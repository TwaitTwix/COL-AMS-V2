export function pageNumbers(current,total){
  if(total<=7)return Array.from({length:total},(_,i)=>i+1);
  const pages=new Set([1,total,current-1,current,current+1]);
  if(current<=3)for(let n=1;n<=4;n++)pages.add(n);
  if(current>=total-2)for(let n=total-3;n<=total;n++)pages.add(n);
  const result=[];for(const n of [...pages].filter(n=>n>=1&&n<=total).sort((a,b)=>a-b)){if(result.length&&n-result.at(-1)>1)result.push(null);result.push(n);}return result;
}
export function createPagination(container,onSelect){
  let current=1,total=1;
  container.setAttribute('aria-label','Page navigation');
  container.addEventListener('click',event=>{const button=event.target.closest('button[data-page]');if(!button||button.disabled)return;const number=Number(button.dataset.page);if(number!==current&&number>=1&&number<=total)onSelect(number);});
  container.addEventListener('submit',event=>{event.preventDefault();const input=container.querySelector('input'),number=Number(input.value);if(input.reportValidity()&&number!==current&&number>=1&&number<=total)onSelect(number);});
  return {
    busy(){container.setAttribute('aria-busy','true');container.querySelectorAll('button,input').forEach(e=>e.disabled=true);},
    update(number,pages){current=number;total=pages;container.setAttribute('aria-busy','false');container.innerHTML=`<div class="page-buttons"><button type="button" class="secondary-button" data-page="${current-1}" ${current===1?'disabled':''} aria-label="Previous page">←</button>${pageNumbers(current,total).map(n=>n===null?'<span class="page-ellipsis" aria-hidden="true">…</span>':`<button type="button" class="small-action" data-page="${n}" aria-label="Go to page ${n}" ${n===current?'aria-current="page" disabled':''}>${n}</button>`).join('')}<button type="button" class="secondary-button" data-page="${current+1}" ${current===total?'disabled':''} aria-label="Next page">→</button></div><span class="muted" aria-live="polite">Page ${current} of ${total}</span><form class="page-jump"><label>Go to page<input type="number" name="page" min="1" max="${total}" value="${current}" required aria-label="Page number"></label><button class="secondary-button" type="submit">Go</button></form>`;},
  };
}
