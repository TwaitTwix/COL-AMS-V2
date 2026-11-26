import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordSchema } from '../src/validators/password-validator.js';
import { strongPassword } from '../public/js/password-policy.js';
test('registration/reset password policy requires mixed case, digit, symbol and length',()=>{
  for(const password of ['Short1!','onlylowercase1!','ONLYUPPERCASE1!','NoSpecial12345','NoNumbersHere!','a'.repeat(129)]){
    assert.equal(strongPassword(password),false);assert.equal(passwordSchema.safeParse(password).success,false);
  }
  assert.equal(passwordSchema.parse('Campus-Password42!'),'Campus-Password42!');
});
test('registration rejects weak passwords and missing consent before creating Auth users',{skip:!process.env.TEST_BASE_URL},async()=>{
  const input={full_name:'Validation only',personal_id:'NOT-A-REAL-REGISTRATION',email:'validation-only@example.invalid',password:'weak',institution:'ISAP',college:'College of Information Technology and Engineering',course:'Bachelor of Science in Information Technology',privacy_accepted:true};
  for(const body of [input,{...input,password:'Campus-Password42!',privacy_accepted:false}]){
    const response=await fetch(process.env.TEST_BASE_URL+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(response.status,400);assert.ok((await response.json()).error.details.length);
  }
});
