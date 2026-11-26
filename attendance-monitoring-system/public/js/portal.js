import { bindAcademicSelects } from './academic-selects.js';
import { bindRoleSearch } from './role-search.js';
import { renderLogs,renderTracker,renderManualAttendance } from './admin-tools.js';
import { confirmEmailRelease } from './email-release-dialog.js';
import { mountStudentDirectory } from './student-directory.js';
import { createNotificationBell } from './notification-bell.js';
import { renderReports } from './report-page.js';
import { eventCheckpoints,checkpointOpen } from './checkpoints.js';
import { mountCheckpointEditor } from './checkpoint-editor.js';
import { renderAccount } from './account-page.js';
import { renderReviewCenter } from './review-center.js';
import { requestDecisionNote } from './decision-dialog.js';
import {createOperationalWorkspace} from './operational-workspace.js';
import {createWorkspaceDrawer} from './workspace-navigation.js';
const page=document.querySelector('#page-content');
const nav=document.querySelector('#workspace-nav');
const dialog=document.querySelector('#qr-dialog');
const toast=document.querySelector('#toast');
let session=null, currentPage='dashboard', screen=0, scanner=null, cameraStarting=null, scanning=false;
let refreshTimer=null, qrTimer=null, qrEvent=null, aborter=new AbortController();
let notificationTimer=null;
let users=[],students=[],events=[],colleges=[];
let rosterSelection=null;
let cameraResize=null;
let viewCleanup=null;
function disposeView(){viewCleanup?.();viewCleanup=null;}
let reviewCategory='notifications',checkpointEditor=null;
const adminRoles=['main_admin','admin','col_officer'];
const isAdmin=()=>adminRoles.includes(session?.role);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const heading=(title,copy)=>`<div class="page-heading"><p class="eyebrow">COL / ${isAdmin()?'ADMINISTRATION':'STUDENT WORKSPACE'}</p><h1>${esc(title)}</h1><p>${esc(copy)}</p></div>`;
function announce(text,state=false){toast.textContent=text;toast.dataset.state=state===true?'error':typeof state==='string'?state:'success';toast.hidden=false;setTimeout(()=>toast.hidden=true,6000);}
async function api(path,options={}){
  const requestToken=session?.accessToken;
  const response=await fetch(path,{...options,cache:'no-store',signal:aborter.signal,headers:{Authorization:'Bearer '+session?.accessToken,...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  const data=await response.json().catch(()=>({}));
  if(response.status===401&&session?.accessToken===requestToken)window.dispatchEvent(new CustomEvent('app:session-invalid',{detail:{accessToken:requestToken,message:data.error?.message}}));
  if(!response.ok)throw Object.assign(new Error(data.error?.details?.[0]?.message||data.error?.message||`Request failed (${response.status})`),{attempts:data.attempts});
  return data;
}
const send=(path,body,method='POST')=>api(path,{method,body:JSON.stringify(body)});
const operationalWorkspace=createOperationalWorkspace({page,nav,api,send,esc,date,announce});
const workspaceDrawer=createWorkspaceDrawer({button:document.querySelector('#workspace-menu-toggle'),dialog:document.querySelector('#workspace-drawer'),closeButton:document.querySelector('#workspace-menu-close'),nav,main:document.querySelector('#workspace-main')});
const notificationBell=createNotificationBell({button:document.querySelector('#notification-bell'),popup:document.querySelector('#notification-popover'),badge:document.querySelector('#notification-count'),api,getSession:()=>session,isAdmin,esc,date,onOpen:()=>{if(session?.access){void navigate('reviews');return;}if(isAdmin()){reviewCategory='notifications';void navigate('reviews');}else void navigate('history');}});
function institutionOptions(value='',all=true){return `${all?'<option value="">All institutions</option>':''}${['MCNP','ISAP'].map(i=>`<option ${i===value?'selected':''}>${i}</option>`).join('')}`;}
function collegeOptions(institution='',value='',all=true){return `${all?'<option value="">All colleges</option>':''}${colleges.filter(c=>c.institution===institution).map(c=>`<option value="${esc(c.name)}" ${c.name===value?'selected':''}>${esc(c.abbreviation?c.abbreviation+' — '+c.name:c.name)}</option>`).join('')}`;}
function statsMarkup(stats){return stats.length?stats.map(s=>`<div class="stat-row"><div><strong>${esc(s.institution)}${s.college?' / '+esc(s.college):' · overall'}${s.level==='course'?' / '+esc(s.course||'Course not assigned'):''}</strong><small>${s.attended} / ${s.eligible} active participant records</small></div><strong>${s.percentage}%</strong><progress max="100" value="${s.percentage}" aria-label="${esc(s.institution+' '+(s.college||'overall')+(s.level==='course'?' '+(s.course||'unassigned course'):''))} attendance"></progress></div>`).join(''):'<p class="muted">No eligible students have an institution and college assigned yet.</p>';}
async function stopCamera(){
  if(cameraResize){window.removeEventListener('resize',cameraResize);cameraResize=null;}
  const active=scanner;scanner=null;scanning=false;
  if(cameraStarting){try{await cameraStarting;}catch{/* Startup failed. */}}
  if(active){try{if(active.isScanning)await active.stop();active.clear();}catch{/* View is already closed. */}}
}
async function navigate(name,push=true){
  window.dispatchEvent(new CustomEvent('app:navigation',{detail:{page:name}}));
  if(session?.access)return operationalWorkspace.navigate(name,push);
  disposeView();
  const version=++screen;currentPage=name;clearInterval(refreshTimer);refreshTimer=null;notificationBell.close();
  document.querySelectorAll('.review-details').forEach(d=>d.close());
  await stopCamera();if(version!==screen||!session)return;
  const targetPath=name==='account'?'/account':'/';if(push&&location.pathname!==targetPath)history.pushState({},'',targetPath);
  nav.querySelectorAll('button').forEach(b=>{b.classList.toggle('active',b.dataset.page===name);b.setAttribute('aria-current',b.dataset.page===name?'page':'false');});
  page.innerHTML='<p class="muted">Loading workspace…</p>';
  try{
    if(name==='account')renderAccount(toolContext(version),session.profile);
    else if(name==='dashboard')await (isAdmin()?adminDashboard(version):studentDashboard(version));
    else if(name==='campus')await studentDashboard(version);
    else if(name==='reviews'&&isAdmin())await renderReviewCenter(toolContext(version),reviewCategory);
    else if(name==='logs'&&isAdmin())await renderLogs(toolContext(version));
    else if(name==='tracker'&&isAdmin())await renderTracker(toolContext(version));
    else if(name==='manual'&&isAdmin())await renderManualAttendance(toolContext(version));
    else if(name==='verifications')await verifications(version);
    else if(name==='events')await eventManagement(version);
    else if(name==='roles'&&session.role==='main_admin')await roleManagement(version);
    else if(name==='reports')await reports(version);
    else if(name==='history')await historyView(version);
    else if(name==='roster')await roster(version);
    else throw new Error('This page is not available to your account');
  }catch(e){if(version===screen&&e.name!=='AbortError')page.innerHTML=heading('Unable to load this page',e.message)+'<button class="secondary-button" data-retry>Retry</button>';}
}
function toolContext(version){return {page,api,send,esc,date,heading,announce,current:()=>version===screen,onCleanup:cleanup=>{if(version===screen)viewCleanup=cleanup;else cleanup();}};}
function setNav(){
  const entries=isAdmin()?[['dashboard','Overview'],['campus','Campus events / scan'],['history','My attendance'],['reviews','Review center'],['logs','Activity logs'],['tracker','Account tracker'],['manual','Manual attendance'],['verifications','User verifications'],['events','Events & geofencing'],['roster','Students & colleges'],['reports','Attendance reports'],...(session.role==='main_admin'?[['roles','Manage role access']]:[])]:[['dashboard','Campus events'],['history','My attendance']];
  nav.innerHTML=entries.map(([key,label])=>`<button type="button" data-page="${key}">${label}</button>`).join('');
}
window.addEventListener('app:session',event=>{
  const previous=session;session=event.detail;
  workspaceDrawer.setActive(!!session);
  if(session)document.querySelector('#account-badge').setAttribute('aria-label','Account settings for '+session.profile.full_name);
  if(!session){operationalWorkspace.destroy();disposeView();screen++;aborter.abort();aborter=new AbortController();clearInterval(refreshTimer);clearInterval(qrTimer);clearInterval(notificationTimer);notificationBell.reset();void stopCamera();dialog.close();document.querySelectorAll('.decision-dialog,.review-details').forEach(d=>d.close());page.replaceChildren();return;}
  if(session.access){disposeView();screen++;clearInterval(refreshTimer);clearInterval(qrTimer);clearInterval(notificationTimer);notificationBell.reset();void stopCamera();operationalWorkspace.mount(session);void notificationBell.refresh();notificationTimer=setInterval(()=>void notificationBell.refresh(),15000);return;}
  if(previous?.user.id===session.user.id&&previous.role===session.role)return;
  setNav();
  clearInterval(notificationTimer);
  notificationBell.reset();void notificationBell.refresh();notificationTimer=setInterval(()=>void notificationBell.refresh(),15000);
  const eventId=/^\/events\/([^/]+)$/.exec(location.pathname)?.[1];
  if(location.pathname==='/account')void navigate('account',false);else if(eventId)void openStudentEvent(eventId,false);else void navigate('dashboard',false);
});
document.querySelector('.brand')?.addEventListener('click',event=>{if(session){event.preventDefault();void navigate('dashboard');}});
document.querySelector('#account-badge').addEventListener('click',()=>{if(session)void navigate('account');});
nav.addEventListener('click',event=>{const b=event.target.closest('[data-page]');if(b)void navigate(b.dataset.page);});
window.addEventListener('popstate',()=>{if(!session)return;if(session.access){void operationalWorkspace.restore();return;}const id=/^\/events\/([^/]+)$/.exec(location.pathname)?.[1];if(location.pathname==='/account')void navigate('account',false);else if(id)void openStudentEvent(id,false);else void navigate('dashboard',false);});

async function studentDashboard(version){
  const data=await api('/api/student/dashboard');if(version!==screen)return;
  if(!data.student){page.innerHTML=heading('My camera attendance','Your account needs a linked attendance record.')+`<section class="workspace-card"><p class="muted">${isAdmin()?'Set up your own attendance record to use the event camera. If no personal ID is registered, the system will assign an attendance ID. Institution-restricted events still require the correct college details.':'Ask an administrator to link your student record.'}</p>${isAdmin()?'<button class="primary-button" data-prepare-attendance>Set up my attendance record</button>':''}</section>`;return;}
  const active=data.events.filter(e=>e.is_open),upcoming=data.events.filter(e=>!e.is_open);
  function cards(items){return items.length?items.map(e=>{
    const records=data.attendance.filter(a=>a.event_id===e.id),attendance=records[0],required=eventCheckpoints(e).length,approved=records.filter(a=>a.status==='approved').length;
    return `<button class="event-card" data-open-event="${e.id}" ${!e.is_open||!e.eligible?'disabled':''}><span class="event-state">${attendance?`${approved}/${required} checkpoints approved`:e.is_open?'Open for attendance':'Upcoming'}</span><h3>${esc(e.name)}</h3><p>${esc(date(e.starts_at))}</p><small>${esc(e.institution||'MCNP + ISAP')} · ${esc(e.college||'All colleges')}</small><span class="event-card-foot">${!e.eligible?'Not eligible for this event':e.is_open?'View event & record attendance →':'Opens '+esc(date(e.opens_at))}</span></button>`;
  }).join(''):'<div class="empty-state">No events in this category.</div>';}
  page.innerHTML=heading('Your campus, in attendance.','View current events, see campus participation, and record your attendance at the venue.')+
    `<div class="summary-grid"><div class="summary-tile"><small>YOUR INSTITUTION</small><strong>${esc(data.student?.institution||'Not assigned')}</strong><span>${esc(data.student?.college||'Contact an administrator to complete your college details')}</span><span>${esc(data.student?.course||'Course not assigned — contact an administrator to confirm it.')}</span></div><div class="summary-tile"><small>APPROVED CHECKPOINTS</small><strong>${data.attendance.filter(a=>a.status==='approved').length}</strong><span>Recorded attendance checkpoints</span></div><div class="summary-tile"><small>PENALTY POINTS</small><strong>${data.profile.penalty_points}</strong><span>${session.device?.requires_review?'This browser requires attendance review':'Keep using your registered browser device'}</span></div></div>
    <h2 class="section-title">Ongoing & opening soon</h2><div class="event-grid">${cards(active)}</div><h2 class="section-title">Upcoming events</h2><div class="event-grid">${cards(upcoming)}</div>
    <section class="workspace-card"><h2>Attendance by institution, college & course</h2><p class="muted">Participants who completed every required checkpoint / active eligible records. Pending and rejected submissions are excluded.</p><select id="statistics-event" class="wide-select"><option value="">Choose an event</option>${data.events.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select><div id="statistics-content"></div></section>`;
  page.querySelector('#statistics-event').addEventListener('change',async event=>{
    const id=event.target.value,target=page.querySelector('#statistics-content');if(!id){target.replaceChildren();return;}
    try{const result=await api(`/api/student/events/${id}/statistics`);if(version===screen&&page.querySelector('#statistics-event')?.value===id)target.innerHTML=statsMarkup(result.statistics);}catch(e){target.textContent=e.message;}
  });
  const firstEvent=active[0]||data.events[0];
  if(firstEvent){const select=page.querySelector('#statistics-event');select.value=firstEvent.id;select.dispatchEvent(new Event('change'));}
  refreshTimer=setInterval(()=>{if(!document.hidden)void navigate(isAdmin()?'campus':'dashboard',false);},60000);
}
async function historyView(version){
  const data=await api('/api/student/dashboard');if(version!==screen)return;
  page.innerHTML=heading('My attendance','Your recent attendance submissions and administrator decisions.')+`<section class="workspace-card">${data.attendance.length?data.attendance.map(a=>`<article class="review-row"><div><strong>${esc(a.events?.name||'Event')} · ${esc(a.checkpoint_label||'Attendance')}</strong><p>${esc(date(a.checked_in_at))} · ${a.distance_from_venue_meters==null?'Manual verification · GPS not measured':a.distance_from_venue_meters+' m from venue'}</p>${a.review_note?`<p>${esc(a.review_note)}</p>`:''}</div><span class="status-badge ${a.status==='approved'?'good':'warning'}">${esc(a.status.replaceAll('_',' '))}</span></article>`).join(''):'<p class="muted">No attendance recorded yet.</p>'}</section>`;
}
async function openStudentEvent(id,push=true){
  const version=++screen;clearInterval(refreshTimer);await stopCamera();if(version!==screen)return;
  currentPage='event';if(push)history.pushState({},'',`/events/${id}`);page.innerHTML='<p class="muted">Loading event…</p>';
  try{
    const {event,statistics,checkpoints}=await api(`/api/student/events/${encodeURIComponent(id)}`);if(version!==screen)return;
    page.innerHTML=`<button class="text-button" data-back-events>← Back to campus events</button>`+heading(event.name,`${date(event.starts_at)} – ${date(event.ends_at)}`)+
      `<div class="event-page-grid"><section class="workspace-card"><p class="eyebrow">RECORD YOUR ATTENDANCE</p><h2>Scan the event QR</h2><p class="muted">Use the camera below to scan the administrator's current code at the venue. Allow precise location access.</p><label class="admin-field checkpoint-selector">ATTENDANCE CHECKPOINT<select id="attendance-checkpoint">${checkpoints.map(c=>`<option value="${esc(c.key)}">${esc(c.label)} · ${esc(date(c.opens_at))} – ${esc(date(c.closes_at))}${c.attendance?' · '+esc(c.attendance.status.replaceAll('_',' ')):''}</option>`).join('')}</select></label><p id="attempt-status" class="attempt-status" role="status"></p><div class="camera-frame"><div id="event-reader"></div><div id="scan-placeholder">Your camera preview appears here</div></div><button id="scan-event" class="primary-button" ${Date.now()>Date.parse(event.ends_at)?'disabled':''}>${Date.now()>Date.parse(event.ends_at)?'Event has ended':'Start camera'}</button><button id="stop-event-camera" class="secondary-button" hidden>Stop camera</button><div id="scan-result" class="result" role="status" aria-live="assertive">Ready to scan. Venue radius: ${event.radius_meters} meters.</div><p class="muted">Device: ${esc(session.device?.device_id||'verified browser')}. Your first valid venue scan establishes your attendance device. Later changes and shared attendance browsers may require administrator review.</p></section><section class="workspace-card"><h2>Campus participation</h2>${statsMarkup(statistics)}</section></div>`;
    event.checkpoint_states=checkpoints;const selector=page.querySelector('#attendance-checkpoint');selector.value=(checkpoints.find(c=>checkpointOpen(c)&&!c.attendance)||checkpoints.find(c=>!c.attendance)||checkpoints[0]).key;
    function selectCheckpoint(){const c=checkpoints.find(c=>c.key===selector.value);event.checkpoint_key=c.key;event.activeCheckpoint=c;event.attempts=c.attempts;event.attendance=c.attendance;const result=page.querySelector('#scan-result');result.textContent=c.attendance?'Attendance submitted for '+c.label+'.':'Selected: '+c.label+'. Venue radius: '+event.radius_meters+' meters.';delete result.dataset.state;updateAttemptStatus(event);}
    refreshTimer=setInterval(()=>{if(version===screen&&!scanning&&!cameraStarting)updateAttemptStatus(event);},5000);
    selectCheckpoint();selector.addEventListener('change',async()=>{await stopCamera();selectCheckpoint();});
    page.querySelector('#scan-event').addEventListener('click',()=>void scanEvent(event,version));
    page.querySelector('#stop-event-camera').addEventListener('click',async()=>{await stopCamera();if(version!==screen)return;updateAttemptStatus(event);page.querySelector('#scan-event').hidden=false;page.querySelector('#stop-event-camera').hidden=true;page.querySelector('#attendance-checkpoint').disabled=false;});
  }catch(e){if(version===screen)page.innerHTML=heading('Event unavailable',e.message)+'<button class="secondary-button" data-back-events>Back to events</button>';}
}
function updateAttemptStatus(event){
  const status=page.querySelector('#attempt-status'),button=page.querySelector('#scan-event');
  const attempts=event.attempts;
  status.textContent=event.attendance?'Attendance already submitted ('+event.attendance.status.replaceAll('_',' ')+').':attempts?.locked?'No attempts remaining. Contact an administrator.':attempts?`${attempts.remaining} of ${attempts.limit} attempts remaining. Rejected verification uses one attempt.`:'';
  button.disabled=!!event.attendance||!!attempts?.locked||!checkpointOpen(event.activeCheckpoint);
  if(!event.attendance&&!attempts?.locked){button.textContent=checkpointOpen(event.activeCheckpoint)?'Start camera':'Checkpoint closed';if(!checkpointOpen(event.activeCheckpoint))status.textContent='This checkpoint is not currently open. '+date(event.activeCheckpoint.opens_at)+' – '+date(event.activeCheckpoint.closes_at);}
  if(attempts?.locked)button.textContent='Attempt limit reached';
  else if(event.attendance)button.textContent='Attendance submitted';
}
function locate(){return new Promise((resolve,reject)=>{
  if(!navigator.geolocation){reject(new Error('Location is unavailable on this device'));return;}
  navigator.geolocation.getCurrentPosition(resolve,error=>reject(new Error(({1:'Location permission denied. Allow precise location and retry.',2:'Location unavailable. Move to an area with a clear GPS signal.',3:'Location timed out. Please retry.'})[error.code]||'Unable to get your location')),{enableHighAccuracy:true,maximumAge:0,timeout:20000});
});}
async function scanEvent(event,version){
  if(scanning||cameraStarting||event.attempts?.locked||event.attendance||!checkpointOpen(event.activeCheckpoint))return;
  const button=page.querySelector('#scan-event'),result=page.querySelector('#scan-result');
  if(!window.Html5Qrcode){result.textContent='Camera scanner did not load. Check your internet connection and refresh.';return;}
  button.disabled=true;result.textContent='Opening camera…';
  const camera=new window.Html5Qrcode('event-reader');scanner=camera;
  const userId=session.user.id;page.querySelector('#attendance-checkpoint').disabled=true;
  let submitted=false;
  try{
    cameraStarting=camera.start({facingMode:'environment'},{fps:10,aspectRatio:1,qrbox:(width,height)=>{const side=Math.floor(Math.min(230,Math.min(width,height)*.72));return {width:side,height:side};}},async token=>{
      if(submitted||version!==screen||session?.user.id!==userId)return;
      submitted=true;
      const positionPromise=locate();
      result.textContent='Verifying your location and device…';
      try{
        // Handle GPS rejection immediately while camera teardown completes.
        const position=await positionPromise;
        await stopCamera();
        if(version!==screen||session?.user.id!==userId)return;
        const data=await send('/api/student/check-in',{event_id:event.id,checkpoint_key:event.checkpoint_key,event_token:token,latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy_meters:position.coords.accuracy});
        if(version!==screen)return;
        event.attendance=data.attendance;event.attempts=data.attempts;event.activeCheckpoint.attendance=data.attendance;event.activeCheckpoint.attempts=data.attempts;const option=page.querySelector('#attendance-checkpoint').selectedOptions[0];option.textContent=event.activeCheckpoint.label+' · '+date(event.activeCheckpoint.opens_at)+' – '+date(event.activeCheckpoint.closes_at)+' · '+data.attendance.status.replaceAll('_',' ');updateAttemptStatus(event);
        result.textContent=data.message;result.dataset.state=data.attendance.status==='approved'?'success':'loading';
        announce(data.message,data.attendance.status==='approved'?'success':'warning');button.textContent='Attendance submitted';button.disabled=true;
      }catch(e){
        await stopCamera();if(version!==screen)return;
        result.textContent=e.message;result.dataset.state='error';announce(e.message,true);button.disabled=false;button.textContent='Try scanning again';if(e.attempts){event.attempts=e.attempts;event.activeCheckpoint.attempts=e.attempts;}updateAttemptStatus(event);
      }finally{if(version===screen){button.hidden=false;page.querySelector('#stop-event-camera').hidden=true;page.querySelector('#attendance-checkpoint').disabled=false;}}
    },()=>{});
    await cameraStarting;cameraStarting=null;scanning=true;
    if(version!==screen||session?.user.id!==userId){await stopCamera();return;}
    page.querySelector('#scan-placeholder').hidden=true;button.hidden=true;page.querySelector('#stop-event-camera').hidden=false;result.textContent='Point the camera at the event QR.';
    const cameraWidth=page.querySelector('#event-reader').clientWidth;
    cameraResize=async()=>{if(version!==screen||Math.abs(page.querySelector('#event-reader').clientWidth-cameraWidth)<2)return;await stopCamera();if(version!==screen)return;page.querySelector('#attendance-checkpoint').disabled=false;result.textContent='Screen size changed. Start the camera again to realign the QR frame.';button.hidden=false;page.querySelector('#stop-event-camera').hidden=true;updateAttemptStatus(event);};
    window.addEventListener('resize',cameraResize);
  }catch(e){if(version===screen){result.textContent='Could not open the camera. Allow camera access and use HTTPS or localhost.';result.dataset.state='error';button.disabled=false;page.querySelector('#attendance-checkpoint').disabled=false;}try{camera.clear();}catch{/* Camera did not start. */}scanner=null;}finally{cameraStarting=null;}
}

async function getUsers(){const data=await api('/api/admin/users');users=data.users;return users;}
async function adminDashboard(version){
  const counts=await api('/api/admin/review-summary');if(version!==screen)return;
  page.innerHTML=heading('Campus overview','Your review queues at a glance. Open a card to search, review details, and make decisions.')+
    `<div class="summary-grid">${[['notifications','UNREAD NOTIFICATIONS','Messages that need your attention'],['attendance','ATTENDANCE TO REVIEW','Pending verification decisions'],['devices','OPEN DEVICE INCIDENTS','Changed or shared browser devices']].map(([key,label,copy])=>`<button type="button" class="summary-tile" data-open-review="${key}"><small>${label}</small><strong>${counts[key]}</strong><span>${copy}</span><span>Open Review center →</span></button>`).join('')}</div><section class="workspace-card"><h2>User registrations</h2><p class="muted">${counts.registrations} account(s) awaiting verification.</p><button type="button" class="secondary-button" data-open-verifications>View registration requests →</button></section>`;
  refreshTimer=setInterval(()=>{if(!document.hidden&&!document.querySelector('dialog[open]'))void navigate('dashboard',false);},60000);
}
async function verifications(version){
  await getUsers();if(version!==screen)return;
  page.innerHTML=heading('Verify new accounts','Check each personal ID and institution before allowing attendance access.')+`<section class="workspace-card">${users.filter(u=>u.approval_status==='pending'||u.approval_status==='rejected').map(u=>`<article class="review-row"><div><strong>${esc(u.full_name||'Unnamed account')}</strong><p>${esc(u.email)} · ID ${esc(u.personal_id||'Missing personal ID')}</p><small>${esc(u.institution||'Institution missing')} / ${esc(u.college||'College missing')} · ${esc(u.approval_status)}</small><p>Course: ${esc(u.course||'Not supplied — complete registration details first')}</p>${u.review_note?`<p>${esc(u.review_note)}</p>`:''}</div>${u.approval_status==='pending'?`<div class="row-actions"><button class="small-action" data-verify-user="${u.user_id}" data-decision="approved">Approve</button><button class="small-action danger" data-verify-user="${u.user_id}" data-decision="rejected">Reject</button></div>`:''}</article>`).join('')||'<p class="muted">No registration requests waiting.</p>'}</section>`;
}
async function eventManagement(version){
  const [data,catalog]=await Promise.all([api('/api/admin/events'),api('/api/auth/colleges')]);events=data.events;colleges=catalog.colleges;if(version!==screen)return;
  page.innerHTML=heading('Events & geofencing','Set the venue, attendance window, and eligible institutions. Attendance opens one hour before the event.')+
    `<div class="admin-columns"><section class="workspace-card"><h2 id="event-form-title">Create an event</h2><form id="event-form" class="management-form"><input type="hidden" name="id"><label class="admin-field">EVENT NAME<input name="name" required maxlength="160"></label><div class="coordinate-fields"><label class="admin-field">LATITUDE<input name="latitude" type="number" step="any" min="-90" max="90" required></label><label class="admin-field">LONGITUDE<input name="longitude" type="number" step="any" min="-180" max="180" required></label></div><button type="button" id="use-location" class="small-action">Use my current location as venue center</button><label class="admin-field">RADIUS IN METERS<input name="radius_meters" type="number" min="1" max="100000" value="100" required></label><label class="admin-field">MAXIMUM REJECTED ATTEMPTS<input name="max_check_in_attempts" type="number" min="1" max="20" value="3" required></label><p class="muted">Per participant, per checkpoint. Invalid QR, GPS, or device verification uses a try. Camera/location permissions and connection errors do not.</p><div class="coordinate-fields"><label class="admin-field">START<input name="starts_at" type="datetime-local" required></label><label class="admin-field">END<input name="ends_at" type="datetime-local" required></label></div><p class="muted" id="event-duration">Times use your current local timezone. End time defines the duration.</p><label class="admin-field">INSTITUTION<select name="institution">${institutionOptions()}</select></label><label class="admin-field">COLLEGE<select name="college">${collegeOptions()}</select></label><button class="report-button" type="submit">Save event →</button><button class="text-button" type="reset">Clear / cancel edit</button></form></section>
    <section class="workspace-card"><h2>Scheduled events</h2>${events.map(e=>`<article class="event-admin-row"><span class="event-state">${e.archived_at?'Archived':Date.now()>Date.parse(e.ends_at)?'Ended':Date.now()>=Date.parse(e.starts_at)?'Ongoing':'Scheduled'}</span><h3>${esc(e.name)}</h3><p>${esc(date(e.starts_at))} – ${esc(date(e.ends_at))}</p><small>${e.radius_meters} m · ${esc(e.institution||'Both institutions')} / ${esc(e.college||'All colleges')}</small><div class="row-actions"><button class="small-action" data-event-qr="${e.id}" ${e.archived_at?'disabled':''}>Display QR</button><button class="small-action" data-edit-event="${e.id}">Edit</button><button class="small-action" data-archive-event="${e.id}" data-archived="${!!e.archived_at}">${e.archived_at?'Restore':'Archive'}</button></div></article>`).join('')||'<p class="muted">No events yet.</p>'}</section></div>`;
  const form=page.querySelector('#event-form');checkpointEditor=mountCheckpointEditor(form);
  form.elements.institution.addEventListener('change',()=>form.elements.college.innerHTML=collegeOptions(form.elements.institution.value));
  form.addEventListener('reset',()=>{form.elements.id.value='';page.querySelector('#event-form-title').textContent='Create an event';});
  form.addEventListener('input',()=>{const minutes=(Date.parse(form.elements.ends_at.value)-Date.parse(form.elements.starts_at.value))/60000;if(minutes>0)page.querySelector('#event-duration').textContent=`Duration: ${Math.floor(minutes/60)}h ${minutes%60}m. Attendance opens one hour before start.`;});
  page.querySelector('#use-location').addEventListener('click',async()=>{try{const p=await locate();form.elements.latitude.value=p.coords.latitude;form.elements.longitude.value=p.coords.longitude;announce('Venue center set from your current location.');}catch(e){announce(e.message,true);}});
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;
    try{const values=Object.fromEntries(new FormData(form)),id=values.id;delete values.id;values.checkpoints=checkpointEditor.getValue();for(const k of ['latitude','longitude','radius_meters','max_check_in_attempts'])values[k]=Number(values[k]);for(const k of ['starts_at','ends_at'])values[k]=new Date(values[k]).toISOString();values.institution=values.institution||null;values.college=values.college||null;await send(id?`/api/admin/events/${id}`:'/api/admin/events',values,id?'PATCH':'POST');announce('Event saved.');void navigate('events',false);}catch(e){announce(e.message,true);button.disabled=false;}
  });
}
async function roleManagement(version){
  const [,data]=await Promise.all([getUsers(),api('/api/admin/students')]);students=data.students;if(version!==screen)return;
  page.innerHTML=heading('Manage role access','Only your main administrator account can promote or demote approved users.')+`<section class="workspace-card"><div class="role-search"><label class="admin-field" for="role-search">FIND AN ACCOUNT<input id="role-search" type="search" placeholder="Search name, email, or personal ID" role="combobox" aria-autocomplete="list" aria-controls="role-suggestions" aria-expanded="false" autocomplete="off"></label><div id="role-suggestions" role="listbox" aria-label="Suggested accounts" hidden></div></div><p id="role-search-status" class="muted" role="status"></p>${users.map(u=>`<form class="role-row" data-role-user="${u.user_id}"><div><strong>${esc(u.full_name||u.email)}</strong><p>${esc(u.email)} · ${esc(u.approval_status)}</p></div><label class="admin-field">ROLE<select name="role" ${u.role==='main_admin'?'disabled':''}>${['student','student_officer','col_officer','admin',...(u.role==='main_admin'?['main_admin']:[])].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${r.replaceAll('_',' ')}</option>`).join('')}</select></label><label class="admin-field">STUDENT RECORD<select name="student_id"><option value="">No student link</option>${students.filter(s=>!s.archived_at).map(s=>`<option value="${s.id}" ${s.id===u.student_id?'selected':''}>${esc(s.name)} / ${esc(s.student_number)}</option>`).join('')}</select></label><button type="submit" class="small-action" ${u.role==='main_admin'||u.approval_status!=='approved'?'disabled':''}>Save access</button></form>`).join('')}</section>`;
  bindRoleSearch(page,users);
  page.querySelectorAll('[data-role-user]').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const b=form.querySelector('button');b.disabled=true;try{const input=Object.fromEntries(new FormData(form));input.student_id=input.student_id||null;await send(`/api/admin/users/${form.dataset.roleUser}`,input,'PATCH');announce('Role updated.');void navigate('roles',false);}catch(e){announce(e.message,true);b.disabled=false;}}));
}
async function roster(version){
  const catalog=await api('/api/auth/colleges');colleges=catalog.colleges;students=[];if(version!==screen)return;
  page.innerHTML=heading('Students & colleges','Find student records and manage your institution, college, and course catalog.')+`<div class="roster-layout"><section id="student-directory" class="workspace-card"></section><div class="roster-forms"><section class="workspace-card"><h2>Student record</h2><form id="student-form" class="management-form"><input name="id" type="hidden"><label class="admin-field">FULL NAME<input name="name" required maxlength="120"></label><label class="admin-field">PERSONAL ID<input name="student_number" required maxlength="40"></label><label class="admin-field">INSTITUTION<select name="institution" required><option value="">Choose an institution</option>${institutionOptions('',false)}</select></label><label class="admin-field">COLLEGE<select name="college" required></select></label><label class="admin-field">COURSE<select name="course" required></select></label><button class="report-button" type="submit">Save student record →</button></form></section><section class="workspace-card"><h2>Add a college</h2><form id="college-form" class="management-form"><label class="admin-field">INSTITUTION<select name="institution">${institutionOptions('',false)}</select></label><label class="admin-field">COLLEGE NAME<input name="name" required maxlength="100"></label><button class="report-button" type="submit">Add college →</button></form></section><section class="workspace-card"><h2>Add a course</h2><form id="course-form" class="management-form"><label class="admin-field">INSTITUTION<select name="institution">${institutionOptions('',false)}</select></label><label class="admin-field">COLLEGE<select name="college" required>${collegeOptions('MCNP','',false)}</select></label><label class="admin-field">COURSE NAME<input name="name" required maxlength="160"></label><button class="report-button" type="submit">Add course →</button></form></section></div></div>`;
  const studentForm=page.querySelector('#student-form');rosterSelection=bindAcademicSelects(studentForm,()=>colleges);
  const courseForm=page.querySelector('#course-form');courseForm.elements.institution.addEventListener('change',()=>courseForm.elements.college.innerHTML=collegeOptions(courseForm.elements.institution.value,'',false));
  for(const [formId,url] of [['student-form','students'],['college-form','colleges'],['course-form','courses']]){
    const form=page.querySelector('#'+formId);form.addEventListener('submit',async event=>{event.preventDefault();const b=form.querySelector('button');b.disabled=true;try{const input=Object.fromEntries(new FormData(form));const id=input.id;delete input.id;await send(`/api/admin/${url}${id?'/'+id:''}`,input,id?'PATCH':'POST');announce('Saved.');void navigate('roster',false);}catch(e){announce(e.message,true);b.disabled=false;}});
  }
  await mountStudentDirectory({...toolContext(version),canReleaseEmail:['admin','main_admin'].includes(session.role)},page.querySelector('#student-directory'),items=>{students=[...new Map([...students,...items].map(s=>[s.id,s])).values()];});
}
async function reports(version){await renderReports(toolContext(version));}
async function displayQr(id){
  clearInterval(qrTimer);qrEvent=id;dialog.showModal();document.querySelector('#event-qr').replaceChildren();
  const refresh=async()=>{try{const data=await api(`/api/admin/events/${id}/qr`);if(qrEvent!==id||!dialog.open)return;document.querySelector('#qr-title').textContent=data.event_name;const container=document.querySelector('#event-qr');container.replaceChildren();if(!window.QRCode)throw new Error('QR generator failed to load. Refresh the page.');new window.QRCode(container,{text:data.token,width:260,height:260,correctLevel:window.QRCode.CorrectLevel.M});document.querySelector('#qr-expiry').textContent='Code expires '+date(data.expires_at);}catch(e){document.querySelector('#qr-expiry').textContent=e.message;}};
  await refresh();if(dialog.open)qrTimer=setInterval(refresh,4*60000);
}
dialog.addEventListener('close',()=>{clearInterval(qrTimer);qrEvent=null;document.querySelector('#event-qr').replaceChildren();});
document.querySelector('#close-qr').addEventListener('click',()=>dialog.close());
document.querySelector('#rotate-qr').addEventListener('click',async()=>{if(!qrEvent)return;try{await send(`/api/admin/events/${qrEvent}/qr/rotate`,{});const id=qrEvent;dialog.close();await displayQr(id);announce('Previous codes revoked.');}catch(e){announce(e.message,true);}});
page.addEventListener('click',async event=>{
  if(session?.access)return;
  const b=event.target.closest('button');if(!b||b.disabled)return;
  if(b.hasAttribute('data-prepare-attendance')){b.disabled=true;try{await send('/api/student/attendance-profile',{});void navigate('campus');}catch(e){announce(e.message,true);b.disabled=false;}return;}
  if(b.dataset.releaseEmail){await confirmEmailRelease({student:b.dataset.releaseEmail,user:b.dataset.releaseUser,email:b.dataset.releaseAddress,send,announce,onDone:()=>navigate('roster',false)});return;}
  if(b.dataset.openReview&&isAdmin()){reviewCategory=b.dataset.openReview;void navigate('reviews');return;}
  if(b.hasAttribute('data-open-verifications')&&isAdmin()){void navigate('verifications');return;}
  if(b.dataset.trackUser&&isAdmin()){const version=++screen;clearInterval(refreshTimer);await stopCamera();currentPage='tracker';try{await renderTracker(toolContext(version),b.dataset.trackUser);}catch(e){announce(e.message,true);}return;}
  if(b.hasAttribute('data-retry')){void navigate(currentPage,false);return;}
  if(b.hasAttribute('data-back-events')){void navigate(isAdmin()?'campus':'dashboard');return;}
  if(b.dataset.openEvent){void openStudentEvent(b.dataset.openEvent);return;}
  if(b.dataset.eventQr){await displayQr(b.dataset.eventQr);return;}
  if(b.dataset.editEvent){const e=events.find(e=>e.id===b.dataset.editEvent),f=page.querySelector('#event-form');for(const key of ['id','name','latitude','longitude','radius_meters','max_check_in_attempts'])f.elements[key].value=e[key];f.elements.institution.value=e.institution||'';f.elements.college.innerHTML=collegeOptions(e.institution,e.college);for(const key of ['starts_at','ends_at']){const d=new Date(e[key]);f.elements[key].value=new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}checkpointEditor.set(e);page.querySelector('#event-form-title').textContent='Edit '+e.name;f.scrollIntoView({behavior:'smooth'});return;}
  if(b.dataset.editStudent){const s=students.find(s=>s.id===b.dataset.editStudent),f=page.querySelector('#student-form');for(const key of ['id','name','student_number'])f.elements[key].value=s[key];rosterSelection.set(s);f.scrollIntoView({behavior:'smooth'});return;}
  b.disabled=true;
  try{
    if(b.dataset.readNotification)await send(`/api/admin/notifications/${b.dataset.readNotification}/read`,{},'PATCH');
    else if(b.dataset.archiveEvent)await send(`/api/admin/events/${b.dataset.archiveEvent}/archive`,{archived:b.dataset.archived!=='true'},'PATCH');
    else if(b.dataset.archiveStudent)await send(`/api/admin/students/${b.dataset.archiveStudent}/archive`,{archived:b.dataset.archived!=='true'},'PATCH');
    else if(b.dataset.verifyUser||b.dataset.reviewAttendance||b.dataset.reviewDevice){
      const note=await requestDecisionNote(b);if(note===null){b.disabled=false;return;}
      const url=b.dataset.verifyUser?`/api/admin/users/${b.dataset.verifyUser}/verification`:b.dataset.reviewAttendance?`/api/admin/attendance/${b.dataset.reviewAttendance}/review`:`/api/admin/devices/${b.dataset.reviewDevice}/review`;
      await send(url,{decision:b.dataset.decision,note:note.trim()},'PATCH');
    }else{b.disabled=false;return;}
    announce('Decision saved.');void navigate(currentPage,false);
  }catch(e){announce(e.message,true);b.disabled=false;}
});
