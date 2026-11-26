import express,{Router} from 'express';
import {z} from 'zod';
import {validate} from '../utils/validate.js';
import {requireOperationalFeature,canUseFeature,accessError} from '../services/operational-access-service.js';
import {createRosterTemplate,MAX_ROSTER_BYTES} from '../services/roster-workbook.js';
import {readRosterInWorker} from '../services/roster-import-service.js';
import {rateLimit} from '../middleware/rate-limit.js';
import {classSearchSchema,createClassSchema,editClassSchema,classAssignmentSchema,rosterQuerySchema,commitRosterSchema,eventClassListSchema} from '../validators/class-roster-validator.js';

export function createClassRosterRouter({client,parseWorkbook=readRosterInWorker}){
  const router=Router(),anyClass=(req,_res,next)=>['rosters.view','rosters.manage','sections.manage','representatives.assign'].some(k=>canUseFeature(req.operationalAccess,k))?next():next(Object.assign(new Error('Class-list access is disabled'),{status:403}));
  const call=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw accessError(error);return data;};
  const handle=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}};
  for(const name of ['sectionId','previewId','eventId'])router.param(name,(_req,_res,next,id)=>{try{validate(z.uuid(),id);next();}catch(error){next(error);}});
  router.get('/sections',anyClass,handle(async(req,res)=>{const q=validate(classSearchSchema,req.query);res.json(await call('list_class_sections',{p_actor:req.authUser.id,p_search:q.search,p_page:q.page,p_archived:q.archived==='true'}));}));
  router.post('/sections',requireOperationalFeature('sections.manage'),handle(async(req,res)=>{const {reason,...fields}=validate(createClassSchema,req.body);res.status(201).json({section:await call('save_class_section',{p_actor:req.authUser.id,p_id:null,p_version:0,p_fields:fields,p_reason:reason})});}));
  router.patch('/sections/:sectionId',requireOperationalFeature('sections.manage'),handle(async(req,res)=>{const {version,reason,...fields}=validate(editClassSchema,req.body);res.json({section:await call('save_class_section',{p_actor:req.authUser.id,p_id:req.params.sectionId,p_version:version,p_fields:fields,p_reason:reason})});}));
  router.get('/sections/:sectionId/assignment-candidates',requireOperationalFeature('representatives.assign'),handle(async(req,res)=>{const {search}=validate(z.object({search:z.string().trim().min(2).max(100)}).strict(),req.query);res.json({items:await call('class_assignment_candidates',{p_actor:req.authUser.id,p_section:req.params.sectionId,p_search:search})});}));
  router.post('/sections/:sectionId/assignments',requireOperationalFeature('representatives.assign'),handle(async(req,res)=>{const x=validate(classAssignmentSchema,req.body);res.json(await call('assign_class_officer',{p_actor:req.authUser.id,p_section:req.params.sectionId,p_user:x.user_id,p_kind:x.kind,p_version:x.version,p_replace:x.kind==='editor'?x.remove:x.replace_existing,p_reason:x.reason}));}));
  router.get('/sections/:sectionId/roster',anyClass,handle(async(req,res)=>{const q=validate(rosterQuerySchema,req.query);res.json(await call('get_class_roster',{p_actor:req.authUser.id,p_section:req.params.sectionId,p_roster:q.roster_id||null,p_page:q.page,p_search:q.search}));}));
  const importAccess=async(req,_res,next)=>{try{const d=await call('get_class_roster',{p_actor:req.authUser.id,p_section:req.params.sectionId});if(!d.permissions.manage)throw Object.assign(new Error('You cannot import into this class'),{status:403});next();}catch(error){next(error);}};
  router.get('/sections/:sectionId/template.xlsx',requireOperationalFeature('rosters.manage'),importAccess,handle(async(_req,res)=>res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition','attachment; filename="COL-class-list-template.xlsx"').send(await createRosterTemplate())));
  router.post('/sections/:sectionId/import-preview',requireOperationalFeature('rosters.manage'),importAccess,rateLimit({max:10,windowMs:15*60_000,bucket:'roster-import',key:req=>req.authUser.id}),express.raw({type:['application/octet-stream','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],limit:MAX_ROSTER_BYTES}),handle(async(req,res)=>{
    let filename;try{filename=decodeURIComponent(req.get('X-Roster-Filename')||'');}catch{throw Object.assign(new Error('Invalid workbook filename'),{status:400});}
    filename=filename.split(/[\\/]/).pop();
    if(!filename||filename.length>120||/[\u0000-\u001f\u007f]/.test(filename)||!filename.toLowerCase().endsWith('.xlsx')||!Buffer.isBuffer(req.body))throw Object.assign(new Error('Upload an .xlsx class list using the template'),{status:400});
    const mode=validate(z.enum(['merge','replace']),req.get('X-Roster-Mode')||'merge');
    const rows=await parseWorkbook(req.body);
    res.json({preview:await call('preview_class_roster',{p_actor:req.authUser.id,p_section:req.params.sectionId,p_rows:rows,p_filename:filename,p_mode:mode})});
  }));
  router.post('/roster-previews/:previewId/commit',requireOperationalFeature('rosters.manage'),handle(async(req,res)=>{const x=validate(commitRosterSchema,req.body);res.json(await call('commit_class_roster',{p_actor:req.authUser.id,p_preview:req.params.previewId,p_accept_rejected:x.accept_valid_rows,p_confirm_replace:x.confirm_replace,p_reason:x.reason}));}));
  router.get('/events/:eventId/class-lists',requireOperationalFeature('events.eligibility'),handle(async(req,res)=>res.json(await call('get_event_class_rosters',{p_actor:req.authUser.id,p_event:req.params.eventId}))));
  router.put('/events/:eventId/class-lists',requireOperationalFeature('events.eligibility'),handle(async(req,res)=>{const x=validate(eventClassListSchema,req.body);res.json(await call('set_event_class_rosters',{p_actor:req.authUser.id,p_event:req.params.eventId,p_expected_revision:x.version,p_sections:x.section_ids,p_reason:x.reason}));}));
  return router;
}
