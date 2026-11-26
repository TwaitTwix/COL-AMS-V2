import {Worker} from 'node:worker_threads';
import {waitUntil} from '@vercel/functions';
import {accessError} from './operational-access-service.js';
export const operationalReportFormats={csv:'text/csv',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
export function runOperationalReportWorker(format,dataset){return new Promise((resolve,reject)=>{
 const worker=new Worker(new URL('../workers/operational-report.worker.js',import.meta.url),{workerData:{format,dataset}});let settled=false;
 const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){void worker.terminate();reject(error);}else resolve(value);};
 const timer=setTimeout(()=>finish(new Error('Report processing time limit exceeded')),240000);timer.unref?.();
 worker.once('message',message=>message.ok?finish(null,{output:Buffer.from(message.bytes),preview:Buffer.from(message.previewBytes)}):finish(new Error('Report build failed')));worker.once('error',finish);worker.once('exit',()=>{if(!settled)finish(new Error('Report worker stopped'));});
 });}
export function createOperationalReportProcessor({client,bucket,build=runOperationalReportWorker,background=process.env.VERCEL==='1'?waitUntil:null}){
 const running=new Map();let tail=Promise.resolve();
 const rpc=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw accessError(error);return data;};
 async function process(id){
  const job=await rpc('claim_operational_report',{p_job:id});if(!job)return;
  try{
   // Fail closed if this bucket was made public through dashboard configuration.
   const {data:info,error:bucketError}=await client.storage.getBucket(bucket);if(bucketError||!info||info.public)throw new Error('Private report storage required');
   const {output,preview}=await build(job.format,job.dataset),prefix=`revision/${job.id}/${job.claim_id}`;
   const {error}=await client.storage.from(bucket).upload(prefix+'.'+job.format,output,{contentType:operationalReportFormats[job.format],upsert:false});if(error)throw error;
   if(job.format!=='pdf'){const {error}=await client.storage.from(bucket).upload(prefix+'.preview.pdf',preview,{contentType:'application/pdf',upsert:false});if(error)throw error;}
   await rpc('finish_operational_report',{p_job:job.id,p_claim:job.claim_id,p_ok:true});
  }catch(error){console.error('Operational report processing failed:',error?.message);await rpc('finish_operational_report',{p_job:job.id,p_claim:job.claim_id,p_ok:false});}
 }
 function schedule(id){if(running.has(id))return running.get(id);const task=(background?Promise.resolve():tail).then(()=>process(id)).catch(error=>console.error('Operational report queue unavailable:',error?.message)).finally(()=>running.delete(id));running.set(id,task);if(background)background(task);else tail=task;return task;}
 return {schedule};
}
