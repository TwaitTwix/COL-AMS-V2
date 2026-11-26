import {parentPort,workerData} from 'node:worker_threads';
import {parseRosterWorkbook} from '../services/roster-workbook.js';
try{parentPort.postMessage({rows:await parseRosterWorkbook(workerData.bytes)});}catch(error){parentPort.postMessage({error:error.message||'Unable to read class-list workbook'});}
