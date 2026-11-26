import {createClient} from '@supabase/supabase-js';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const url='https://jpdebursuvgxgdklpbod.supabase.co',site='https://col-ams-v2.vercel.app';
if(!process.argv.includes('--confirm-test-accounts')||process.env.SUPABASE_URL!==url)throw Error('Explicit V2 URL and --confirm-test-accounts required');
if(!process.env.SUPABASE_SECRET_KEY||!process.env.SUPABASE_PUBLISHABLE_KEY)throw Error('V2 keys required');
const client=createClient(url,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const rpc=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw Error(name+': '+error.message);return data;};
const check=result=>{if(result.error)throw Error(result.error.message);return result.data;};
const directory=path.resolve(process.env.V2_TEST_CREDENTIALS_DIR||'.local-preview');await mkdir(directory,{recursive:true});
const file=path.join(directory,'v2-test-accounts.json'),markdown=path.join(directory,'v2-test-accounts.md');let saved={project_url:url,created_at:new Date().toISOString(),accounts:[]};
try{saved=JSON.parse(await readFile(file,'utf8'));if(saved.project_url!==url)throw Error('Credential file belongs to another project');}catch(error){if(error.code!=='ENOENT')throw error;}
const persist=()=>writeFile(file,JSON.stringify(saved,null,2)+'\n',{mode:0o600});
const owners=check(await client.from('operational_accounts').select('user_id,role,enabled,user_profiles!inner(email)').eq('role','administrator').eq('enabled',true));
const owner=owners.find(o=>o.user_profiles.email?.toLowerCase()==='leonardolllmacalinaoisap@gmail.com');if(!owner)throw Error('The designated active V2 administrator is required');
const identity=check(await client.auth.admin.getUserById(owner.user_id)).user;if(!identity.email_confirmed_at||identity.deleted_at)throw Error('The designated owner must be verified');
const definitions=[
 {role:'classroom_representative',email:'test.classroom-rep@example.com',name:'TEST ONLY - Classroom Representative',scopes:[]},
 {role:'club_president',email:'test.club-president@example.com',name:'TEST ONLY - Club President',scopes:[]},
 {role:'col_regular',email:'test.col-regular@example.com',name:'TEST ONLY - COL Regular',scopes:[{kind:'institution',scope_id:'ISAP'}]},
 {role:'col_admin',email:'test.col-admin@example.com',name:'TEST ONLY - COL Admin',scopes:[{kind:'institution',scope_id:'ISAP'},{kind:'institution',scope_id:'MCNP'}]},
 {role:'administrator',email:'test.administrator@example.com',name:'TEST ONLY - Administrator',scopes:[]}
];
let users=[];for(let page=1;;page++){const result=check(await client.auth.admin.listUsers({page,perPage:1000}));users.push(...result.users);if(result.users.length<1000)break;if(page>=20)throw Error('Auth identity inventory exceeds safe bound');}
for(const def of definitions){
 await rpc('validate_operational_provision',{p_actor:owner.user_id,p_role:def.role,p_scopes:def.scopes,p_overrides:{}});
 let user=users.find(u=>u.email?.toLowerCase()===def.email),record=saved.accounts.find(a=>a.email===def.email);
 if(user&&(!user.app_metadata?.col_ams_v2_test_fixture||!record||record.user_id!==user.id))throw Error('Refusing to modify an unrecognized existing identity: '+def.email);
 if(!user){
  const password='V2!aA9'+randomBytes(18).toString('base64url');
  user=check(await client.auth.admin.createUser({email:def.email,password,email_confirm:true,app_metadata:{col_ams_v2_test_fixture:true},user_metadata:{full_name:def.name}})).user;
  record={email:def.email,password,user_id:user.id,role:def.role};saved.accounts.push(record);await persist();
 }
 if(user.deleted_at||!user.email_confirmed_at)throw Error('Test identity is inactive or unconfirmed');
 const access=await rpc('get_operational_access',{p_user:user.id});
 if(access){if(access.role!==def.role||!access.enabled)throw Error('Existing test account access changed; manual review required');}
 else{
  check(await client.from('user_profiles').upsert({user_id:user.id,email:def.email,full_name:def.name,role:'pending',approval_status:'pending'},{onConflict:'user_id',ignoreDuplicates:true}));
  await rpc('save_operational_account',{p_actor:owner.user_id,p_user:user.id,p_role:def.role,p_name:def.name,p_enabled:true,p_version:0,p_scopes:def.scopes,p_overrides:{},p_reason:'User-requested synthetic V2 role testing'});
 }
}
const course=check(await client.from('courses').select('institution,college,name').eq('institution','ISAP').eq('active',true).ilike('name','%Information Technology%').limit(1))[0];if(!course)throw Error('Active ISAP IT course not found');
let sections=check(await client.from('class_sections').select('*').eq('name','TEST ONLY - Role Testing').eq('academic_year','2026-2027').eq('term','Test environment'));
if(sections.length>1)throw Error('Ambiguous test section');let section=sections[0];
if(!section)section=await rpc('save_class_section',{p_actor:owner.user_id,p_id:null,p_version:0,p_fields:{institution:course.institution,college:course.college,course:course.name,name:'TEST ONLY - Role Testing',academic_year:'2026-2027',term:'Test environment'},p_reason:'Synthetic class for requested role-account testing; no real roster'});
if(section.archived_at||section.created_by!==owner.user_id)throw Error('Existing test section requires review');
for(const [role,kind] of [['classroom_representative','representative'],['club_president','editor']]){
 const account=saved.accounts.find(a=>a.role===role);
 const assignments=check(await client.from('class_assignments').select('user_id').eq('section_id',section.id).eq('kind',kind).is('ended_at',null));
 if(kind==='representative'&&assignments.some(a=>a.user_id!==account.user_id))throw Error('Refusing to replace another class representative');
 if(!assignments.some(a=>a.user_id===account.user_id)){
  section=check(await client.from('class_sections').select('*').eq('id',section.id).single());
  await rpc('assign_class_officer',{p_actor:owner.user_id,p_section:section.id,p_user:account.user_id,p_kind:kind,p_version:section.version,p_replace:false,p_reason:'Synthetic test-role assignment requested by owner'});
 }
}
saved.test_class={id:section.id,name:section.name,institution:section.institution};saved.verification=[];
for(const account of saved.accounts){
 const auth=createClient(url,process.env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const session=check(await auth.auth.signInWithPassword({email:account.email,password:account.password})).session;
  const headers={Authorization:'Bearer '+session.access_token};
  let response=await fetch(site+'/api/auth/activate-session',{method:'POST',headers});if(!response.ok)throw Error('Session activation failed: '+response.status);
  response=await fetch(site+'/api/auth/me',{headers});const me=await response.json();if(!response.ok||me.profile?.role!==account.role)throw Error('Verified application role mismatch');
  const access=await rpc('get_operational_access',{p_user:account.user_id});const admin=access.features.find(f=>f.key==='accounts.manage')?.effective===true;
  if(admin!==(account.role==='administrator'))throw Error('Role permission boundary mismatch');
  saved.verification.push({role:account.role,login:true,application_role_verified:true,privacy_consent_required:me.privacy_required});
 }finally{await auth.auth.signOut({scope:'local'});}
}
saved.verified_at=new Date().toISOString();await persist();
const lines=['# V2 test accounts','',`Sign in: ${site}`,'','These are synthetic pre-verified test identities. No email was sent. Accept the privacy notice yourself on first use.','', '| Role | Email | Password |','| --- | --- | --- |',...saved.accounts.map(a=>`| ${a.role} | ${a.email} | ${a.password} |`),'',`Representative and president: ${section.name} (ISAP).`,'COL regular: ISAP. COL admin: ISAP and MCNP. Administrator: global application access.','No real students, event attendance or penalties were seeded. Existing accounts/passwords were not changed.','Keep this file private and deactivate test accounts when testing is complete.'];
await writeFile(markdown,lines.join('\n')+'\n',{mode:0o600});
console.log(JSON.stringify({created_or_reused:saved.accounts.length,verified_roles:saved.verification.map(v=>v.role),credentials_file:markdown,test_class:section.name,existing_passwords_changed:false,v1_changed:false}));
