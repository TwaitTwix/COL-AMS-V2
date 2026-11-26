import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {createParticipantDeviceRouter} from '../src/routes/participant-devices.js';
import {errorHandler} from '../src/middleware/error-handler.js';
test('device evidence and replacement routes require current access and verified actors; decisions cannot inject browser IDs',async t=>{
 const actor=randomUUID(),incident=randomUUID(),event=randomUUID(),calls=[];let enabled=true,denied=false;
 const client={rpc:async(name,args)=>{calls.push({name,args});return denied?{error:{code:'42501',message:'Administrator device review required'}}:{data:{incident:{id:incident},items:[]}};}};
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.authUser={id:actor};req.operationalAccess={enabled:true,role:'administrator',features:[{key:'devices.admin',effective:enabled}]};next();});app.use(createParticipantDeviceRouter({client}));app.use(errorHandler);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 const send=data=>fetch(base+'/device-incidents/'+incident,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 assert.equal((await fetch(base+'/events/'+event+'/device-incidents?page=2')).status,200);assert.equal(calls.at(-1).args.p_actor,actor);assert.equal(calls.at(-1).args.p_page,2);
 const decision={version:1,action:'replace',reason:'Independently verified owner',confirm_identity:true};
 for(const change of [{confirm_identity:false},{action:'approve_attendance'},{device_hash:'forged'},{p_actor:randomUUID()},{reason:''}])assert.equal((await send({...decision,...change})).status,400);
 assert.equal((await send(decision)).status,200);assert.deepEqual(calls.at(-1).args,{p_actor:actor,p_incident:incident,p_version:1,p_action:'replace',p_reason:decision.reason,p_confirm:true});
 denied=true;assert.equal((await fetch(base+'/device-incidents/'+incident)).status,403);enabled=false;const count=calls.length;assert.equal((await send(decision)).status,403);assert.equal(calls.length,count);
 assert.equal((await fetch(base+'/events/'+event+'/device-incidents?page=0')).status,403);
});
