import test from 'node:test';
import assert from 'node:assert/strict';
test('account deep links load the app and anonymous password changes are blocked',{skip:!process.env.TEST_BASE_URL},async()=>{
  const base=process.env.TEST_BASE_URL;
  const page=await fetch(base+'/account');assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);
  const response=await fetch(base+'/api/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,401);
});
