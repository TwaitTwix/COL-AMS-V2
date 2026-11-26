import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import ExcelJS from 'exceljs';
import {createOperationalRouter} from '../src/routes/operational.js';
import {errorHandler} from '../src/middleware/error-handler.js';

async function fixture(t){const actor=randomUUID(),section=randomUUID(),outside=randomUUID(),preview=randomUUID(),state={enabled:true,workers:0,calls:[]};
 const client={rpc:async(name,args)=>{state.calls.push({name,args});if((args.p_section&&args.p_section!==section)||(name==='commit_class_roster'&&args.p_preview!==preview))return{error:{code:'42501',message:'This class is outside your access'}};if(name==='get_class_roster')return{data:{section:{id:section},permissions:{manage:true},rows:[]}};if(name==='preview_class_roster')return{data:{id:preview,rows:args.p_rows}};if(name==='commit_class_roster')return{data:{changed:true}};if(name==='list_class_sections')return{data:{items:[{id:section}],total:1,page:1,page_size:10}};return{data:{saved:true}};}};
 const app=express();app.use(express.json({limit:'1mb'}));app.use('/api/operational',createOperationalRouter({client,mode:'revision',authenticate:(req,_res,next)=>{req.authUser={id:actor};req.userProfile={privacy_version:'2026-11-17'};req.operationalAccess={enabled:true,role:'col_regular',features:['rosters.view','rosters.manage','sections.manage','representatives.assign','events.eligibility'].map(key=>({key,effective:state.enabled}))};next();},parseWorkbook:async()=>{state.workers++;return[{row_number:2,school_id:'00001',full_name:'Synthetic Student',error:null}];}}));app.use(errorHandler);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
 const request=(url,options={})=>fetch(base+'/api/operational'+url,options);
 return{actor,section,outside,preview,state,request};
}
test('class scope is verified before workbook processing; valid previews use the verified actor',async t=>{
 const x=await fixture(t),body=Buffer.from('synthetic workbook handled by injected parser'),options={method:'POST',headers:{'Content-Type':'application/octet-stream','X-Roster-Filename':'official.xlsx'},body};
 assert.equal((await x.request(`/sections/${x.outside}/import-preview`,options)).status,403);assert.equal(x.state.workers,0);
 assert.equal((await x.request(`/sections/${x.section}/import-preview`,options)).status,200);assert.equal(x.state.workers,1);
 const call=x.state.calls.find(c=>c.name==='preview_class_roster');assert.equal(call.args.p_actor,x.actor);assert.equal(call.args.p_section,x.section);assert.equal(call.args.p_mode,'merge');
 assert.equal((await x.request(`/sections/${x.section}/import-preview`,{...options,headers:{...options.headers,'X-Roster-Filename':'unsafe.csv'}})).status,400);
 assert.equal((await x.request(`/sections/${x.section}/import-preview`,{...options,body:Buffer.alloc(2*1024*1024+1)})).status,413);
});
test('template is a valid authenticated workbook and cross-class preview tokens cannot be committed',async t=>{
 const x=await fixture(t),response=await x.request(`/sections/${x.section}/template.xlsx`);assert.equal(response.status,200);const w=new ExcelJS.Workbook();await w.xlsx.load(Buffer.from(await response.arrayBuffer()));assert.equal(w.worksheets[0].getCell('A1').value,'School ID');
 const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accept_valid_rows:false,confirm_replace:false,reason:'Reviewed list'})};
 assert.equal((await x.request('/roster-previews/'+randomUUID()+'/commit',options)).status,403);
 assert.equal((await x.request('/roster-previews/'+x.preview+'/commit',options)).status,200);
 assert.equal(x.state.calls.find(c=>c.name==='commit_class_roster'&&c.args.p_preview===x.preview).args.p_actor,x.actor);
});
test('direct class APIs reject revoked features, malformed IDs and injected actor/affiliation changes',async t=>{
 const x=await fixture(t);
 assert.equal((await x.request('/sections/not-a-uuid/roster')).status,400);
 const options={method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Class',archived:false,version:1,reason:'Update class',institution:'MCNP',p_actor:randomUUID()})};
 assert.equal((await x.request(`/sections/${x.section}`,options)).status,400);
 x.state.enabled=false;
 for(const [path,method] of [['/sections','GET'],[`/sections/${x.section}/roster`,'GET'],[`/sections/${x.section}/template.xlsx`,'GET'],[`/sections/${x.section}/assignments`,'POST'],[`/events/${randomUUID()}/class-lists`,'GET']])assert.equal((await x.request(path,{method})).status,403);
});
