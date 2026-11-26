import {z} from 'zod';
export const classSearchSchema=z.object({search:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),archived:z.enum(['true','false']).default('false')}).strict();
const reason=z.string().trim().min(3).max(500),version=z.number().int().min(0).max(2147483646);
export const createClassSchema=z.object({institution:z.enum(['MCNP','ISAP']),college:z.string().trim().min(1).max(100),course:z.string().trim().min(1).max(160),name:z.string().trim().min(1).max(80),academic_year:z.string().regex(/^\d{4}-\d{4}$/).refine(s=>Number(s.slice(5))===Number(s.slice(0,4))+1,{message:'Academic year must span consecutive years'}),term:z.string().trim().min(1).max(40),reason}).strict();
export const editClassSchema=z.object({name:z.string().trim().min(1).max(80),archived:z.boolean(),version,reason}).strict();
export const classAssignmentSchema=z.object({user_id:z.uuid().nullable(),kind:z.enum(['representative','editor']),version,replace_existing:z.boolean().default(false),remove:z.boolean().default(false),reason}).strict().refine(v=>v.kind==='representative'?(v.remove?v.user_id===null&&v.replace_existing:v.user_id!==null):v.user_id!==null,{message:'Choose an account, or explicitly confirm representative removal'});
export const rosterQuerySchema=z.object({roster_id:z.uuid().optional(),page:z.coerce.number().int().min(1).max(100000).default(1),search:z.string().trim().max(100).default('')}).strict();
export const commitRosterSchema=z.object({accept_valid_rows:z.boolean(),confirm_replace:z.boolean(),reason}).strict();
export const eventClassListSchema=z.object({section_ids:z.array(z.uuid()).min(1).max(100).refine(a=>new Set(a).size===a.length,{message:'Choose each class only once'}),version,reason}).strict();
