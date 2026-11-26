alter table public.events add column checkpoints jsonb not null default '[{"key":"default","label":"Attendance"}]';
alter table public.attendance_logs add column checkpoint_key text not null default 'default';
alter table public.attendance_logs add column checkpoint_label text not null default 'Attendance';
drop index public.attendance_logs_student_event_unique;
create unique index attendance_logs_student_checkpoint_unique on public.attendance_logs(student_id,event_id,checkpoint_key);
alter table public.attendance_attempts add column checkpoint_key text not null default 'default';
alter table public.attendance_attempts drop constraint attendance_attempts_pkey;
alter table public.attendance_attempts add primary key(student_id,event_id,checkpoint_key);

create function public.validate_event_checkpoints() returns trigger language plpgsql security invoker set search_path='' as $$
declare c jsonb; previous_end timestamptz; start_time timestamptz; end_time timestamptz; keys text[]:='{}';
begin
  if jsonb_typeof(new.checkpoints)<>'array' or jsonb_array_length(new.checkpoints) not between 1 and 8 then raise exception 'Choose between one and eight attendance checkpoints';end if;
  if tg_op='UPDATE' and new.checkpoints is distinct from old.checkpoints and exists(select 1 from public.attendance_logs where event_id=new.id) then raise exception 'Checkpoints cannot be changed after attendance has been recorded';end if;
  for c in select * from jsonb_array_elements(new.checkpoints) loop
    if coalesce(c->>'key','')!~'^[a-zA-Z0-9_-]{1,50}$' or length(trim(coalesce(c->>'label',''))) not between 1 and 80 or (c->>'key')=any(keys) then raise exception 'Each checkpoint needs a unique key and a name';end if;
    keys:=array_append(keys,c->>'key');
    if jsonb_array_length(new.checkpoints)=1 and c->>'key'='default' and not(c?'opens_at') and not(c?'closes_at') then continue;end if;
    start_time:=(c->>'opens_at')::timestamptz;end_time:=(c->>'closes_at')::timestamptz;
    if start_time is null or end_time is null or not isfinite(start_time) or not isfinite(end_time) or start_time>=end_time or start_time<new.starts_at-interval '1 hour' or end_time>new.ends_at or (previous_end is not null and start_time<previous_end) then raise exception 'Checkpoint windows must be ordered, non-overlapping, and inside the event attendance window';end if;
    previous_end:=end_time;
  end loop;
  return new;
end $$;
revoke all on function public.validate_event_checkpoints() from public,anon,authenticated;
grant execute on function public.validate_event_checkpoints() to service_role;
create trigger events_validate_checkpoints before insert or update on public.events for each row execute function public.validate_event_checkpoints();

