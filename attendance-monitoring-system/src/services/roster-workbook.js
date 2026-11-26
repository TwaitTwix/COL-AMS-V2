import ExcelJS from 'exceljs';
import {inflateRawSync} from 'node:zlib';

export const MAX_ROSTER_BYTES=2*1024*1024;
export const MAX_ROSTER_ROWS=1000;
const MAX_EXPANDED=8*1024*1024;
const fail=message=>{throw new Error(message);};
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}

// Check expansion bounds before ExcelJS sees the archive. Repack ONLY the
// checked members, so an unlisted local ZIP entry cannot bypass central limits.
export function boundedWorkbookZip(input){
  const bytes=Buffer.from(input);
  if(bytes.length>MAX_ROSTER_BYTES||bytes.length<22)fail('Use an .xlsx class list no larger than 2 MB.');
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
  if(end<0)fail('The file is not a valid .xlsx workbook.');
  const count=bytes.readUInt16LE(end+10),central=bytes.readUInt32LE(end+16),centralSize=bytes.readUInt32LE(end+12);
  if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==count||count<1||count>128||central+centralSize!==end)fail('Unsupported or oversized workbook archive.');
  let offset=central,total=0;const members=[],seen=new Set();
  for(let n=0;n<count;n++){
    if(offset+46>end||bytes.readUInt32LE(offset)!==0x02014b50)fail('Invalid workbook archive index.');
    const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),crc=bytes.readUInt32LE(offset+16),packed=bytes.readUInt32LE(offset+20),size=bytes.readUInt32LE(offset+24),nameLength=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42);
    if(offset+46+nameLength+extra+comment>end)fail('Invalid workbook archive entry.');
    const nameBytes=bytes.subarray(offset+46,offset+46+nameLength),name=nameBytes.toString('utf8');offset+=46+nameLength+extra+comment;
    if(flags&1||![0,8].includes(method)||size===0xffffffff||packed===0xffffffff||seen.has(name)||!/^[A-Za-z0-9_\[\].\/-]+$/.test(name)||name.startsWith('/')||name.split('/').some(p=>p==='..'||p==='.'))fail('Encrypted, duplicated or unsafe workbook entries are not supported.');
    seen.add(name);
    if(local+30>central||bytes.readUInt32LE(local)!==0x04034b50||bytes.readUInt16LE(local+8)!==method)fail('Invalid workbook archive member.');
    const localName=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),start=local+30+localName+localExtra;
    if(start+packed>central||!bytes.subarray(local+30,local+30+localName).equals(nameBytes))fail('Inconsistent workbook archive member.');
    if(size>MAX_EXPANDED-total)fail('The expanded workbook exceeds the 8 MB safety limit.');
    const data=method===0?bytes.subarray(start,start+packed):inflateRawSync(bytes.subarray(start,start+packed),{maxOutputLength:Math.max(1,MAX_EXPANDED-total)});
    if(data.length!==size||crc32(data)!==crc)fail('Workbook integrity check failed.');total+=data.length;
    if(name.endsWith('/'))continue;
    if(!/\.(xml|rels)$/i.test(name))fail('Use the two-column template without images, macros or embedded files.');
    const text=data.toString('utf8');
    if(/<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External["']/i.test(text))fail('External links and XML entities are not allowed in class lists.');
    if(/^xl\/worksheets\/sheet\d+\.xml$/.test(name)){
      const rows=[...text.matchAll(/<row\b[^>]*\br=["'](\d+)["']/g)];
      if(rows.length>MAX_ROSTER_ROWS+1||rows.some(m=>Number(m[1])>MAX_ROSTER_ROWS+1))fail('Use at most 1000 data rows in the class-list template.');
    }
    members.push({nameBytes,data,crc});
  }
  if(offset!==end||!seen.has('[Content_Types].xml')||!seen.has('xl/workbook.xml'))fail('Missing workbook structure.');
  const locals=[],directory=[];let position=0;
  for(const m of members){const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt32LE(m.crc,14);local.writeUInt32LE(m.data.length,18);local.writeUInt32LE(m.data.length,22);local.writeUInt16LE(m.nameBytes.length,26);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt32LE(m.crc,16);entry.writeUInt32LE(m.data.length,20);entry.writeUInt32LE(m.data.length,24);entry.writeUInt16LE(m.nameBytes.length,28);entry.writeUInt32LE(position,42);
    locals.push(local,m.nameBytes,m.data);directory.push(entry,m.nameBytes);position+=30+m.nameBytes.length+m.data.length;
  }
  const tail=Buffer.alloc(22),dirBytes=Buffer.concat(directory);tail.writeUInt32LE(0x06054b50);tail.writeUInt16LE(members.length,8);tail.writeUInt16LE(members.length,10);tail.writeUInt32LE(dirBytes.length,12);tail.writeUInt32LE(position,16);
  return Buffer.concat([...locals,dirBytes,tail]);
}

export async function parseRosterWorkbook(bytes){
  const safe=boundedWorkbookZip(bytes),workbook=new ExcelJS.Workbook();
  try{await workbook.xlsx.load(safe);}catch{fail('The workbook could not be read. Save it as .xlsx using the class-list template.');}
  if(workbook.worksheets.length!==1||workbook.worksheets[0].state==='hidden'||workbook.worksheets[0].state==='veryHidden')fail('Use exactly one visible class-list worksheet.');
  const sheet=workbook.worksheets[0];
  const header=[sheet.getCell('A1').value,sheet.getCell('B1').value];
  if(header.some(v=>typeof v!=='string')||header[0].trim().toLowerCase()!=='school id'||header[1].trim().toLowerCase()!=='full name')fail('The first row must contain School ID and Full name. Download the template.');
  if(sheet.rowCount>MAX_ROSTER_ROWS+1||Object.keys(sheet._merges||{}).length)fail('Use at most 1000 data rows without merged cells.');
  const rows=[];
  sheet.eachRow({includeEmpty:false},(row,rowNumber)=>{
    if(rowNumber===1){for(let c=3;c<=row.cellCount;c++)if(row.getCell(c).value!==null)fail('Only the School ID and Full name columns are supported.');return;}
    const id=row.getCell(1).value,name=row.getCell(2).value;if(id===null&&name===null)return;
    for(let c=3;c<=row.cellCount;c++)if(row.getCell(c).value!==null)fail('Only the School ID and Full name columns are supported.');
    let error=null;
    if(typeof id==='number')error='School ID must be stored as text. Leading zeroes may have been lost; re-enter it as text.';
    else if(typeof id!=='string'||typeof name!=='string')error='Use plain text for school IDs and full names; formulas, links and rich-text cells are not accepted.';
    const school_id=typeof id==='string'?id.trim().toUpperCase():'',full_name=typeof name==='string'?name.trim():'';
    if(!error&&(!/^[A-Z0-9][A-Z0-9 ./_-]{0,39}$/.test(school_id)||!full_name||full_name.length>120||/[\u0000-\u001f\u007f]/.test(full_name)||/^[=+@-]/.test(full_name)))error='Enter a valid text school ID (1–40 characters) and plain full name (1–120 characters, without formula prefixes).';
    rows.push({row_number:rowNumber,school_id:school_id.slice(0,40),full_name:full_name.slice(0,120),error});
  });
  if(!rows.length)fail('The class list has no participant rows. Add your official students below the headers.');
  const counts=new Map();for(const r of rows)counts.set(r.school_id,(counts.get(r.school_id)||0)+1);
  for(const r of rows)if(!r.error&&counts.get(r.school_id)>1)r.error='School ID is repeated in this upload';
  return rows;
}

export async function createRosterTemplate(){
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Class list');
  sheet.columns=[{header:'School ID',key:'school_id',width:28,style:{numFmt:'@'}},{header:'Full name',key:'full_name',width:50,style:{numFmt:'@'}}];
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'},size:12};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF202020'}};sheet.getRow(1).height=26;
  sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter='A1:B1';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
