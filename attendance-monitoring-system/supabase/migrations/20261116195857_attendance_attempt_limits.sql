alter table public.events add column max_check_in_attempts integer not null default 3
  check (max_check_in_attempts between 1 and 20);

create table public.attendance_attempts (
  student_id uuid not null references public.students(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  rejected_count integer not null default 0 check (rejected_count >= 0),
  last_rejection text,
  updated_at timestamptz not null default now(),
  primary key(student_id,event_id)
);
create index attendance_attempts_event_idx on public.attendance_attempts(event_id);
alter table public.attendance_attempts enable row level security;
revoke all on public.attendance_attempts from anon,authenticated;
grant select,insert,update on public.attendance_attempts to service_role;

-- The outer transaction keeps rejected counts even when validation raises an
-- exception. A profile lock serializes concurrent scans before checking quota.
create or replace function public.attempt_event_attendance(
  p_user uuid,p_event uuid,p_qr_version uuid,p_device_hash text,
  p_latitude double precision,p_longitude double precision,p_accuracy double precision,
  p_qr_error text default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles; s public.students; e public.events; tries integer; result jsonb; message text;
begin
  select * into strict p from public.user_profiles where user_id=p_user for update;
  if p.approval_status<>'approved' or p.role not in ('student','student_officer') or p.student_id is null then
    raise exception 'Approved student access required';
  end if;
  select * into strict s from public.students where id=p.student_id and archived_at is null;
  select * into strict e from public.events where id=p_event and archived_at is null for share;
  if exists(select 1 from public.attendance_logs where student_id=s.id and event_id=e.id) then
    return jsonb_build_object('error','Already checked in','http_status',409);
  end if;
  -- Closed/ineligible events are not failed attempts at venue verification.
  if now()<e.starts_at-interval '1 hour' or now()>e.ends_at then raise exception 'Event is not currently accepting attendance'; end if;
  if (e.institution is not null and e.institution is distinct from s.institution) or (e.college is not null and e.college is distinct from s.college) then
    raise exception 'This event is for a different institution or college';
  end if;
  insert into public.attendance_attempts(student_id,event_id) values(s.id,e.id) on conflict do nothing;
  select rejected_count into tries from public.attendance_attempts where student_id=s.id and event_id=e.id for update;
  if tries>=e.max_check_in_attempts then
    return jsonb_build_object('error','Attendance attempt limit reached. Contact an administrator.','http_status',400,
      'attempts',jsonb_build_object('rejected',tries,'limit',e.max_check_in_attempts,'remaining',0,'locked',true));
  end if;
  begin
    if p_qr_error is not null then raise exception '%',p_qr_error; end if;
    if p_qr_version is null or p_latitude is null or p_longitude is null or p_accuracy is null then raise exception 'Incomplete attendance verification'; end if;
    result:=public.submit_event_attendance(p_user,p_event,p_qr_version,p_device_hash,p_latitude,p_longitude,p_accuracy);
  exception when raise_exception then
    get stacked diagnostics message=message_text;
    tries:=tries+1;
    update public.attendance_attempts set rejected_count=tries,last_rejection=message,updated_at=now() where student_id=s.id and event_id=e.id;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details)
      values(p_user,'attendance.scan_rejected','event',e.id::text,jsonb_build_object('reason',message,'rejected_attempts',tries,'limit',e.max_check_in_attempts));
    return jsonb_build_object('error',message,'http_status',400,'attempts',jsonb_build_object('rejected',tries,'limit',e.max_check_in_attempts,'remaining',greatest(0,e.max_check_in_attempts-tries),'locked',tries>=e.max_check_in_attempts));
  end;
  return jsonb_build_object('attendance',result,'attempts',jsonb_build_object('rejected',tries,'limit',e.max_check_in_attempts,'remaining',greatest(0,e.max_check_in_attempts-tries),'locked',false));
end $$;
revoke all on function public.attempt_event_attendance(uuid,uuid,uuid,text,double precision,double precision,double precision,text) from public,anon,authenticated;
grant execute on function public.attempt_event_attendance(uuid,uuid,uuid,text,double precision,double precision,double precision,text) to service_role;
