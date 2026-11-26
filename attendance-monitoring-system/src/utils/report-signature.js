import {deflateSync} from 'node:zlib';
// Normalized application signature strokes; never interprets user HTML/SVG or fetches URLs.
export function signaturePng(strokes,width=240,height=90){
 if(!Array.isArray(strokes)||!strokes.length)return null;
 const pixels=Buffer.alloc((width*3+1)*height,255);for(let y=0;y<height;y++)pixels[y*(width*3+1)]=0;
 const dot=(x,y)=>{for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<width&&yy>=0&&yy<height){const i=yy*(width*3+1)+1+xx*3;pixels.fill(30,i,i+3);}}};
 for(const stroke of strokes){if(!Array.isArray(stroke))continue;for(let i=1;i<stroke.length;i++){const a=stroke[i-1],b=stroke[i];if(![a?.[0],a?.[1],b?.[0],b?.[1]].every(n=>Number.isFinite(n)&&n>=0&&n<=1))continue;const x1=Math.round(a[0]*(width-5))+2,y1=Math.round(a[1]*(height-5))+2,x2=Math.round(b[0]*(width-5))+2,y2=Math.round(b[1]*(height-5))+2,steps=Math.max(Math.abs(x2-x1),Math.abs(y2-y1),1);for(let n=0;n<=steps;n++)dot(Math.round(x1+(x2-x1)*n/steps),Math.round(y1+(y2-y1)*n/steps));}}
 const crc=bytes=>{let value=0xffffffff;for(const b of bytes){value^=b;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;};
 const chunk=(type,data)=>{const label=Buffer.from(type),size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([label,data])));return Buffer.concat([size,label,data,checksum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
