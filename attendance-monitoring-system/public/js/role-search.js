export function matchingUsers(users,query){
  const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return users.filter(user=>words.every(word=>[user.full_name,user.email,user.personal_id].filter(Boolean).join(' ').toLocaleLowerCase().includes(word)));
}

export function bindRoleSearch(root,users,onSelect=()=>{}){
  const input=root.querySelector('#role-search'),list=root.querySelector('#role-suggestions'),status=root.querySelector('#role-search-status');
  const rows=[...root.querySelectorAll('[data-role-user]')];let matches=[],active=-1;
  function close(){list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;}
  function filter(items){const ids=new Set(items.map(u=>u.user_id));rows.forEach(row=>row.hidden=!ids.has(row.dataset.roleUser));status.textContent=items.length?`${items.length} matching account${items.length===1?'':'s'}`:'No matching accounts. Try another name, email, or personal ID.';}
  function choose(user){input.value=user.full_name||user.email;input.focus();filter([user]);close();onSelect(user);}
  function render(){
    const found=matchingUsers(users,input.value);filter(found);matches=found.slice(0,8);active=-1;list.replaceChildren();
    for(const [i,user] of matches.entries()){
      const option=document.createElement('button');option.type='button';option.role='option';option.id=`role-match-${i}`;option.tabIndex=-1;
      const name=document.createElement('strong');name.textContent=user.full_name||user.email;
      const detail=document.createElement('span');detail.textContent=[user.email,user.personal_id].filter(Boolean).join(' · ');
      option.append(name,detail);option.addEventListener('click',()=>choose(user));list.append(option);
    }
    list.hidden=!input.value.trim()||!matches.length;input.setAttribute('aria-expanded',String(!list.hidden));input.removeAttribute('aria-activedescendant');
  }
  input.addEventListener('input',render);input.addEventListener('focus',render);
  input.addEventListener('keydown',event=>{
    if(event.key==='Escape'){close();return;}
    if(event.key==='Enter'&&!list.hidden&&matches.length){event.preventDefault();choose(matches[Math.max(0,active)]);return;}
    if(['ArrowDown','ArrowUp'].includes(event.key)&&matches.length){event.preventDefault();list.hidden=false;input.setAttribute('aria-expanded','true');active=active<0?(event.key==='ArrowDown'?0:matches.length-1):(active+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length;[...list.children].forEach((option,i)=>option.setAttribute('aria-selected',String(i===active)));input.setAttribute('aria-activedescendant',`role-match-${active}`);}
  });
  root.addEventListener('focusout',event=>{if(!root.querySelector('.role-search').contains(event.relatedTarget))close();});
  filter(users);
}
