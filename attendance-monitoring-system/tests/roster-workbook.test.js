import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {parseRosterWorkbook,createRosterTemplate,boundedWorkbookZip,MAX_ROSTER_BYTES} from '../src/services/roster-workbook.js';
import {readRosterInWorker} from '../src/services/roster-import-service.js';
import {createClassSchema,classAssignmentSchema,eventClassListSchema} from '../src/validators/class-roster-validator.js';

async function workbook(rows=[],alter=()=>{}){const w=new ExcelJS.Workbook(),s=w.addWorksheet('Class list');s.addRow(['School ID','Full name']);for(const r of rows)s.addRow(r);alter(w,s);return Buffer.from(await w.xlsx.writeBuffer());}
test('official workbook template has only text ID/name columns and no phantom participant',async()=>{
 const bytes=await createRosterTemplate(),w=new ExcelJS.Workbook();await w.xlsx.load(bytes);const s=w.worksheets[0];
 assert.equal(s.getCell('A1').value,'School ID');assert.equal(s.getCell('B1').value,'Full name');assert.equal(s.getColumn(1).numFmt,'@');assert.equal(s.actualRowCount,1);
 await assert.rejects(()=>parseRosterWorkbook(bytes),/no participant rows/);
});
test('workbook parsing preserves leading zeroes, normalizes case and flags duplicate IDs',async()=>{
 const rows=await parseRosterWorkbook(await workbook([[' 000123 ','First Student'],['id-two','Second Student'],['DUP','Duplicate A'],[' dup ','Duplicate B']]));
 assert.equal(rows[0].school_id,'000123');assert.equal(rows[1].school_id,'ID-TWO');assert.equal(rows[0].error,null);assert.match(rows[2].error,/repeated/);assert.match(rows[3].error,/repeated/);
});
test('numeric school IDs, formulas, empty names and oversized fields are rejected as individual rows',async()=>{
 const rows=await parseRosterWorkbook(await workbook([[123,'Numeric'],['FORMULA',{formula:'"Calculated"',result:'Calculated'}],['EMPTY',''],['X'.repeat(41),'Long ID'],['OK','Valid Student'],['PREFIX','=Plain formula-like text']]));
 assert.match(rows[0].error,/text/);assert.match(rows[1].error,/plain text/);assert.ok(rows[2].error);assert.ok(rows[3].error);assert.equal(rows[4].error,null);assert.ok(rows[5].error);
});
test('extra columns, merged cells, wrong headers, multiple sheets and excess rows fail structurally',async()=>{
 for(const bytes of [await workbook([['A','Person','Private data']]),await workbook([['A','Person']],(_w,s)=>s.mergeCells('A2:B2')),await workbook([['A','Person']],(_w,s)=>s.getCell('A1').value='Incorrect'),await workbook([['A','Person']],w=>w.addWorksheet('Another class')),await workbook([['A','Person']],(_w,s)=>s.getCell('A1002').value='too far')])await assert.rejects(()=>parseRosterWorkbook(bytes));
});
test('external hyperlinks and unsafe archive formats are rejected before ExcelJS parsing',async()=>{
 await assert.rejects(async()=>parseRosterWorkbook(await workbook([['A',{text:'Person',hyperlink:'https://example.invalid/external'}]])),/External/);
 assert.throws(()=>boundedWorkbookZip(Buffer.alloc(MAX_ROSTER_BYTES+1)),/2 MB/);
 assert.throws(()=>boundedWorkbookZip(Buffer.from('not a workbook')),/valid|2 MB/);
 const bytes=await workbook([['A','Person']]);const bad=Buffer.from(bytes);bad[0]=0;assert.throws(()=>boundedWorkbookZip(bad),/archive member/);
});
test('declared expansion bomb is rejected before decompression',()=>{
 const name=Buffer.from('xl/workbook.xml'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(9*1024*1024,24);central.writeUInt16LE(name.length,28);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+name.length,12);end.writeUInt32LE(30+name.length,16);
 assert.throws(()=>boundedWorkbookZip(Buffer.concat([local,name,central,name,end])),/8 MB/);
});
test('production roster parser runs in a worker while the main event loop remains available',async()=>{
 const bytes=await workbook([['000001','Worker Student']]);let ticked=false;
 const pending=readRosterInWorker(bytes);setTimeout(()=>{ticked=true;},0);const rows=await pending;
 assert.equal(ticked,true);assert.equal(rows[0].school_id,'000001');await assert.rejects(()=>readRosterInWorker(Buffer.from('invalid')),e=>e.status===400);
});
test('class and event inputs require explicit consecutive academic years, reasons and unique sections',()=>{
 const section={institution:'ISAP',college:'CITE',course:'BSIT',name:'IT 1A',academic_year:'2026-2027',term:'First semester',reason:'Approved class'};
 assert.ok(createClassSchema.safeParse(section).success);assert.ok(!createClassSchema.safeParse({...section,academic_year:'2026-2028'}).success);
 assert.ok(!classAssignmentSchema.safeParse({kind:'editor',user_id:null,version:1,reason:'Assign editor'}).success);
 assert.ok(!eventClassListSchema.safeParse({section_ids:['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'],version:0,reason:'Duplicate'}).success);
});
