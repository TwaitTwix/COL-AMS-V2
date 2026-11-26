import {Router} from 'express';
import {timingSafeEqual} from 'node:crypto';
import {env} from '../config/env.js';
import {supabase} from '../config/supabase.js';
export function createReviewWorkerRouter({client=supabase,mode=env.ACCESS_MODE,secret=env.CRON_SECRET}={}){
 const router=Router();router.all('/review-escalation',async(req,res)=>{
  res.set('Cache-Control','no-store');if(mode!=='revision')return res.status(404).json({error:{message:'Not found'}});
  const value=Buffer.from(req.get('authorization')||''),expected=Buffer.from('Bearer '+(secret||''));
  if(!secret||secret.length<32)return res.status(503).json({error:{message:'Review scheduler is not configured'}});
  if(value.length!==expected.length||!timingSafeEqual(value,expected))return res.status(401).json({error:{message:'Unauthorized'}});
  if(!['GET','POST'].includes(req.method))return res.sendStatus(405);
  try{const {data,error}=await client.rpc('process_attendance_review_queue',{p_limit:100});if(error)throw error;res.json(data);}catch{res.status(503).json({error:{message:'Review worker failed; inspect monitoring and retry the durable queue'}});}
 });return router;
}
export default createReviewWorkerRouter();
