import {validSignature} from './attendance-policy.js';

export function createSignaturePad(canvas){
 const strokes=[];let active=null,pointer=null;
 const context=canvas.getContext('2d');
 function draw(){const box=canvas.getBoundingClientRect(),scale=Math.min(devicePixelRatio||1,3);canvas.width=Math.round(box.width*scale);canvas.height=Math.round(box.height*scale);context.setTransform(scale,0,0,scale,0,0);context.lineWidth=2.5;context.lineCap='round';context.lineJoin='round';context.strokeStyle='#183b2b';for(const stroke of strokes){context.beginPath();stroke.forEach(([x,y],i)=>context[i?'lineTo':'moveTo'](x*box.width,y*box.height));context.stroke();}}
 function point(event){const r=canvas.getBoundingClientRect();return [Math.round(Math.max(0,Math.min(1,(event.clientX-r.left)/r.width))*10000)/10000,Math.round(Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))*10000)/10000];}
 function start(event){if(canvas.getAttribute('aria-disabled')==='true'||event.button!==0||pointer!==null||strokes.length>=32||strokes.reduce((n,s)=>n+s.length,0)>=2048)return;event.preventDefault();pointer=event.pointerId;active=[point(event)];strokes.push(active);canvas.setPointerCapture(pointer);}
 function move(event){if(event.pointerId!==pointer||!active)return;event.preventDefault();if(active.length>=1024||strokes.reduce((n,s)=>n+s.length,0)>=2048)return;const p=point(event),last=active.at(-1);if(Math.hypot(p[0]-last[0],p[1]-last[1])<.002)return;active.push(p);draw();}
 function stop(event){if(event.pointerId!==pointer)return;if(active?.length<2)strokes.pop();active=null;pointer=null;draw();}
 canvas.addEventListener('pointerdown',start);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.addEventListener('lostpointercapture',stop);
 const observer=new ResizeObserver(draw);observer.observe(canvas);
 return {value:()=>structuredClone(strokes),valid:()=>validSignature(strokes),clear(){strokes.length=0;active=null;pointer=null;draw();},destroy(){observer.disconnect();canvas.removeEventListener('pointerdown',start);canvas.removeEventListener('pointermove',move);for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.removeEventListener(name,stop);}};
}
