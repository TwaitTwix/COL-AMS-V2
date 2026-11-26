import { z } from 'zod';
import { supabase } from '../config/supabase.js';
import { validate } from '../utils/validate.js';
import { writeAuditLog } from '../services/audit-service.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
function check(error){if(error){console.error('Account activity request failed:',error.message);throw fail(503,'Unable to load or save this request. Please retry.');}}
export async function accountActivity(req,res,next){
  try{
    const id=validate(z.string().uuid(),req.params.userId);
    const {data:profile,error}=await supabase.from('user_profiles').select('user_id,full_name,email,personal_id,student_id,institution,college,course,approval_status,privacy_version,privacy_accepted_at').eq('user_id',id).maybeSingle();check(error);
    if(!profile)throw fail(404,'Account not found');
    const [devices,logins,attendance]=await Promise.all([
      supabase.from('user_devices').select('device_hash,user_agent,first_seen_at,last_seen_at').eq('user_id',id).order('last_seen_at',{ascending:false}).limit(100),
      supabase.from('login_logs').select('id,device_hash,user_agent,ip_address,changed_device,shared_device,created_at').eq('user_id',id).order('created_at',{ascending:false}).limit(100),
      profile.student_id?supabase.from('attendance_logs').select('id,event_id,checked_in_at,status,device_hash,latitude,longitude,accuracy_meters,distance_from_venue_meters,entry_method,recorded_by,manual_reason,checkpoint_label,events(name,radius_meters,latitude,longitude)').eq('student_id',profile.student_id).order('checked_in_at',{ascending:false}).limit(100):Promise.resolve({data:[]}),
    ]);[devices,logins,attendance].forEach(r=>check(r.error));
    await writeAuditLog(req.authUser.id,'account.activity_viewed','user_profile',id);
    res.set('Cache-Control','no-store').json({profile,devices:devices.data,logins:logins.data,attendance:attendance.data});
  }catch(e){next(e);}
}
export async function manualAttendance(req,res,next){
  try{
    const input=validate(z.object({student_id:z.string().uuid(),event_id:z.string().uuid(),reason:z.string().trim().min(3).max(1000),verified:z.literal(true),checkpoint_key:z.string().max(50).optional()}),req.body);
    const {data,error}=await supabase.rpc('record_checkpoint_manual',{p_actor:req.authUser.id,p_student:input.student_id,p_event:input.event_id,p_reason:input.reason,p_key:input.checkpoint_key||null});
    if(error?.code==='23505')throw fail(409,'Already checked in');
    if(error?.code==='P0002')throw fail(404,'Student or event is unavailable');
    if(error?.code==='P0001')throw fail(400,error.message);check(error);
    res.status(201).json({attendance:data,message:'Manual attendance recorded. No student GPS or device was verified.'});
  }catch(e){next(e);}
}
