import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import { validate } from '../utils/validate.js';
import { recordSession, createEventQr, verifyEventQr } from '../services/security-service.js';
import { writeAuditLog } from '../services/audit-service.js';
import { validateAcademicSelection } from '../services/academic-service.js';
import { eventCheckpoints } from '../../public/js/checkpoints.js';
import { PRIVACY_VERSION } from '../config/privacy.js';

export const uuid = z.string().uuid();
const fail = (status, message) => Object.assign(new Error(message), { status });
function check(error) { if (error) { console.error('Portal database operation failed:', error.message); throw fail(503, 'Unable to load or save this request. Please retry.'); } }
const reviewSchema=z.object({decision:z.enum(['approved','rejected']),note:z.string().trim().max(1000).default('')}).refine(input=>input.decision!=='rejected'||!!input.note,{path:['note'],message:'A reason is required when rejecting a request'}).transform(input=>({...input,note:input.note||'Approved after administrator review'}));
export async function listColleges(_req, res, next) {
  try {
    const [parents,programs]=await Promise.all([
      supabase.from('colleges').select('institution,name,abbreviation').eq('active',true).order('name'),
      supabase.from('courses').select('institution,college,name').eq('active',true).order('name'),
    ]);check(parents.error);check(programs.error);
    res.json({colleges:parents.data.map(college=>({...college,courses:programs.data.filter(course=>course.institution===college.institution&&course.college===college.name).map(course=>course.name)}))});
  } catch(e) { next(e); }
}
export async function createCollege(req, res, next) {
  try {
    const input=validate(z.object({ institution:z.enum(['MCNP','ISAP']),name:z.string().trim().min(1).max(100) }),req.body);
    const {error}=await supabase.from('colleges').upsert({...input,active:true});check(error);
    await writeAuditLog(req.authUser.id,'college.created','college',input.name,input);res.status(201).json({college:input});
  } catch(e){next(e);}
}
export async function createCourse(req,res,next){
  try{
    const input=validate(z.object({institution:z.enum(['MCNP','ISAP']),college:z.string().trim().min(1).max(100),name:z.string().trim().min(1).max(160)}),req.body);
    await validateAcademicSelection(input);
    const {error}=await supabase.from('courses').upsert({...input,active:true});check(error);
    await writeAuditLog(req.authUser.id,'course.created','course',input.name,{institution:input.institution,college:input.college});
    res.status(201).json({course:input});
  }catch(e){next(e);}
}
export async function dashboard(req,res,next) {
  try {
    const {data:events,error}=await supabase.from('events').select('id,name,starts_at,ends_at,radius_meters,institution,college,checkpoints').is('archived_at',null).gte('ends_at',new Date().toISOString()).order('starts_at').limit(100);check(error);
    const {data:student,error:studentError}=req.userProfile.student_id ? await supabase.from('students').select('institution,college,course,archived_at').eq('id',req.userProfile.student_id).maybeSingle() : {data:null};check(studentError);
    const {data:attendance,error:attendanceError}=req.userProfile.student_id ? await supabase.from('attendance_logs').select('id,event_id,status,checked_in_at,review_note,distance_from_venue_meters,entry_method,checkpoint_key,checkpoint_label,events(name)').eq('student_id',req.userProfile.student_id).order('checked_in_at',{ascending:false}).limit(100) : {data:[]};check(attendanceError);
    const now=Date.now();
    res.json({profile:req.userProfile,student,server_time:new Date(now).toISOString(),events:events.map(e=>({...e,opens_at:new Date(Date.parse(e.starts_at)-3600000).toISOString(),is_open:now>=Date.parse(e.starts_at)-3600000,eligible:!student?.archived_at&&(!e.institution||e.institution===student?.institution)&&(!e.college||e.college===student?.college)})),attendance});
  } catch(e){next(e);}
}
export async function prepareAttendanceProfile(req,res,next){
  try{const {data,error}=await supabase.rpc('ensure_staff_attendance_profile',{p_user:req.authUser.id});if(error?.code==='P0001')throw fail(400,error.message);check(error);res.json({student_id:data});}catch(e){next(e);}
}
export async function eventDetail(req,res,next){
  try{
    const id=validate(uuid,req.params.eventId);
    const {data:event,error}=await supabase.from('events').select('id,name,starts_at,ends_at,radius_meters,institution,college,max_check_in_attempts,checkpoints').eq('id',id).is('archived_at',null).maybeSingle();check(error);if(!event)throw fail(404,'Event not found');
    if(Date.now()<Date.parse(event.starts_at)-3600000)throw fail(403,'This event opens one hour before its scheduled start');
    if(!req.userProfile.student_id)throw fail(400,'Open Campus events and set up your attendance profile first');
    const [stats,tries,logs]=await Promise.all([supabase.rpc('event_attendance_statistics',{p_event:id}),supabase.from('attendance_attempts').select('checkpoint_key,rejected_count').eq('student_id',req.userProfile.student_id).eq('event_id',id),supabase.from('attendance_logs').select('status,checkpoint_key').eq('student_id',req.userProfile.student_id).eq('event_id',id)]);[stats,tries,logs].forEach(r=>check(r.error));
    const checkpoints=eventCheckpoints(event).map(c=>{const rejected=tries.data.find(t=>t.checkpoint_key===c.key)?.rejected_count||0;return {...c,attendance:logs.data.find(l=>l.checkpoint_key===c.key)||null,attempts:{rejected,limit:event.max_check_in_attempts,remaining:Math.max(0,event.max_check_in_attempts-rejected),locked:rejected>=event.max_check_in_attempts}};});
    res.json({event,checkpoints,statistics:stats.data});
  }catch(e){next(e);}
}
export async function eventStatistics(req,res,next){
  try{const id=validate(uuid,req.params.eventId);const {data,error}=await supabase.rpc('event_attendance_statistics',{p_event:id});check(error);res.json({statistics:data});}catch(e){next(e);}
}
export async function eventQr(req,res,next) {
  try {
    const id=validate(uuid,req.params.eventId);
    const {data:event,error}=await supabase.from('events').select('id,name,qr_version,starts_at,ends_at').eq('id',id).is('archived_at',null).maybeSingle();check(error);
    if(!event)throw fail(404,'Event not found');
    res.set('Cache-Control','no-store').json({...createEventQr(event),event_name:event.name});
  }catch(e){next(e);}
}
export async function rotateQr(req,res,next){
  try{const id=validate(uuid,req.params.eventId);const {data,error}=await supabase.from('events').update({qr_version:randomUUID()}).eq('id',id).select('id').maybeSingle();check(error);if(!data)throw fail(404,'Event not found');await writeAuditLog(req.authUser.id,'event.qr_rotated','event',id);res.json({message:'Previous QR codes revoked'});}catch(e){next(e);}
}
export async function selfCheckIn(req,res,next) {
  try {
    const input=validate(z.object({event_id:uuid,checkpoint_key:z.string().max(50).optional(),event_token:z.string().min(1).max(2048),latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180),accuracy_meters:z.number().finite().nonnegative()}),req.body);
    let qr=null,qrError=null;
    try{qr=verifyEventQr(input.event_token,input.event_id);}catch(e){if(e.status!==400)throw e;qrError=e.message;}
    await recordSession(req,res,req.get('authorization').replace(/^Bearer\s+/i,''));
    const {data,error}=await supabase.rpc('submit_checkpoint_attendance',{p_user:req.authUser.id,p_event:input.event_id,p_key:input.checkpoint_key||null,p_qr_version:qr?.version||null,p_qr_error:qrError,p_device_hash:req.deviceHash,p_latitude:input.latitude,p_longitude:input.longitude,p_accuracy:input.accuracy_meters});
    if(error){
      if(error.code==='23505')throw fail(409,'Already checked in');
      if(['P0001','P0002'].includes(error.code))throw fail(400,error.code==='P0002'?'Student or event is unavailable':error.message);
      check(error);
    }
    if(data.error)throw Object.assign(fail(data.http_status||400,data.error),{attempts:data.attempts});
    res.status(201).json({...data,message:data.attendance.status==='approved'?'Successfully recorded!':'Attendance submitted for administrator review. Device verification is required.'});
  }catch(e){next(e);}
}
export async function reviewRegistration(req,res,next){
  try{
    const userId=validate(uuid,req.params.userId);const input=validate(reviewSchema,req.body);
    const {data:profile,error:profileError}=await supabase.from('user_profiles').select('retired_at,personal_id').eq('user_id',userId).single();check(profileError);
    if(profile.retired_at)throw fail(409,'This account is retired. Review its new registration instead');
    if(input.decision==='approved'){
      if(profile.personal_id){const {data:archived,error:archivedError}=await supabase.from('students').select('id').ilike('student_number',profile.personal_id.replace(/[\\%_]/g,'\\$&')).not('archived_at','is',null).maybeSingle();check(archivedError);if(archived)throw fail(409,'Restore the archived student record for this personal ID before approving the new account. Previous attendance will remain in its history.');}
      const {data,error}=await supabase.auth.admin.getUserById(userId);
      if(error)throw fail(503,'Unable to verify the registration email');
      if(!data.user?.email_confirmed_at)throw fail(400,'The user must verify their email before you approve the account');
    }
    const {error}=await supabase.rpc('approve_registration',{p_actor:req.authUser.id,p_user:userId,p_decision:input.decision,p_note:input.note});
    if(error?.code==='23505')throw fail(409,'Personal ID is already assigned');
    if(error?.code==='P0001')throw fail(400,error.message);check(error);res.json({message:'Registration reviewed'});
  }catch(e){next(e);}
}
export async function completeRegistration(req,res,next){
  try{
    if(req.userProfile.privacy_version!==PRIVACY_VERSION)throw fail(403,'Accept the privacy notice before continuing');
    const input=validate(z.object({full_name:z.string().trim().min(1).max(120),personal_id:z.string().trim().min(1).max(40),institution:z.enum(['MCNP','ISAP']),college:z.string().trim().min(1).max(100),course:z.string().trim().min(1).max(160)}),req.body);
    await validateAcademicSelection(input,{requireCourse:true});
    const {data,error}=await supabase.from('user_profiles').update(input).eq('user_id',req.authUser.id).eq('approval_status','pending').eq('role','pending').select('user_id').maybeSingle();
    if(error?.code==='23505')throw fail(409,'This personal ID is already registered');check(error);if(!data)throw fail(409,'Only a pending registration can be completed');
    res.json({message:'Details saved. Awaiting administrator approval.'});
  }catch(e){next(e);}
}
export async function securityDashboard(_req,res,next){
  try{
    const results=await Promise.all([
      supabase.from('login_logs').select('id,user_id,device_hash,user_agent,ip_address,changed_device,shared_device,created_at').order('created_at',{ascending:false}).limit(100),
      supabase.from('device_incidents').select('*').order('created_at',{ascending:false}).limit(100),
      supabase.from('admin_notifications').select('*').order('created_at',{ascending:false}).limit(100),
      supabase.from('attendance_logs').select('id,user_id,event_id,status,risk_reasons,device_hash,distance_from_venue_meters,checked_in_at,students(name,student_number),events(name)').eq('status','pending_review').order('checked_in_at',{ascending:false}).limit(100),
    ]);results.forEach(r=>check(r.error));
    res.json({logins:results[0].data,incidents:results[1].data,notifications:results[2].data,attendance:results[3].data});
  }catch(e){next(e);}
}
export async function reviewAttendance(req,res,next){
  try{
    const id=validate(uuid,req.params.attendanceId);const input=validate(reviewSchema,req.body);
    const {data,error}=await supabase.from('attendance_logs').update({status:input.decision,review_note:input.note,reviewed_by:req.authUser.id,reviewed_at:new Date().toISOString()}).eq('id',id).eq('status','pending_review').select('id').maybeSingle();check(error);if(!data)throw fail(409,'Attendance already reviewed or not found');
    await writeAuditLog(req.authUser.id,`attendance.review_${input.decision}`,'attendance_log',id,{note:input.note});res.json({message:'Attendance reviewed'});
  }catch(e){next(e);}
}
export async function reviewDevice(req,res,next){
  try{
    const id=validate(uuid,req.params.incidentId);const input=validate(z.object({decision:z.enum(['trusted','dismissed']),note:z.string().trim().min(1).max(1000)}),req.body);
    const {data,error}=await supabase.from('device_incidents').update({status:input.decision,reviewed_by:req.authUser.id,reviewed_at:new Date().toISOString()}).eq('id',id).eq('status','open').select('id,user_id').maybeSingle();check(error);if(!data)throw fail(409,'Device incident already reviewed or not found');
    await writeAuditLog(req.authUser.id,`device.${input.decision}`,'device_incident',id,{note:input.note,user_id:data.user_id});res.json({message:'Device reviewed. Existing attendance still needs its own decision.'});
  }catch(e){next(e);}
}
export async function readNotification(req,res,next){
  try{const id=validate(uuid,req.params.notificationId);const {error}=await supabase.from('admin_notifications').update({read_at:new Date().toISOString()}).eq('id',id);check(error);res.json({message:'Notification marked read'});}catch(e){next(e);}
}
export async function listNotifications(_req,res,next){
  try{const [items,unread]=await Promise.all([supabase.from('admin_notifications').select('id,message,created_at,read_at').order('read_at',{ascending:true,nullsFirst:true}).order('created_at',{ascending:false}).limit(30),supabase.from('admin_notifications').select('id',{count:'exact',head:true}).is('read_at',null)]);check(items.error);check(unread.error);res.set('Cache-Control','no-store').json({notifications:items.data,unread_count:unread.count});}catch(e){next(e);}
}
export async function studentNotifications(req,res,next){
  try{
    if(!req.userProfile.student_id){res.json({notifications:[]});return;}
    const {data,error}=await supabase.from('attendance_logs').select('id,status,review_note,checked_in_at,reviewed_at,checkpoint_label,events(name)').eq('student_id',req.userProfile.student_id).order('checked_in_at',{ascending:false}).limit(10);check(error);
    res.set('Cache-Control','no-store').json({notifications:data.map(a=>({id:a.id,message:(a.events?.name||'Event')+' · '+(a.checkpoint_label||'Attendance')+': '+a.status.replaceAll('_',' ')+(a.review_note?' — '+a.review_note:''),created_at:a.reviewed_at||a.checked_in_at}))});
  }catch(e){next(e);}
}
