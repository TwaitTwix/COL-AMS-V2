import { authenticateUser } from "../middleware/authenticate-user.js";
import { env } from "../config/env.js";
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../config/supabase.js';
import { z } from 'zod';
import { validate } from '../utils/validate.js';
import { recordSession,recordOperationalSession } from '../services/security-service.js';
import { validateAcademicSelection } from '../services/academic-service.js';
import { passwordSchema } from '../validators/password-validator.js';
import { PRIVACY_VERSION } from '../config/privacy.js';
import { writeAuditLog } from '../services/audit-service.js';
import { changePasswordSchema } from '../validators/change-password-validator.js';
import { changeOwnPassword } from '../services/change-password-service.js';

export function getPublicAuthConfig(_req, res) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    res.status(503).json({ error: { message: "Browser sign-in is not configured", details: [] } });
    return;
  }
  res.set("Cache-Control", "no-store").json({
    supabaseUrl: env.SUPABASE_URL,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    accessMode:env.ACCESS_MODE,
    registrationOpen:env.ACCESS_MODE==='legacy',
  });
}

export const getCurrentUser = [authenticateUser, async (req, res, next) => {
  try {
  const privacyRequired=req.userProfile.privacy_version!==PRIVACY_VERSION;
  const device = privacyRequired?null:await (req.operationalAccess?recordOperationalSession:recordSession)(req, res, req.get('authorization').replace(/^Bearer\s+/i, ''));
  res.set('Cache-Control','no-store').status(200).json({
    user: { id: req.authUser.id, email: req.authUser.email },
    profile: req.userProfile,
    ...(req.operationalAccess?{access:req.operationalAccess}:{}),
    device,
    privacy_required:privacyRequired,
    privacy_version:PRIVACY_VERSION,
  });
  } catch(error) { next(error); }
}];

export async function acceptPrivacy(req,res,next){
  try{
    validate(z.object({accepted:z.literal(true),version:z.literal(PRIVACY_VERSION)}),req.body);
    if(req.userProfile.privacy_version!==PRIVACY_VERSION){
      const {error}=await supabase.from('user_profiles').update({privacy_version:PRIVACY_VERSION,privacy_accepted_at:new Date().toISOString()}).eq('user_id',req.authUser.id);
      if(error)throw error;
      await writeAuditLog(req.authUser.id,'privacy.accepted','user_profile',req.authUser.id,{version:PRIVACY_VERSION});
    }
    res.json({message:'Privacy consent recorded',version:PRIVACY_VERSION});
  }catch(e){next(e);}
}
export async function updatePassword(req,res,next){
  try{
    const {password}=validate(z.object({password:passwordSchema}),req.body);
    // Use the user's token so Auth keeps its normal recovery/reauthentication
    // protections. A service-role password update would bypass those checks.
    const response=await fetch(`${env.SUPABASE_URL.replace(/\/$/,'')}/auth/v1/user`,{method:'PUT',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:req.get('authorization'),'Content-Type':'application/json'},body:JSON.stringify({password})});
    const result=await response.json();
    if(!response.ok)throw Object.assign(new Error(result.msg||result.message||'Unable to update password'),{status:response.status>=500?503:400});
    res.json({message:'Password updated'});
  }catch(e){next(e);}
}
export async function changePassword(req,res,next){
  try{
    const input=validate(changePasswordSchema,req.body);
    const client=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    await changeOwnPassword({userId:req.authUser.id,email:req.authUser.email,authorization:req.get('authorization'),currentPassword:input.current_password,password:input.password},{client,update:async(authorization,password)=>{
      const response=await fetch(`${env.SUPABASE_URL.replace(/\/$/,'')}/auth/v1/user`,{method:'PUT',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({password})});
      const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.msg||result.message||'Unable to change password. Sign in again and retry.'),{status:response.status>=500?503:400});
    }});
    await writeAuditLog(req.authUser.id,'account.password_changed','user_profile',req.authUser.id,{});
    res.json({message:'Password updated. Sign in with your new password.'});
  }catch(e){next(e);}
}

export async function register(req,res,next) {
  try {
    if(!supabase || !env.SUPABASE_PUBLISHABLE_KEY)throw Object.assign(new Error('Registration is not configured'),{status:503});
    const input=validate(z.object({full_name:z.string().trim().min(1).max(120),personal_id:z.string().trim().min(1).max(40),email:z.string().email().max(254),password:passwordSchema,privacy_accepted:z.literal(true),institution:z.enum(['MCNP','ISAP']),college:z.string().trim().min(1).max(100),course:z.string().trim().min(1).max(160)}),req.body);
    await validateAcademicSelection(input,{requireCourse:true});
    const client=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.auth.signUp({email:input.email,password:input.password,options:{emailRedirectTo:env.PUBLIC_APP_URL,data:{full_name:input.full_name}}});
    if(error)throw Object.assign(new Error(error.message),{status:error.status===429?429:400});
    // Supabase may return an obfuscated user for an already-registered email.
    // Never overwrite an existing profile or trust its returned identity.
    if(data.user?.identities?.length){
      const {error:profileError}=await supabase.from('user_profiles').upsert({user_id:data.user.id,email:input.email,full_name:input.full_name,personal_id:input.personal_id,institution:input.institution,college:input.college,course:input.course,role:'pending',approval_status:'pending',privacy_version:PRIVACY_VERSION,privacy_accepted_at:new Date().toISOString()},{onConflict:'user_id',ignoreDuplicates:true});
      if(profileError){
        // Never delete an Auth identity from a registration retry. Existing
        // unconfirmed identities may be returned by the Auth service as well.
        throw Object.assign(new Error(profileError.code==='23505'?'This personal ID is already registered. Verify your email, sign in, and correct your registration details.':'Verify your email and sign in to complete your registration details.'),{status:profileError.code==='23505'?409:503});
      }
    }
    res.status(202).json({message:'Check your email to verify your address. An administrator must approve your personal ID before you can record attendance.'});
  }catch(e){next(e);}
}
