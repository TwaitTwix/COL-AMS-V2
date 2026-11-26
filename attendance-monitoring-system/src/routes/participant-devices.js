import {Router} from 'express';
import {z} from 'zod';
import {validate} from '../utils/validate.js';
import {requireOperationalFeature,accessError} from '../services/operational-access-service.js';

export const deviceDecisionSchema=z.object({version:z.number().int().positive(),action:z.enum(['replace','dismiss','reject_change']),reason:z.string().trim().min(3).max(500),confirm_identity:z.literal(true)}).strict();
export function createParticipantDeviceRouter({client}){
 const router=Router();router.use('/device-incidents',requireOperationalFeature('devices.admin'));
 const handle=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}};
 const call=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw accessError(error);return data;};
 for(const key of ['eventId','incidentId'])router.param(key,(_req,_res,next,id)=>{try{validate(z.uuid(),id);next();}catch(error){next(error);}});
 router.get('/events/:eventId/device-incidents',requireOperationalFeature('devices.admin'),handle(async(req,res)=>{const q=validate(z.object({page:z.coerce.number().int().min(1).max(100000).default(1)}).strict(),req.query);res.json(await call('list_participant_device_incidents',{p_actor:req.authUser.id,p_event:req.params.eventId,p_page:q.page}));}));
 router.get('/device-incidents/:incidentId',handle(async(req,res)=>{const result=await call('get_participant_device_incident',{p_actor:req.authUser.id,p_incident:req.params.incidentId});if(!result)return res.status(404).json({error:{message:'Device incident not found'}});res.json(result);}));
 router.put('/device-incidents/:incidentId',handle(async(req,res)=>{const x=validate(deviceDecisionSchema,req.body);res.json(await call('resolve_participant_device_incident',{p_actor:req.authUser.id,p_incident:req.params.incidentId,p_version:x.version,p_action:x.action,p_reason:x.reason,p_confirm:x.confirm_identity}));}));
 return router;
}
