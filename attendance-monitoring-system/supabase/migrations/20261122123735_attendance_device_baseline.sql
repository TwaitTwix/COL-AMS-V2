alter table public.user_profiles add column attendance_device_hash text,add column attendance_device_bound_at timestamptz;
create index profiles_attendance_device_idx on public.user_profiles(attendance_device_hash) where retired_at is null and attendance_device_hash is not null;
create index attendance_browser_owner_idx on public.attendance_logs(device_hash,user_id) where entry_method='qr' and status in ('approved','pending_review') and device_hash is not null;

-- Migrate attendance users from an actual camera check-in, never a login.
with first_scan as (
 select distinct on (user_id) user_id,device_hash,checked_in_at from public.attendance_logs
 where user_id is not null and device_hash is not null and entry_method='qr'
 and status in ('approved','pending_review') and latitude is not null and longitude is not null
 order by user_id,checked_in_at,id
)
update public.user_profiles p set attendance_device_hash=f.device_hash,attendance_device_bound_at=f.checked_in_at from first_scan f where p.user_id=f.user_id and p.retired_at is null;

create function public.attendance_browser_shared(p_user uuid,p_hash text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.user_profiles p where p.user_id<>p_user and p.retired_at is null and p.attendance_device_hash=p_hash)
 or exists(select 1 from public.attendance_logs a join public.user_profiles p on p.user_id=a.user_id
 where a.user_id<>p_user and a.device_hash=p_hash and a.entry_method='qr' and a.status in ('approved','pending_review') and p.retired_at is null);
$$;

create function public.evaluate_attendance_device(p_user uuid,p_hash text,p_bind boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles;changed boolean;shared boolean;d public.device_incidents;new_points integer;add_points integer:=0;notify boolean:=false;
begin
 select * into strict p from public.user_profiles where user_id=p_user for update;
 if p.retired_at is not null then raise exception 'This account is retired';end if;
 if p_hash is null or length(p_hash) not between 1 and 128 then raise exception 'Invalid browser identifier';end if;
 -- All callers lock profile before browser, including concurrent first scans.
 perform pg_advisory_xact_lock(hashtextextended(p_hash,0));
 changed:=p.attendance_device_hash is not null and p.attendance_device_hash<>p_hash;
 shared:=public.attendance_browser_shared(p_user,p_hash);
 if changed or shared then
   select * into d from public.device_incidents where user_id=p_user and device_hash=p_hash for update;
   if not found then
     new_points:=case when p.attendance_device_hash is not null then 1 else 0 end;
     insert into public.device_incidents(user_id,device_hash,changed_device,shared_device,penalty_points) values(p_user,p_hash,changed,shared,new_points) returning * into d;
     add_points:=new_points;notify:=true;
   else
     notify:=(changed and not d.changed_device) or (shared and not d.shared_device);
     new_points:=case when p.attendance_device_hash is not null and (changed or (shared and not d.shared_device)) then greatest(d.penalty_points,1) else d.penalty_points end;
     add_points:=new_points-d.penalty_points;
     update public.device_incidents set changed_device=changed_device or changed,shared_device=shared_device or shared,penalty_points=new_points,
       status=case when notify then 'open' else status end,reviewed_by=case when notify then null else reviewed_by end,reviewed_at=case when notify then null else reviewed_at end
       where id=d.id returning * into d;
   end if;
   if add_points>0 then update public.user_profiles set penalty_points=penalty_points+add_points where user_id=p_user;end if;
   if notify or add_points>0 then
     insert into public.admin_notifications(kind,user_id,incident_id,message) values('device',p_user,d.id,
       case when p.attendance_device_hash is null then 'Browser previously used for another active account attendance. Review required; no first-registration penalty.'
       else 'Attendance device changed or shared. Review required.' end);
   end if;
 end if;
 if p_bind and p.attendance_device_hash is null then
   update public.user_profiles set attendance_device_hash=p_hash,attendance_device_bound_at=now() where user_id=p_user;
   insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_user,'device.attendance_baseline_set','user_profile',p_user::text,jsonb_build_object('device_id',left(p_hash,12)));
 end if;
 select * into d from public.device_incidents where user_id=p_user and device_hash=p_hash;
 return jsonb_build_object('changed_device',changed,'shared_device',shared,'requires_review',coalesce(d.status='open',false),'device_id',left(p_hash,12),'attendance_device_bound',p.attendance_device_hash is not null or p_bind);
end $$;

