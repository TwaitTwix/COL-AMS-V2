import test from 'node:test';import assert from 'node:assert/strict';
process.env.APP_MAINTENANCE='true';process.env.ACCESS_MODE='revision';const {default:app}=await import('../src/app.js');
test('maintenance pauses new public, operational, legacy and scheduled API requests before side effects',async t=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 for(const [path,method] of [['/api/public-attendance/test','POST'],['/api/operational/reports','POST'],['/api/operational/reports/summary','GET'],['/api/internal/review-escalation','GET'],['/api/admin/users','GET'],['/api/auth/register','POST']]){const r=await fetch(base+path,{method});assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'60');assert.equal(r.headers.get('cache-control'),'no-store');}
 assert.equal((await fetch(base+'/')).status,200);const health=await fetch(base+'/api/health');assert.notEqual(health.headers.get('retry-after'),'60');
});