create function public.resolve_event_checkpoint(p_event public.events,p_key text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c jsonb;
begin
  if p_key is null and jsonb_array_length(p_event.checkpoints)=1 then p_key:=p_event.checkpoints->0->>'key';end if;
  select value into c from jsonb_array_elements(p_event.checkpoints) where value->>'key'=p_key;
  if c is null then raise exception 'Choose an attendance checkpoint for this event';end if;
  return c||jsonb_build_object('opens_at',coalesce((c->>'opens_at')::timestamptz,p_event.starts_at-interval '1 hour'),'closes_at',coalesce((c->>'closes_at')::timestamptz,p_event.ends_at));
end $$;
revoke all on function public.resolve_event_checkpoint(public.events,text) from public,anon,authenticated;
grant execute on function public.resolve_event_checkpoint(public.events,text) to service_role;

create function public.ensure_staff_attendance_profile(p_user uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles; sid uuid; number text;
begin
  select * into strict p from public.user_profiles where user_id=p_user for update;
  if p.approval_status<>'approved' or p.role not in ('main_admin','admin','col_officer','officer','student','student_officer') then raise exception 'Approved attendance access required';end if;
  if p.student_id is not null then return p.student_id;end if;
  if p.role in ('student','student_officer') then raise exception 'Ask an administrator to link your student record';end if;
  number:=coalesce(nullif(p.personal_id,''),'ACCOUNT-'||left(replace(p.user_id::text,'-',''),24));
  select id into sid from public.students where lower(student_number)=lower(number) and archived_at is null for update;
  if sid is not null and exists(select 1 from public.user_profiles where student_id=sid and user_id<>p_user) then raise exception 'This attendance ID is already linked to another account';end if;
  if sid is null then
    insert into public.students(name,student_number,student_token,institution,college,course) values(coalesce(nullif(p.full_name,''),p.email,'Staff account'),number,gen_random_uuid()::text,p.institution,p.college,p.course) returning id into sid;
  end if;
  update public.user_profiles set student_id=sid where user_id=p_user;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_user,'attendance.profile_linked','student',sid::text,jsonb_build_object('system_attendance_id',p.personal_id is null));
  return sid;
end $$;
revoke all on function public.ensure_staff_attendance_profile(uuid) from public,anon,authenticated;
grant execute on function public.ensure_staff_attendance_profile(uuid) to service_role;

create function public.submit_checkpoint_attendance(p_user uuid,p_event uuid,p_key text,p_qr_version uuid,p_device_hash text,p_latitude double precision,p_longitude double precision,p_accuracy double precision,p_qr_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles; s public.students; e public.events; c jsonb; a public.attendance_logs; tries integer; distance double precision; risky boolean; message text;
begin
  select * into strict p from public.user_profiles where user_id=p_user for update;
  if p.approval_status<>'approved' or p.role not in ('student','student_officer','admin','col_officer','main_admin','officer') or p.student_id is null then raise exception 'A linked, approved attendance account is required';end if;
  select * into strict s from public.students where id=p.student_id and archived_at is null;
  select * into strict e from public.events where id=p_event and archived_at is null for share;c:=public.resolve_event_checkpoint(e,p_key);
  if now()<(c->>'opens_at')::timestamptz or now()>(c->>'closes_at')::timestamptz then raise exception 'This attendance checkpoint is not currently open';end if;
  if (e.institution is not null and e.institution is distinct from s.institution) or (e.college is not null and e.college is distinct from s.college) then raise exception 'This event is for a different institution or college';end if;
  if exists(select 1 from public.attendance_logs where student_id=s.id and event_id=e.id and checkpoint_key=c->>'key') then return jsonb_build_object('error','Already checked in for this checkpoint','http_status',409);end if;
  insert into public.attendance_attempts(student_id,event_id,checkpoint_key) values(s.id,e.id,c->>'key') on conflict do nothing;
  select rejected_count into tries from public.attendance_attempts where student_id=s.id and event_id=e.id and checkpoint_key=c->>'key' for update;
  if tries>=e.max_check_in_attempts then return jsonb_build_object('error','Attendance attempt limit reached for this checkpoint. Contact an administrator.','http_status',400,'attempts',jsonb_build_object('rejected',tries,'limit',e.max_check_in_attempts,'remaining',0,'locked',true));end if;
  begin
    if p_qr_error is not null then raise exception '%',p_qr_error;end if;
    if p_qr_version is null or p_qr_version<>e.qr_version then raise exception 'Event QR code has been replaced';end if;
    if p_latitude is null or p_longitude is null or p_accuracy is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 or p_accuracy<0 or p_accuracy>e.radius_meters then raise exception 'GPS accuracy is insufficient. Move to a clear area and retry';end if;
    distance:=6371000*2*asin(sqrt(least(1::double precision,greatest(0::double precision,power(sin(radians(e.latitude-p_latitude)/2),2)+cos(radians(p_latitude))*cos(radians(e.latitude))*power(sin(radians(e.longitude-p_longitude)/2),2)))));
    if distance>e.radius_meters then raise exception 'Outside geofence perimeter';end if;
    if not exists(select 1 from public.user_devices where user_id=p_user and device_hash=p_device_hash) then raise exception 'Verify this login before recording attendance';end if;
    risky:=exists(select 1 from public.device_incidents where user_id=p_user and device_hash=p_device_hash and status='open');
    insert into public.attendance_logs(student_id,event_id,user_id,device_hash,latitude,longitude,accuracy_meters,distance_from_venue_meters,status,risk_reasons,checkpoint_key,checkpoint_label)
      values(s.id,e.id,p_user,p_device_hash,p_latitude,p_longitude,p_accuracy,round(distance::numeric,2),case when risky then 'pending_review' else 'approved' end,case when risky then '["Changed or shared browser device"]'::jsonb else '[]'::jsonb end,c->>'key',c->>'label') returning * into a;
    if risky then insert into public.admin_notifications(kind,user_id,attendance_id,message) values('attendance',p_user,a.id,'Attendance checkpoint requires device verification: '||(c->>'label'));end if;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_user,'attendance.'||a.status,'attendance_log',a.id::text,jsonb_build_object('checkpoint',c->>'label','distance_meters',distance));
  exception when raise_exception then
    get stacked diagnostics message=message_text;tries:=tries+1;
    update public.attendance_attempts set rejected_count=tries,last_rejection=message,updated_at=now() where student_id=s.id and event_id=e.id and checkpoint_key=c->>'key';
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_user,'attendance.scan_rejected','event',e.id::text,jsonb_build_object('checkpoint',c->>'label','reason',message,'rejected_attempts',tries));
    return jsonb_build_object('error',message,'http_status',400,'attempts',jsonb_build_object('rejected',tries,'limit',e.max_check_in_attempts,'remaining',greatest(0,e.max_check_in_attempts-tries),'locked',tries>=e.max_check_in_attempts));
  end;
  return jsonb_build_object('attendance',to_jsonb(a),'attempts',jsonb_build_object('rejected',tries,'limit',e.max_check_in_attempts,'remaining',greatest(0,e.max_check_in_attempts-tries),'locked',false));
