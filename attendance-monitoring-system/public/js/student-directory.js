import { createPagination } from './pagination.js';
export async function mountStudentDirectory(ctx,container,onLoaded=()=>{}){
  const {api,esc,current}=ctx;let number=1,revision=0,timer=null;
  container.innerHTML=`<h2>Student records</h2><form class="directory-filters"><label class="admin-field">SEARCH STUDENT RECORDS<input type="search" name="search" maxlength="100" placeholder="Name, ID, institution, college, or course"></label><label class="admin-field">SHOW<select name="state"><option value="active">Active students</option><option value="archived">Archived students</option><option value="all">All students</option></select></label><button type="submit" class="secondary-button">Search</button></form><p class="muted" data-directory-status role="status"></p><div class="student-card-grid"></div><nav class="review-pagination" data-directory-pages></nav>`;
  const form=container.querySelector('form'),results=container.querySelector('.student-card-grid'),status=container.querySelector('[data-directory-status]');
  const pagination=createPagination(container.querySelector('[data-directory-pages]'),selected=>{number=selected;void load();});
  async function load(){
    if(!current())return;const request=++revision;results.replaceChildren();pagination.busy();status.textContent='Loading student records…';
    try{
      const query=new URLSearchParams({search:form.elements.search.value.trim(),state:form.elements.state.value,page:String(number),page_size:'10'});
      const data=await api('/api/admin/student-directory?'+query);if(!current()||request!==revision)return;
      const pages=Math.max(1,Math.ceil(data.total/data.page_size));if(number>pages){number=pages;await load();return;}onLoaded(data.items);
      status.textContent=`${data.total} student ${data.total===1?'record':'records'}`;
      results.innerHTML=data.items.map(s=>`<article class="student-record-card"><div class="student-card-heading"><h3>${esc(s.name)}</h3><span class="status-badge">${esc(s.institution||'Unassigned')}${s.archived_at?' · Archived':''}</span></div><p class="muted">ID ${esc(s.student_number)}</p>${(s.accounts||[]).map(a=>`<p class="muted">${a.email_release_completed_at?'Released email':a.retired_at?'Email release unfinished':'Linked email'}: ${esc(a.email||'Not available')}</p>${s.archived_at&&ctx.canReleaseEmail&&['student','student_officer','pending'].includes(a.role)&&!a.email_release_completed_at?`<button type="button" class="small-action danger" data-release-email="${s.id}" data-release-user="${a.user_id}" data-release-address="${esc(a.email)}">${a.retired_at?'Retry email release':'Release email for registration'}</button>`:''}`).join('')}<details><summary>College & course</summary><p>${esc(s.college||'College not assigned')}</p><p>${esc(s.course||'Course not assigned — confirmation needed')}</p></details><div class="student-card-actions"><button type="button" class="small-action" data-edit-student="${s.id}">Edit</button><button type="button" class="small-action" data-archive-student="${s.id}" data-archived="${!!s.archived_at}">${s.archived_at?'Restore':'Archive'}</button></div></article>`).join('')||'<p class="muted">No matching student records.</p>';
      pagination.update(number,pages);
    }catch(e){if(current()&&request===revision){status.textContent=e.message;results.innerHTML='<button class="secondary-button" type="button" data-retry-directory>Retry</button>';}}
  }
  form.addEventListener('submit',event=>{event.preventDefault();clearTimeout(timer);number=1;void load();});
  form.elements.search.addEventListener('input',()=>{clearTimeout(timer);revision++;pagination.busy();results.replaceChildren();timer=setTimeout(()=>{number=1;void load();},300);});
  form.elements.state.addEventListener('change',()=>{clearTimeout(timer);number=1;void load();});
  results.addEventListener('click',event=>{if(event.target.closest('[data-retry-directory]'))void load();});
  await load();
}
