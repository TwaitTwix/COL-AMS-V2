import {z} from 'zod';
import {ATTENDANCE_PRIVACY_VERSION,validSignature} from '../../public/js/attendance-policy.js';
const point=z.tuple([z.number().finite().min(0).max(1),z.number().finite().min(0).max(1)]);
export const publicAttendanceSchema=z.object({
 request_id:z.uuid(),form_token:z.string().min(20).max(1500),
 school_id:z.string().trim().toUpperCase().min(1).max(40).regex(/^[A-Z0-9][A-Z0-9 ./_-]*$/),
 full_name:z.string().trim().min(1).max(120).refine(v=>!/[\u0000-\u001f\u007f]/.test(v)&&!/^[=+@-]/.test(v),{message:'Enter your full name as plain text'}),
 institution:z.enum(['MCNP','ISAP']),class_label:z.string().trim().max(80).regex(/^[^\u0000-\u001f\u007f]*$/).default(''),
 college:z.string().trim().max(100).regex(/^[^\u0000-\u001f\u007f]*$/).optional(),course:z.string().trim().max(150).regex(/^[^\u0000-\u001f\u007f]*$/).optional(),
 checkpoint_key:z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),
 latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180),
 accuracy:z.number().finite().min(0).max(100000),location_captured_at:z.string().datetime({offset:true}),
 signature:z.array(z.array(point).min(2).max(1024)).min(1).max(32).refine(validSignature,{message:'Add a complete handwritten signature in the box'}),
 privacy_accepted:z.literal(true),privacy_version:z.enum([ATTENDANCE_PRIVACY_VERSION,'2026-11-27-attendance-v2','2026-11-26-attendance-v1']),
}).strict();
export const publicLinkSchema=z.object({version:z.number().int().min(0),enabled:z.boolean(),replace:z.boolean().default(false),confirmation:z.string().max(30).default(''),reason:z.string().trim().min(3).max(500)}).strict();
