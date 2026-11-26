import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventSchema } from '../src/validators/admin-validator.js';
const event={name:'Test event',latitude:17,longitude:121,radius_meters:100,starts_at:'2026-11-17T08:00:00Z',ends_at:'2026-11-17T10:00:00Z'};
test('event attempt cap defaults to three and only accepts whole numbers from one through twenty',()=>{
  assert.equal(createEventSchema.parse(event).max_check_in_attempts,3);
  assert.equal(createEventSchema.parse({...event,max_check_in_attempts:1}).max_check_in_attempts,1);
  for(const max_check_in_attempts of [0,-1,1.5,21,'3',null])assert.equal(createEventSchema.safeParse({...event,max_check_in_attempts}).success,false);
});
