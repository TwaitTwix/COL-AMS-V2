export function coursesFor(catalog,institution,college){
  return catalog.find(item=>item.institution===institution&&item.name===college)?.courses||[];
}

// Every parent change clears its descendants. Never guess a student's course,
// including when the selected college has only a single listed program.
export function bindAcademicSelects(form,getCatalog){
  const institution=form.elements.institution,college=form.elements.college,course=form.elements.course;
  let selection={institution:institution.value,college:college.value,course:course.value};
  const description=select=>{
    const element=document.createElement('small');element.className='academic-description';
    element.id=`${form.id}-${select.name}-description`;
    element.setAttribute('aria-hidden','true');
    select.setAttribute('aria-describedby',element.id);
    select.insertAdjacentElement('afterend',element);return element;
  };
  const collegeDescription=description(college),courseDescription=description(course);
  function renderCourses(){
    const names=coursesFor(getCatalog(),selection.institution,selection.college);
    course.replaceChildren(new Option('Choose a course',''),...names.map(name=>new Option(name,name)));
    course.disabled=!names.length;
    course.value=names.includes(selection.course)?selection.course:'';
    courseDescription.textContent=course.value||(!selection.college?'Choose a college first.':!names.length?'No courses are configured for this college. Contact an administrator.':'Choose your actual course; it will not be assigned automatically.');
  }
  function render(){
    const parents=getCatalog().filter(item=>item.institution===selection.institution);
    college.replaceChildren(new Option('Choose a college / department',''),...parents.map(item=>new Option(item.abbreviation?`${item.abbreviation} — ${item.name}`:item.name,item.name)));
    college.disabled=!parents.length;
    college.value=parents.some(item=>item.name===selection.college)?selection.college:'';
    collegeDescription.textContent=college.value||(selection.college?`Previous college: ${selection.college}. Choose its current catalog entry.`:'Choose the college belonging to your institution.');
    renderCourses();
  }
  institution.addEventListener('change',()=>{selection={institution:institution.value,college:'',course:''};render();});
  college.addEventListener('change',()=>{selection={institution:institution.value,college:college.value,course:''};collegeDescription.textContent=college.value;renderCourses();});
  course.addEventListener('change',()=>{selection.course=course.value;courseDescription.textContent=course.value||'Choose your actual course.';});
  const api={set(value){selection={institution:value.institution||'',college:value.college||'',course:value.course||''};institution.value=selection.institution;render();},refresh:render};
  render();return api;
}
