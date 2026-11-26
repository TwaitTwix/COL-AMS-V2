-- Server-only operations: all functions are SECURITY INVOKER and executable
-- only by service_role. Browser users never receive direct table privileges.
alter table public.user_profiles add column personal_id text;
alter table public.user_profiles add column institution text check (institution in ('MCNP','ISAP'));
alter table public.user_profiles add column college text;
alter table public.user_profiles add column approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected'));
alter table public.user_profiles add column reviewed_by uuid references auth.users(id);
alter table public.user_profiles add column reviewed_at timestamptz;
alter table public.user_profiles add column review_note text;
alter table public.user_profiles add column primary_device_hash text;
alter table public.user_profiles add column penalty_points integer not null default 0 check (penalty_points >= 0);
alter table public.user_profiles drop constraint user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check check (role in ('pending','student','student_officer','col_officer','officer','admin','main_admin'));
create unique index user_profiles_one_main_admin on public.user_profiles(role) where role='main_admin';
create unique index user_profiles_personal_id_unique on public.user_profiles(lower(personal_id)) where personal_id is not null;
update public.user_profiles set approval_status='approved' where role <> 'pending';
insert into public.user_profiles(user_id,email,full_name,role,approval_status)
select id,email,coalesce(raw_user_meta_data->>'full_name','Main administrator'),'main_admin','approved'
from auth.users where lower(email)=lower('leonardolllmacalinaoisap@gmail.com')
on conflict(user_id) do update set role='main_admin', approval_status='approved';

create table public.colleges (
  institution text not null check (institution in ('MCNP','ISAP')),
  name text not null check(length(name) between 1 and 100),
  primary key(institution,name)
);
insert into public.colleges(institution,name)
select i,c from unnest(array['MCNP','ISAP']) i cross join unnest(array['IT','CoE','Pharma','Nursing','Medtech','Business','Education','Criminology','Hospitality','Liberal Arts']) c;
alter table public.colleges enable row level security;
grant select,insert on public.colleges to service_role;
alter table public.students add column institution text check (institution in ('MCNP','ISAP'));
alter table public.students add column college text;
alter table public.events add column qr_version uuid not null default gen_random_uuid();
alter table public.events add column institution text check (institution in ('MCNP','ISAP'));
alter table public.events add column college text;
alter table public.events add constraint event_college_institution check(college is null or institution is not null);
alter table public.attendance_logs add column status text not null default 'approved' check(status in ('approved','pending_review','rejected'));
alter table public.attendance_logs add column device_hash text;
alter table public.attendance_logs add column user_id uuid references auth.users(id);
alter table public.attendance_logs add column latitude double precision;
alter table public.attendance_logs add column longitude double precision;
alter table public.attendance_logs add column accuracy_meters double precision;
alter table public.attendance_logs add column risk_reasons jsonb not null default '[]';
alter table public.attendance_logs add column reviewed_by uuid references auth.users(id);
alter table public.attendance_logs add column reviewed_at timestamptz;
alter table public.attendance_logs add column review_note text;

create table public.user_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_hash text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent text not null,
  primary key(user_id,device_hash)
);
create index user_devices_hash_idx on public.user_devices(device_hash);
create table public.login_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  device_hash text not null,
  user_agent text not null,
  ip_address text,
  changed_device boolean not null,
  shared_device boolean not null,
  created_at timestamptz not null default now(),
  unique(user_id,session_id,device_hash)
);
create index login_logs_created_idx on public.login_logs(created_at desc);
create table public.device_incidents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_hash text not null,
  changed_device boolean not null,
  shared_device boolean not null,
  penalty_points integer not null default 1,
  status text not null default 'open' check(status in ('open','trusted','dismissed')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id,device_hash)
);
create index device_incidents_status_idx on public.device_incidents(status,created_at desc);
create table public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  user_id uuid references auth.users(id) on delete cascade,
  incident_id uuid references public.device_incidents(id) on delete cascade,
  attendance_id uuid references public.attendance_logs(id) on delete cascade,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index admin_notifications_created_idx on public.admin_notifications(created_at desc);
