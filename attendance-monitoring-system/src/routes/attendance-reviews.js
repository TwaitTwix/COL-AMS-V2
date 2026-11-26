import {Router} from 'express';
import {z} from 'zod';
import {validate} from '../utils/validate.js';
import {requireOperationalFeature,accessError} from '../services/operational-access-service.js';

export function createAttendanceReviewRouter({client}){
 const router=Router(),handle=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}};
 const call=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw accessError(error);return data;};
 router.use('/reviews',requireOperationalFeature('attendance.review'));
 router.get('/events/:eventId/manual-context',requireOperationalFeature('attendance.manual'),handle(async(req,res)=>{validate(z.uuid(),req.params.eventId);const event=await call('manual_attendance_context',{p_actor:req.authUser.id,p_event:req.params.eventId});if(!event)return res.sendStatus(404);res.json({event});}));
 router.post('/reviews/bulk-approve',handle(async(req,res)=>{const q=validate(z.object({items:z.array(z.object({id:z.uuid(),version:z.number().int().positive()}).strict()).min(1).max(50).refine(a=>new Set(a.map(x=>x.id)).size===a.length),reason:z.string().trim().min(3).max(500),confirm:z.literal(true),risk:z.literal('unflagged')}).strict(),req.body);res.json(await call('bulk_approve_attendance_reviews',{p_actor:req.authUser.id,p_items:q.items,p_reason:q.reason,p_confirm:q.confirm}));}));
 router.get('/events/:eventId/manual-candidates',requireOperationalFeature('attendance.manual'),handle(async(req,res)=>{validate(z.uuid(),req.params.eventId);const q=validate(z.object({search:z.string().trim().min(2).max(100)}).strict(),req.query);res.json({items:await call('manual_attendance_candidates',{p_actor:req.authUser.id,p_event:req.params.eventId,p_search:q.search})});}));
 router.post('/events/:eventId/manual-attendance',requireOperationalFeature('attendance.manual'),handle(async(req,res)=>{validate(z.uuid(),req.params.eventId);const q=validate(z.object({request_id:z.uuid(),student_id:z.uuid(),checkpoint_key:z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),reason:z.string().trim().min(3).max(500),confirm:z.literal(true)}).strict(),req.body);res.status(202).json(await call('record_manual_attendance',{p_actor:req.authUser.id,p_request:q.request_id,p_event:req.params.eventId,p_checkpoint:q.checkpoint_key,p_student:q.student_id,p_reason:q.reason,p_confirm:q.confirm}));}));
 router.get('/reviews',handle(async(req,res)=>{const q=validate(z.object({page:z.coerce.number().int().min(1).max(100000).default(1),search:z.string().trim().max(100).default(''),state:z.enum(['open','approved','rejected']).default('open'),risk:z.enum(['all','unflagged','flagged']).default('all')}).strict(),req.query);res.json(await call('list_attendance_review_cases',{p_actor:req.authUser.id,p_page:q.page,p_search:q.search,p_state:q.state,p_risk:q.risk}));}));
 router.get('/reviews/notifications',handle(async(req,res)=>{const q=validate(z.object({page:z.coerce.number().int().min(1).max(100000).default(1)}).strict(),req.query);res.json(await call('attendance_review_notifications',{p_actor:req.authUser.id,p_page:q.page}));}));
 router.put('/reviews/notifications/:id',handle(async(req,res)=>{validate(z.uuid(),req.params.id);validate(z.object({read:z.literal(true)}).strict(),req.body);await call('read_attendance_review_notification',{p_actor:req.authUser.id,p_notification:req.params.id});res.json({read:true});}));
 router.get('/reviews/health',handle(async(req,res)=>res.json(await call('attendance_review_health',{p_actor:req.authUser.id}))));
 router.get('/reviews/:id',handle(async(req,res)=>{validate(z.uuid(),req.params.id);res.json(await call('get_attendance_review_case',{p_actor:req.authUser.id,p_case:req.params.id}));}));
 router.put('/reviews/:id',handle(async(req,res)=>{validate(z.uuid(),req.params.id);const q=validate(z.object({version:z.number().int().positive(),action:z.enum(['approve','reject','escalate']),reason:z.string().trim().min(3).max(500),confirm:z.literal(true)}).strict(),req.body);res.json(await call('decide_attendance_review',{p_actor:req.authUser.id,p_case:req.params.id,p_version:q.version,p_action:q.action,p_reason:q.reason,p_confirm:q.confirm}));}));
 return router;
}
