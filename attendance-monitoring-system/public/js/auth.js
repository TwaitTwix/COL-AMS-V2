import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import { requireAuthClient } from './auth-guard.js';
import { strongPassword, PASSWORD_HELP } from './password-policy.js';
import { enhancePasswordFields } from './password-visibility.js';
import { bindAcademicSelects } from './academic-selects.js';

const panel=document.querySelector('#auth-panel');
enhancePasswordFields(document);
const workspace=document.querySelector('#workspace');
const badge=document.querySelector('#account-badge');
const signout=document.querySelector('#sign-out');
const message=document.querySelector('#auth-message');
const forgot=document.querySelector('#forgot-password');
const refresh=document.querySelector('#refresh-approval');
const forms=Object.fromEntries(['signin','signup','recovery','update-password','privacy'].map(name=>[name,document.querySelector('#'+name+'-form')]));
let client=null;
let registrationOpen=true,lastAccessVersion=null;
let signingIn=false,lastVerifiedSession=null,heartbeatBusy=false;
let callbackActivation=!!(new URLSearchParams(location.hash.slice(1)).get('access_token')||new URLSearchParams(location.search).get('code'));
const loading=document.querySelector('#session-loading'),retrySession=document.querySelector('#retry-session');
function finishLoading(){if(loading)loading.hidden=true;}
function restoreError(text){workspace.hidden=true;panel.hidden=true;window.dispatchEvent(new CustomEvent('app:session',{detail:null}));if(loading){loading.hidden=false;loading.querySelector('[data-loading-copy]').textContent=text;retrySession.hidden=false;}else note(text,'error');}
async function activateSession(session){
  const response=await fetch('/api/auth/activate-session',{method:'POST',headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
  const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'Unable to activate this login.');
}
async function expireSession(text){
  manuallySignedOut=true;signedOut(text);history.replaceState({},'','/');
  try{await client.auth.signOut({scope:'local'});}catch{/* Only this browser is cleared. */}
  finally{localStorage.removeItem('col-ams-auth-session');localStorage.removeItem('col-ams-auth-session-code-verifier');}
}
let revision=0;
let recovery=['recovery','invite'].includes(new URLSearchParams(location.hash.slice(1)).get('type'));
let manuallySignedOut=false;
let failedAttempts=Number(sessionStorage.getItem('col-failed-attempts')||0);
let collegeCatalog=[];
const completion=document.querySelector('#profile-completion-form');
const signupSelection=bindAcademicSelects(forms.signup,()=>collegeCatalog);
const completionSelection=bindAcademicSelects(completion,()=>collegeCatalog);
forgot.hidden=failedAttempts<3;
function note(text,state='info'){message.textContent=text;message.dataset.state=state;message.hidden=!text;}
function view(name,text=''){
  if(name==='signup'&&!registrationOpen)name='signin';
  completion.hidden=true;
  for(const [key,form] of Object.entries(forms))form.hidden=key!==name;
  document.querySelector('#auth-tabs').hidden=!registrationOpen||['recovery','update-password','privacy'].includes(name);
  document.querySelectorAll('[data-auth-mode]').forEach(b=>b.classList.toggle('active',b.dataset.authMode===name));
  document.querySelector('#resend-verification').hidden=!registrationOpen||name==='privacy';
  const copy={privacy:['Your privacy, your choice.','Please review the attendance privacy notice.'],signin:['Welcome back.','Sign in to your campus attendance account.'],signup:['Your campus. Your account.','Register with your personal ID and a working email.'],recovery:['Forgot your password?','We will send a secure password reset link.'],'update-password':['Choose a new password.','Finish your password recovery.']}[name];
  document.querySelector('#auth-title').textContent=copy[0];document.querySelector('#auth-copy').textContent=copy[1];note(text);
}
function closeWorkspace(){finishLoading();workspace.hidden=true;panel.hidden=false;window.dispatchEvent(new CustomEvent('app:session',{detail:null}));}
function signedOut(text=''){lastVerifiedSession=null;revision++;closeWorkspace();badge.hidden=true;signout.hidden=true;refresh.hidden=true;view('signin',text);}
async function verify(session){
  if(manuallySignedOut)return;
  const requestRevision=++revision;
  if(!session){signedOut();return;}
  if(recovery){lastVerifiedSession=session;closeWorkspace();view('update-password');return;}
  const response=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
  const data=await response.json();
  if(requestRevision!==revision)return;
  if(response.status===401){await expireSession(data.error?.message||'Your session has ended. Sign in again.');return;}
  if(response.status>=500||response.status===429){restoreError(data.error?.message||'Unable to restore your account. Retry shortly.');return;}
  if(!response.ok){
    closeWorkspace();view('signin',data.error?.message||'Unable to verify your account.');signout.hidden=false;
    return;
  }
  lastVerifiedSession=session;finishLoading();
  lastAccessVersion=data.access?.version??null;
  badge.hidden=false;badge.textContent=(data.profile.full_name||data.user.email)+' · '+data.profile.role.replaceAll('_',' ');
  badge.disabled=data.privacy_required||data.profile.approval_status!=='approved'||data.profile.role==='pending';badge.title='Account settings — '+(data.profile.full_name||data.user.email);badge.setAttribute('aria-label','Account settings for '+(data.profile.full_name||data.user.email));
  signout.hidden=false;
  if(data.privacy_required){closeWorkspace();refresh.hidden=true;view('privacy');return;}
  if(data.profile.approval_status!=='approved'||data.profile.role==='pending'){
    closeWorkspace();refresh.hidden=false;
    view('signin',data.profile.approval_status==='rejected'?'Registration declined. '+(data.profile.review_note||'Contact an administrator.'):'Email verified. Your personal ID is awaiting administrator approval.');
    if(data.profile.approval_status==='pending'&&(!data.profile.personal_id||!data.profile.institution||!data.profile.college||!data.profile.course)){
      forms.signin.hidden=true;completion.hidden=false;completion.elements.full_name.value=data.profile.full_name||'';completion.elements.personal_id.value=data.profile.personal_id||'';completionSelection.set(data.profile);
    }
    return;
  }
  refresh.hidden=true;panel.hidden=true;workspace.hidden=false;
  window.dispatchEvent(new CustomEvent('app:session',{detail:{accessToken:session.access_token,role:data.profile.role,user:data.user,profile:data.profile,device:data.device,...(data.access?{access:data.access}:{})}}));
}
document.querySelectorAll('[data-auth-mode]').forEach(button=>button.addEventListener('click',()=>view(button.dataset.authMode)));
forgot.addEventListener('click',()=>view('recovery'));
refresh.addEventListener('click',async()=>{try{const {data}=await client.auth.getSession();await verify(data.session);}catch(e){note(e.message,'error');}});
function handle(form,action){
  form.addEventListener('submit',async event=>{
    event.preventDefault();const auth=requireAuthClient(client,note);if(!auth)return;
    const button=form.querySelector('[type=submit]');button.disabled=true;
    try{await action(new FormData(form),auth);}catch(e){note(e.message||'Request failed. Please retry.','error');}finally{button.disabled=false;}
  });
}
handle(forms.signin,async(data,auth)=>{
  manuallySignedOut=false;signingIn=true;revision++;note('Signing in…');
  try{
    const {data:result,error}=await auth.auth.signInWithPassword({email:String(data.get('email')).trim(),password:String(data.get('password'))});
    if(error){
      if(error.status===400||error.code==='invalid_credentials'){failedAttempts++;sessionStorage.setItem('col-failed-attempts',String(failedAttempts));forgot.hidden=failedAttempts<3;}
      throw error;
    }
    await activateSession(result.session);await verify(result.session);
    failedAttempts=0;sessionStorage.removeItem('col-failed-attempts');forgot.hidden=true;
  }finally{signingIn=false;}
});
handle(forms.signup,async data=>{
  if(!registrationOpen)throw new Error('Public registration is closed. Contact an administrator for operational access.');
  if(!strongPassword(String(data.get('password'))))throw new Error(PASSWORD_HELP);
  note('Creating your account…');
  const response=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...Object.fromEntries(data),privacy_accepted:data.get('privacy_accepted')==='on'})});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error?.details?.[0]?.message||result.error?.message||'Registration failed');
  forms.signin.elements.email.value=String(data.get('email'));
  view('signin',result.message);
});
handle(forms.privacy,async(data,auth)=>{
  const {data:{session}}=await auth.auth.getSession();
  const response=await fetch('/api/auth/privacy-consent',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({accepted:data.get('accepted')==='on',version:'2026-11-17'})});
  const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'Unable to save consent');
  await verify(session);
});
handle(completion,async(data,auth)=>{
  const {data:{session}}=await auth.auth.getSession();
  const response=await fetch('/api/auth/registration',{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(Object.fromEntries(data))});
  const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'Unable to save details');
  await verify(session);
});
handle(forms.recovery,async(data,auth)=>{
  const {error}=await auth.auth.resetPasswordForEmail(String(data.get('email')).trim(),{redirectTo:location.origin+'/'});
  if(error)throw error;view('signin','If that email is registered, a secure reset link is on its way. Check your inbox and spam folder.');
});
handle(forms['update-password'],async(data,auth)=>{
  if(data.get('password')!==data.get('confirm_password'))throw new Error('Passwords do not match');
  const password=String(data.get('password'));if(!strongPassword(password))throw new Error(PASSWORD_HELP);
  const {data:{session}}=await auth.auth.getSession();
  const response=await fetch('/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({password})});
  const result=await response.json();if(!response.ok)throw new Error(result.error?.details?.[0]?.message||result.error?.message||'Unable to update password');
  recovery=false;await auth.auth.signOut({scope:'local'});signedOut('Password updated. Sign in with your new password.');
});
document.querySelector('#resend-verification').addEventListener('click',async()=>{
  if(!client)return;
  const email=forms.signin.elements.email.value.trim()||forms.signup.elements.email.value.trim();
  if(!email){note('Enter your email address first.');return;}
  const {error}=await client.auth.resend({type:'signup',email,options:{emailRedirectTo:location.origin+'/'}});
  note(error?.message||'If verification is needed, an email is on its way.',error?'error':'info');
});
signout.addEventListener('click',async()=>{
  if(!client)return;
  manuallySignedOut=true;
  signedOut('You have signed out.');
  // Close the workspace immediately. A stalled Auth request must not leave
  // this browser looking signed in or retain credentials after a reload.
  try{
    await Promise.race([client.auth.signOut({scope:'local'}),new Promise(resolve=>setTimeout(resolve,5000))]);
  }catch{
    // Local credentials are cleared below even if the network is unavailable.
  }finally{
    localStorage.removeItem('col-ams-auth-session');
    localStorage.removeItem('col-ams-auth-session-code-verifier');
    location.replace('/');
  }
});
window.addEventListener('app:password-changed',async()=>{
  if(!client)return;manuallySignedOut=true;signedOut('Password updated. Sign in with your new password.');
  try{await Promise.race([client.auth.signOut({scope:'local'}),new Promise(resolve=>setTimeout(resolve,5000))]);}catch{/* Clear this browser below. */}
  finally{localStorage.removeItem('col-ams-auth-session');localStorage.removeItem('col-ams-auth-session-code-verifier');history.replaceState({},'','/');}
});
async function receiveSession(session){
  if(manuallySignedOut||signingIn)return;
  try{
    const {data:current,error}=await client.auth.getSession();if(error)throw error;
    if(manuallySignedOut||signingIn||current.session?.access_token!==session?.access_token)return;
    if(callbackActivation&&session){await activateSession(session);callbackActivation=false;}
    await verify(session);
  }catch(e){restoreError(e.message||'Unable to restore your account. Check your connection and retry.');}
}
async function heartbeat(){
  if(!client||manuallySignedOut||signingIn||heartbeatBusy||!lastVerifiedSession||document.hidden)return;
  heartbeatBusy=true;const token=lastVerifiedSession.access_token;
  try{
    const response=await fetch('/api/auth/session',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
    if(response.status===401&&lastVerifiedSession?.access_token===token){const data=await response.json();await expireSession(data.error?.message||'Your account was signed in elsewhere.');}
    else if(response.ok&&lastVerifiedSession?.access_token===token){const data=await response.json();if(data.accessVersion!==undefined&&data.accessVersion!==lastAccessVersion)await verify(lastVerifiedSession);}
  }catch{/* Temporary connection failures do not remove a saved login. */}finally{heartbeatBusy=false;}
}
window.addEventListener('app:session-invalid',event=>{if(event.detail?.accessToken===lastVerifiedSession?.access_token)void expireSession(event.detail.message||'Your session has ended. Sign in again.');});
window.addEventListener('app:access-changed',()=>{if(lastVerifiedSession)void verify(lastVerifiedSession);});
window.addEventListener('online',()=>void heartbeat());document.addEventListener('visibilitychange',()=>{if(!document.hidden)void heartbeat();});
setInterval(()=>void heartbeat(),20000);
if(retrySession)retrySession.onclick=async()=>{retrySession.disabled=true;try{if(client){const {data,error}=await client.auth.getSession();if(error)throw error;await receiveSession(data.session);}else await initialize();}catch(e){restoreError(e.message);}finally{retrySession.disabled=false;}};
async function initialize(){
  try{
    const response=await fetch('/api/auth/config',{cache:'no-store'});const config=await response.json();
    if(!response.ok)throw new Error(config.error?.message||'Sign-in is not configured');
    registrationOpen=config.registrationOpen!==false;
    document.querySelectorAll('[data-auth-mode="signup"]').forEach(button=>button.hidden=!registrationOpen);
    client=createClient(config.supabaseUrl,config.publishableKey,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true,storageKey:'col-ams-auth-session'}});
    client.auth.onAuthStateChange((event,session)=>{
      if(manuallySignedOut||signingIn)return;
      if(event==='PASSWORD_RECOVERY')recovery=true;
      if(event==='SIGNED_OUT'){signedOut();return;}
      if(['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED','PASSWORD_RECOVERY'].includes(event))setTimeout(()=>void receiveSession(session),0);
    });
    const {data,error}=await client.auth.getSession();if(error)throw error;await receiveSession(data.session);
    // Catalog outages must not discard an otherwise valid restored session.
    void fetch('/api/auth/colleges').then(r=>{if(!r.ok)throw new Error('Catalog unavailable');return r.json();}).then(({colleges=[]})=>{collegeCatalog=colleges;completionSelection.refresh();signupSelection.refresh();}).catch(()=>{});
  }catch(e){restoreError(e.message||'Unable to load your account. Refresh and retry.');}
}
initialize();
