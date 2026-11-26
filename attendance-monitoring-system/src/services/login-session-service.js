const replaced=()=>Object.assign(new Error('Your account was signed in elsewhere, or this session has ended. Sign in again to continue.'),{status:401,code:'SESSION_REPLACED'});
export async function enforceLoginSession({userId,accessToken,activate=false},rpc){
  // This is called only after Auth.getUser verifies the token. Never authorize
  // using unverified JWT data or a browser-provided user/session ID.
  let claims;try{claims=JSON.parse(Buffer.from(accessToken.split('.')[1],'base64url').toString());}catch{throw replaced();}
  if(claims.sub!==userId||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(claims.session_id||''))throw replaced();
  const {data,error}=await rpc('enforce_active_login',{p_user:userId,p_session:claims.session_id,p_activate:activate});
  if(error)throw Object.assign(new Error('Unable to verify your active login. Please retry.'),{status:503});
  if(!data?.active)throw replaced();
}
