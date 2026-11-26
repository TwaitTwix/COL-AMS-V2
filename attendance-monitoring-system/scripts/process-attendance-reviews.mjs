import {env} from '../src/config/env.js';
import {supabase} from '../src/config/supabase.js';
if(env.ACCESS_MODE!=='revision'||!supabase)throw new Error('Enable revision mode and server-only Supabase configuration before running the review worker');
const {data,error}=await supabase.rpc('process_attendance_review_queue',{p_limit:100});
if(error){console.error('Review worker failed; durable cases remain queued.');process.exitCode=1;}else console.log(JSON.stringify(data));
