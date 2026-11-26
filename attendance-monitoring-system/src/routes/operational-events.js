import {Router} from 'express';
import {z} from 'zod';
import {validate} from '../utils/validate.js';
import {requireOperationalFeature,accessError} from '../services/operational-access-service.js';
import {createEventSchema} from '../validators/admin-validator.js';
import {publicLinkSchema} from '../validators/public-attendance-validator.js';

export function createOperationalEventRouter({client,appUrl}){
 const router=Router(),input=z.object({event:createEventSchema,version:z.number().int().min(0),reason:z.string().trim().min(3).max(500)}).strict();
 const call=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw accessError(error);return data;};
 const handle=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}};
 router.param('eventId',(_req,_res,next,id)=>{try{validate(z.uuid(),id);next();}catch(error){next(error);}});
 router.post('/events',requireOperationalFeature('events.manage'),handle(async(req,res)=>{const x=validate(input,req.body);res.status(201).json({event:await call('save_operational_event',{p_actor:req.authUser.id,p_event:null,p_version:x.version,p_fields:x.event,p_reason:x.reason})});}));
 router.get('/events/:eventId',requireOperationalFeature('events.manage'),handle(async(req,res)=>{const event=await call('get_operational_event',{p_actor:req.authUser.id,p_event:req.params.eventId});if(!event)return res.status(404).json({error:{message:'Event not found'}});res.json({event});}));
 router.put('/events/:eventId',requireOperationalFeature('events.manage'),handle(async(req,res)=>{const x=validate(input,req.body);res.json({event:await call('save_operational_event',{p_actor:req.authUser.id,p_event:req.params.eventId,p_version:x.version,p_fields:x.event,p_reason:x.reason})});}));
 const link=data=>({...data,url:data.token?new URL('/attend/'+data.token,appUrl).href:null});
 router.get('/events/:eventId/public-link',handle(async(req,res)=>res.json({link:link(await call('get_event_public_link',{p_actor:req.authUser.id,p_event:req.params.eventId}))})));
 router.put('/events/:eventId/public-link',requireOperationalFeature('events.manage'),handle(async(req,res)=>{const x=validate(publicLinkSchema,req.body);res.json({link:link(await call('save_event_public_link',{p_actor:req.authUser.id,p_event:req.params.eventId,p_version:x.version,p_enabled:x.enabled,p_replace:x.replace,p_confirmation:x.confirmation,p_reason:x.reason}))});}));
 return router;
}
