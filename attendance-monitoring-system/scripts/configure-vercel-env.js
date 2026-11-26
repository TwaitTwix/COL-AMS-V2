// Transfer only approved application settings to the linked Vercel project.
// Values travel through stdin, never command arguments, logs, or source control.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'dotenv';

const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const settings=parse(await readFile(path.join(directory,'.env'),'utf8'));
const team=process.argv[2];
if(!/^[a-z0-9-]+$/i.test(team||''))throw new Error('Provide the linked Vercel team slug');
const keys=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','DEVICE_SIGNING_SECRET','ATTENDANCE_REPORTS_BUCKET'];
if(!settings.SUPABASE_URL||!settings.SUPABASE_PUBLISHABLE_KEY||!(settings.SUPABASE_SECRET_KEY||settings.SUPABASE_SERVICE_ROLE_KEY))throw new Error('The local Supabase configuration is incomplete');
if(process.argv[3]){
  const origin=new URL(process.argv[3]);
  if(origin.protocol!=='https:')throw new Error('The hosted application URL must use HTTPS');
  settings.PUBLIC_APP_URL=origin.origin;keys.push('PUBLIC_APP_URL');
}
for(const key of keys){
  const value=settings[key];if(!value)continue;
  const secret=/SECRET|SERVICE_ROLE/.test(key);
  const args=['env','add',key,'--environment','production','--environment','preview','--scope',team,'--yes','--force',secret?'--sensitive':'--no-sensitive'];
  await new Promise((resolve,reject)=>{
    const child=process.platform==='win32'
      ?spawn('cmd.exe',['/d','/s','/c','vercel '+args.join(' ')],{cwd:path.dirname(directory),stdio:['pipe','pipe','pipe'],windowsHide:true})
      :spawn('vercel',args,{cwd:path.dirname(directory),stdio:['pipe','pipe','pipe']});
    let diagnostics='';child.stdout.on('data',()=>{});child.stderr.on('data',chunk=>diagnostics+=chunk);
    child.on('error',()=>reject(new Error('Could not start the Vercel CLI')));
    child.stdin.on('error',()=>{});
    child.on('close',code=>{
      if(code===0){console.log(`Configured ${key}${secret?' (secret)':''}`);resolve();}
      else{
        for(const sensitive of Object.values(settings))if(sensitive)diagnostics=diagnostics.split(sensitive).join('[redacted]');
        reject(new Error(`Could not configure ${key}: ${diagnostics.slice(-1000)}`));
      }
    });
    child.stdin.end(value+'\n');
  });
}
