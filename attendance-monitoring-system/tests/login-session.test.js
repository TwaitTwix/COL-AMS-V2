import test from 'node:test';
import assert from 'node:assert/strict';
import {enforceLoginSession} from '../src/services/login-session-service.js';
const userId='user',sessionId='00000000-0000-4000-8000-000000000001';
const token=claims=>'header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
test('single-session check uses the verified subject and Auth session, not caller-supplied timestamps',async()=>{
 const accessToken=token({sub:userId,session_id:sessionId,iat:9999999999});let args;
 await enforceLoginSession({userId,accessToken,activate:true},async(name,input)=>{args={name,input};return {data:{active:true}};});
 assert.deepEqual(args,{name:'enforce_active_login',input:{p_user:userId,p_session:sessionId,p_activate:true}});
});
test('missing, mismatched and replaced sessions are rejected; outages remain retryable',async()=>{
 for(const accessToken of ['bad',token({sub:'other',session_id:sessionId}),token({sub:userId})])await assert.rejects(enforceLoginSession({userId,accessToken},()=>{throw Error('Must not call');}),e=>e.status===401);
 await assert.rejects(enforceLoginSession({userId,accessToken:token({sub:userId,session_id:sessionId})},async()=>({data:{active:false}})),e=>e.status===401&&e.code==='SESSION_REPLACED');
 await assert.rejects(enforceLoginSession({userId,accessToken:token({sub:userId,session_id:sessionId})},async()=>({error:{message:'Offline'}})),e=>e.status===503);
});
