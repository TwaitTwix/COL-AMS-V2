// Subscribe the workspace before Auth can publish its restored session.
try{
  await import('./portal.js');
  await import('./auth.js');
}catch{
  const loading=document.querySelector('#session-loading');loading.hidden=false;
  loading.querySelector('[data-loading-copy]').textContent='Unable to load the app. Check your connection and retry.';
  const retry=document.querySelector('#retry-session');retry.hidden=false;retry.onclick=()=>location.reload();
}
