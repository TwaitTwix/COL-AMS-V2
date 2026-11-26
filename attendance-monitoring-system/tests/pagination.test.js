import test from 'node:test';
import assert from 'node:assert/strict';
import { pageNumbers } from '../public/js/pagination.js';
import { activityQuerySchema } from '../src/controllers/activity-logs-controller.js';
test('page numbers expose every small page and a compact window for large collections',()=>{
  assert.deepEqual(pageNumbers(1,1),[1]);assert.deepEqual(pageNumbers(3,5),[1,2,3,4,5]);
  assert.deepEqual(pageNumbers(50,100),[1,null,49,50,51,null,100]);
  for(const current of [1,2,3,4,50,97,98,99,100]){
    const pages=pageNumbers(current,100).filter(n=>n!==null);
    assert.equal(pages[0],1);assert.equal(pages.at(-1),100);assert.ok(pages.includes(current));assert.equal(new Set(pages).size,pages.length);assert.ok(pages.length<=7);
  }
});
test('activity queries validate category-specific filters and bounded pagination',()=>{
  assert.deepEqual(activityQuerySchema.parse({}),{category:'logins',filter:'all',search:'',page:1,page_size:10});
  for(const input of [{category:'bad'},{category:'audit',filter:'flagged'},{category:'logins',filter:'attendance'},{page:0},{page_size:51},{search:'x'.repeat(101)}])assert.equal(activityQuerySchema.safeParse(input).success,false);
});
