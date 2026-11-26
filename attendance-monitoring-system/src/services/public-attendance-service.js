import {createHmac,createHash,timingSafeEqual,randomUUID} from 'node:crypto';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function requireAttendanceSecret(secret){if(!secret)throw fail('Attendance verification is not configured. Contact the event officer.',503);return secret;}
export function attendanceFormToken({token,device,secret,now=Date.now()}){
 requireAttendanceSecret(secret);
 const payload=Buffer.from(JSON.stringify({token,device,expires:now+15*60000,nonce:randomUUID()})).toString('base64url');
 const signature=createHmac('sha256',secret).update('public-attendance-form:'+payload).digest('base64url');
 return payload+'.'+signature;
}
export function verifyAttendanceFormToken({value,token,device,secret,now=Date.now()}){
 requireAttendanceSecret(secret);
 const [payload,signature,extra]=value.split('.');const expected=createHmac('sha256',secret).update('public-attendance-form:'+payload).digest('base64url');
 const a=Buffer.from(signature||''),b=Buffer.from(expected);
 if(extra||!payload||a.length!==b.length||!timingSafeEqual(a,b))throw fail('This attendance form could not be verified. Refresh the form and allow browser cookies.');
 let data;try{data=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{throw fail('Refresh the attendance form and try again.');}
 if(data.token!==token||data.device!==device||!Number.isFinite(data.expires)||data.expires<now||data.expires>now+16*60000)throw fail('This form expired or its browser changed. Refresh it and allow browser cookies.');
}
export function attendancePayloadHash(token,input){
 const {request_id,form_token,...payload}=input;
 return createHash('sha256').update(JSON.stringify({token,...payload})).digest('hex');
}
export function attendanceIpHash(ip,secret){return createHmac('sha256',requireAttendanceSecret(secret)).update('public-attendance-ip:'+ip).digest('hex');}
export function publicEventFields(data){
 return {name:data.name,institution:data.institution,starts_at:data.starts_at,ends_at:data.ends_at,server_time:data.server_time,max_attempts:data.max_attempts,active_checkpoint_key:data.active_checkpoint_key,
 checkpoints:(data.checkpoints||[]).map(c=>({key:c.key,label:c.label,opens_at:c.opens_at,closes_at:c.closes_at}))};
}
