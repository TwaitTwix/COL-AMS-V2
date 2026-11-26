/* Run before styles so a saved preference does not flash the wrong theme. */
(()=>{
  const key='col-ams-theme';let theme='dark';
  try{if(localStorage.getItem(key)==='light')theme='light';}catch{/* Storage is optional. */}
  function apply(value){
    theme=value==='light'?'light':'dark';document.documentElement.dataset.theme=theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='light'?'#f5f5f2':'#131313');
    const button=document.querySelector('#theme-toggle');if(!button)return;
    const label=theme==='light'?'Switch to dark mode':'Switch to light mode';button.setAttribute('aria-label',label);button.title=label;button.setAttribute('aria-pressed',String(theme==='light'));
    button.innerHTML=theme==='light'?'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/></svg>':'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>';
  }
  apply(theme);
  document.addEventListener('DOMContentLoaded',()=>{apply(theme);document.querySelector('#theme-toggle')?.addEventListener('click',()=>{apply(theme==='dark'?'light':'dark');try{localStorage.setItem(key,theme);}catch{/* Keep the in-page choice. */}});},{once:true});
  window.addEventListener('storage',event=>{if(event.key===key)apply(event.newValue);});
})();
