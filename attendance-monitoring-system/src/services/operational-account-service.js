import {accessError} from './operational-access-service.js';

export async function saveOperationalAccount(client,actor,userId,input){
  const {data:identity,error}=await client.auth.admin.getUserById(userId);
  if(error)throw Object.assign(new Error('Unable to verify the target Auth identity. Retry shortly.'),{status:503});
  if(!identity?.user||identity.user.deleted_at||(!identity.user.email_confirmed_at&&input.version===0))throw Object.assign(new Error('Choose an email-verified account that has not been retired'),{status:400});
  return persistAccount(client,actor,userId,input);
}
export async function persistAccount(client,actor,userId,input){
  const {data,error}=await client.rpc('save_operational_account',{p_actor:actor,p_user:userId,p_role:input.role,p_name:input.full_name,p_enabled:input.enabled,p_version:input.version,p_scopes:input.scopes,p_overrides:input.overrides,p_reason:input.reason});
  if(error)throw accessError(error);return data;
}

// Provisioning and notification are deliberately distinct. Creating an unconfirmed
// identity sends no email; invitation links are generated only on explicit request.
// A failed DB provision leaves an unconfirmed identity with no operational access,
// never an active account with guessed scope, and is recoverable by its returned ID.
export async function provisionOperationalAccount(client,actor,input){
  const {error:preflightError}=await client.rpc('validate_operational_provision',{p_actor:actor,p_role:input.role,p_scopes:input.scopes,p_overrides:input.overrides});
  if(preflightError)throw accessError(preflightError);
  const {data,error}=input.existing_user_id?await client.auth.admin.getUserById(input.existing_user_id):await client.auth.admin.createUser({email:input.email,email_confirm:false,user_metadata:{full_name:input.full_name}});
  if(error)throw Object.assign(new Error(error.message||'Unable to provision Auth identity'),{status:error.status>=500?503:400});
  const userId=data.user?.id;if(!userId)throw Object.assign(new Error('Auth returned no account identity'),{status:503});
  if(data.user.deleted_at||data.user.email?.toLowerCase()!==input.email.toLowerCase())throw Object.assign(new Error('The recovery identity must match the email and must not be retired'),{status:400});
  const {data:existing,error:lookupError}=await client.rpc('get_operational_access',{p_user:userId});
  if(lookupError)throw Object.assign(new Error(`Provisioning is incomplete for Auth identity ${userId}. No invitation was sent. Resume provisioning with this identity.`),{status:503});
  if(existing)throw Object.assign(new Error('This account is already provisioned. Search its name to edit access.'),{status:409});
  try{
    const {error:profileError}=await client.from('user_profiles').upsert({user_id:userId,email:input.email,full_name:input.full_name,role:'pending',approval_status:'pending'},{onConflict:'user_id',ignoreDuplicates:true});
    if(profileError)throw accessError(profileError);
    const account=await persistAccount(client,actor,userId,{...input,enabled:true,version:0});
    return {account,email:input.email,invitation_sent:false};
  }catch(error){
    // No destructive Auth deletion on a partial failure. The ID lets an admin
    // repair the same identity instead of creating or emailing a second account.
    throw Object.assign(new Error(`Provisioning is incomplete for Auth identity ${userId}. No invitation was sent. Repair this identity before retrying.`),{status:error.status||503});
  }
}

export async function generateOperationalInvitation(client,userId,redirectTo){
  const {data,error}=await client.auth.admin.getUserById(userId);
  if(error||!data?.user||data.user.deleted_at)throw Object.assign(new Error('Unable to verify the invitation identity'),{status:503});
  if(data.user.email_confirmed_at)throw Object.assign(new Error('This email is already verified. Use password recovery to regain access.'),{status:409});
  // generateLink intentionally does not send email. The sensitive one-time URL
  // is shown only to the administrator for secure delivery, never logged/audited.
  const {data:link,error:linkError}=await client.auth.admin.generateLink({type:'invite',email:data.user.email,options:{redirectTo}});
  if(linkError)throw Object.assign(new Error(linkError.message||'Unable to generate invitation'),{status:linkError.status>=500?503:400});
  if(link?.user?.id!==userId||!link?.properties?.action_link)throw Object.assign(new Error('Invitation identity did not match. No link can be delivered.'),{status:503});
  return {url:link.properties.action_link,email:data.user.email};
}
