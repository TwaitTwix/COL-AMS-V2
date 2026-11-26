import { createPagination } from './pagination.js';
const categories={notifications:'Notifications',attendance:'Attendance decisions',devices:'Device incidents'};
export async function renderReviewCenter(ctx,initial='notifications'){
  const {page,api,send,esc,date,heading,current,announce}=ctx;
  let category=categories[initial]?initial:'notifications',number=1,revision=0,timer=null,items=[];
  page.innerHTML=heading('Review center','Handle notifications, attendance decisions, and device incidents without crowding your dashboard.')+`<section class="workspace-card review-center"><div class="review-tabs" aria-label="Review categories">${Object.entries(categories).map(([key,label])=>`<button class="small-action" data-review-tab="${key}" aria-pressed="${key===category}">${label}</button>`).join('')}</div><form id="review-filters" class="review-filters"><label class="admin-field">SEARCH<input name="search" type="search" maxlength="100" placeholder="Name, email, ID, event, or message"></label><label class="admin-field">SHOW<select name="state"><option value="pending">Needs attention</option><option value="history">Resolved history</option><option value="all">All items</option></select></label><label class="admin-field" id="attendance-risk-filter">ATTENDANCE FLAGS<select name="risk"><option value="all">All attendance</option><option value="unflagged">No recorded flags</option><option value="flagged">Flagged for review</option></select></label><button type="submit" class="secondary-button">Search</button></form><div id="bulk-attendance" hidden><p class="muted">Routine scans are already approved automatically. Bulk approval includes only pending records with no recorded risk flags or open device incidents. Flagged records need individual review.</p><button type="button" class="primary-button" id="preview-bulk">Approve matching unflagged attendance…</button><p class="muted">Uses your search across all pages, up to 500 records per batch.</p></div><p id="review-status" class="muted" role="status"></p><div id="review-results" aria-busy="false"></div><nav class="review-pagination" id="review-pagination"></nav></section>`;
  const form=page.querySelector('#review-filters'),results=page.querySelector('#review-results'),status=page.querySelector('#review-status');
  const riskFilter=page.querySelector('#attendance-risk-filter'),bulk=page.querySelector('#bulk-attendance'),bulkButton=page.querySelector('#preview-bulk');
  const pagination=createPagination(page.querySelector('#review-pagination'),selected=>{number=selected;void load();});
  async function load(){
    if(!current())return;riskFilter.hidden=category!=='attendance';bulk.hidden=category!=='attendance'||form.elements.state.value!=='pending'||form.elements.risk.value==='flagged';bulkButton.disabled=true;const request=++revision;status.textContent='Loading reviews…';results.setAttribute('aria-busy','true');pagination.busy();
    // Remove stale rows immediately so an old response cannot be acted on while
    // another category or filter is being loaded.
    results.replaceChildren();
    try{
      const query=new URLSearchParams({category,state:form.elements.state.value,risk:form.elements.risk.value,search:form.elements.search.value.trim(),page:String(number),page_size:'10'});
      const data=await api('/api/admin/reviews?'+query);if(!current()||request!==revision)return;
      const pages=Math.max(1,Math.ceil(data.total/data.page_size));if(number>pages){number=pages;await load();return;}
      items=data.items;bulkButton.disabled=!data.total;status.textContent=`${data.total} ${data.total===1?'item':'items'} · ${categories[category]}`;
      results.innerHTML=items.map(item=>`<article class="review-row"><div><strong>${esc(item.user_name)}</strong><p class="review-preview">${esc(item.label||categories[category])}</p>${category==='attendance'?`<p class="status-badge ${item.details.flagged?'warning':'good'}">${item.details.flagged?'Flagged for review':'No recorded flags'}</p>`:''}<small>${esc(date(item.created_at))} · ${esc(item.status.replaceAll('_',' '))}</small></div><button type="button" class="small-action" data-view-review="${item.id}">View details</button></article>`).join('')||'<div class="empty-state">No matching items. Try another search or view resolved history.</div>';
      pagination.update(number,pages);
    }catch(e){if(current()&&request===revision){status.textContent=e.message;results.innerHTML='<button type="button" class="secondary-button" data-retry-reviews>Retry</button>';}}
    finally{if(current()&&request===revision)results.setAttribute('aria-busy','false');}
  }
  function details(item){
    const type=category,d=item.details;
    const dialog=document.createElement('dialog');dialog.className='review-details';dialog.setAttribute('aria-labelledby','review-detail-title');
    const pending=item.bucket==='pending';
    let content=type==='notifications'?`<p>${esc(d.message)}</p>`:type==='attendance'?`<p><strong>Event:</strong> ${esc(d.event_name)}</p><p><strong>Checkpoint:</strong> ${esc(d.checkpoint_label||'Attendance')}</p><p><strong>Verification flags:</strong> ${esc((d.risk_reasons||[]).join(', ')||(d.flagged?'Open device incident linked to this account or browser':'No flags recorded'))}</p><p><strong>Distance:</strong> ${d.distance_from_venue_meters==null?'Not measured':esc(d.distance_from_venue_meters)+' m from venue'}</p><p><strong>Browser:</strong> ${esc(d.device_hash?.slice(0,16)||'Not recorded')}</p>${d.latitude!=null?`<p><strong>Recorded GPS:</strong> ${esc(d.latitude)}, ${esc(d.longitude)} · Accuracy ±${esc(d.accuracy_meters??'unknown')} m</p>`:''}${d.review_note?`<p><strong>Decision note:</strong> ${esc(d.review_note)}</p>`:''}`:`<p>${d.changed_device?'Changed browser device. ':''}${d.shared_device?'Browser used by another account. ':''}</p><p><strong>Penalty:</strong> ${esc(d.penalty_points)} point(s)</p><p><strong>Browser identifier:</strong> ${esc(d.device_hash?.slice(0,16))}</p><p class="muted">Trusting this browser or dismissing the alert does not approve attendance. Pending attendance requires a separate decision.</p>`;
    const actions=!pending?'':type==='notifications'?'<button type="button" class="primary-button" data-action="read">Mark read</button>':type==='attendance'?'<button type="button" class="primary-button" data-action="approved">Accept attendance</button><button type="button" class="small-action danger" data-action="rejected">Reject attendance</button>':'<button type="button" class="primary-button" data-action="trusted">Trust this browser</button><button type="button" class="small-action" data-action="dismissed">Dismiss alert</button>';
    dialog.innerHTML=`<div class="card-heading"><h2 id="review-detail-title">${esc(categories[type])}</h2><button type="button" class="small-action" data-close-details>Close</button></div><div class="review-detail-content"><h3>${esc(item.user_name)}</h3><p class="muted">${esc(item.email||'')} · ${esc(date(item.created_at))} · ${esc(item.status.replaceAll('_',' '))}</p>${content}</div>${pending&&type!=='notifications'?'<label class="admin-field">DECISION NOTE<textarea name="note" rows="3" maxlength="1000" placeholder="Required for rejection and device decisions; optional for attendance approval"></textarea></label>':''}<p class="muted" data-detail-message role="status"></p><div class="row-actions">${actions}</div>`;
    document.body.append(dialog);dialog.querySelector('[data-close-details]').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    dialog.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',async()=>{
      const action=button.dataset.action,note=dialog.querySelector('textarea')?.value.trim()||'',message=dialog.querySelector('[data-detail-message]');
      if((action==='rejected'||type==='devices')&&!note){message.textContent='Please add a reason for this decision.';dialog.querySelector('textarea').focus();return;}
      const buttons=[...dialog.querySelectorAll('[data-action]')];buttons.forEach(b=>b.disabled=true);
      try{
        const url=type==='notifications'?`/api/admin/notifications/${item.id}/read`:type==='attendance'?`/api/admin/attendance/${item.id}/review`:`/api/admin/devices/${item.id}/review`;
        await send(url,type==='notifications'?{}:{decision:action,note},'PATCH');if(!current())return;dialog.close();announce(type==='notifications'?'Notification marked read.':'Decision saved.');await load();
      }catch(e){if(current())message.textContent=e.message;}
      finally{buttons.forEach(b=>b.disabled=false);}
    }));dialog.showModal();
  }
  page.querySelectorAll('[data-review-tab]').forEach(button=>button.addEventListener('click',()=>{clearTimeout(timer);category=button.dataset.reviewTab;number=1;page.querySelectorAll('[data-review-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));void load();}));
  form.addEventListener('submit',event=>{event.preventDefault();clearTimeout(timer);number=1;void load();});
  form.elements.search.addEventListener('input',()=>{clearTimeout(timer);revision++;bulkButton.disabled=true;pagination.busy();results.replaceChildren();timer=setTimeout(()=>{number=1;void load();},300);});
  form.elements.state.addEventListener('change',()=>{clearTimeout(timer);number=1;void load();});

  form.elements.risk.addEventListener('change',()=>{clearTimeout(timer);number=1;void load();});
  bulkButton.addEventListener('click',()=>void previewBulk());
  results.addEventListener('click',event=>{const button=event.target.closest('[data-view-review]');if(button){const item=items.find(i=>i.id===button.dataset.viewReview);if(item)details(item);}else if(event.target.closest('[data-retry-reviews]'))void load();});

  async function previewBulk(){
    bulkButton.disabled=true;const search=form.elements.search.value.trim(),ownerRevision=revision;
    try{
      const data=await send('/api/admin/attendance/bulk-preview',{search});if(!current()||revision!==ownerRevision)return;
      if(!data.ids.length){announce('No matching unflagged attendance is waiting for approval.');await load();return;}
      const dialog=document.createElement('dialog');dialog.className='review-details';dialog.setAttribute('aria-labelledby','bulk-review-title');
      dialog.innerHTML=`<h2 id="bulk-review-title">Approve ${data.ids.length} attendance ${data.ids.length===1?'record':'records'}?</h2><p>Search: <strong>${esc(search||'All pending attendance')}</strong></p><p>This includes matching unflagged records across all pages. Records with risk flags or open device incidents will be skipped. Each approval records your account and time in the audit log.</p>${data.total>data.ids.length?`<p>${data.total} records match. This batch contains the newest ${data.ids.length}; repeat for the rest.</p>`:''}<p data-bulk-message role="status"></p><div class="row-actions"><button type="button" class="secondary-button" data-cancel-bulk>Cancel</button><button type="button" class="primary-button" data-confirm-bulk>Approve ${data.ids.length} ${data.ids.length===1?'record':'records'}</button></div>`;
      document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.querySelector('[data-cancel-bulk]').onclick=()=>dialog.close();
      dialog.querySelector('[data-confirm-bulk]').onclick=async()=>{
        const buttons=[...dialog.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
        try{const result=await send('/api/admin/attendance/bulk-approve',{ids:data.ids});if(!current()){dialog.close();return;}dialog.close();announce(`${result.approved} attendance ${result.approved===1?'record':'records'} approved. ${result.skipped} skipped because their status or flags changed.`);await load();}
        catch(e){dialog.querySelector('[data-bulk-message]').textContent=e.message;buttons.forEach(b=>b.disabled=false);}
      };dialog.showModal();
    }catch(e){if(current())announce(e.message,true);}finally{if(current())bulkButton.disabled=false;}
  }
  await load();
}
