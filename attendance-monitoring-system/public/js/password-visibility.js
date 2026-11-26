let sequence=0;
const eye='<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const crossedEye='<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3 3.8M6.5 6.5A19 19 0 0 0 2 12s3.5 7 10 7a11 11 0 0 0 5.5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
export function enhancePasswordFields(root){
  root.querySelectorAll('input[type="password"]:not([data-password-eye])').forEach(input=>{
    const original=input.closest('label');if(!original)return;
    input.dataset.passwordEye='true';input.id||=`password-field-${++sequence}`;
    const name=[...original.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent.trim()).join(' ').trim()||'Password';
    const field=document.createElement('div');field.className=original.className;
    const label=document.createElement('label');label.htmlFor=input.id;label.textContent=name;
    const control=document.createElement('span');control.className='password-control';
    const button=document.createElement('button');button.type='button';button.className='password-visibility';button.setAttribute('aria-controls',input.id);
    const help=[...original.querySelectorAll('small')];original.replaceWith(field);field.append(label,control,...help);control.append(input,button);
    function reveal(visible){input.type=visible?'text':'password';const text=(visible?'Hide ':'Show ')+name.toLowerCase();button.setAttribute('aria-label',text);button.title=text;button.setAttribute('aria-pressed',String(visible));button.innerHTML=visible?crossedEye:eye;}
    reveal(false);
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();reveal(input.type==='password');});
    input.form?.addEventListener('reset',()=>reveal(false));input.form?.addEventListener('submit',()=>reveal(false));
  });
}
