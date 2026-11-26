-- Keep historical college values, but offer only the confirmed catalog.
alter table public.colleges add column abbreviation text;
alter table public.colleges add column active boolean not null default true;
update public.colleges set active=false;
insert into public.colleges(institution,name,abbreviation,active) values
('ISAP','College of Arts, Sciences and Teacher Education','CASTE',true),
('ISAP','College of Information Technology and Engineering','CITE',true),
('ISAP','College of Business Education and Management','CBEM',true),
('ISAP','College of Criminal Justice Education','CoCJE',true),
('MCNP','College of Nursing',null,true),
('MCNP','College of Radiologic Technology',null,true),
('MCNP','College of Medical Technology',null,true),
('MCNP','College of Pharmacy',null,true),
('MCNP','Physical Therapy',null,true),
('MCNP','Midwifery',null,true)
on conflict(institution,name) do update set abbreviation=excluded.abbreviation,active=true;

create table public.courses (
  institution text not null,
  college text not null,
  name text not null check(length(name) between 1 and 160),
  active boolean not null default true,
  primary key(institution,college,name),
  foreign key(institution,college) references public.colleges(institution,name) on update cascade
);
insert into public.courses(institution,college,name) values
('ISAP','College of Arts, Sciences and Teacher Education','Bachelor of Science in Social Work'),
('ISAP','College of Arts, Sciences and Teacher Education','Bachelor of Secondary Education'),
('ISAP','College of Arts, Sciences and Teacher Education','Bachelor of Science in Psychology'),
('ISAP','College of Arts, Sciences and Teacher Education','Bachelor of Physical Education'),
('ISAP','College of Information Technology and Engineering','Bachelor of Science in Information Technology'),
('ISAP','College of Information Technology and Engineering','Bachelor of Science in Computer Engineering'),
('ISAP','College of Business Education and Management','Bachelor of Science in Customs Administration'),
('ISAP','College of Business Education and Management','Bachelor of Science in Business Administration'),
('ISAP','College of Business Education and Management','Bachelor of Science in Accountancy'),
('ISAP','College of Business Education and Management','Bachelor of Science in Hospitality Management'),
('ISAP','College of Business Education and Management','Bachelor of Science in Tourism Management'),
('ISAP','College of Criminal Justice Education','Bachelor of Science in Criminology'),
('MCNP','College of Nursing','Bachelor of Science in Nursing'),
('MCNP','College of Radiologic Technology','Bachelor of Science in Radiologic Technology'),
('MCNP','College of Medical Technology','Bachelor of Science in Medical Laboratory Science'),
('MCNP','College of Pharmacy','Bachelor of Science in Pharmacy'),
('MCNP','Physical Therapy','Physical Therapy'),
('MCNP','Midwifery','2-Year Midwifery');
alter table public.courses enable row level security;
revoke all on public.courses from anon,authenticated;
grant select,insert,update on public.courses to service_role;
grant update on public.colleges to service_role;
alter table public.students add column course text;
alter table public.user_profiles add column course text;

-- Map only known college aliases. In particular, CITE has two programs;
-- an old college label of IT is not evidence of a student's actual course.
with aliases(institution,old_name,new_name) as (values
 ('ISAP','IT','College of Information Technology and Engineering'),
 ('ISAP','CoE','College of Information Technology and Engineering'),
 ('ISAP','Education','College of Arts, Sciences and Teacher Education'),
 ('ISAP','Liberal Arts','College of Arts, Sciences and Teacher Education'),
 ('ISAP','Business','College of Business Education and Management'),
 ('ISAP','Hospitality','College of Business Education and Management'),
 ('ISAP','Criminology','College of Criminal Justice Education'),
 ('MCNP','Nursing','College of Nursing'),
 ('MCNP','Medtech','College of Medical Technology'),
 ('MCNP','Pharma','College of Pharmacy'))
