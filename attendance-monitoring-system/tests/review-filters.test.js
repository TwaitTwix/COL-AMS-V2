import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewQuerySchema,bulkApprovalSchema } from '../src/controllers/review-center-controller.js';
test('review filters default to ten pending records and reject invalid query values',()=>{
  assert.deepEqual(reviewQuerySchema.parse({category:'attendance'}),{category:'attendance',state:'pending',risk:'all',search:'',page:1,page_size:10});
  for(const query of [{category:'unknown'},{category:'devices',page:'0'},{category:'devices',page_size:'51'},{category:'attendance',state:'bad'},{category:'notifications',search:'x'.repeat(101)}])assert.equal(reviewQuerySchema.safeParse(query).success,false);
});
test('bulk approval only accepts bounded distinct IDs and known risk filters',()=>{
  const id='00000000-0000-4000-8000-000000000001';
  assert.equal(bulkApprovalSchema.safeParse({ids:[id]}).success,true);
  for(const ids of [[],[id,id],['bad'],Array(501).fill(id)])assert.equal(bulkApprovalSchema.safeParse({ids}).success,false);
  assert.equal(reviewQuerySchema.safeParse({category:'attendance',risk:'safe'}).success,false);
  assert.equal(reviewQuerySchema.parse({category:'attendance',risk:'flagged'}).risk,'flagged');
});
