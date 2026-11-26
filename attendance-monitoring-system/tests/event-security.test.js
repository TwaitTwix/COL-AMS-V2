import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DEVICE_SIGNING_SECRET='test-only-signing-secret-not-for-production';
const {createEventQr,verifyEventQr,resolveDevice}=await import('../src/services/security-service.js');
const event={id:'9143352b-0886-4f5e-a159-15082279cab1',qr_version:'cc2ff2d9-0808-4573-bf11-80d374db268d'};
test('event QR verifies only its event and its five-minute validity',()=>{
  const qr=createEventQr(event,1_000_000);
  assert.equal(verifyEventQr(qr.token,event.id,1_000_001).version,event.qr_version);
  assert.throws(()=>verifyEventQr(qr.token,'another-event',1_000_001),/different event/);
  assert.throws(()=>verifyEventQr(qr.token,event.id,1_300_001),/expired/);
});
test('tampered QR payload and signatures are rejected',()=>{
  const qr=createEventQr(event,1_000_000);
  const pieces=qr.token.split('.');pieces[1]=Buffer.from(JSON.stringify({...event,expires:9_999_999})).toString('base64url');
  assert.throws(()=>verifyEventQr(pieces.join('.'),event.id,1_000_001),/Invalid/);
  assert.throws(()=>verifyEventQr(qr.token+'.extra',event.id,1_000_001),/Invalid/);
  assert.throws(()=>verifyEventQr('random QR',event.id,1_000_001),/Invalid/);
});
test('device cookie is signed, stable, HttpOnly, and replaced when forged',()=>{
  let cookie;
  const response={append:(_key,value)=>{cookie=value;}};
  const first=resolveDevice({headers:{},secure:true},response);
  assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Secure/);
  const stored=cookie.split(';')[0];
  assert.equal(resolveDevice({headers:{cookie:stored},secure:true},response),first);
  assert.notEqual(resolveDevice({headers:{cookie:stored+'forged'},secure:true},response),first);
});
