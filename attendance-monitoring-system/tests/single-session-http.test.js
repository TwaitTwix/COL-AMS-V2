import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {createClient} from '@supabase/supabase-js';
const base=process.env.TEST_BASE_URL;
test('new demo login replaces old access while refresh preserves the active session',{skip:process.env.TEST_SINGLE_SESSION!=='1'||!base,timeout:60000},async()=>{
 const config=await fetch(base+'/api/auth/config').then(r=>r.json());
 const {accounts}=JSON.parse(await readFile(new URL('../.demo-credentials.json',import.meta.url),'utf8'));
 const account=accounts.find(a=>a.email==='student.demo@example.com');
 const clients=Array.from({length:2},()=>createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false}}));
 const request=(path,token,method='GET')=>fetch(base+path,{method,headers:{Authorization:'Bearer '+token}});
 try{
   const first=await clients[0].auth.signInWithPassword({email:account.email,password:account.password});assert.ifError(first.error);
   const a=first.data.session.access_token;assert.equal((await request('/api/auth/activate-session',a,'POST')).status,200);assert.equal((await request('/api/auth/session',a)).status,200);
   const second=await clients[1].auth.signInWithPassword({email:account.email,password:account.password});assert.ifError(second.error);
   const b=second.data.session.access_token;assert.equal((await request('/api/auth/activate-session',b,'POST')).status,200);
   const replaced=await request('/api/auth/session',a);assert.equal(replaced.status,401);assert.equal((await replaced.json()).error.code,'SESSION_REPLACED');
   assert.equal((await request('/api/auth/activate-session',a,'POST')).status,401);
   const refreshed=await clients[1].auth.refreshSession();assert.ifError(refreshed.error);assert.equal((await request('/api/auth/session',refreshed.data.session.access_token)).status,200);
 }finally{await Promise.all(clients.map(c=>c.auth.signOut({scope:'local'})));}
});
