import {renderOperationalReports} from './operational-reports.js';
import {operationalMenu,requestedWorkspacePage} from './workspace-navigation.js';
import {renderOperationalDashboard} from './operational-dashboard.js';
import {renderAuditTrail,renderStudentRecords,renderAccountLifecycle} from './account-audit.js';
import {renderAttendanceReviews,renderManualAttendance} from './attendance-reviews.js';
import {renderParticipantDevices} from './participant-devices.js';
import {renderOperationalEvent,renderPublicEventLink} from './operational-events.js';
import {renderAccount} from './account-page.js';
import {renderClassLists,renderEventClassLists} from './class-lists.js';

export function createOperationalWorkspace({page,nav,api,send,esc,date,announce}){
  let session=null,view=0,cleanup=null,modal=null,accountPage=1,search='',queryRevision=0,events=[];
  const roles=['classroom_representative','club_president','col_regular','col_admin','administrator'];
  const label=value=>({classroom_representative:'Classroom representative',club_president:'Club president',col_regular:'COL regular',col_admin:'COL admin',administrator:'Administrator'}[value]||String(value).replaceAll('_',' '));
  const can=key=>session?.access.features.some(f=>f.key===key&&f.effective);
  const heading=(title,copy)=>`<div class="page-heading"><p class="eyebrow">COL / OPERATIONAL WORKSPACE</p><h1>${esc(title)}</h1><p>${esc(copy)}</p></div>`;
  const notice=(text)=>`<section class="workspace-card"><p class="muted">${esc(text)}</p></section>`;
  function closeEditor(){if(modal){modal.close();modal.remove();modal=null;}}
  function destroy(){view++;queryRevision++;cleanup?.();cleanup=null;closeEditor();session=null;}
  function mount(value){
    // A token refresh must not discard an administrator's unsaved access form.
    if(session?.user.id===value.user.id&&session.access.version===value.access.version&&session.role===value.role){session=value;return;}
    destroy();session=value;search='';accountPage=1;
    nav.innerHTML=operationalMenu(session.access).map(([key,text])=>`<button type="button" data-page="${key}">${esc(text)}</button>`).join('');
    void navigate(requestedWorkspacePage(location.pathname,location.search,session.access),false);
  }
  async function navigate(name,push=true,options={}){
    window.dispatchEvent(new CustomEvent('app:navigation',{detail:{page:name}}));
    cleanup?.();cleanup=null;closeEditor();const epoch=++view;
    document.title=(name==='account'?'My account':operationalMenu(session.access).find(([key])=>key===name)?.[1]||'Workspace')+' · COL-AMS';
    const target=name==='account'?'/account':name==='dashboard'?'/':'/?view='+encodeURIComponent(name);if(location.pathname+location.search!==target){if(push)history.pushState({},'',target);else history.replaceState({},'',target);}
    for(const button of nav.querySelectorAll('button')){button.classList.toggle('active',button.dataset.page===name);button.setAttribute('aria-current',button.dataset.page===name?'page':'false');}
    page.innerHTML=notice('Loading workspace…');
    try{
      if(name==='account')renderAccount({page,send,esc,heading,current:()=>epoch===view,onCleanup:fn=>cleanup=fn},session.profile);
      else if(name==='dashboard'){
        await renderOperationalDashboard({...classContext(epoch),profile:session.profile,onNavigate:name=>void navigate(name),onReview:id=>void navigate('reviews',true,{caseId:id}),onNotifications:()=>void navigate('reviews',true,{notifications:true})});
      }else if(name==='reviews'&&can('attendance.review'))await renderAttendanceReviews({...classContext(epoch),initialCaseId:options.caseId,initialNotifications:options.notifications});
      else if(name==='events'&&can('events.view')){
        const data=await api('/api/operational/events');if(epoch!==view)return;
        page.innerHTML=heading('Events','Events within your assigned access.')+(can('events.manage')?'<p><button class="primary-button" data-new-event>Create event</button></p>':'')+(data.events.length?`<div class="operational-cards">${data.events.map(e=>`<article class="workspace-card"><h2>${esc(e.name)}</h2><p>${esc(date(e.starts_at))} – ${esc(date(e.ends_at))}</p><p class="muted">${esc(e.institution||'Campus event')}${e.college?' · '+esc(e.college):''}</p><p>${can('attendance.manual')?`<button class="secondary-button" data-event-manual="${e.id}">Manual attendance</button>`:''}${can('devices.admin')?`<button class="secondary-button" data-event-devices="${e.id}">Device verification</button>`:''}<button class="secondary-button" data-event-link="${e.id}">Attendance QR / link</button> ${can('events.manage')&&e.can_manage?`<button class="secondary-button" data-edit-event="${e.id}">Edit event</button>`:''}</p>${can('events.eligibility')&&e.can_set_class_lists?`<button class="secondary-button" data-event-classes="${e.id}">Set event class lists</button>`:''}</article>`).join('')}</div>`:notice('No events are assigned to your account. Ask an administrator to review your scope assignments.'));
        const openEvent=(renderer,value)=>{cleanup?.();cleanup=null;const selected=++view;void renderer({...classContext(selected),back:()=>void navigate('events')},value).catch(error=>{if(selected===view)page.innerHTML=heading('Unable to load event',error.message);});};
        page.querySelector('[data-new-event]')?.addEventListener('click',()=>openEvent(renderOperationalEvent,null));
        for(const b of page.querySelectorAll('[data-edit-event]'))b.onclick=()=>openEvent(renderOperationalEvent,b.dataset.editEvent);
        for(const b of page.querySelectorAll('[data-event-manual]'))b.onclick=()=>openEvent(renderManualAttendance,data.events.find(e=>e.id===b.dataset.eventManual));
        for(const b of page.querySelectorAll('[data-event-devices]'))b.onclick=()=>openEvent(renderParticipantDevices,data.events.find(e=>e.id===b.dataset.eventDevices));
        for(const b of page.querySelectorAll('[data-event-link]'))b.onclick=()=>openEvent(renderPublicEventLink,data.events.find(e=>e.id===b.dataset.eventLink));
        for(const b of page.querySelectorAll('[data-event-classes]'))b.onclick=()=>{cleanup?.();cleanup=null;const selected=++view;void renderEventClassLists(classContext(selected),data.events.find(e=>e.id===b.dataset.eventClasses)).catch(e=>{if(selected===view)page.innerHTML=heading('Unable to load event lists',e.message);});};
      }else if(name==='classes'&&['rosters.view','rosters.manage','sections.manage','representatives.assign'].some(can))await renderClassLists(classContext(epoch));
      else if(name==='students'&&can('accounts.manage'))await renderStudentRecords(classContext(epoch));
      else if(name==='reports'&&can('reports.view'))await renderOperationalReports(classContext(epoch));
      else if(name==='audit'&&can('audit.view'))await renderAuditTrail(classContext(epoch));
      else if(name==='roles'&&can('accounts.manage'))await accounts(epoch);
      else throw new Error('This page is unavailable to your account');
    }catch(error){if(epoch===view)page.innerHTML=heading('Unable to load this page',error.message);}
  }
  function classContext(epoch){return {page,api,send,esc,date,heading,announce,actorId:session.user.id,access:session.access,getToken:()=>session?.accessToken,current:()=>epoch===view,onCleanup:fn=>{if(epoch===view)cleanup=fn;else fn();}};}
  async function accounts(epoch){
    const result=await api('/api/operational/events');if(epoch!==view)return;events=result.events;
    page.innerHTML=heading('Account & feature access','Manage operational roles, assignments, and individual permissions.')+`<section class="workspace-card"><div class="card-heading"><h2>Operational accounts</h2><button type="button" class="primary-button" data-new-account>Provision account</button></div><label class="admin-field">SEARCH ACCOUNTS<input id="operational-search" type="search" maxlength="100" placeholder="Search name or email" value="${esc(search)}" autocomplete="off"></label><div id="operational-candidates" class="operational-candidates" aria-live="polite"></div><p id="operational-status" role="status" class="muted"></p><div id="operational-accounts"></div><nav id="operational-pagination" class="operational-pagination" aria-label="Account pages"></nav></section>`;
    page.querySelector('[data-new-account]').onclick=()=>editAccount(null,epoch);
    let timer;
    const field=page.querySelector('#operational-search');
    field.oninput=()=>{search=field.value.trim();accountPage=1;queryRevision++;clearTimeout(timer);timer=setTimeout(()=>void loadAccounts(epoch),300);};
    cleanup=()=>clearTimeout(timer);
    await loadAccounts(epoch);
  }
  async function loadAccounts(epoch){
    const query=++queryRevision;const status=page.querySelector('#operational-status');status.textContent='Searching…';
    try{
      const data=await api('/api/operational/accounts?'+new URLSearchParams({search,page:String(accountPage)}));
      const candidates=search.length>=2?await api('/api/operational/account-candidates?'+new URLSearchParams({search})):{items:[]};
      if(epoch!==view||query!==queryRevision)return;
      status.textContent=`${data.total} operational account${data.total===1?'':'s'}.`;
      const results=page.querySelector('#operational-accounts');
      results.innerHTML=data.items.length?`<div class="operational-cards">${data.items.map(a=>`<article class="operational-account-card"><div><h3>${esc(a.full_name)}</h3><p>${esc(a.email)}</p><p class="muted">${esc(label(a.role))} · ${a.enabled?'Active':'Deactivated'}</p></div><div><button class="secondary-button" data-edit-account="${a.user_id}">Edit access</button><button class="secondary-button" data-account-state="${a.user_id}">Deactivate / reactivate</button></div></article>`).join('')}</div>`:'<p class="muted">No matching operational accounts.</p>';
      for(const button of results.querySelectorAll('[data-edit-account]'))button.onclick=()=>editAccount(data.items.find(a=>a.user_id===button.dataset.editAccount),epoch);
      for(const button of results.querySelectorAll('[data-account-state]'))button.onclick=()=>{cleanup?.();cleanup=null;const selected=++view;void renderAccountLifecycle(classContext(selected),button.dataset.accountState,()=>void navigate('roles')).catch(error=>{if(selected===view)page.innerHTML=heading('Unable to load account',error.message);});};
      const suggestions=page.querySelector('#operational-candidates');
      suggestions.innerHTML=candidates.items.length?`<p class="muted">Existing identities available for reviewed assignment</p>${candidates.items.map(a=>`<button type="button" class="operational-candidate" data-candidate="${a.user_id}"><strong>${esc(a.full_name||a.email)}</strong><span>${esc(a.email)} · ${esc(label(a.legacy_role))}</span></button>`).join('')}`:'';
      for(const button of suggestions.querySelectorAll('[data-candidate]'))button.onclick=()=>editAccount({...candidates.items.find(a=>a.user_id===button.dataset.candidate),role:'classroom_representative',version:0,enabled:true,scopes:[],overrides:{}},epoch);
      const totalPages=Math.ceil(data.total/data.page_size);const pagination=page.querySelector('#operational-pagination');pagination.replaceChildren();
      if(totalPages>1){const selected=new Set([1,totalPages,...Array.from({length:5},(_,i)=>accountPage+i-2).filter(n=>n>=1&&n<=totalPages)]);for(const n of [...selected].sort((a,b)=>a-b)){const button=document.createElement('button');button.className='secondary-button';button.type='button';button.textContent=String(n);button.disabled=n===accountPage;button.setAttribute('aria-label','Account page '+n);if(n===accountPage)button.setAttribute('aria-current','page');button.onclick=()=>{accountPage=n;void loadAccounts(epoch);};pagination.append(button);}}
    }catch(error){if(epoch===view&&query===queryRevision)status.textContent=error.message;}
  }
  function editAccount(account,epoch){
    closeEditor();const isNew=!account;const features=session.access.features;
    modal=document.createElement('dialog');modal.className='operational-editor';
    modal.innerHTML=`<div class="card-heading"><h2>${isNew?'Provision operational account':'Edit account access'}</h2><button type="button" class="secondary-button" data-close-editor>Close</button></div>${!isNew?'<button type="button" class="secondary-button" data-review-account-state>Review account state / deactivate / reactivate</button>':''}<form class="management-form" id="operational-editor-form"><label class="admin-field">FULL NAME<input name="full_name" maxlength="120" value="${esc(account?.full_name||'')}" required></label><label class="admin-field">EMAIL<input type="email" name="email" maxlength="254" value="${esc(account?.email||'')}" ${isNew?'required':'readonly'}></label><label class="admin-field">ROLE<select name="role">${roles.map(r=>`<option value="${r}" ${r===(account?.role||roles[0])?'selected':''}>${esc(label(r))}</option>`).join('')}</select></label>${isNew?'':`<label class="consent-check"><input type="checkbox" name="enabled" ${account.enabled?'checked':''} disabled><span>Account active (state changes use the account lifecycle action)</span></label>`}<fieldset><legend>Scope assignments</legend><p class="muted">An event assignment grants access only to that event. Institution assignments are available to COL roles. Class assignments are managed on Class lists and are preserved when saving this form.</p><div data-institution-scopes>${['MCNP','ISAP'].map(i=>`<label class="consent-check"><input type="checkbox" data-scope-kind="institution" value="${i}" ${account?.scopes?.some(s=>s.kind==='institution'&&s.scope_id===i)?'checked':''}><span>${i}</span></label>`).join('')}</div><label class="admin-field">EVENTS<select data-event-scopes multiple size="5">${events.map(e=>`<option value="${e.id}" ${account?.scopes?.some(s=>s.kind==='event'&&s.scope_id===e.id)?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label><p class="muted" data-scope-preview></p></fieldset><fieldset><legend>Feature access</legend><p class="muted">Use role default, enable, or disable. Enabling a feature never expands the assigned scope. Features marked unavailable can be prepared for later use.</p><div class="operational-feature-list">${features.map(f=>`<label class="operational-feature"><span><strong>${esc(f.label)}</strong><small>${esc(f.description)}${f.available?'':' Not yet available.'}</small></span><select data-feature="${f.key}" ${f.delegable?'':'disabled'} aria-label="${esc(f.label)} override"><option value="default">Role default</option><option value="true">Enabled</option><option value="false">Disabled</option></select><small data-effective="${f.key}"></small></label>`).join('')}</div></fieldset><label class="admin-field">REASON FOR THIS ACCESS CHANGE<textarea name="reason" minlength="3" maxlength="500" required></textarea></label>${isNew?'<details><summary>Resume unfinished provisioning</summary><label class="admin-field">AUTH ID FROM THE PREVIOUS ERROR<input name="existing_user_id" autocomplete="off" maxlength="36"></label><p class="muted">Leave blank for a new account. Resuming preserves the same identity and requires its matching email.</p></details>':''}<button type="submit" class="primary-button">${isNew?'Provision account':'Save access'}</button><p class="muted" data-editor-status role="status"></p></form>${account?.version>0&&account.enabled?'<section class="operational-invitation"><h3>Invitation</h3><p class="muted">For an unverified invited account, generate a one-time link and deliver it privately to its owner. No email is sent automatically.</p><button class="secondary-button" type="button" data-invitation>Generate invitation link</button><div data-invitation-result></div></section>':''}`;
    document.body.append(modal);modal.showModal();const editor=modal,form=editor.querySelector('form'),status=form.querySelector('[data-editor-status]');
    editor.querySelector('[data-close-editor]').onclick=closeEditor;editor.addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
    editor.querySelector('[data-review-account-state]')?.addEventListener('click',()=>{closeEditor();cleanup?.();cleanup=null;const selected=++view;void renderAccountLifecycle(classContext(selected),account.user_id,()=>void navigate('roles')).catch(error=>{if(selected===view)page.innerHTML=heading('Unable to load account state',error.message);});});
    for(const field of form.querySelectorAll('[data-feature]'))if(typeof account?.overrides?.[field.dataset.feature]==='boolean')field.value=String(account.overrides[field.dataset.feature]);
    function preview(){const role=form.elements.role.value,admin=role==='administrator';
      for(const input of form.querySelectorAll('[data-scope-kind="institution"]')){input.disabled=admin||['classroom_representative','club_president'].includes(role);if(input.disabled)input.checked=false;}
      form.querySelector('[data-event-scopes]').disabled=admin;
      form.querySelector('[data-scope-preview]').textContent=admin?'Administrator access is global.':`${form.querySelectorAll('[data-scope-kind]:checked').length+form.querySelector('[data-event-scopes]').selectedOptions.length} scope assignment(s). No assignments means no scoped records.`;
      for(const f of features){const field=form.querySelector(`[data-feature="${f.key}"]`);const allowed=!f.allowed_roles||f.allowed_roles.includes(role);field.disabled=admin||!f.delegable||!allowed;if(!allowed)field.value='default';const enabled=admin||(allowed&&(field.value==='default'?f.default_roles.includes(role):field.value==='true'));form.querySelector(`[data-effective="${f.key}"]`).textContent=(enabled?'Enabled':'Disabled')+(f.available?'':' · unavailable');}
    }
    form.addEventListener('change',preview);preview();
    form.onsubmit=async event=>{event.preventDefault();const role=form.elements.role.value;const scopes=role==='administrator'?[]:[...form.querySelectorAll('[data-scope-kind]:checked')].map(i=>({kind:i.dataset.scopeKind,scope_id:i.value})).concat([...form.querySelector('[data-event-scopes]').selectedOptions].map(o=>({kind:'event',scope_id:o.value})));
      const overrides={};if(role!=='administrator')for(const input of form.querySelectorAll('[data-feature]:not(:disabled)'))if(input.value!=='default')overrides[input.dataset.feature]=input.value==='true';
      const common={role,full_name:form.elements.full_name.value.trim(),scopes,overrides,reason:form.elements.reason.value.trim()};
      const button=form.querySelector('[type="submit"]');button.disabled=true;status.textContent='Saving…';
      try{let result;if(isNew){const identity=form.elements.existing_user_id.value.trim();result=await send('/api/operational/accounts/provision',{...common,email:form.elements.email.value.trim(),...(identity?{existing_user_id:identity}:{})});}else result=await send('/api/operational/accounts/'+account.user_id,{...common,version:account.version,enabled:form.elements.enabled.checked},'PUT');
        if(epoch!==view||modal!==editor)return;closeEditor();announce(isNew?'Account provisioned. Generate its invitation link when ready.':'Account access updated.');
        if(result.account.user_id===session.user.id)window.dispatchEvent(new CustomEvent('app:access-changed'));else {await loadAccounts(epoch);if(isNew)editAccount({...result.account,email:result.email},epoch);}
      }catch(error){if(modal===editor)status.textContent=error.message;}finally{if(modal===editor)button.disabled=false;}
    };
    editor.querySelector('[data-invitation]')?.addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;const output=editor.querySelector('[data-invitation-result]');output.textContent='Generating invitation…';try{const result=await send('/api/operational/accounts/'+account.user_id+'/invitation',{confirm:true});if(modal!==editor||epoch!==view)return;output.innerHTML='<label class="admin-field">PRIVATE ONE-TIME INVITATION<input readonly autocomplete="off" aria-label="Private invitation URL"></label><button class="secondary-button" type="button">Copy invitation link</button>';output.querySelector('input').value=result.url;output.querySelector('button').onclick=async()=>{try{await navigator.clipboard.writeText(result.url);output.querySelector('button').textContent='Copied';}catch{output.querySelector('input').select();}};}catch(error){if(modal===editor)output.textContent=error.message;}finally{if(modal===editor)button.disabled=false;}});
  }
  return {mount,navigate,destroy,restore:()=>session&&navigate(requestedWorkspacePage(location.pathname,location.search,session.access),false)};
}
