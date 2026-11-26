import { renderActivityLogs } from './activity-logs.js';
import { eventCheckpoints,checkpointOpen } from './checkpoints.js';
import { bindRoleSearch } from './role-search.js';
const searchMarkup=()=>`<div class="role-search"><label class="admin-field" for="role-search">FIND A STUDENT OR ACCOUNT<input id="role-search" type="search" placeholder="Type a name, email, or personal ID" role="combobox" aria-autocomplete="list" aria-controls="role-suggestions" aria-expanded="false" autocomplete="off"></label><div id="role-suggestions" role="listbox" aria-label="Suggested accounts" hidden></div></div><p id="role-search-status" class="muted" role="status"></p>`;
const distance=a=>a.distance_from_venue_meters==null?'Not measured':`${Number(a.distance_from_venue_meters).toFixed(2)} m`;

export async function renderLogs(ctx){return renderActivityLogs(ctx);}

export async function renderTracker(ctx,initialUser=null){
  const {page,api,esc,date,current,heading}=ctx;
  const {users}=await api('/api/admin/users');if(!current())return;
  page.innerHTML=heading('Account tracker','Review recorded browser devices and attendance location evidence for a selected account.')+`<section class="workspace-card">${searchMarkup()}<p class="muted">GPS coordinates are estimates, not live tracking. MAC addresses and guaranteed exact physical locations are unavailable to this website.</p></section><div id="account-activity"></div>`;
  let selection=0;
  async function choose(user){
    const requested=++selection,target=page.querySelector('#account-activity');target.textContent='Loading account activity…';
    try{
      const data=await api(`/api/admin/users/${user.user_id}/activity`);if(!current()||requested!==selection)return;
      target.innerHTML=`<section class="workspace-card account-details"><h2>${esc(data.profile.full_name||data.profile.email)}</h2><p>${esc(data.profile.email)} · ${esc(data.profile.personal_id||'No personal ID')}</p><p>${esc(data.profile.institution||'Unassigned')} / ${esc(data.profile.college||'Unassigned')}</p><p>Privacy consent: ${data.profile.privacy_accepted_at?esc(date(data.profile.privacy_accepted_at))+' · version '+esc(data.profile.privacy_version):'Not recorded'}</p></section><section class="workspace-card"><h2>Recorded browser devices</h2>${data.devices.map(d=>`<article class="review-row"><div><strong>Browser ${esc(d.device_hash.slice(0,16))}</strong><p>${esc(d.user_agent)}</p><small>First seen ${esc(date(d.first_seen_at))} · Last seen ${esc(date(d.last_seen_at))}</small></div></article>`).join('')||'<p class="muted">No recorded browser devices.</p>'}</section><section class="workspace-card"><h2>Attendance & venue distance</h2>${data.attendance.map(a=>`<article class="review-row"><div class="location-evidence"><strong>${esc(a.events?.name||a.event_id)} · ${esc(a.checkpoint_label||'Attendance')} · ${esc(a.status)}</strong><span>${esc(date(a.checked_in_at))} · ${a.entry_method==='manual'?'Manual staff entry':'QR submission'}</span><span>Distance from venue: ${esc(distance(a))} · Radius: ${esc(a.events?.radius_meters)} m</span>${a.latitude!=null&&a.longitude!=null?`<span>Recorded GPS: ${esc(a.latitude)}, ${esc(a.longitude)}</span><span>Reported accuracy: ±${esc(a.accuracy_meters??'unknown')} m</span>`:'<span>No student GPS recorded.</span>'}<span>Student browser: ${esc(a.device_hash?.slice(0,16)||'Not verified / not recorded')}</span>${a.entry_method==='manual'?`<span>Recorded by staff account ${esc(a.recorded_by)}</span><span>Reason: ${esc(a.manual_reason)}</span>`:''}</div></article>`).join('')||'<p class="muted">No attendance records.</p>'}</section><section class="workspace-card"><h2>Login history · latest 100</h2>${data.logins.map(l=>`<article class="review-row"><div><strong>${esc(date(l.created_at))} · Browser ${esc(l.device_hash.slice(0,16))}</strong><p>${esc(l.user_agent)}</p><small>IP ${esc(l.ip_address||'Unavailable')} · ${l.shared_device?'Shared browser. ':''}${l.changed_device?'Changed browser. ':''}GPS not collected at login.</small></div></article>`).join('')||'<p class="muted">No login records.</p>'}</section>`;
    }catch(e){if(current()&&requested===selection)target.textContent=e.message;}
  }
  bindRoleSearch(page,users,user=>void choose(user));
  page.querySelector('#role-search').addEventListener('input',()=>{selection++;page.querySelector('#account-activity').replaceChildren();});
  if(initialUser){const user=users.find(u=>u.user_id===initialUser);if(user){page.querySelector('#role-search').value=user.full_name||user.email;await choose(user);}}
}

