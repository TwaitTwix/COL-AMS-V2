export function createNotificationBell({button,popup,badge,api,getSession,isAdmin,onOpen,esc,date}){
  let revision=0,notifications=[];
  function close(){popup.hidden=true;button.setAttribute('aria-expanded','false');}
  function render(admin,count){
    const focused=[...popup.querySelectorAll('button')].indexOf(document.activeElement);
    badge.hidden=!admin||!count;badge.textContent=count>99?'99+':String(count||'');button.setAttribute('aria-label',admin&&count?`Notifications, ${count} unread`:'Notifications');
    popup.innerHTML=`<h2>${admin?'Notifications':'Attendance updates'}</h2><div class="bell-items">${notifications.slice(0,5).map(n=>`<button type="button" data-open-notifications><span>${esc(n.message)}</span><small>${esc(date(n.created_at))}${admin&&!n.read_at?' · Unread':''}</small></button>`).join('')||'<p class="muted">No notifications to show.</p>'}</div><button type="button" class="secondary-button" data-open-notifications>${admin?'Open Review center →':'View my attendance →'}</button>`;
    if(focused>=0&&!popup.hidden){const buttons=popup.querySelectorAll('button');buttons[Math.min(focused,buttons.length-1)]?.focus();}
  }
  button.addEventListener('click',()=>{popup.style.setProperty('--notification-top',`${button.getBoundingClientRect().bottom+12}px`);popup.hidden=!popup.hidden;button.setAttribute('aria-expanded',String(!popup.hidden));});
  window.addEventListener('resize',close);window.addEventListener('scroll',close);
  popup.addEventListener('click',event=>{if(event.target.closest('[data-open-notifications]')){close();onOpen();}});
  document.addEventListener('click',event=>{if(!button.contains(event.target)&&!popup.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!popup.hidden){close();button.focus();}});
  return {
    close,
    reset(){revision++;close();button.hidden=true;badge.hidden=true;popup.replaceChildren();notifications=[];},
    async refresh(){
      const session=getSession();if(!session)return;const operational=!!session.access;
      if(operational&&!session.access.features.some(f=>f.key==='attendance.review'&&f.effective)){button.hidden=true;close();return;}
      const request=++revision,owner=session.user.id,admin=operational||isAdmin();button.hidden=false;
      try{
        const data=await api(operational?'/api/operational/reviews/notifications':admin?'/api/admin/notifications':'/api/student/notifications');if(request!==revision||getSession()?.user.id!==owner)return;
        notifications=operational?data.items.map(n=>({...n,read_at:n.read_at||n.resolved_at,message:n.resolved_at?'Review assignment resolved or moved':'Attendance review assigned to you'})):data.notifications;render(admin,(operational?data.unread:data.unread_count)||0);
      }catch(e){if(request===revision&&getSession()?.user.id===owner){badge.hidden=true;button.setAttribute('aria-label','Notifications');popup.innerHTML='<p class="muted">Unable to load notifications. Please retry shortly.</p>';}}
    },
  };
}
