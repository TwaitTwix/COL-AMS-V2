import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {createAttendanceReviewRouter} from '../src/routes/attendance-reviews.js';
import {createReviewWorkerRouter} from '../src/routes/review-worker.js';
import {errorHandler} from '../src/middleware/error-handler.js';

async function serve(t,app){const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));return 'http://127.0.0.1:'+server.address().port;}
test('review decisions, unflagged bulk approval and manual requests use verified actors and reject invented evidence',async t=>{
 const actor=randomUUID(),id=randomUUID(),event=randomUUID(),student=randomUUID(),calls=[];let enabled=true,deny=false;
 const client={rpc:async(name,args)=>{calls.push({name,args});return deny?{error:{code:'42501',message:'Not assigned to this case'}}:{data:{items:[],total:0,case:{id},submission_id:id,status:'pending_review'}};}};
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.authUser={id:actor};req.operationalAccess={enabled:true,role:'col_admin',features:['attendance.review','attendance.manual'].map(key=>({key,effective:enabled}))};next();});app.use(createAttendanceReviewRouter({client}));app.use(errorHandler);const base=await serve(t,app);
 const send=(path,data,method='PUT')=>fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const decision={version:1,action:'approve',reason:'Independently checked evidence',confirm:true};
 for(const change of [{confirm:false},{actor_id:student},{action:'replace_browser'},{version:0}])assert.equal((await send('/reviews/'+id,{...decision,...change})).status,400);
 assert.equal((await send('/reviews/'+id,decision)).status,200);assert.equal(calls.at(-1).args.p_actor,actor);
 assert.equal((await send('/reviews/bulk-approve',{items:[{id,version:1}],reason:'Verified forms',confirm:true,risk:'flagged'},'POST')).status,400);
 assert.equal((await send('/reviews/bulk-approve',{items:[{id,version:1},{id,version:1}],reason:'Verified forms',confirm:true,risk:'unflagged'},'POST')).status,400);
 assert.equal((await send('/reviews/bulk-approve',{items:[{id,version:1}],reason:'Verified forms',confirm:true,risk:'unflagged'},'POST')).status,200);
 const manual={request_id:randomUUID(),student_id:student,checkpoint_key:'default',reason:'Participant has no usable phone',confirm:true};
 assert.equal((await send('/events/'+event+'/manual-attendance',{...manual,latitude:17},'POST')).status,400);
 assert.equal((await send('/events/'+event+'/manual-attendance',manual,'POST')).status,202);assert.equal(calls.at(-1).args.p_actor,actor);assert.equal(calls.at(-1).args.p_lat,undefined);
 deny=true;assert.equal((await fetch(base+'/reviews/'+id)).status,403);enabled=false;const count=calls.length;assert.equal((await send('/reviews/'+id,decision)).status,403);assert.equal(calls.length,count);
});
test('durable review worker requires revision mode and a private scheduler credential, and hides failures',async t=>{
 const secret='synthetic-private-scheduler-secret-123456',calls=[];let failed=false;
 const client={rpc:async(name,args)=>{calls.push({name,args});return failed?{error:{message:'private database connection details'}}:{data:{processed:2}};}};
 const app=express();app.use(createReviewWorkerRouter({client,mode:'revision',secret}));const base=await serve(t,app);
 assert.equal((await fetch(base+'/review-escalation')).status,401);assert.equal(calls.length,0);
 const headers={Authorization:'Bearer '+secret};assert.equal((await fetch(base+'/review-escalation',{headers})).status,200);assert.deepEqual(calls[0],{name:'process_attendance_review_queue',args:{p_limit:100}});
 failed=true;const result=await fetch(base+'/review-escalation',{headers});assert.equal(result.status,503);assert.doesNotMatch(await result.text(),/private database/);
 const legacy=express();legacy.use(createReviewWorkerRouter({client,mode:'legacy',secret}));assert.equal((await fetch((await serve(t,legacy))+'/review-escalation',{headers})).status,404);
 const missing=express();missing.use(createReviewWorkerRouter({client,mode:'revision',secret:''}));assert.equal((await fetch((await serve(t,missing))+'/review-escalation',{headers})).status,503);
});
