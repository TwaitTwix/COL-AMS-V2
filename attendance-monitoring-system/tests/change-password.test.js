import test from 'node:test';
import assert from 'node:assert/strict';
import { changePasswordSchema } from '../src/validators/change-password-validator.js';
import { changeOwnPassword } from '../src/services/change-password-service.js';
const input={userId:'owner',email:'owner@example.test',authorization:'Bearer original-owner-token',currentPassword:'Old-password42!',password:'New-password42!'};
test('password change requires a current password, a matching strong new password and a different value',()=>{
  assert.equal(changePasswordSchema.safeParse({current_password:input.currentPassword,password:input.password,confirm_password:input.password}).success,true);
  for(const body of [{current_password:'',password:input.password,confirm_password:input.password},{current_password:input.currentPassword,password:'weak',confirm_password:'weak'},{current_password:input.currentPassword,password:input.password,confirm_password:'different'},{current_password:input.password,password:input.password,confirm_password:input.password}])assert.equal(changePasswordSchema.safeParse(body).success,false);
});
test('self-service change verifies the owner, uses the existing authorization, and disposes its verification session',async()=>{
  let disposed=0,updated=0;
  const client={auth:{signInWithPassword:async values=>{assert.equal(values.email,input.email);assert.equal(values.password,input.currentPassword);return {data:{user:{id:'owner'}}};},signOut:async options=>{assert.equal(options.scope,'local');disposed++;}}};
  await changeOwnPassword(input,{client,update:async(auth,password)=>{updated++;assert.equal(auth,input.authorization);assert.equal(password,input.password);}});
  assert.equal(updated,1);assert.equal(disposed,1);
});
test('wrong credentials or a different verified owner cannot update a password; cleanup still runs',async()=>{
  for(const result of [{error:{status:400}},{data:{user:{id:'other-user'}}},{error:{status:0}},{error:{status:429}}]){
    let disposed=0,updated=0;
    await assert.rejects(changeOwnPassword(input,{client:{auth:{signInWithPassword:async()=>result,signOut:async()=>{disposed++;}}},update:async()=>{updated++;}}));
    assert.equal(updated,0);assert.equal(disposed,1);
  }
});
test('verification session is disposed if provider password protection rejects the change',async()=>{
  let disposed=0;
  await assert.rejects(changeOwnPassword(input,{client:{auth:{signInWithPassword:async()=>({data:{user:{id:'owner'}}}),signOut:async()=>{disposed++;}}},update:async()=>{throw new Error('Reauthentication required');}}));assert.equal(disposed,1);
});
