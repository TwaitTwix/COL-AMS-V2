import test from 'node:test';
import assert from 'node:assert/strict';

test('academic catalog exposes the supplied hierarchy and rejects invalid registration combinations',{skip:!process.env.TEST_BASE_URL},async()=>{
  const base=process.env.TEST_BASE_URL;
  const response=await fetch(base+'/api/auth/colleges');assert.equal(response.status,200);
  const {colleges}=await response.json();
  const isap=colleges.filter(c=>c.institution==='ISAP'),mcnp=colleges.filter(c=>c.institution==='MCNP');
  assert.equal(isap.length,4);assert.equal(mcnp.length,6);
  assert.equal(isap.flatMap(c=>c.courses).length,12);assert.equal(mcnp.flatMap(c=>c.courses).length,6);
  const cite=isap.find(c=>c.abbreviation==='CITE');
  assert.deepEqual(cite.courses,['Bachelor of Science in Computer Engineering','Bachelor of Science in Information Technology']);
  assert.equal(mcnp.some(c=>c.abbreviation==='CITE'),false);
  const input={full_name:'Validation only',personal_id:'NOT-A-REAL-REGISTRATION',email:'validation-only@example.invalid',password:'Validation-only-123',privacy_accepted:true,institution:'ISAP',college:cite.name,course:'Bachelor of Science in Nursing'};
  const invalid=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal(invalid.status,400);
  assert.equal((await invalid.json()).error.message,'This course does not belong to the selected institution and college');
  const {course,...missingCourse}=input;
  const missing=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(missingCourse)});
  assert.equal(missing.status,400);
  assert.ok((await missing.json()).error.details.some(issue=>issue.path.includes('course')));
});