alter table public.user_devices enable row level security;
alter table public.login_logs enable row level security;
alter table public.device_incidents enable row level security;
alter table public.admin_notifications enable row level security;
grant select,insert,update on public.user_devices,public.login_logs,public.device_incidents,public.admin_notifications to service_role;
revoke all on public.colleges,public.user_devices,public.login_logs,public.device_incidents,public.admin_notifications from anon,authenticated;

create function public.record_device_session(p_user_id uuid,p_session_id text,p_device_hash text,p_user_agent text,p_ip_address text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles; changed boolean; shared boolean; incident public.device_incidents; inserted_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_device_hash,0));
  select * into strict p from public.user_profiles where user_id=p_user_id for update;
  changed := p.primary_device_hash is not null and p.primary_device_hash <> p_device_hash;
  shared := exists(select 1 from public.user_devices where device_hash=p_device_hash and user_id<>p_user_id);
  if p.primary_device_hash is null then
    update public.user_profiles set primary_device_hash=p_device_hash where user_id=p_user_id;
  end if;
  insert into public.user_devices(user_id,device_hash,user_agent) values(p_user_id,p_device_hash,p_user_agent)
  on conflict(user_id,device_hash) do update set last_seen_at=now(),user_agent=excluded.user_agent;
  insert into public.login_logs(user_id,session_id,device_hash,user_agent,ip_address,changed_device,shared_device)
  values(p_user_id,p_session_id,p_device_hash,p_user_agent,p_ip_address,changed,shared) on conflict do nothing;
  if changed or shared then
    insert into public.device_incidents(user_id,device_hash,changed_device,shared_device)
    values(p_user_id,p_device_hash,changed,shared) on conflict do nothing returning id into inserted_id;
    if inserted_id is not null then
      update public.user_profiles set penalty_points=penalty_points+1 where user_id=p_user_id;
      insert into public.admin_notifications(kind,user_id,incident_id,message)
      values('device',p_user_id,inserted_id,'Changed or shared browser device detected. One penalty point recorded; attendance requires review.');
    else
      update public.device_incidents set shared_device=shared_device or shared,changed_device=changed_device or changed where user_id=p_user_id and device_hash=p_device_hash;
    end if;
  end if;
  select * into incident from public.device_incidents where user_id=p_user_id and device_hash=p_device_hash;
  return jsonb_build_object('changed_device',changed,'shared_device',shared,'requires_review',coalesce(incident.status='open',false),'device_id',left(p_device_hash,12));
end $$;

create function public.approve_registration(p_actor uuid,p_user uuid,p_decision text,p_note text)
returns void language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles; sid uuid;
begin
  if not exists(select 1 from public.user_profiles where user_id=p_actor and approval_status='approved' and role in ('main_admin','admin','col_officer')) then raise exception 'Administrator access required'; end if;
  select * into strict p from public.user_profiles where user_id=p_user for update;
  if p.approval_status <> 'pending' or p.role <> 'pending' then raise exception 'Registration was already reviewed'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
  if p_decision='approved' then
    if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then raise exception 'Email must be verified first'; end if;
    if p.personal_id is null or p.institution is null or p.college is null then raise exception 'Registration details are incomplete'; end if;
    if not exists(select 1 from public.colleges where institution=p.institution and name=p.college) then raise exception 'College is not registered'; end if;
    select id into sid from public.students where lower(student_number)=lower(p.personal_id) and archived_at is null;
    if sid is null then
      insert into public.students(name,student_number,student_token,institution,college)
      values(p.full_name,p.personal_id,gen_random_uuid()::text,p.institution,p.college) returning id into sid;
    else
      if exists(select 1 from public.user_profiles where student_id=sid and user_id<>p_user) then raise exception 'Personal ID is already linked to another account'; end if;
      update public.students set institution=p.institution,college=p.college where id=sid;
    end if;
  end if;
  update public.user_profiles set approval_status=p_decision,role=case when p_decision='approved' then 'student' else 'pending' end,
    student_id=sid,reviewed_by=p_actor,reviewed_at=now(),review_note=p_note where user_id=p_user;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'registration.'||p_decision,'user_profile',p_user::text,jsonb_build_object('note',p_note));
