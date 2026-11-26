import { z } from 'zod';
import { supabase } from '../config/supabase.js';
import { validate } from '../utils/validate.js';
export const reviewQuerySchema=z.object({category:z.enum(['notifications','attendance','devices']),state:z.enum(['pending','history','all']).default('pending'),risk:z.enum(['all','flagged','unflagged']).default('all'),search:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),page_size:z.coerce.number().int().min(1).max(50).default(10)});
export const bulkApprovalSchema=z.object({ids:z.array(z.string().uuid()).min(1).max(500).refine(ids=>new Set(ids).size===ids.length,{message:'Duplicate attendance IDs are not allowed'})});
function check(error){if(error){console.error('Review center failed:',error.message);throw Object.assign(new Error('Unable to load reviews. Please retry.'),{status:503});}}
export async function reviewSummary(_req,res,next){
  try{
    const results=await Promise.all([
      supabase.from('admin_notifications').select('id',{count:'exact',head:true}).is('read_at',null),
      supabase.from('attendance_logs').select('id',{count:'exact',head:true}).eq('status','pending_review'),
      supabase.from('device_incidents').select('id',{count:'exact',head:true}).eq('status','open'),
      supabase.from('user_profiles').select('user_id',{count:'exact',head:true}).eq('approval_status','pending'),
    ]);results.forEach(r=>check(r.error));
    res.set('Cache-Control','no-store').json({notifications:results[0].count,attendance:results[1].count,devices:results[2].count,registrations:results[3].count});
  }catch(e){next(e);}
}
export async function listReviews(req,res,next){
  try{
    const input=validate(reviewQuerySchema,req.query);
    const {data,error}=await supabase.rpc('list_filtered_reviews',{p_category:input.category,p_state:input.state,p_search:input.search,p_page:input.page,p_size:input.page_size,p_risk:input.risk});check(error);
    res.set('Cache-Control','no-store').json(data);
  }catch(e){next(e);}
}
export async function previewBulkAttendance(req,res,next){
  try{const input=validate(z.object({search:z.string().trim().max(100).default('')}),req.body);const {data,error}=await supabase.rpc('preview_unflagged_attendance',{p_search:input.search});check(error);res.set('Cache-Control','no-store').json(data);}catch(e){next(e);}
}
export async function approveBulkAttendance(req,res,next){
  try{const input=validate(bulkApprovalSchema,req.body);const {data,error}=await supabase.rpc('approve_unflagged_attendance',{p_actor:req.authUser.id,p_ids:input.ids});check(error);res.set('Cache-Control','no-store').json(data);}catch(e){next(e);}
}
