import test from 'node:test';
import assert from 'node:assert/strict';
process.env.ACCESS_MODE='revision';
const {default:app}=await import('../src/app.js');

test('real application wiring closes legacy APIs and registration in revision mode without contacting Auth',async t=>{
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  for(const path of ['/api/admin/users','/api/admin/reports','/api/student/dashboard','/api/attendance/check-in'])assert.equal((await fetch(base+path)).status,403);
  for(const [path,method] of [['/api/auth/register','POST'],['/api/auth/registration','PATCH']])assert.equal((await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const config=await fetch(base+'/api/auth/config');if(config.ok){const data=await config.json();assert.equal(data.registrationOpen,false);assert.equal(data.accessMode,'revision');}
  const configured=process.env.SUPABASE_URL&&process.env.SUPABASE_PUBLISHABLE_KEY&&(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal((await fetch(base+'/api/operational/me')).status,configured?401:503);
  assert.equal((await fetch(base+'/account')).status,200);
  const attendance=await fetch(base+'/attend/11111111-1111-4111-8111-111111111111');
  assert.equal(attendance.status,200);
  assert.match(attendance.headers.get('permissions-policy'),/camera=\(\)/);
  assert.match(await attendance.text(),/public-attendance.js/);
});
