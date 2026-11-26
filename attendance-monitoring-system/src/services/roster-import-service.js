import {Worker} from 'node:worker_threads';
import {MAX_ROSTER_BYTES} from './roster-workbook.js';
let running=0;
export async function readRosterInWorker(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length>MAX_ROSTER_BYTES)throw Object.assign(new Error('Upload an .xlsx class list no larger than 2 MB'),{status:400});
  if(running>=2)throw Object.assign(new Error('Two class lists are being processed. Please retry shortly.'),{status:429});
  running++;
  let worker;
  try{return await new Promise((resolve,reject)=>{
    worker=new Worker(new URL('../workers/roster-import.worker.js',import.meta.url),{workerData:{bytes},resourceLimits:{maxOldGenerationSizeMb:128}});
    const timer=setTimeout(()=>reject(Object.assign(new Error('Workbook processing exceeded the time limit. Use the class-list template.'),{status:400})),10000);
    const fail=error=>{clearTimeout(timer);reject(Object.assign(new Error(error.message||'Workbook processing failed'),{status:400}));};
    worker.once('message',data=>{clearTimeout(timer);if(data.error)fail(new Error(data.error));else resolve(data.rows);});
    worker.once('error',()=>fail(new Error('The workbook exceeds the processing limit or could not be read.')));
    worker.once('exit',code=>{if(code!==0)fail(new Error('Workbook processing stopped. Use a smaller class-list workbook.'));});
  });}finally{if(worker)await worker.terminate();running--;}
}
