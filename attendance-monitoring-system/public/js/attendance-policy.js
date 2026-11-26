export const ATTENDANCE_PRIVACY_VERSION='2026-11-26-attendance-v1';
export function validSignature(strokes){
  if(!Array.isArray(strokes)||strokes.length<1||strokes.length>32)return false;
  let count=0,length=0;
  for(const stroke of strokes){
    if(!Array.isArray(stroke)||stroke.length<2||stroke.length>1024)return false;
    let previous=null;
    for(const point of stroke){
      if(!Array.isArray(point)||point.length!==2||point.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1))return false;
      count++;if(count>2048)return false;
      if(previous)length+=Math.hypot(point[0]-previous[0],point[1]-previous[1]);previous=point;
    }
  }
  return count>=8&&length>=0.15;
}
