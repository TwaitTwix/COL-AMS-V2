import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {createOperationalAuthenticator,canUseFeature} from '../src/services/operational-access-service.js';
import {createOperationalRouter} from '../src/routes/operational.js';
import {legacyApiGate,registrationGate} from '../src/middleware/revision-mode.js';
import {errorHandler} from '../src/middleware/error-handler.js';
import {operationalAccountSchema,operationalInviteSchema} from '../src/validators/operational-access-validator.js';
import {provisionOperationalAccount,generateOperationalInvitation} from '../src/services/operational-account-service.js';

const privacy='2026-11-17',id=randomUUID(),sid=randomUUID();
const token=(sub=id,session=sid)=>'header.'+Buffer.from(JSON.stringify({sub,session_id:session})).toString('base64url')+'.verified-by-provider';
const access=role=>({user_id:id,role,enabled:true,version:1,full_name:'Test Operator',scopes:[],features:[{key:'events.view',effective:true},{key:'accounts.manage',effective:role==='administrator'}]});
async function fixture(t,{role='col_regular',mutate=()=>{}}={}){
  const state={access:access(role),profile:{user_id:id,email:'operator@test.invalid',privacy_version:privacy},user:{id,email_confirmed_at:'2026-01-01',user_metadata:{role:'administrator'}},calls:[],session:true};mutate(state);
  const client={rpc:async(name,args)=>{state.calls.push({name,args});if(state.failure)return{error:{code:'08006'}};if(name==='get_operational_access')return{data:state.access};if(name==='enforce_operational_login')return{data:{active:state.session}};if(name==='list_operational_events')return{data:[{id:'assigned-event'}]};if(name==='list_operational_accounts')return{data:{items:[],total:0,page:1,page_size:10}};if(name==='operational_account_candidates')return{data:[]};if(name==='save_operational_account')return state.saveError?{error:state.saveError}:{data:{user_id:args.p_user}};return{data:null};},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:state.profile})})})}),auth:{admin:{getUserById:async()=>({data:{user:{id,email_confirmed_at:'2026-01-01'}}})}}};
  const authenticate=createOperationalAuthenticator({client,verifier:{auth:{getUser:async()=>state.invalid?{error:{status:401}}:{data:{user:state.user}}}},privacyVersion:privacy});
  const app=express();app.use(express.json());app.use('/api/operational',createOperationalRouter({client,authenticate,mode:'revision',privacyVersion:privacy}));app.use('/api/student',legacyApiGate('revision'));app.use('/api/admin',legacyApiGate('revision'));app.use('/api/attendance',legacyApiGate('revision'));app.post('/api/auth/register',registrationGate('revision'));app.patch('/api/auth/registration',registrationGate('revision'));app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const request=(url,options={})=>fetch(base+url,{...options,headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json',...options.headers}});
  return{state,request};
}

test('operational requests verify Auth subject/session, ignore editable metadata, and do not expose account management to COL roles',async t=>{
  const {state,request}=await fixture(t);
  assert.equal((await request('/api/operational/events')).status,200);
  assert.equal(state.calls.find(c=>c.name==='list_operational_events').args.p_actor,id);
  for(const path of ['/accounts','/account-candidates?search=Test'])assert.equal((await request('/api/operational'+path)).status,403);
  for(const [path,method] of [['/accounts/'+randomUUID(),'PUT'],['/accounts/provision','POST'],['/accounts/'+randomUUID()+'/invitation','POST']])assert.equal((await request('/api/operational'+path,{method,body:'{}'})).status,403);
  assert.equal((await request('/api/operational/me',{headers:{Authorization:'Bearer '+token(randomUUID())}})).status,401);
  state.invalid=true;assert.equal((await request('/api/operational/me')).status,401);
});
test('disabled, unprovisioned, retired, unverified and replaced accounts fail closed; outages are retryable',async t=>{
  for(const change of [s=>s.access.enabled=false,s=>s.access=null,s=>s.profile.retired_at='2026-01-01',s=>s.session=false]){
    const {request}=await fixture(t,{mutate:change});assert.equal((await request('/api/operational/me')).status,401);
  }
  const unverified=await fixture(t,{mutate:s=>{s.user.email_confirmed_at=null;s.user.confirmed_at='2026-01-01';}});assert.equal((await unverified.request('/api/operational/me')).status,403);
  const outage=await fixture(t,{mutate:s=>s.failure=true});assert.equal((await outage.request('/api/operational/me')).status,503);
  const consent=await fixture(t,{mutate:s=>s.profile.privacy_version=null});assert.equal((await consent.request('/api/operational/events')).status,403);
});
test('revoked grants apply on the next request, including direct API requests',async t=>{
  const {state,request}=await fixture(t,{role:'administrator'});
  assert.equal((await request('/api/operational/accounts')).status,200);
  state.access=access('club_president');assert.equal((await request('/api/operational/accounts')).status,403);
  state.access.features[0].effective=false;assert.equal((await request('/api/operational/events')).status,403);
  assert.equal(canUseFeature({...access('administrator'),enabled:false},'accounts.manage'),false);
});
test('administrator updates use verified actor and version, reject injected actors, and surface concurrent-edit conflicts',async t=>{
  const {state,request}=await fixture(t,{role:'administrator'});const target=randomUUID();
  const body={role:'col_regular',full_name:'Scoped Operator',enabled:true,version:3,scopes:[],overrides:{'events.view':false},reason:'Review assignment'};
  assert.equal((await request('/api/operational/accounts/'+target,{method:'PUT',body:JSON.stringify({...body,p_actor:target})})).status,400);
  assert.equal((await request('/api/operational/accounts/'+target,{method:'PUT',body:JSON.stringify(body)})).status,200);
  const call=state.calls.find(c=>c.name==='save_operational_account');assert.equal(call.args.p_actor,id);assert.equal(call.args.p_version,3);assert.equal(call.args.p_user,target);
  state.saveError={code:'40001',message:'Account changed. Reload before saving'};assert.equal((await request('/api/operational/accounts/'+target,{method:'PUT',body:JSON.stringify(body)})).status,409);
});
test('revision mode closes old global APIs and public registration independently of client menus',async t=>{
  const {request}=await fixture(t);
  for(const prefix of ['/api/student','/api/admin','/api/attendance'])for(const method of ['GET','POST','PUT','PATCH','DELETE'])assert.equal((await request(prefix+'/any-path',{method})).status,403);
  assert.equal((await request('/api/auth/register',{method:'POST',body:'{}'})).status,403);
  assert.equal((await request('/api/auth/registration',{method:'PATCH',body:'{}'})).status,403);
});
test('provisioning preflight avoids orphan identities; partial failures keep identity recoverable without sending messages',async()=>{
  const calls=[];let bad=true;let dbBad=false;const created=randomUUID();
  const client={rpc:async name=>{calls.push(name);return{data:null,error:bad?{code:'42501',message:'Denied'}:dbBad&&name==='save_operational_account'?{code:'40001',message:'Conflict'}:null};},auth:{admin:{createUser:async()=>{calls.push('createUser');return{data:{user:{id:created,email:'invite@test.invalid'}}};}}},from:()=>({upsert:async()=>({})})};
  const input={role:'col_regular',full_name:'Invited',email:'invite@test.invalid',scopes:[],overrides:{},reason:'Staff assignment'};
  await assert.rejects(()=>provisionOperationalAccount(client,id,input),e=>e.status===403);assert.ok(!calls.includes('createUser'));
  bad=false;dbBad=true;await assert.rejects(()=>provisionOperationalAccount(client,id,input),e=>e.message.includes(created)&&e.message.includes('No invitation was sent'));
  dbBad=false;const result=await provisionOperationalAccount(client,id,input);assert.equal(result.invitation_sent,false);
});
test('invitation links must match the intended unverified identity and never use automatic email delivery',async()=>{
  let returned=randomUUID();const client={auth:{admin:{getUserById:async()=>({data:{user:{id,email:'invite@test.invalid'}}}),generateLink:async()=>({data:{user:{id:returned},properties:{action_link:'https://example.invalid/one-time'}}})}}};
  await assert.rejects(()=>generateOperationalInvitation(client,id,'https://app.invalid'),/did not match/);
  returned=id;assert.equal((await generateOperationalInvitation(client,id,'https://app.invalid')).url,'https://example.invalid/one-time');
});
test('operational validators require explicit scopes, decision reason, known roles and version; invitation schema loads with pinned Zod',()=>{
  const body={role:'col_regular',full_name:'Test',enabled:true,version:0,scopes:[],overrides:{},reason:'Assignment'};
  assert.ok(operationalAccountSchema.safeParse(body).success);
  assert.ok(!operationalAccountSchema.safeParse({...body,role:'student'}).success);
  assert.ok(!operationalAccountSchema.safeParse({...body,reason:''}).success);
  const {enabled,version,...invite}=body;assert.ok(operationalInviteSchema.safeParse({...invite,email:'invite@test.invalid'}).success);
});
