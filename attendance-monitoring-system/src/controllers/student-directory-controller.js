import { z } from 'zod';
import { supabase } from '../config/supabase.js';
import { validate } from '../utils/validate.js';
export const directoryQuerySchema=z.object({search:z.string().trim().max(100).default(''),state:z.enum(['active','archived','all']).default('active'),page:z.coerce.number().int().min(1).max(100000).default(1),page_size:z.coerce.number().int().min(1).max(50).default(10)});
export async function studentDirectory(req,res,next){
  try{
    const input=validate(directoryQuerySchema,req.query);
    const {data,error}=await supabase.rpc('list_student_records',{p_search:input.search,p_state:input.state,p_page:input.page,p_size:input.page_size});
    if(error){console.error('Student directory failed:',error.message);throw Object.assign(new Error('Unable to load student records. Please retry.'),{status:503});}
    const ids=data.items.map(s=>s.id);let accounts=[];
    if(ids.length){
      const [linked,retired]=await Promise.all([
        supabase.from('user_profiles').select('user_id,email,role,student_id,retired_at,email_release_completed_at,retired_student_id').in('student_id',ids),
        supabase.from('user_profiles').select('user_id,email,role,student_id,retired_at,email_release_completed_at,retired_student_id').in('retired_student_id',ids),
      ]);
      if(linked.error||retired.error)throw Object.assign(new Error('Unable to load linked accounts'),{status:503});
      accounts=[...new Map([...linked.data,...retired.data].map(p=>[p.user_id,p])).values()];
    }
    res.set('Cache-Control','no-store').json({...data,items:data.items.map(s=>({...s,accounts:accounts.filter(p=>p.student_id===s.id||p.retired_student_id===s.id)}))});
  }catch(e){next(e);}
}
