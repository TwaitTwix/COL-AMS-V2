import test from 'node:test';
import assert from 'node:assert/strict';
import { directoryQuerySchema } from '../src/controllers/student-directory-controller.js';
test('student directory defaults to active records and bounds search and pages',()=>{
  assert.deepEqual(directoryQuerySchema.parse({}),{search:'',state:'active',page:1,page_size:10});
  for(const input of [{state:'unknown'},{page:0},{page_size:51},{search:'x'.repeat(101)}])assert.equal(directoryQuerySchema.safeParse(input).success,false);
});
