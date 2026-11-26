const operationalRoles=['classroom_representative','club_president','col_regular','col_admin','administrator'];
export function operationalMenu(access){
 if(!access?.enabled||!operationalRoles.includes(access.role))return [];
 const can=key=>access.features?.some(f=>f.key===key&&f.effective&&f.available!==false);
 return [['dashboard','Dashboard'],...(can('events.view')?[['events','Events']]:[]),...(can('attendance.review')?[['reviews','Attendance review']]:[]),...(['rosters.view','rosters.manage','sections.manage','representatives.assign'].some(can)?[['classes','Class lists']]:[]),...(can('accounts.manage')?[['students','Student records']]:[]),...(can('reports.view')?[['reports','Reports']]:[]),...(can('accounts.manage')?[['roles','Account & feature access']]:[]),...(can('audit.view')?[['audit','Audit Trail']]:[])];
}
export function requestedWorkspacePage(pathname,search,access){
 if(!access?.enabled||!operationalRoles.includes(access.role))return 'dashboard';
 if(pathname==='/account')return 'account';
 const page=new URLSearchParams(search).get('view')||'dashboard';
 return operationalMenu(access).some(([key])=>key===page)?page:'dashboard';
}

export function createWorkspaceDrawer({button,dialog,closeButton,nav,main,root=document.documentElement}){
 let active=false,previousOverflow='';
 function close({focus='trigger'}={}){if(!dialog.open)return;dialog.close();root.style.overflow=previousOverflow;button.setAttribute('aria-expanded','false');if(focus==='main'&&!main.closest('[hidden]')){main.focus({preventScroll:true});main.scrollIntoView({block:'start'});}else if(focus==='trigger'&&!button.hidden)button.focus({preventScroll:true});}
 function open(){if(!active||dialog.open||document.querySelector('dialog[open]'))return;previousOverflow=root.style.overflow;root.style.overflow='hidden';dialog.showModal();button.setAttribute('aria-expanded','true');closeButton.focus();}
 const toggle=()=>dialog.open?close():open(),cancel=e=>{e.preventDefault();close();},backdrop=e=>{const r=dialog.getBoundingClientRect();if(e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))close();},navigate=e=>{if(e.target.closest('[data-page]'))close({focus:'main'});},pageChange=()=>close({focus:'main'});
 const keyboard=e=>{if(e.key!=='Tab')return;const controls=[...dialog.querySelectorAll('button:not(:disabled),a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};
 dialog.addEventListener('keydown',keyboard);
 button.addEventListener('click',toggle);closeButton.addEventListener('click',closeFromButton);dialog.addEventListener('cancel',cancel);dialog.addEventListener('click',backdrop);nav.addEventListener('click',navigate,{capture:true});window.addEventListener('app:navigation',pageChange);
 function closeFromButton(){close();}
 return {setActive(value){if(active===!!value)return;active=!!value;button.hidden=!active;if(!active)close({focus:'none'});},close,open,destroy(){close({focus:'none'});button.removeEventListener('click',toggle);closeButton.removeEventListener('click',closeFromButton);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('click',backdrop);dialog.removeEventListener('keydown',keyboard);nav.removeEventListener('click',navigate,{capture:true});window.removeEventListener('app:navigation',pageChange);button.hidden=true;}};
}