create or replace function public.record_device_session(p_user_id uuid,p_session_id text,p_device_hash text,p_user_agent text,p_ip_address text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 -- Registration and verification logins are evidence only, not a baseline.
 result:=public.evaluate_attendance_device(p_user_id,p_device_hash,false);
 insert into public.user_devices(user_id,device_hash,user_agent) values(p_user_id,p_device_hash,p_user_agent)
 on conflict(user_id,device_hash) do update set last_seen_at=now(),user_agent=excluded.user_agent;
 insert into public.login_logs(user_id,session_id,device_hash,user_agent,ip_address,changed_device,shared_device)
 values(p_user_id,p_session_id,p_device_hash,p_user_agent,p_ip_address,(result->>'changed_device')::boolean,(result->>'shared_device')::boolean) on conflict do nothing;
 return result;
end $$;
revoke all on function public.attendance_browser_shared(uuid,text),public.evaluate_attendance_device(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.attendance_browser_shared(uuid,text),public.evaluate_attendance_device(uuid,text,boolean) to service_role;

-- Repair only untouched automatic penalties from before the first venue scan.
-- Keep historical login/attendance evidence and all administrator decisions.
do $$
declare d record;current_points integer;is_shared boolean;
begin
 for d in select i.* from public.device_incidents i join public.user_profiles p on p.user_id=i.user_id
   where p.retired_at is null and i.status='open' and i.reviewed_by is null and i.penalty_points>0
   and (p.attendance_device_bound_at is null or i.created_at<p.attendance_device_bound_at)
   order by i.user_id,i.id
 loop
   select penalty_points into current_points from public.user_profiles where user_id=d.user_id for update;
   is_shared:=public.attendance_browser_shared(d.user_id,d.device_hash);
   update public.user_profiles set penalty_points=greatest(0,penalty_points-d.penalty_points) where user_id=d.user_id;
   update public.device_incidents set penalty_points=0,changed_device=false,shared_device=is_shared,
     status=case when is_shared then 'open' else 'dismissed' end,reviewed_at=case when is_shared then null else now() end where id=d.id;
   if not is_shared then update public.admin_notifications set read_at=coalesce(read_at,now()) where incident_id=d.id;end if;
   insert into public.audit_logs(action,entity_type,entity_id,details) values('device.registration_penalty_corrected','device_incident',d.id::text,
     jsonb_build_object('user_id',d.user_id,'reason','Login/verification before first venue attendance must not incur a penalty','previous_incident',to_jsonb(d),'points_refunded',least(current_points,d.penalty_points),'still_requires_review',is_shared));
   insert into public.admin_notifications(kind,user_id,incident_id,message) values('device',d.user_id,d.id,
     'Pre-attendance login/verification penalty corrected. '||case when is_shared then 'Shared attendance browser still requires review.' else 'Login-only device alert resolved. Attendance decisions remain unchanged.' end);
 end loop;
end $$;

create or replace function public.submit_checkpoint_attendance(p_user uuid,p_event uuid,p_key text,p_qr_version uuid,p_device_hash text,p_latitude double precision,p_longitude double precision,p_accuracy double precision,p_qr_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles; s public.students; e public.events; c jsonb; a public.attendance_logs; tries integer; distance double precision; risky boolean; message text;
begin
  select * into strict p from public.user_profiles where user_id=p_user for update;
  if p.retired_at is not null or p.approval_status<>'approved' or p.role not in ('student','student_officer','admin','col_officer','main_admin','officer') or p.student_id is null then raise exception 'A linked, approved attendance account is required';end if;
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
    perform public.evaluate_attendance_device(p_user,p_device_hash,true);
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

create or replace function public.submit_event_attendance(p_user uuid,p_event uuid,p_qr_version uuid,p_device_hash text,p_latitude double precision,p_longitude double precision,p_accuracy double precision)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles; e public.events; s public.students; a public.attendance_logs; distance double precision; risky boolean; reasons jsonb := '[]';
begin
  select * into strict p from public.user_profiles where user_id=p_user for update;
  if p.retired_at is not null or p.approval_status<>'approved' or p.role not in ('student','student_officer') or p.student_id is null then raise exception 'Approved student access required'; end if;
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
  perform public.evaluate_attendance_device(p_user,p_device_hash,true);
  risky := exists(select 1 from public.device_incidents where user_id=p_user and device_hash=p_device_hash and status='open');
  if risky then reasons := '["Changed or shared browser device"]'::jsonb; end if;
  insert into public.attendance_logs(student_id,event_id,distance_from_venue_meters,user_id,device_hash,latitude,longitude,accuracy_meters,status,risk_reasons)
  values(s.id,e.id,round(distance::numeric,2),p_user,p_device_hash,p_latitude,p_longitude,p_accuracy,case when risky then 'pending_review' else 'approved' end,reasons) returning * into a;
  if risky then insert into public.admin_notifications(kind,user_id,attendance_id,message) values('attendance',p_user,a.id,'Potential malicious attendance: changed/shared browser device. Administrator decision required.'); end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_user,'attendance.'||a.status,'attendance_log',a.id::text,jsonb_build_object('device_id',left(p_device_hash,12),'distance_meters',distance));
  return to_jsonb(a);
end $$;
