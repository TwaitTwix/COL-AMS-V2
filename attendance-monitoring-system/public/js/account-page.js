import { strongPassword,PASSWORD_HELP } from './password-policy.js';
import { enhancePasswordFields } from './password-visibility.js';
export function renderAccount(ctx,profile){
  const {page,send,current,heading,esc}=ctx;
  page.innerHTML=heading('Account settings','Manage the password for your own account.')+`<section class="workspace-card account-settings"><h2>${esc(profile.full_name||profile.email)}</h2><p class="muted">${esc(profile.email)} · ${esc(profile.role.replaceAll('_',' '))}</p><h3>Change password</h3><form id="change-password-form" class="management-form"><label class="admin-field">CURRENT PASSWORD<input type="password" name="current_password" autocomplete="current-password" maxlength="128" required></label><label class="admin-field">NEW PASSWORD<input type="password" name="password" autocomplete="new-password" minlength="10" maxlength="128" required></label><p class="muted">${PASSWORD_HELP}</p><label class="admin-field">CONFIRM NEW PASSWORD<input type="password" name="confirm_password" autocomplete="new-password" minlength="10" maxlength="128" required></label><button type="submit" class="primary-button">Change password</button><p class="muted" id="password-change-status" role="status"></p></form><p class="muted">After a successful change, sign in again with your new password. If you cannot remember the current password, sign out and use password recovery.</p></section>`;
  enhancePasswordFields(page);
  const form=page.querySelector('#change-password-form'),status=page.querySelector('#password-change-status');
  ctx.onCleanup?.(()=>form.reset());
  form.addEventListener('submit',async event=>{
    event.preventDefault();const input=Object.fromEntries(new FormData(form));
    if(!strongPassword(input.password)){status.textContent=PASSWORD_HELP;return;}
    if(input.password!==input.confirm_password){status.textContent='Passwords do not match';return;}
    if(input.password===input.current_password){status.textContent='Choose a password different from your current password';return;}
    const button=form.querySelector('[type="submit"]');button.disabled=true;status.textContent='Updating password…';
    try{const data=await send('/api/auth/change-password',input);if(!current())return;form.reset();status.textContent=data.message;window.dispatchEvent(new CustomEvent('app:password-changed'));}
    catch(e){if(current()){form.elements.current_password.value='';status.textContent=e.message;}}
    finally{if(current())button.disabled=false;}
  });
}
