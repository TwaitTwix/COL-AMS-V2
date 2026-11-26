import {z} from 'zod';
import {OPERATIONAL_ROLES} from '../services/operational-access-service.js';
const scope=z.object({kind:z.enum(['institution','event']),scope_id:z.string().min(1).max(80)}).strict();
const accountBase=z.object({
  role:z.enum(OPERATIONAL_ROLES),full_name:z.string().trim().min(1).max(120),enabled:z.boolean(),
  version:z.number().int().min(0).max(2147483646),scopes:z.array(scope).max(40),
  overrides:z.record(z.string().min(1).max(80),z.boolean()).refine(v=>Object.keys(v).length<=30,{message:'Too many feature overrides'}),reason:z.string().trim().min(3).max(500),
}).strict();
export const operationalAccountSchema=accountBase;
export const operationalInviteSchema=accountBase.omit({version:true,enabled:true}).extend({email:z.email().max(254),existing_user_id:z.uuid().optional()});
export const operationalSearchSchema=z.object({search:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).strict();
