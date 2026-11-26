export function eventCheckpoints(event){return (event.checkpoints||[{key:'default',label:'Attendance'}]).map(c=>({...c,opens_at:c.opens_at||new Date(Date.parse(event.starts_at)-3600000).toISOString(),closes_at:c.closes_at||event.ends_at}));}
export function checkpointOpen(checkpoint,now=Date.now()){return now>=Date.parse(checkpoint.opens_at)&&now<=Date.parse(checkpoint.closes_at);}
export function validCheckpointSchedule(event){
  const rows=event.checkpoints||[{key:'default',label:'Attendance'}];if(rows.length<1||rows.length>8||new Set(rows.map(c=>c.key)).size!==rows.length)return false;
  if(rows.length===1&&rows[0].key==='default'&&!rows[0].opens_at&&!rows[0].closes_at)return true;
  let end=-Infinity;return rows.every(c=>{const start=Date.parse(c.opens_at),close=Date.parse(c.closes_at),valid=Number.isFinite(start)&&Number.isFinite(close)&&start<close&&start>=Date.parse(event.starts_at)-3600000&&close<=Date.parse(event.ends_at)&&start>=end;end=close;return valid;});
}
