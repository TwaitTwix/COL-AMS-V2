import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingUsers } from '../public/js/role-search.js';

test('account suggestions match names, email and personal ID without case or word-order sensitivity',()=>{
  const users=[{user_id:'1',full_name:'Ana Cruz',email:'ana@example.test',personal_id:'ISAP-001'},{user_id:'2',full_name:'Ben Cruz',email:'ben@example.test',personal_id:'MCNP-002'}];
  assert.deepEqual(matchingUsers(users,' CRUZ ana ').map(u=>u.user_id),['1']);
  assert.deepEqual(matchingUsers(users,'mcnp-002').map(u=>u.user_id),['2']);
  assert.equal(matchingUsers(users,'example.test').length,2);
  assert.equal(matchingUsers(users,'no match').length,0);
  assert.equal(matchingUsers(users,'').length,2);
});
