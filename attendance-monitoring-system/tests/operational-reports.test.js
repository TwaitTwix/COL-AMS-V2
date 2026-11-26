import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {buildOperationalReport} from '../src/workers/operational-report.worker.js';
import {runOperationalReportWorker,createOperationalReportProcessor} from '../src/services/operational-report-service.js';
import {createOperationalReportRouter} from '../src/routes/operational-reports.js';
import {errorHandler} from '../src/middleware/error-handler.js';
export const sampleDataset={generated_at:'2026-11-26T10:00:00Z',event:{name:'Synthetic report verification'},scope:'Assigned classes only',includes_signatures:true,totals:{eligible_participants:2,eligible_checkpoint_slots:4,approved_eligible_slots:1,submissions:3,approved:1,pending_review:1,rejected:1,approved_exceptions:0},groups:[{institution:'ISAP',college:'CITE',course:'BSIT',checkpoint:'Morning',eligible:2,approved:1,percentage:50}],rows:[{participant_name:'=Formula-like participant',school_id:'000001',participant_type:'Account-free participant',institution:'ISAP',college:'CITE',course:'BSIT',class_name:'IT 1A',checkpoint:'Morning',status:'approved',source:'public_form',submitted_at:'2026-11-26T09:00:00Z',distance_meters:8,flags:['device_changed'],resolution:'approved',reviewer_name:'Synthetic Representative',reviewer_role:'classroom_representative',decided_at:'2026-11-26T09:10:00Z',signature_collected:true,signature:[[[.1,.2],[.2,.4],[.4,.2],[.5,.5]]]}]};
test('revision exports preserve participant/reviewer distinction, outcomes, rates and signature evidence without spreadsheet formulas',async()=>{
 for(const format of ['csv','xlsx','pdf','docx']){
  const {output,preview}=await buildOperationalReport(format,sampleDataset);assert.equal(preview.subarray(0,4).toString(),'%PDF');
  if(format==='csv'){const s=output.toString();assert.ok(s.includes("'=Formula-like participant"));assert.ok(s.includes('classroom_representative'));assert.ok(s.includes('Account-free participant'));assert.ok(s.includes('Signature collected'));}
  if(format==='xlsx'){const w=new ExcelJS.Workbook();await w.xlsx.load(output);assert.equal(w.getWorksheet('Attendance').getCell('A2').value,"'=Formula-like participant");assert.equal(w.getWorksheet('Attendance').getImages().length,1);assert.equal(w.getWorksheet('Official attendance rates').getCell('G2').value,50);}
  if(format==='docx'){const zip=await JSZip.loadAsync(output),xml=await zip.file('word/document.xml').async('string');assert.ok(xml.includes('Reviewer role at decision'));assert.ok(xml.includes('classroom_representative'));assert.ok(xml.includes('25.00%'));assert.equal(Object.keys(zip.files).filter(n=>/word\/media\/.+\.png$/.test(n)).length,1);}
 }
});
test('revision report building runs off the event loop',async()=>{let ticked=false;const result=runOperationalReportWorker('pdf',sampleDataset);setTimeout(()=>{ticked=true;},0);assert.equal((await result).output.subarray(0,4).toString(),'%PDF');assert.equal(ticked,true);});
test('revision report processor deduplicates local jobs and fences storage paths by claim',async()=>{
 const id=randomUUID(),claim=randomUUID(),calls=[],uploads=[];let claimed=false;
 const client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='claim_operational_report'&&!claimed?(claimed=true,{id,claim_id:claim,format:'csv',dataset:sampleDataset}):true};},storage:{getBucket:async()=>({data:{public:false}}),from:()=>({upload:async(path,bytes,opts)=>{uploads.push({path,opts});return {};}})}};
 const processor=createOperationalReportProcessor({client,bucket:'private',build:async()=>({output:Buffer.from('csv'),preview:Buffer.from('pdf')})});const first=processor.schedule(id),second=processor.schedule(id);assert.equal(first,second);await first;assert.equal(uploads.length,2);assert.equal(uploads[0].path,`revision/${id}/${claim}.csv`);assert.equal(uploads[0].opts.upsert,false);assert.equal(calls.at(-1).args.p_claim,claim);assert.equal(calls.at(-1).args.p_ok,true);
});
test('revision reports reject actor/scope injection, gate exports, omit paths and recheck access before signing',async t=>{
 const actor=randomUUID(),id=randomUUID(),event=randomUUID(),calls=[];let exportAllowed=false,denied=false,signed=0;
 const client={rpc:async(name,args)=>{calls.push({name,args});if(denied)return {error:{code:'42501',message:'Access changed'}};return {data:name==='create_operational_report'?{job_id:id,status:'queued'}:{job_id:id,status:'completed',format:'csv',file_path:'private.csv',preview_path:'private.pdf',summary:{},items:[]}};},storage:{getBucket:async()=>({data:{public:false}}),from:()=>({createSignedUrl:async(path,ttl)=>{signed++;assert.equal(ttl,60);return {data:{signedUrl:'https://synthetic.invalid/'+path}};}})}};
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.authUser={id:actor};req.operationalAccess={enabled:true,role:'col_regular',features:[{key:'reports.view',effective:true},{key:'reports.export',effective:exportAllowed}]};next();});app.use(createOperationalReportRouter({client,bucket:'private',processor:{schedule(){}}}));app.use(errorHandler);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 const post=data=>fetch(base+'/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),body={request_id:randomUUID(),event_id:event,format:'preview'};
 assert.equal((await post({...body,p_actor:id})).status,400);assert.equal((await post({...body,format:'csv'})).status,403);assert.equal((await post(body)).status,202);assert.equal(calls.at(-1).args.p_actor,actor);
 let r=await fetch(base+'/reports/'+id);assert.equal(r.status,200);assert.equal((await r.json()).file_path,undefined);assert.equal(signed,0);assert.equal((await fetch(base+'/reports/'+id+'?download=true')).status,403);
 exportAllowed=true;r=await fetch(base+'/reports/'+id+'?download=true');assert.equal(r.status,200);assert.equal(signed,2);denied=true;assert.equal((await fetch(base+'/reports/'+id+'?download=true')).status,403);assert.equal(signed,2);
});

test('public report buckets fail closed before building or uploading evidence',async()=>{
 const calls=[];let builds=0;
 const client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='claim_operational_report'?{id:randomUUID(),claim_id:randomUUID(),format:'pdf',dataset:sampleDataset}:true};},storage:{getBucket:async()=>({data:{public:true}})}};
 await createOperationalReportProcessor({client,bucket:'unsafe',build:async()=>{builds++;throw new Error('Must not build');}}).schedule(randomUUID());assert.equal(builds,0);assert.equal(calls.at(-1).name,'finish_operational_report');assert.equal(calls.at(-1).args.p_ok,false);
});
