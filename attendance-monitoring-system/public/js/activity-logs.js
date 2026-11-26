import { createPagination } from './pagination.js';
const categories={logins:'Login history',audit:'Administrator actions'};
const filters={logins:[['all','All logins'],['flagged','Changed or shared browser'],['registered','Registered browser']],audit:[['all','All actions'],...['attendance','device','account','registration','privacy','event','student','college','course'].map(value=>[value,value[0].toUpperCase()+value.slice(1)])]};
export async function renderActivityLogs(ctx){
  const {page,api,esc,date,current,heading}=ctx;
  let category='logins',number=1,revision=0,timer=null,items=[];
  page.innerHTML=heading('Activity logs','Search login history and administrator actions. Open a record for full details or view its account tracker.')+`<section class="workspace-card"><div class="review-tabs" aria-label="Log categories">${Object.entries(categories).map(([key,label])=>`<button type="button" class="small-action" data-log-tab="${key}" aria-pressed="${key===category}">${label}</button>`).join('')}</div><form class="review-filters" id="log-filters"><label class="admin-field">SEARCH<input type="search" name="search" maxlength="100" placeholder="Name, email, ID, browser, action, or address"></label><label class="admin-field">SHOW<select name="filter"></select></label><button type="submit" class="secondary-button">Search</button></form><p class="muted" id="log-status" role="status"></p><div id="log-results" aria-busy="false"></div><nav id="log-pagination" class="review-pagination"></nav></section>`;
  const form=page.querySelector('#log-filters'),results=page.querySelector('#log-results'),status=page.querySelector('#log-status');
  const pagination=createPagination(page.querySelector('#log-pagination'),selected=>{number=selected;void load();});
  function setFilters(){form.elements.filter.innerHTML=filters[category].map(([value,label])=>`<option value="${value}">${label}</option>`).join('');}
  setFilters();
  async function load(){
    if(!current())return;const request=++revision;results.replaceChildren();results.setAttribute('aria-busy','true');pagination.busy();status.textContent='Loading activity logs…';
    try{
      const query=new URLSearchParams({category,filter:form.elements.filter.value,search:form.elements.search.value.trim(),page:String(number),page_size:'10'});
      const data=await api('/api/admin/activity-logs?'+query);if(!current()||request!==revision)return;
      const pages=Math.max(1,Math.ceil(data.total/data.page_size));if(number>pages){number=pages;await load();return;}
      items=data.items;status.textContent=`${data.total} ${data.total===1?'record':'records'} · ${categories[category]}`;
      results.innerHTML=items.map(item=>`<article class="review-row"><div><strong>${esc(item.user_name)}</strong><p class="review-preview">${esc(item.label)}</p><small>${esc(date(item.created_at))}</small></div><div class="row-actions"><button type="button" class="small-action" data-view-log="${item.id}">View details</button>${item.user_id?`<button type="button" class="small-action" data-track-user="${item.user_id}">View account</button>`:''}</div></article>`).join('')||'<div class="empty-state">No matching records. Try another name, action, or filter.</div>';
      pagination.update(number,pages);
    }catch(e){if(current()&&request===revision){status.textContent=e.message;results.innerHTML='<button type="button" class="secondary-button" data-retry-logs>Retry</button>';}}
    finally{if(current()&&request===revision)results.setAttribute('aria-busy','false');}
  }
  function details(item){
    const data=item.details,dialog=document.createElement('dialog');dialog.className='review-details';dialog.setAttribute('aria-labelledby','log-detail-title');
    const facts=category==='logins'?[['Browser identifier',data.device_hash],['Browser details',data.user_agent],['Network address',data.ip_address||'Not recorded'],['Changed browser',data.changed_device?'Yes':'No'],['Shared browser',data.shared_device?'Yes':'No']]:[['Action',data.action],['Record type',data.entity_type],['Record ID',data.entity_id],...Object.entries(data.details||{}).map(([key,value])=>[key.replaceAll('_',' '),value])];
    const show=value=>value===null||value===undefined?'Not recorded':typeof value==='object'?JSON.stringify(value):String(value);
    dialog.innerHTML=`<div class="card-heading"><h2 id="log-detail-title">${categories[category]}</h2><button class="small-action" type="button" data-close-log>Close</button></div><div class="review-detail-content"><h3>${esc(item.user_name)}</h3><p class="muted">${esc(item.email||'')} · ${esc(date(item.created_at))}</p><dl class="log-facts">${facts.map(([label,value])=>`<dt>${esc(label)}</dt><dd>${esc(show(value))}</dd>`).join('')}</dl>${category==='logins'?'<p class="muted">GPS is not collected at login. The account tracker shows recorded attendance coordinates and venue distance when available. Browser identifiers are not MAC addresses.</p>':''}</div>`;
    document.body.append(dialog);dialog.querySelector('[data-close-log]').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
  }
  page.querySelectorAll('[data-log-tab]').forEach(button=>button.addEventListener('click',()=>{clearTimeout(timer);category=button.dataset.logTab;number=1;setFilters();page.querySelectorAll('[data-log-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));void load();}));
  form.addEventListener('submit',event=>{event.preventDefault();clearTimeout(timer);number=1;void load();});
  form.elements.search.addEventListener('input',()=>{clearTimeout(timer);revision++;pagination.busy();results.replaceChildren();timer=setTimeout(()=>{number=1;void load();},300);});
  form.elements.filter.addEventListener('change',()=>{clearTimeout(timer);number=1;void load();});
  results.addEventListener('click',event=>{const button=event.target.closest('[data-view-log]');if(button){const item=items.find(i=>i.id===button.dataset.viewLog);if(item)details(item);}else if(event.target.closest('[data-retry-logs]'))void load();});
  await load();
}
