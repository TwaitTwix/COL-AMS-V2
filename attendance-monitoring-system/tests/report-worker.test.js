import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import 'dotenv/config';

test('report worker generates every file format after deployment dependency changes',{skip:process.env.LIVE_REPORT_WORKER!=='1',timeout:60000},async()=>{
  for(const format of ['csv','xlsx','pdf','docx']){
    const result=await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('../src/workers/report.worker.js',import.meta.url),{workerData:{format,eventId:randomUUID(),supabaseUrl:process.env.SUPABASE_URL,serviceRoleKey:process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY}});
      worker.once('message',resolve);worker.once('error',reject);
      worker.once('exit',code=>{if(code!==0)reject(new Error(`Worker exited: ${code}`));});
    });
    assert.equal(result.ok,true,result.error);assert.equal(result.recordCount,0);
    const bytes=Buffer.from(result.bytes);assert.ok(bytes.length>20);
    const preview=Buffer.from(result.previewBytes||result.bytes);assert.equal(preview.subarray(0,4).toString(),'%PDF');
    if(format==='pdf')assert.equal(bytes.subarray(0,4).toString(),'%PDF');
    if(format==='xlsx'||format==='docx')assert.equal(bytes.subarray(0,2).toString(),'PK');
    if(format==='csv')assert.match(bytes.toString(),/Student number/);
  }
});
