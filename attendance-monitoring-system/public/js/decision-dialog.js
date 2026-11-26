export function requestDecisionNote(button){
  const required=button.dataset.decision==='rejected'||!!button.dataset.reviewDevice;
  const target=button.closest('.review-row')?.querySelector('strong')?.textContent||'this record';
  const dialog=document.createElement('dialog');dialog.className='decision-dialog';dialog.setAttribute('aria-labelledby','decision-title');
  dialog.innerHTML=`<form class="management-form"><h2 id="decision-title"></h2><p class="decision-target"></p><p class="muted">This decision is saved in the audit log with your account and the time.</p><label class="admin-field">${required?'REASON (REQUIRED)':'NOTE (OPTIONAL)'}<textarea name="note" rows="3" maxlength="1000" ${required?'required':''}></textarea></label><div class="row-actions"><button type="button" class="secondary-button" data-cancel>Cancel</button><button type="submit" class="primary-button">Confirm decision</button></div></form>`;
  dialog.querySelector('h2').textContent=button.textContent.trim();dialog.querySelector('.decision-target').textContent=target;
  document.body.append(dialog);
  return new Promise(resolve=>{
    let note=null;
    dialog.querySelector('[data-cancel]').addEventListener('click',()=>dialog.close());
    dialog.querySelector('form').addEventListener('submit',event=>{event.preventDefault();const field=dialog.querySelector('textarea');if(required&&!field.value.trim()){field.setCustomValidity('Please explain this decision.');field.reportValidity();return;}note=field.value.trim();dialog.close();});
    dialog.querySelector('textarea').addEventListener('input',event=>event.target.setCustomValidity(''));
    dialog.addEventListener('close',()=>{dialog.remove();resolve(note);},{once:true});dialog.showModal();
  });
}