update public.students s set college=a.new_name from aliases a where s.institution=a.institution and s.college=a.old_name;
with aliases(institution,old_name,new_name) as (values
 ('ISAP','IT','College of Information Technology and Engineering'),
 ('ISAP','CoE','College of Information Technology and Engineering'),
 ('ISAP','Education','College of Arts, Sciences and Teacher Education'),
 ('ISAP','Liberal Arts','College of Arts, Sciences and Teacher Education'),
 ('ISAP','Business','College of Business Education and Management'),
 ('ISAP','Hospitality','College of Business Education and Management'),
 ('ISAP','Criminology','College of Criminal Justice Education'),
 ('MCNP','Nursing','College of Nursing'),
 ('MCNP','Medtech','College of Medical Technology'),
 ('MCNP','Pharma','College of Pharmacy'))
update public.user_profiles p set college=a.new_name from aliases a where p.institution=a.institution and p.college=a.old_name;

alter table public.students add constraint students_course_parent_check check(course is null or (institution is not null and college is not null));
alter table public.user_profiles add constraint profiles_course_parent_check check(course is null or (institution is not null and college is not null));
alter table public.students add constraint students_course_fkey foreign key(institution,college,course) references public.courses(institution,college,name);
alter table public.user_profiles add constraint profiles_course_fkey foreign key(institution,college,course) references public.courses(institution,college,name);
create index students_course_idx on public.students(institution,college,course);
create index profiles_course_idx on public.user_profiles(institution,college,course);

create function public.sync_student_affiliation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  update public.user_profiles set institution=new.institution,college=new.college,course=new.course where student_id=new.id;
  return new;
end $$;
revoke execute on function public.sync_student_affiliation() from public,anon,authenticated;
grant execute on function public.sync_student_affiliation() to service_role;
create trigger students_sync_affiliation after update of institution,college,course on public.students for each row execute function public.sync_student_affiliation();

create or replace function public.approve_registration(p_actor uuid,p_user uuid,p_decision text,p_note text)
returns void language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles; sid uuid;
begin
  if not exists(select 1 from public.user_profiles where user_id=p_actor and approval_status='approved' and role in ('main_admin','admin','col_officer')) then raise exception 'Administrator access required'; end if;
  select * into strict p from public.user_profiles where user_id=p_user for update;
  if p.approval_status <> 'pending' or p.role <> 'pending' then raise exception 'Registration was already reviewed'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
  if p_decision='approved' then
    if p.personal_id is null or p.institution is null or p.college is null or p.course is null then raise exception 'Registration details, including course, are incomplete'; end if;
    if not exists(select 1 from public.courses c join public.colleges d on d.institution=c.institution and d.name=c.college where c.institution=p.institution and c.college=p.college and c.name=p.course and c.active and d.active) then raise exception 'Choose an active course belonging to this institution and college'; end if;
    select id into sid from public.students where lower(student_number)=lower(p.personal_id) and archived_at is null;
    if sid is null then
      insert into public.students(name,student_number,student_token,institution,college,course)
      values(p.full_name,p.personal_id,gen_random_uuid()::text,p.institution,p.college,p.course) returning id into sid;
    else
      if exists(select 1 from public.user_profiles where student_id=sid and user_id<>p_user) then raise exception 'Personal ID is already linked to another account'; end if;
      update public.students set institution=p.institution,college=p.college,course=p.course where id=sid;
    end if;
  end if;
  update public.user_profiles set approval_status=p_decision,role=case when p_decision='approved' then 'student' else 'pending' end,
    student_id=sid,reviewed_by=p_actor,reviewed_at=now(),review_note=p_note where user_id=p_user;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'registration.'||p_decision,'user_profile',p_user::text,jsonb_build_object('note',p_note));
end $$;

create or replace function public.event_attendance_statistics(p_event uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (
  select s.institution,s.college,s.course,
    case when grouping(s.college)=1 then 'institution' when grouping(s.course)=1 then 'college' else 'course' end as level,
    count(*)::int as eligible,count(a.id)::int as attended,
    round(100.0*count(a.id)/nullif(count(*),0),1) as percentage
  from public.students s join public.events e on e.id=p_event
  left join public.attendance_logs a on a.student_id=s.id and a.event_id=e.id and a.status='approved'
  where s.archived_at is null and s.institution is not null
    and (e.institution is null or s.institution=e.institution) and (e.college is null or s.college=e.college)
  group by grouping sets((s.institution),(s.institution,s.college),(s.institution,s.college,s.course))
  order by s.institution,grouping(s.college) desc,s.college nulls first,grouping(s.course) desc,s.course nulls first
) t;
$$;