end $$;

create function public.submit_event_attendance(p_user uuid,p_event uuid,p_qr_version uuid,p_device_hash text,p_latitude double precision,p_longitude double precision,p_accuracy double precision)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles; e public.events; s public.students; a public.attendance_logs; distance double precision; risky boolean; reasons jsonb := '[]';
begin
  select * into strict p from public.user_profiles where user_id=p_user for update;
  if p.approval_status<>'approved' or p.role not in ('student','student_officer') or p.student_id is null then raise exception 'Approved student access required'; end if;
  select * into strict s from public.students where id=p.student_id and archived_at is null;
  select * into strict e from public.events where id=p_event and archived_at is null for share;
  if e.qr_version<>p_qr_version then raise exception 'Event QR code has been replaced'; end if;
  if now()<e.starts_at-interval '1 hour' or now()>e.ends_at then raise exception 'Event is not currently accepting attendance'; end if;
  if (e.institution is not null and e.institution is distinct from s.institution) or (e.college is not null and e.college is distinct from s.college) then raise exception 'This event is for a different institution or college'; end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 or p_accuracy<0 or p_accuracy>e.radius_meters then raise exception 'GPS accuracy is insufficient. Move to a clear area and retry'; end if;
  distance := 6371000*2*asin(sqrt(least(1::double precision,greatest(0::double precision,
    power(sin(radians(e.latitude-p_latitude)/2),2)+cos(radians(p_latitude))*cos(radians(e.latitude))*power(sin(radians(e.longitude-p_longitude)/2),2)))));
  if distance>e.radius_meters then raise exception 'Outside geofence perimeter'; end if;
  if not exists(select 1 from public.user_devices where user_id=p_user and device_hash=p_device_hash) then raise exception 'Verify this login before recording attendance'; end if;
  risky := exists(select 1 from public.device_incidents where user_id=p_user and device_hash=p_device_hash and status='open');
  if risky then reasons := '["Changed or shared browser device"]'::jsonb; end if;
  insert into public.attendance_logs(student_id,event_id,distance_from_venue_meters,user_id,device_hash,latitude,longitude,accuracy_meters,status,risk_reasons)
  values(s.id,e.id,round(distance::numeric,2),p_user,p_device_hash,p_latitude,p_longitude,p_accuracy,case when risky then 'pending_review' else 'approved' end,reasons) returning * into a;
  if risky then insert into public.admin_notifications(kind,user_id,attendance_id,message) values('attendance',p_user,a.id,'Potential malicious attendance: changed/shared browser device. Administrator decision required.'); end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_user,'attendance.'||a.status,'attendance_log',a.id::text,jsonb_build_object('device_id',left(p_device_hash,12),'distance_meters',distance));
  return to_jsonb(a);
end $$;

create function public.event_attendance_statistics(p_event uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (
    select s.institution,s.college,count(*)::int as eligible,
      count(a.id)::int as attended,round(100.0*count(a.id)/nullif(count(*),0),1) as percentage
    from public.students s join public.events e on e.id=p_event
    left join public.attendance_logs a on a.student_id=s.id and a.event_id=e.id and a.status='approved'
    where s.archived_at is null and s.institution is not null
      and (e.institution is null or s.institution=e.institution) and (e.college is null or s.college=e.college)
    group by grouping sets ((s.institution,s.college),(s.institution))
    order by s.institution,s.college nulls first
  ) t;
$$;
revoke execute on function public.record_device_session(uuid,text,text,text,text),public.approve_registration(uuid,uuid,text,text),public.submit_event_attendance(uuid,uuid,uuid,text,double precision,double precision,double precision),public.event_attendance_statistics(uuid) from public,anon,authenticated;
grant execute on function public.record_device_session(uuid,text,text,text,text),public.approve_registration(uuid,uuid,text,text),public.submit_event_attendance(uuid,uuid,uuid,text,double precision,double precision,double precision),public.event_attendance_statistics(uuid) to service_role;
