// Opt-in live smoke test; uses only existing demo credentials and read-only
// endpoints. /auth/me records the expected demo browser login as a side effect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
const base=process.env.TEST_BASE_URL;
test('live student/admin endpoints enforce roles and return the new dashboard',{skip:!base},async()=>{
  const credentials=JSON.parse(await readFile(new URL('../.demo-credentials.json',import.meta.url),'utf8'));
  const config=await fetch(base+'/api/auth/config').then(r=>r.json());
  let cookie='';
  for(const email of ['student.demo@example.com','col.officer@example.com']){
    const account=credentials.accounts.find(a=>a.email===email);
    const client=createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.auth.signInWithPassword({email,password:account.password});
    if(error)throw new Error('Demo sign-in failed: '+error.message);
    const headers={Authorization:'Bearer '+data.session.access_token,...(cookie?{Cookie:cookie}:{})};
    assert.equal((await fetch(base+'/api/auth/activate-session',{method:'POST',headers})).status,200);
    const me=await fetch(base+'/api/auth/me',{headers});assert.equal(me.status,200);
    cookie=me.headers.get('set-cookie')?.split(';')[0]||cookie;
    headers.Cookie=cookie;
    const payload=await me.json();assert.equal(payload.profile.role,account.role);
    const invalidChange=await fetch(base+'/api/auth/change-password',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({current_password:'Validation-only',password:'weak',confirm_password:'weak'})});assert.equal(invalidChange.status,400);
    if(payload.privacy_required){
      assert.equal(payload.device,null);
      const path=account.role==='student'?'/api/student/dashboard':'/api/admin/security';
      assert.equal((await fetch(base+path,{headers})).status,403);
      assert.equal((await fetch(base+'/api/admin/review-summary',{headers})).status,403);
      assert.equal((await fetch(base+'/api/admin/reviews?category=notifications',{headers})).status,403);
      assert.equal((await fetch(base+'/api/admin/activity-logs?category=logins',{headers})).status,403);
      assert.equal((await fetch(base+'/api/admin/student-directory',{headers})).status,403);
      assert.equal((await fetch(base+'/api/student/notifications',{headers})).status,403);
      assert.equal((await fetch(base+'/api/admin/manual-attendance',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,403);
      await client.auth.signOut({scope:'local'});continue;
    }
    assert.ok(payload.device.device_id);
    if(account.role==='student'){
      const dashboard=await fetch(base+'/api/student/dashboard',{headers});assert.equal(dashboard.status,200);assert.ok(Array.isArray((await dashboard.json()).events));
      assert.equal((await fetch(base+'/api/admin/security',{headers})).status,403);
      assert.equal((await fetch(base+'/api/student/check-in',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,400);
    }else{
      const dashboard=await fetch(base+'/api/student/dashboard',{headers});assert.equal(dashboard.status,200);assert.ok(Array.isArray((await dashboard.json()).events));
      assert.equal((await fetch(base+'/api/student/check-in',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,400);
      assert.equal((await fetch(base+'/api/admin/security',{headers})).status,200);
      assert.equal((await fetch(base+'/api/admin/notifications',{headers})).status,200);
      assert.equal((await fetch(base+'/api/admin/users/'+payload.user.id,{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({role:'admin'})})).status,403);
    }
    await client.auth.signOut({scope:'local'});
  }
});
