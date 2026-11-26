import {rateLimit} from '../middleware/rate-limit.js';
import {Router} from 'express';
import {z} from 'zod';
import {validate} from '../utils/validate.js';
import {requireOperationalFeature,accessError,canUseFeature} from '../services/operational-access-service.js';
import {createOperationalReportProcessor} from '../services/operational-report-service.js';
export function createOperationalReportRouter({client,bucket,processor=createOperationalReportProcessor({client,bucket})}){
 const router=Router(),call=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw accessError(error);return data;},handle=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}};
 router.post('/reports',requireOperationalFeature('reports.view'),rateLimit({max:10,windowMs:15*60_000,bucket:'revision-report-create',key:req=>req.authUser.id}),handle(async(req,res)=>{
  const q=validate(z.object({request_id:z.uuid(),event_id:z.uuid(),format:z.enum(['preview','csv','xlsx','pdf','docx']),include_signatures:z.boolean().default(false)}).strict(),req.body);
  if(q.format!=='preview'&&!canUseFeature(req.operationalAccess,'reports.export'))throw Object.assign(new Error('Report export access required'),{status:403});
  const job=await call('create_operational_report',{p_actor:req.authUser.id,p_request:q.request_id,p_event:q.event_id,p_format:q.format,p_signatures:q.include_signatures});
  if(q.format!=='preview')processor.schedule(job.job_id);
  res.status(202).json({...job,status_url:'/api/operational/reports/'+job.job_id});
 }));
 router.get('/reports/events',requireOperationalFeature('reports.view'),handle(async(req,res)=>res.json(await call('list_operational_report_events',{p_actor:req.authUser.id}))));
 router.get('/reports/summary',requireOperationalFeature('reports.view'),handle(async(req,res)=>res.json(await call('operational_attendance_rates',{p_actor:req.authUser.id}))));
 router.get('/reports/:id',requireOperationalFeature('reports.view'),handle(async(req,res)=>{
  validate(z.uuid(),req.params.id);const q=validate(z.object({page:z.coerce.number().int().min(1).max(100000).default(1),download:z.enum(['true','false']).default('false')}).strict(),req.query),download=q.download==='true';
  if(download&&!canUseFeature(req.operationalAccess,'reports.export'))throw Object.assign(new Error('Report export access required'),{status:403});
  const job=await call('get_operational_report',{p_actor:req.authUser.id,p_job:req.params.id,p_page:q.page,p_export:download}),{file_path,preview_path,...safe}=job;
  if(job.status==='queued'||job.status==='processing')processor.schedule(job.job_id);
  if(download&&job.status==='completed'&&file_path){
   const {data:info,error:bucketError}=await client.storage.getBucket(bucket);if(bucketError||!info||info.public)throw Object.assign(new Error('Private report storage is unavailable'),{status:503});
   const sign=async path=>{const {data,error}=await client.storage.from(bucket).createSignedUrl(path,60);if(error)throw Object.assign(new Error('Unable to create report link'),{status:503});return data.signedUrl;};
   safe.download_url=await sign(file_path);if(preview_path)safe.preview_url=await sign(preview_path);safe.expires_in_seconds=60;
  }
  res.json(safe);
 }));
 return router;
}
