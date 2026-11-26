import { enforceLoginSession } from './login-session-service.js';

export const OPERATIONAL_ROLES=['classroom_representative','club_president','col_regular','col_admin','administrator'];
export function canUseFeature(access,key){
  return !!access?.enabled&&OPERATIONAL_ROLES.includes(access.role)&&access.features?.some(f=>f.key===key&&f.effective===true)===true;
}
export function accessError(error){
  if(!error)return null;
  const status=error.code==='42501'?403:error.code==='40001'||error.code==='23505'?409:error.code==='22023'||error.code==='23514'?400:503;
  return Object.assign(new Error(status===503?'Access service is unavailable. Please retry.':error.code==='23505'?'A matching record already exists. Reload and check the current list.':error.message),{status});
}

// An injectable boundary lets tests exercise the actual authentication/route chain
// without creating real Auth sessions or changing production accounts.
export function createOperationalAuthenticator({client,verifier,privacyVersion}){
  return async(req,res,next,{activate=false}={})=>{
    try{
      res.set('Cache-Control','no-store');
      if(!client||!verifier)throw Object.assign(new Error('Operational sign-in is not configured'),{status:503});
      const token=/^Bearer\s+(.+)$/i.exec(req.get('authorization')||'')?.[1];
      if(!token)throw Object.assign(new Error('Sign in to continue'),{status:401});
      const {data,error}=await verifier.auth.getUser(token);
      if(error||!data?.user)throw Object.assign(new Error('Your session is invalid or has expired. Sign in again.'),{status:error?.status>=500||(!error?.status&&error)?503:401});
      const user=data.user;
      if(!user.email_confirmed_at)throw Object.assign(new Error('Verify your invited email before continuing'),{status:403});
      const {data:access,error:lookupError}=await client.rpc('get_operational_access',{p_user:user.id});
      if(lookupError)throw accessError(lookupError);
      if(!access?.enabled||!OPERATIONAL_ROLES.includes(access.role))throw Object.assign(new Error('This account has no active operational access. Attendance participants do not need an account.'),{status:401});
      await enforceLoginSession({userId:user.id,accessToken:token,activate},(_name,args)=>client.rpc('enforce_operational_login',args));
      const {data:profile,error:profileError}=await client.from('user_profiles').select('user_id,email,full_name,privacy_version,privacy_accepted_at,retired_at').eq('user_id',user.id).maybeSingle();
      if(profileError)throw accessError(profileError);
      if(!profile||profile.retired_at)throw Object.assign(new Error('This account is inactive. Contact an administrator.'),{status:401});
      req.authUser=user;req.operationalAccess=access;
      req.userProfile={...profile,full_name:access.full_name,role:access.role,approval_status:'approved'};
      req.privacyRequired=profile.privacy_version!==privacyVersion;
      return next();
    }catch(error){next(error);}
  };
}

export function requireOperationalFeature(key){
  return(req,_res,next)=>canUseFeature(req.operationalAccess,key)?next():next(Object.assign(new Error('You do not have access to this feature'),{status:403}));
}
