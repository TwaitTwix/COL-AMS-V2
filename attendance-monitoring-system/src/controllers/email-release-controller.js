import {z} from 'zod';
import {supabase} from '../config/supabase.js';
import {validate} from '../utils/validate.js';
import {releaseArchivedEmail} from '../services/email-release-service.js';
export const emailReleaseSchema=z.object({user_id:z.string().uuid(),email:z.string().email().max(254),reason:z.string().trim().min(3).max(1000),confirm:z.literal('RELEASE')});
export async function releaseStudentEmail(req,res,next){
  try{const input=validate(emailReleaseSchema,req.body);await releaseArchivedEmail({actor:req.authUser.id,student:req.params.studentId,user:input.user_id,email:input.email,reason:input.reason},{rpc:(name,args)=>supabase.rpc(name,args),admin:supabase.auth.admin});res.json({message:'Email released. The old login is retired. A new registration requires email verification and administrator approval.'});}catch(e){next(e);}
}
