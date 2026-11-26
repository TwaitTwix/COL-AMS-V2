import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseArchivedEmail} from '../src/services/email-release-service.js';
import {emailReleaseSchema} from '../src/controllers/email-release-controller.js';
const input={actor:'actor',student:'student',user:'user',email:'owner@example.invalid',reason:'Duplicate registration'};
test('email release requires an exact confirmation, identity, and reason',()=>{
  const valid={user_id:'00000000-0000-4000-8000-000000000001',email:input.email,reason:input.reason,confirm:'RELEASE'};
  assert.equal(emailReleaseSchema.safeParse(valid).success,true);
  for(const change of [{confirm:'release'},{reason:''},{user_id:'bad'},{email:'bad'}])assert.equal(emailReleaseSchema.safeParse({...valid,...change}).success,false);
});
test('retirement blocks the old login before Auth soft deletion and completion',async()=>{
  const calls=[];
  await releaseArchivedEmail(input,{rpc:async(name,args)=>{calls.push(name);return {data:{user_id:input.user,completed:false}};},admin:{getUserById:async()=>({data:{user:{}}}),deleteUser:async(id,soft)=>{calls.push('auth');assert.equal(id,input.user);assert.equal(soft,true);return {};}}});
  assert.deepEqual(calls,['begin_archived_email_release','auth','finish_archived_email_release']);
});
test('failed Auth retirement never releases the personal ID and can be retried',async()=>{
  const calls=[];await assert.rejects(releaseArchivedEmail(input,{rpc:async name=>{calls.push(name);return {data:{user_id:input.user}};},admin:{getUserById:async()=>({data:{user:{}}}),deleteUser:async()=>({error:{status:503}})}}),/unfinished/);
  assert.deepEqual(calls,['begin_archived_email_release']);
  let deleted=false;await releaseArchivedEmail(input,{rpc:async()=>({data:{completed:true}}),admin:{getUserById:async()=>({data:{user:{}}}),deleteUser:async()=>{deleted=true;}}});assert.equal(deleted,false);
});
test('invalid preparation prevents Auth changes; unfinished completion reports retry',async()=>{
  let deleted=false;await assert.rejects(releaseArchivedEmail(input,{rpc:async()=>({error:{code:'P0001',message:'Archive first'}}),admin:{getUserById:async()=>({data:{user:{}}}),deleteUser:async()=>{deleted=true;}}}),/Archive first/);assert.equal(deleted,false);
  await assert.rejects(releaseArchivedEmail(input,{rpc:async name=>name.startsWith('begin')?{data:{user_id:input.user}}:{error:{message:'Not deleted'}},admin:{getUserById:async()=>({data:{user:{}}}),deleteUser:async()=>({error:{status:404}})}}),/unfinished/);
});

test('retry after Auth retirement skips a second deletion and completes using server confirmation',async()=>{
  let deleted=false;const args=[];
  const result=await releaseArchivedEmail(input,{rpc:async(name,params)=>{args.push([name,params]);return name.startsWith('begin')?{data:{user_id:input.user}}:{data:{completed:true}};},admin:{getUserById:async()=>({data:{user:{deleted_at:'2026-11-20T04:40:53Z'}}}),deleteUser:async()=>{deleted=true;}}});
  assert.equal(deleted,false);assert.equal(result.completed,true);assert.equal(args[1][1].p_auth_retired,true);
});