export async function renderManualAttendance(ctx){
  const {page,api,send,esc,date,current,heading,announce}=ctx;
  const [roster,accounts,calendar]=await Promise.all([api('/api/admin/students'),api('/api/admin/users'),api('/api/admin/events')]);if(!current())return;
  const choices=roster.students.filter(s=>!s.archived_at).map(s=>({user_id:s.id,full_name:s.name,personal_id:s.student_number,email:accounts.users.find(u=>u.student_id===s.id)?.email||'',student:s}));
  const now=Date.now(),events=calendar.events.filter(e=>!e.archived_at&&now>=Date.parse(e.starts_at)-3600000&&now<=Date.parse(e.ends_at));
  page.innerHTML=heading('Manual attendance','For students without a usable device. An admin or COL officer must verify the student in person.')+`<section class="workspace-card">${searchMarkup()}<p id="manual-selected" class="manual-selection">Select a student from the suggestions.</p><form id="manual-attendance-form" class="management-form"><input name="student_id" type="hidden"><label class="admin-field">OPEN EVENT<select name="event_id" required><option value="">Choose an event</option>${events.map(e=>`<option value="${e.id}">${esc(e.name)} · ${esc(date(e.starts_at))}</option>`).join('')}</select></label><label class="admin-field">ATTENDANCE CHECKPOINT<select name="checkpoint_key" required><option value="">Choose an event first</option></select></label><label class="admin-field">REASON FOR MANUAL CHECK-IN<textarea name="reason" rows="3" minlength="3" maxlength="1000" placeholder="Example: student has no device; ID and presence verified in person" required></textarea></label><label class="consent-check"><input name="verified" type="checkbox" required><span>I verified this student's ID and presence at the venue. This entry does not certify the student's GPS or device.</span></label><button type="submit" class="primary-button">Record manual attendance</button><p id="manual-result" class="muted" role="status"></p></form><p class="muted">No student scan-attempt limit applies to staff entries. Each participant can have one attendance record per checkpoint. Entries record your staff account, time, and reason.</p>${events.length?'':'<p class="muted">No events are currently accepting attendance.</p>'}</section>`;
  const form=page.querySelector('#manual-attendance-form'),selected=page.querySelector('#manual-selected');
  form.elements.event_id.addEventListener('change',()=>{const event=events.find(e=>e.id===form.elements.event_id.value);const checkpoints=event?eventCheckpoints(event):[];form.elements.checkpoint_key.innerHTML='<option value="">Choose an open checkpoint</option>'+checkpoints.map(c=>`<option value="${esc(c.key)}" ${checkpointOpen(c)?'':'disabled'}>${esc(c.label)} · ${esc(date(c.opens_at))} – ${esc(date(c.closes_at))}</option>`).join('');form.elements.checkpoint_key.value=checkpoints.find(c=>checkpointOpen(c))?.key||'';});
  bindRoleSearch(page,choices,user=>{form.elements.student_id.value=user.user_id;selected.textContent=`${user.full_name} · ${user.personal_id} · ${user.student.institution||'Unassigned'}`;});
  page.querySelector('#role-search').addEventListener('input',()=>{form.elements.student_id.value='';selected.textContent='Select a student from the suggestions.';});
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('[type="submit"]'),result=page.querySelector('#manual-result');
    if(!form.elements.student_id.value){result.textContent='Choose a student from the search suggestions first.';return;}
    button.disabled=true;
    try{const input=Object.fromEntries(new FormData(form));input.verified=input.verified==='on';const data=await send('/api/admin/manual-attendance',input);if(!current())return;result.textContent=data.message;announce(data.message);form.elements.student_id.value='';form.elements.reason.value='';form.elements.verified.checked=false;page.querySelector('#role-search').value='';selected.textContent='Select the next student from the suggestions.';}
    catch(e){if(current()){result.textContent=e.message;announce(e.message,true);}}
    finally{if(current())button.disabled=false;}
  });
}