end $$;
revoke all on function public.submit_checkpoint_attendance(uuid,uuid,text,uuid,text,double precision,double precision,double precision,text) from public,anon,authenticated;
grant execute on function public.submit_checkpoint_attendance(uuid,uuid,text,uuid,text,double precision,double precision,double precision,text) to service_role;

create function public.record_checkpoint_manual(p_actor uuid,p_student uuid,p_event uuid,p_reason text,p_key text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles; s public.students; e public.events; c jsonb; a public.attendance_logs; uid uuid;
begin
  select * into strict p from public.user_profiles where user_id=p_actor for share;
  if p.approval_status<>'approved' or p.role not in ('main_admin','admin','col_officer') or p.privacy_version is distinct from '2026-11-17' then raise exception 'Approved administrator access and privacy consent required';end if;
  if length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Explain why manual attendance is needed';end if;
  select * into strict s from public.students where id=p_student and archived_at is null for share;
  select * into strict e from public.events where id=p_event and archived_at is null for share;c:=public.resolve_event_checkpoint(e,p_key);
  if now()<(c->>'opens_at')::timestamptz or now()>(c->>'closes_at')::timestamptz then raise exception 'This attendance checkpoint is not currently open';end if;
  if (e.institution is not null and e.institution is distinct from s.institution) or (e.college is not null and e.college is distinct from s.college) then raise exception 'This event is for a different institution or college';end if;
  select user_id into uid from public.user_profiles where student_id=s.id;
  insert into public.attendance_logs(student_id,event_id,user_id,status,entry_method,recorded_by,manual_reason,reviewed_by,reviewed_at,review_note,checkpoint_key,checkpoint_label)
    values(s.id,e.id,uid,'approved','manual',p_actor,trim(p_reason),p_actor,now(),'In-person manual verification',c->>'key',c->>'label') returning * into a;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'attendance.manual_recorded','attendance_log',a.id::text,jsonb_build_object('student_id',s.id,'event_id',e.id,'checkpoint',c->>'label','reason',trim(p_reason)));
  return to_jsonb(a);
