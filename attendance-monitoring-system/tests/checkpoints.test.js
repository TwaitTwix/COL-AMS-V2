import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventSchema } from '../src/validators/admin-validator.js';
import { eventCheckpoints,checkpointOpen } from '../public/js/checkpoints.js';
const event={name:'All-day event',latitude:17,longitude:121,radius_meters:100,starts_at:'2026-11-20T00:00:00Z',ends_at:'2026-11-20T10:00:00Z'};
test('single events inherit their attendance window; multi-checkpoint windows are required and non-overlapping',()=>{
  const single=createEventSchema.parse(event);assert.equal(eventCheckpoints(single).length,1);assert.equal(eventCheckpoints(single)[0].opens_at,'2026-11-19T23:00:00.000Z');
  const checkpoints=[{key:'start',label:'Morning arrival',opens_at:'2026-11-20T00:00:00Z',closes_at:'2026-11-20T01:00:00Z'},{key:'end',label:'Final departure',opens_at:'2026-11-20T09:00:00Z',closes_at:'2026-11-20T10:00:00Z'}];
  assert.equal(createEventSchema.safeParse({...event,checkpoints}).success,true);
  assert.equal(createEventSchema.safeParse({...event,checkpoints:[checkpoints[0],{...checkpoints[1],opens_at:'2026-11-20T00:30:00Z'}]}).success,false);
  assert.equal(createEventSchema.safeParse({...event,checkpoints:[checkpoints[0],{...checkpoints[1],key:'start'}]}).success,false);
  assert.equal(checkpointOpen(checkpoints[1],Date.parse('2026-11-20T08:00:00Z')),false);
});
