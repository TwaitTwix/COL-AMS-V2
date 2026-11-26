import { z } from 'zod';
import { supabase } from '../config/supabase.js';
import { validate } from '../utils/validate.js';
const filters={logins:['all','flagged','registered'],audit:['all','attendance','device','account','registration','privacy','event','student','college','course']};
export const activityQuerySchema=z.object({category:z.enum(['logins','audit']).default('logins'),filter:z.string().default('all'),search:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),page_size:z.coerce.number().int().min(1).max(50).default(10)}).refine(value=>filters[value.category].includes(value.filter),{path:['filter'],message:'Choose a valid filter for this log category'});
export async function listActivityLogs(req,res,next){
  try{
    const input=validate(activityQuerySchema,req.query);
    const {data,error}=await supabase.rpc('list_activity_logs',{p_category:input.category,p_filter:input.filter,p_search:input.search,p_page:input.page,p_size:input.page_size});
    if(error){console.error('Activity logs failed:',error.message);throw Object.assign(new Error('Unable to load activity logs. Please retry.'),{status:503});}
    res.set('Cache-Control','no-store').json(data);
  }catch(e){next(e);}
}