end $$;
revoke all on function public.record_checkpoint_manual(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_checkpoint_manual(uuid,uuid,uuid,text,text) to service_role;
create or replace function public.list_review_items(p_category text,p_state text default 'pending',p_search text default '',p_page integer default 1,p_size integer default 10)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_category not in ('notifications','attendance','devices') or p_state not in ('pending','history','all') or p_page is null or p_page<1 or p_page>100000 or p_size is null or p_size<1 or p_size>50 or length(coalesce(p_search,''))>100 then raise exception 'Invalid review filters';end if;
  with entries as (
    select n.id,n.created_at,coalesce(p.full_name,p.email,'Unknown account') as user_name,p.email,
      case when n.read_at is null then 'pending' else 'history' end as bucket,
      case when n.read_at is null then 'Unread' else 'Read' end as status,
      n.message as label,to_jsonb(n) as details,
      concat_ws(' ',p.full_name,p.email,p.personal_id,n.message) as search_text
      from public.admin_notifications n left join public.user_profiles p on p.user_id=n.user_id where p_category='notifications'
    union all
    select a.id,a.checked_in_at,coalesce(s.name,p.full_name,p.email,'Unknown student'),p.email,
      case when a.status='pending_review' then 'pending' else 'history' end,a.status,
      concat_ws(' · ',coalesce(e.name,'Event unavailable'),a.checkpoint_label),to_jsonb(a)||jsonb_build_object('event_name',e.name,'student_name',s.name),
      concat_ws(' ',s.name,s.student_number,p.email,e.name,a.checkpoint_label,a.risk_reasons::text,a.review_note)
      from public.attendance_logs a left join public.students s on s.id=a.student_id left join public.user_profiles p on p.user_id=a.user_id left join public.events e on e.id=a.event_id
      where p_category='attendance' and (a.status='pending_review' or (a.reviewed_at is not null and a.entry_method<>'manual'))
    union all
    select d.id,d.created_at,coalesce(p.full_name,p.email,'Unknown account'),p.email,
      case when d.status='open' then 'pending' else 'history' end,d.status,
      concat_ws(' · ',case when d.changed_device then 'Changed browser' end,case when d.shared_device then 'Shared browser' end),to_jsonb(d),
      concat_ws(' ',p.full_name,p.email,p.personal_id,d.device_hash,case when d.changed_device then 'Changed browser' end,case when d.shared_device then 'Shared browser' end)
      from public.device_incidents d left join public.user_profiles p on p.user_id=d.user_id where p_category='devices'
  ), filtered as (
    select * from entries where (p_state='all' or bucket=p_state) and strpos(lower(search_text),lower(trim(coalesce(p_search,''))))>0
  ), page_rows as (
    select * from filtered order by created_at desc,id desc limit p_size offset ((p_page-1)*p_size)
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)-'search_text' order by r.created_at desc,r.id desc) from page_rows r),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',p_page,'page_size',p_size) into result;
  return result;
end $$;
revoke all on function public.list_review_items(text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.list_review_items(text,text,text,integer,integer) to service_role;
create or replace function public.event_attendance_statistics(p_event uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (
  select s.institution,s.college,s.course,
    case when grouping(s.college)=1 then 'institution' when grouping(s.course)=1 then 'college' else 'course' end as level,
    count(*)::int as eligible,count(a.id)::int as attended,
    round(100.0*count(a.id)/nullif(count(*),0),1) as percentage
  from public.students s join public.events e on e.id=p_event
  left join (select student_id,min(id::text) as id from public.attendance_logs where event_id=p_event and status='approved' group by student_id having count(distinct checkpoint_key)=(select jsonb_array_length(checkpoints) from public.events where id=p_event)) a on a.student_id=s.id
  where s.archived_at is null and s.institution is not null
    and (e.institution is null or s.institution=e.institution) and (e.college is null or s.college=e.college)
  group by grouping sets((s.institution),(s.institution,s.college),(s.institution,s.college,s.course))
  order by s.institution,grouping(s.college) desc,s.college nulls first,grouping(s.course) desc,s.course nulls first
) t;
$$;
