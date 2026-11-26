import {Router} from 'express';
import {z} from 'zod';
import {env} from '../config/env.js';
import {supabase} from '../config/supabase.js';
import {resolveDevice} from '../services/security-service.js';
import {validate} from '../utils/validate.js';
import {rateLimit} from '../middleware/rate-limit.js';
import {accessError} from '../services/operational-access-service.js';
import {publicAttendanceSchema} from '../validators/public-attendance-validator.js';
import {ATTENDANCE_PRIVACY_VERSION} from '../../public/js/attendance-policy.js';
import {attendanceFormToken,verifyAttendanceFormToken,attendancePayloadHash,attendanceIpHash,publicEventFields} from '../services/public-attendance-service.js';

export function createPublicAttendanceRouter({client=supabase,mode=env.ACCESS_MODE,appUrl=env.PUBLIC_APP_URL,secret=env.DEVICE_SIGNING_SECRET||env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,resolveBrowser=resolveDevice}={}){
 const router=Router();
 router.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Vary':'Cookie'});return mode==='revision'?next():res.status(404).json({error:{message:'Not found',details:[]}});});
 router.use(rateLimit({max:900,bucket:'public-attendance-ip'}));
 for(const name of ['token','requestId'])router.param(name,(_req,_res,next,value)=>{try{validate(z.uuid(),value);next();}catch(e){next(e);}});
 const call=async(name,args)=>{if(!client)throw Object.assign(new Error('Attendance is unavailable. Please retry shortly.'),{status:503});const {data,error}=await client.rpc(name,args);if(error)throw accessError(error);return data;};
 const handle=action=>async(req,res,next)=>{try{await action(req,res);}catch(error){next(error);}};
 const deliver=(res,result)=>{if(!result||![200,202,400,404,409,429,503].includes(result.status_code)||!result.body)throw Object.assign(new Error('Attendance could not be confirmed. Check your submission status before retrying.'),{status:503});if(result.status_code===429)res.set('Retry-After','60');return res.status(result.status_code).json(result.body);};
 router.get('/:token',handle(async(req,res)=>{
  const event=await call('get_public_event_attendance',{p_token:req.params.token});if(!event)return res.status(404).json({error:{message:'This attendance link is unavailable. Contact the event officer.'}});
  const device=resolveBrowser(req,res);
  res.json({event:publicEventFields(event),privacy_version:ATTENDANCE_PRIVACY_VERSION,form_token:attendanceFormToken({token:req.params.token,device,secret})});
 }));
 router.get('/:token/requests/:requestId',handle(async(req,res)=>{
  const result=await call('public_attendance_receipt',{p_token:req.params.token,p_request:req.params.requestId,p_device:resolveBrowser(req,res),p_payload_hash:null});
  if(!result)return res.status(404).json({error:{message:'No saved result was found for this browser request.'}});deliver(res,result);
 }));
 router.post('/:token/check-in',(req,res,next)=>{
  const origin=req.get('origin');let local=false;
  try{const u=new URL(origin);local=env.NODE_ENV!=='production'&&['127.0.0.1','localhost'].includes(u.hostname)&&u.host===req.get('host')&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.ip);}catch{/* Invalid origins are denied. */}
  if(origin!==new URL(appUrl).origin&&!local)return res.status(403).json({error:{message:'Open the attendance form on this website before submitting.'}});
  if(!req.is('application/json'))return res.status(400).json({error:{message:'Submit using the attendance form.'}});next();
 },handle(async(req,res)=>{
  const input=validate(publicAttendanceSchema,req.body),device=resolveBrowser(req,res),hash=attendancePayloadHash(req.params.token,input);
  const prior=await call('public_attendance_receipt',{p_token:req.params.token,p_request:input.request_id,p_device:device,p_payload_hash:hash});
  if(prior)return deliver(res,prior);
  verifyAttendanceFormToken({value:input.form_token,token:req.params.token,device,secret});
  const result=await call('submit_public_attendance_details',{p_token:req.params.token,p_request:input.request_id,p_device:device,p_ip:attendanceIpHash(req.ip||'unknown',secret),p_agent:(req.get('user-agent')||'Unknown browser').slice(0,500),p_hash:hash,p_school_id:input.school_id,p_name:input.full_name,p_institution:input.institution,p_class:input.class_label,p_college:input.college||'',p_course:input.course||'',p_checkpoint:input.checkpoint_key,p_lat:input.latitude,p_lon:input.longitude,p_accuracy:input.accuracy,p_captured:input.location_captured_at,p_signature:input.signature,p_privacy_version:input.privacy_version,p_consent:true});
  deliver(res,result);
 }));
 return router;
}
export default createPublicAttendanceRouter();
