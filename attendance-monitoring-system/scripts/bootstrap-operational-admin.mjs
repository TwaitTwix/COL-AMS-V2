import 'dotenv/config';
import {createClient} from '@supabase/supabase-js';

// This command is never called automatically by startup, migration, or deploy.
// The explicit project URL check avoids bootstrapping a different environment.
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
if(!args.includes('--confirm-bootstrap')||!args.includes('--user-id')||!args.includes('--project-url'))throw Error('Usage: node scripts/bootstrap-operational-admin.mjs --user-id UUID --project-url TARGET_URL --confirm-bootstrap');
if(arg('--project-url')!==process.env.SUPABASE_URL)throw Error('Target URL must exactly match SUPABASE_URL.');
const id=arg('--user-id');if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('Valid user ID required.');
const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data,error}=await client.auth.admin.getUserById(id);
if(error||!data?.user?.email_confirmed_at||data.user.deleted_at||data.user.email?.toLowerCase()!=='leonardolllmacalinaoisap@gmail.com')throw Error('The existing verified designated main administrator is required.');
const {data:account,error:bootstrapError}=await client.rpc('bootstrap_operational_administrator',{p_user:id});
if(bootstrapError)throw Error(bootstrapError.message);
console.log(JSON.stringify({bootstrapped:true,user_id:account.user_id,role:account.role}));
