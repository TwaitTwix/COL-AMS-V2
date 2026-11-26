import test from 'node:test';
import assert from 'node:assert/strict';
import { reportRole } from '../src/utils/report-role.js';
import { buildReport } from '../src/workers/report.worker.js';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
test('report role follows the attendee account and safely handles legacy or unlinked records',()=>{
  const byUser=new Map([['student',{role:'student'}],['officer',{role:'student_officer'}],['col',{role:'col_officer'}]]),byStudent=new Map([['legacy',{role:'student_officer'}]]);
  assert.equal(reportRole({user_id:'student',recorded_by:'col'},byUser,byStudent),'Student');
  assert.equal(reportRole({user_id:'officer'},byUser,byStudent),'Student Officer');
  assert.equal(reportRole({user_id:'col'},byUser,byStudent),'COL Officer');
  assert.equal(reportRole({student_id:'legacy'},byUser,byStudent),'Student Officer');
  assert.equal(reportRole({student_id:'unlinked',recorded_by:'col'},byUser,byStudent),'No linked account');
  assert.equal(reportRole({user_id:'deleted',student_id:'legacy'},byUser,byStudent),'Account unavailable');
});
test('all export formats and matching PDF previews include role-bearing sample rows',async()=>{
  const roles=['Student','Student Officer','COL Officer','Main Administrator','No linked account'];
  const rows=roles.map((role,i)=>({student_name:'Sample attendee '+(i+1),student_number:'SAMPLE-'+i,role,checkpoint:'Morning arrival',event_id:'sample-event',checked_in_at:'2026-11-19T04:00:00.000Z',distance_meters:i===4?'Manual / not measured':12.5}));
  for(const format of ['csv','xlsx','pdf','docx']){
    const {output,preview}=await buildReport(format,rows,'sample-event');assert.equal(preview.subarray(0,4).toString(),'%PDF');
    assert.equal((preview.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,1,'A short report must not gain a blank footer page');
    if(format==='csv'){assert.match(output.toString(),/Role \(current\)/);assert.ok(output.toString().includes('Checkpoint'));assert.ok(output.toString().includes('Morning arrival'));for(const role of roles)assert.ok(output.toString().includes(role));}
    if(format==='xlsx'){const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(output);const sheet=workbook.worksheets[0];assert.equal(sheet.getCell('C1').value,'Role (current)');roles.forEach((role,i)=>assert.equal(sheet.getCell(i+2,3).value,role));}
    if(format==='docx'){const zip=await JSZip.loadAsync(output);const xml=await zip.file('word/document.xml').async('string');assert.ok(xml.includes('Role (current)'));for(const role of roles)assert.ok(xml.includes(role));}
    if(format==='pdf')assert.equal(output.subarray(0,4).toString(),'%PDF');
  }
});
