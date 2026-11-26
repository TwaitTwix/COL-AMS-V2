import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

test('hosted reports complete and private downloads contain each expected format',{skip:!process.env.TEST_REPORT_BASE_URL,timeout:180000},async()=>{
  const base=process.env.TEST_REPORT_BASE_URL;
  const credentials=JSON.parse(await readFile(new URL('../.demo-credentials.json',import.meta.url),'utf8'));
  const account=credentials.accounts.find(a=>a.role==='col_officer');
  const config=await fetch(base+'/api/auth/config').then(r=>r.json());
  const client=createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.auth.signInWithPassword({email:account.email,password:account.password});if(error)throw error;
  let cookie='',eventId;
  const api=async(path,method='GET',body)=>{
    const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+data.session.access_token,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    cookie=response.headers.get('set-cookie')?.split(';')[0]||cookie;
    const result=await response.json();assert.ok(response.ok,result.error?.message||`HTTP ${response.status}`);return result;
  };
  try{
    await api('/api/auth/activate-session','POST');
    await api('/api/auth/me');
    const {event}=await api('/api/admin/events','POST',{name:'Deployment verification · archived test event',latitude:17.6,longitude:121.7,radius_meters:100,starts_at:new Date(Date.now()-2*86400000).toISOString(),ends_at:new Date(Date.now()-86400000).toISOString()});
    eventId=event.id;
    // This expired test fixture never opens for student attendance.
    await api(`/api/admin/events/${eventId}/archive`,'PATCH',{archived:true});
    for(const format of ['csv','xlsx','pdf','docx']){
      let job=await api('/api/admin/reports','POST',{event_id:eventId,format});const statusUrl=job.status_url;
      for(let attempt=0;attempt<45;attempt++){
        await new Promise(resolve=>setTimeout(resolve,1000));job=await api(statusUrl);
        if(job.status==='failed')throw new Error(`${format}: ${job.error}`);
        if(job.status==='completed')break;
      }
      assert.equal(job.status,'completed',`${format} did not finish`);assert.equal(job.record_count,0);
      assert.ok(job.preview_url);const preview=await fetch(job.preview_url);assert.ok(preview.ok);assert.equal(Buffer.from(await preview.arrayBuffer()).subarray(0,4).toString(),'%PDF');
      const download=await fetch(job.download_url);assert.ok(download.ok);const bytes=Buffer.from(await download.arrayBuffer());
      if(format==='pdf')assert.equal(bytes.subarray(0,4).toString(),'%PDF');
      if(format==='xlsx'||format==='docx')assert.equal(bytes.subarray(0,2).toString(),'PK');
      if(format==='csv')assert.match(bytes.toString(),/Student number/);
    }
  }finally{
    if(eventId)await api(`/api/admin/events/${eventId}/archive`,'PATCH',{archived:true});
    await client.auth.signOut({scope:'local'});
  }
});
