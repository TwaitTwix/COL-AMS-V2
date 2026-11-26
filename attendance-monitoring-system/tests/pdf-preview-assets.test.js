import test from 'node:test';
import assert from 'node:assert/strict';
test('only the two pinned browser PDF renderer assets are exposed',{skip:!process.env.TEST_BASE_URL},async()=>{
  const base=process.env.TEST_BASE_URL;
  for(const asset of ['pdf.mjs','pdf.worker.mjs']){
    const response=await fetch(`${base}/vendor/pdfjs/${asset}`,{method:'HEAD'});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);
  }
  assert.equal((await fetch(base+'/vendor/pdfjs/package.json')).status,404);
});
