-- Phase 3 is deliberately pending-only until phase 4 verifies device ownership.
create table public.event_public_links(
 event_id uuid primary key references public.events(id) on delete restrict,
 token uuid not null unique default gen_random_uuid(), enabled boolean not null default false,
 version integer not null default 1,updated_by uuid references auth.users(id),updated_at timestamptz not null default now()
);
create table public.public_attendance_submissions(
 id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id) on delete restrict,
 checkpoint_key text not null,checkpoint_label text not null,school_id text not null,submitted_name text not null,
 institution text not null check(institution in ('MCNP','ISAP')),class_label text not null default '',
 student_id uuid references public.students(id) on delete restrict,
 eligibility_id uuid not null references public.event_eligibility_versions(id) on delete restrict,
 status text not null default 'pending_review' check(status in ('pending_review','approved','rejected')),
 review_reasons text[] not null,device_hash text not null,ip_hash text not null,user_agent text not null,
 latitude double precision not null,longitude double precision not null,accuracy_meters double precision not null,
 location_captured_at timestamptz not null,distance_from_venue_meters double precision not null,
 event_snapshot jsonb not null,privacy_version text not null,privacy_accepted_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 unique(event_id,checkpoint_key,school_id)
);
create index public_attendance_student_idx on public.public_attendance_submissions(student_id);
create index public_attendance_eligibility_idx on public.public_attendance_submissions(eligibility_id);
create index public_attendance_review_idx on public.public_attendance_submissions(created_at,id) where status='pending_review';
create table public.public_attendance_signatures(
 submission_id uuid primary key references public.public_attendance_submissions(id) on delete restrict,
 strokes jsonb not null,created_at timestamptz not null default now()
);
create table public.public_submission_rosters(
 submission_id uuid not null references public.public_attendance_submissions(id) on delete restrict,
 section_id uuid not null,roster_version_id uuid not null,
 primary key(submission_id,section_id),foreign key(section_id,roster_version_id) references public.class_roster_versions(section_id,id)
);
create index public_submission_roster_idx on public.public_submission_rosters(section_id,roster_version_id);
create table public.public_attendance_attempts(
 event_id uuid not null references public.events(id) on delete restrict,checkpoint_key text not null,
 school_id text not null,device_hash text not null,rejected_count integer not null default 0 check(rejected_count>=0),
 last_rejection text,updated_at timestamptz not null default now(),
 primary key(event_id,checkpoint_key,school_id,device_hash)
);
create table public.public_attendance_requests(
 request_id uuid primary key,event_id uuid not null references public.events(id) on delete restrict,
 link_token uuid not null,device_hash text not null,payload_hash text not null,
 school_id text not null,checkpoint_key text not null,ip_hash text not null,
 submission_id uuid references public.public_attendance_submissions(id) on delete restrict,
 latitude double precision,longitude double precision,accuracy_meters double precision,location_captured_at timestamptz,
 response jsonb not null,created_at timestamptz not null default now()
);
create index public_attendance_request_submission_idx on public.public_attendance_requests(submission_id);
create index public_attendance_request_event_idx on public.public_attendance_requests(event_id,created_at);
create table public.public_attendance_throttles(
 key text primary key,window_started timestamptz not null default now(),requests integer not null default 1
);

create function app_private.public_distance_meters(p_lat1 double precision,p_lon1 double precision,p_lat2 double precision,p_lon2 double precision) returns double precision
language sql immutable security invoker set search_path='' as $$
 select 6371000.0*2*atan2(sqrt(a),sqrt(1-a)) from(select greatest(0.0,least(1.0,power(sin(radians(p_lat2-p_lat1)/2),2)+cos(radians(p_lat1))*cos(radians(p_lat2))*power(sin(radians(p_lon2-p_lon1)/2),2))) a) x;
$$;

create function app_private.valid_attendance_signature(p_signature jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare stroke jsonb;point jsonb;count_points integer:=0;previous_x double precision;previous_y double precision;x double precision;y double precision;path_length double precision:=0;
begin
 if jsonb_typeof(p_signature) is distinct from 'array' or jsonb_array_length(p_signature) not between 1 and 32 or octet_length(p_signature::text)>100000 then return false;end if;
 for stroke in select value from jsonb_array_elements(p_signature) loop
  if jsonb_typeof(stroke) is distinct from 'array' or jsonb_array_length(stroke) not between 2 and 1024 then return false;end if;
  previous_x:=null;previous_y:=null;
  for point in select value from jsonb_array_elements(stroke) loop
   if jsonb_typeof(point) is distinct from 'array' or jsonb_array_length(point)<>2 or jsonb_typeof(point->0)<>'number' or jsonb_typeof(point->1)<>'number' then return false;end if;
   x:=(point->>0)::double precision;y:=(point->>1)::double precision;
   if not(x between 0 and 1 and y between 0 and 1) then return false;end if;
   count_points:=count_points+1;if count_points>2048 then return false;end if;
   if previous_x is not null then path_length:=path_length+sqrt(power(x-previous_x,2)+power(y-previous_y,2));end if;
   previous_x:=x;previous_y:=y;
  end loop;
 end loop;
 return count_points>=8 and path_length>=0.15;
exception when others then return false;
end $$;

create function app_private.take_public_attendance_rate(p_key text,p_limit integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare count_requests integer;
begin
 -- Transient counters have no evidentiary purpose after their minute expires.
 -- Bounded, skip-locked pruning avoids a growing key table and cleanup contention.
 delete from public.public_attendance_throttles where key in(select key from public.public_attendance_throttles where window_started<clock_timestamp()-interval '10 minutes' order by window_started for update skip locked limit 100);
 insert into public.public_attendance_throttles(key) values(p_key) on conflict(key) do update set
 requests=case when public.public_attendance_throttles.window_started<clock_timestamp()-interval '1 minute' then 1 else public.public_attendance_throttles.requests+1 end,
 window_started=case when public.public_attendance_throttles.window_started<clock_timestamp()-interval '1 minute' then clock_timestamp() else public.public_attendance_throttles.window_started end returning requests into count_requests;
 return count_requests<=p_limit;
end $$;

create function public.get_public_event_attendance(p_token uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('name',e.name,'institution',e.institution,'starts_at',e.starts_at,'ends_at',e.ends_at,'server_time',now(),'max_attempts',e.max_check_in_attempts,
 'checkpoints',(select jsonb_agg(jsonb_build_object('key',c->>'key','label',c->>'label','opens_at',coalesce((c->>'opens_at')::timestamptz,e.starts_at-interval '1 hour'),'closes_at',coalesce((c->>'closes_at')::timestamptz,e.ends_at)) order by n) from jsonb_array_elements(e.checkpoints) with ordinality x(c,n)),
 'active_checkpoint_key',(select c->>'key' from jsonb_array_elements(e.checkpoints) with ordinality x(c,n) where now()>=coalesce((c->>'opens_at')::timestamptz,e.starts_at-interval '1 hour') and now()<coalesce((c->>'closes_at')::timestamptz,e.ends_at) order by n limit 1))
 from public.event_public_links l join public.events e on e.id=l.event_id where l.token=p_token and l.enabled and e.archived_at is null;
$$;

create function public.get_event_public_link(p_actor uuid,p_event uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'events.view','event',p_event::text) and not app_private.operational_capable(p_actor,'events.manage','event',p_event::text) then raise exception using errcode='42501',message='Event access required';end if;
 return jsonb_build_object('event_id',p_event,'token',(select token from public.event_public_links where event_id=p_event),'enabled',coalesce((select enabled from public.event_public_links where event_id=p_event),false),'version',coalesce((select version from public.event_public_links where event_id=p_event),0),'can_manage',app_private.operational_capable(p_actor,'events.manage','event',p_event::text),'can_replace',(select role='administrator' from public.operational_accounts where user_id=p_actor));
end $$;

create function public.save_event_public_link(p_actor uuid,p_event uuid,p_version integer,p_enabled boolean,p_replace boolean,p_confirmation text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.event_public_links;e public.events;
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 if not app_private.operational_capable(p_actor,'events.manage','event',p_event::text) then raise exception using errcode='42501',message='Event management is outside your access';end if;
 select * into e from public.events where id=p_event for update;
 if not found or (p_enabled and (e.archived_at is not null or e.ends_at<=now())) or p_enabled is null or p_replace is null or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='Choose an available event and provide a decision reason';end if;
 if p_enabled and not exists(select 1 from public.event_eligibility_heads h join public.event_eligibility_rosters r on r.eligibility_id=h.eligibility_id where h.event_id=p_event) then raise exception using errcode='22023',message='Select official event class lists before publishing attendance';end if;
 if p_replace and (p_confirmation is distinct from 'REPLACE LINK' or not exists(select 1 from public.operational_accounts where user_id=p_actor and role='administrator' and enabled)) then raise exception using errcode='42501',message='Only an administrator can replace a compromised link with explicit confirmation';end if;
 select * into l from public.event_public_links where event_id=p_event for update;
 if coalesce(l.version,0) is distinct from p_version then raise exception using errcode='40001',message='The event link changed. Reload before saving';end if;
 insert into public.event_public_links(event_id,enabled,updated_by) values(p_event,p_enabled,p_actor)
 on conflict(event_id) do update set enabled=excluded.enabled,token=case when p_replace then gen_random_uuid() else public.event_public_links.token end,version=public.event_public_links.version+1,updated_by=p_actor,updated_at=now();
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,case when p_replace then 'event.public_link_replaced' else 'event.public_link_visibility_changed' end,'event',p_event::text,jsonb_build_object('enabled',p_enabled,'reason',p_reason));
 return public.get_event_public_link(p_actor,p_event);
end $$;

create function public.public_attendance_receipt(p_token uuid,p_request uuid,p_device text,p_payload_hash text default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when p_payload_hash is not null and p_payload_hash<>r.payload_hash then jsonb_build_object('status_code',409,'body',jsonb_build_object('error',jsonb_build_object('message','This request identifier was already used for different form data. Start a new attempt.','code','request_conflict')))
 else case when s.id is null then r.response else jsonb_build_object('status_code',case when s.status='pending_review' then 202 else 200 end,'body',jsonb_build_object('receipt_id',s.id,'status',s.status,'checkpoint_key',s.checkpoint_key,'checkpoint_label',s.checkpoint_label,'message',case s.status when 'approved' then 'Attendance successfully recorded!' when 'rejected' then 'Your submission was reviewed and rejected. Contact the event officer.' else 'Your submission is saved and is awaiting verification.' end)) end end
 from public.public_attendance_requests r join public.event_public_links l on l.event_id=r.event_id and l.token=p_token and l.enabled join public.events e on e.id=l.event_id and e.archived_at is null left join public.public_attendance_submissions s on s.id=r.submission_id
 where r.request_id=p_request and r.link_token=p_token and r.device_hash=p_device;
$$;

create function public.submit_public_attendance(p_token uuid,p_request uuid,p_device text,p_ip text,p_agent text,p_hash text,p_school_id text,p_name text,p_institution text,p_class text,p_checkpoint text,p_lat double precision,p_lon double precision,p_accuracy double precision,p_captured timestamptz,p_signature jsonb,p_privacy_version text,p_consent boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.events;l public.event_public_links;cached jsonb;c jsonb;distance double precision;error_message text;error_code text;charge boolean:=false;rejections integer:=0;result jsonb;submission uuid;eligibility uuid;validation_time timestamptz;student uuid;official_name text;official_institution text;reasons text[]:=array['device_verification_required'];
begin
 if p_request is null then return jsonb_build_object('status_code',400,'body',jsonb_build_object('error',jsonb_build_object('message','A request identifier is required.','code','invalid_form')));end if;
 perform pg_advisory_xact_lock(hashtextextended('public-attendance-request:'||p_request::text,0));
 select * into l from public.event_public_links where token=p_token and enabled;
 if not found then return jsonb_build_object('status_code',404,'body',jsonb_build_object('error',jsonb_build_object('message','This attendance link is unavailable.','code','link_unavailable')));end if;
 -- A per-event transaction serializes slots, retries, counters and configuration.
 select * into e from public.events where id=l.event_id for update;
 select * into l from public.event_public_links where event_id=e.id and token=p_token and enabled;
 if not found or e.archived_at is not null then return jsonb_build_object('status_code',404,'body',jsonb_build_object('error',jsonb_build_object('message','This attendance link is unavailable.','code','link_unavailable')));end if;
 cached:=public.public_attendance_receipt(p_token,p_request,p_device,p_hash);if cached is not null then return cached;end if;
 if exists(select 1 from public.public_attendance_requests where request_id=p_request) then return jsonb_build_object('status_code',409,'body',jsonb_build_object('error',jsonb_build_object('message','Request identifier unavailable. Start a new attempt.','code','request_conflict')));end if;
 if p_checkpoint is null or p_checkpoint!~'^[a-zA-Z0-9_-]{1,50}$' or coalesce(p_class,'') ~ '[[:cntrl:]]' or p_device is null or p_device!~'^[a-f0-9]{64}$' or p_ip is null or p_ip!~'^[a-f0-9]{64}$' or p_hash is null or p_hash!~'^[a-f0-9]{64}$' or length(coalesce(p_agent,''))>500 or p_consent is distinct from true or p_privacy_version is distinct from '2026-11-26-attendance-v1' or p_school_id is null or p_school_id!~'^[A-Z0-9][A-Z0-9 ./_-]{0,39}$' or length(btrim(coalesce(p_name,''))) not between 1 and 120 or p_name ~ '[[:cntrl:]]|^[=+@-]' or p_institution is null or p_institution not in ('MCNP','ISAP') or length(coalesce(p_class,''))>80 or not coalesce(p_lat between -90 and 90 and p_lon between -180 and 180 and p_accuracy between 0 and 100000,false) or p_captured is null or not isfinite(p_captured) or not app_private.valid_attendance_signature(p_signature) then return jsonb_build_object('status_code',400,'body',jsonb_build_object('error',jsonb_build_object('message','Complete the form, privacy consent, signature and valid location before submitting.','code','invalid_form')));end if;
 if not app_private.take_public_attendance_rate('ip:'||p_ip||':'||e.id::text,600) or not app_private.take_public_attendance_rate('browser:'||p_device||':'||e.id::text,20) then return jsonb_build_object('status_code',429,'body',jsonb_build_object('error',jsonb_build_object('message','Too many attendance requests. Wait a minute before retrying.','code','rate_limited')));end if;
 validation_time:=clock_timestamp();
 select value into c from jsonb_array_elements(e.checkpoints) where value->>'key'=p_checkpoint;
 if c is null or validation_time<coalesce((c->>'opens_at')::timestamptz,e.starts_at-interval '1 hour') or validation_time>=coalesce((c->>'closes_at')::timestamptz,e.ends_at) then
  error_message:='This attendance checkpoint is outside its active window.';error_code:='checkpoint_closed';
 elsif e.institution is not null and e.institution<>p_institution then
  error_message:='Choose the institution assigned to this event.';error_code:='institution_mismatch';
 elsif exists(select 1 from public.public_attendance_submissions where event_id=e.id and checkpoint_key=p_checkpoint and school_id=p_school_id) or exists(select 1 from public.attendance_logs a join public.students s on s.id=a.student_id where a.event_id=e.id and a.checkpoint_key=p_checkpoint and upper(btrim(s.student_number))=p_school_id) then
  error_message:='Attendance already submitted for this checkpoint. Contact the event officer if you need a review.';error_code:='already_submitted';
 else
  select rejected_count into rejections from public.public_attendance_attempts where event_id=e.id and checkpoint_key=p_checkpoint and school_id=p_school_id and device_hash=p_device;
  rejections:=coalesce(rejections,0);
  if rejections>=e.max_check_in_attempts then error_message:='No verification attempts remain for this checkpoint in this browser. Contact the event officer.';error_code:='attempt_limit';
  else
   charge:=true;
   distance:=app_private.public_distance_meters(e.latitude,e.longitude,p_lat,p_lon);
   if p_captured<clock_timestamp()-interval '30 seconds' or p_captured>clock_timestamp()+interval '5 seconds' then error_message:='Location is stale or its timestamp is incorrect. Request a fresh location.';error_code:='stale_location';
   elsif p_accuracy>least(50.0,e.radius_meters) then error_message:='Location accuracy is too low. Allow precise location and try again.';error_code:='inaccurate_location';
   elsif distance>e.radius_meters then error_message:='Outside geofence perimeter';error_code:='outside_geofence';
   elsif distance+p_accuracy>e.radius_meters then error_message:='Your location accuracy overlaps the venue boundary. Move further inside the venue and try again.';error_code:='uncertain_boundary';
   end if;
  end if;
 end if;
 if error_message is not null then
  if charge then insert into public.public_attendance_attempts(event_id,checkpoint_key,school_id,device_hash,rejected_count,last_rejection) values(e.id,p_checkpoint,p_school_id,p_device,1,error_code) on conflict(event_id,checkpoint_key,school_id,device_hash) do update set rejected_count=public.public_attendance_attempts.rejected_count+1,last_rejection=excluded.last_rejection,updated_at=now() returning rejected_count into rejections;end if;
  result:=jsonb_build_object('status_code',case when error_code='already_submitted' then 409 else 400 end,'body',jsonb_build_object('error',jsonb_build_object('message',error_message,'code',error_code),'attempts',jsonb_build_object('limit',e.max_check_in_attempts,'remaining',greatest(0,e.max_check_in_attempts-coalesce(rejections,0)))));
 else
  select eligibility_id into eligibility from public.event_eligibility_heads where event_id=e.id;
  if eligibility is null then return jsonb_build_object('status_code',503,'body',jsonb_build_object('error',jsonb_build_object('message','Event eligibility is not ready. Contact the event officer.','code','event_not_ready')));end if;
  select r.student_id,r.full_name,v.section_snapshot->>'institution' into student,official_name,official_institution from public.event_eligibility_rosters b join public.class_roster_versions v on v.id=b.roster_version_id join public.class_roster_entries r on r.version_id=b.roster_version_id where b.eligibility_id=eligibility and r.school_id=p_school_id order by b.section_id limit 1;
  if student is null then reasons:=array_append(reasons,'not_on_official_list');
  elsif upper(regexp_replace(btrim(official_name),'\s+',' ','g'))<>upper(regexp_replace(btrim(p_name),'\s+',' ','g')) or official_institution<>p_institution then reasons:=array_append(reasons,'identity_mismatch');end if;
  if student is not null and exists(select 1 from public.students where id=student and archived_at is not null) then reasons:=array_append(reasons,'archived_identity');end if;
  insert into public.public_attendance_submissions(event_id,checkpoint_key,checkpoint_label,school_id,submitted_name,institution,class_label,student_id,eligibility_id,review_reasons,device_hash,ip_hash,user_agent,latitude,longitude,accuracy_meters,location_captured_at,distance_from_venue_meters,event_snapshot,privacy_version)
  values(e.id,p_checkpoint,c->>'label',p_school_id,p_name,p_institution,coalesce(p_class,''),student,eligibility,reasons,p_device,p_ip,coalesce(p_agent,''),p_lat,p_lon,p_accuracy,p_captured,distance,jsonb_build_object('name',e.name,'latitude',e.latitude,'longitude',e.longitude,'radius_meters',e.radius_meters,'starts_at',e.starts_at,'ends_at',e.ends_at),p_privacy_version) returning id into submission;
  insert into public.public_attendance_signatures(submission_id,strokes) values(submission,p_signature);
  insert into public.public_submission_rosters(submission_id,section_id,roster_version_id) select submission,b.section_id,b.roster_version_id from public.event_eligibility_rosters b join public.class_roster_entries r on r.version_id=b.roster_version_id and r.school_id=p_school_id where b.eligibility_id=eligibility;
  result:=jsonb_build_object('status_code',202,'body',jsonb_build_object('receipt_id',submission,'status','pending_review','checkpoint_key',p_checkpoint,'checkpoint_label',c->>'label','message','Your submission is saved and is awaiting verification.'));
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(null,'attendance.public_submitted','public_attendance_submission',submission::text,jsonb_build_object('event_id',e.id,'checkpoint_key',p_checkpoint,'status','pending_review'));
 end if;
 insert into public.public_attendance_requests(request_id,event_id,link_token,device_hash,payload_hash,school_id,checkpoint_key,ip_hash,submission_id,latitude,longitude,accuracy_meters,location_captured_at,response) values(p_request,e.id,p_token,p_device,p_hash,p_school_id,p_checkpoint,p_ip,submission,p_lat,p_lon,p_accuracy,p_captured,result);
 return result;
end $$;

alter table public.events add column operational_version integer not null default 1;
create function app_private.freeze_public_event_evidence() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.latitude,new.longitude,new.radius_meters,new.starts_at,new.ends_at,new.checkpoints,new.institution,new.college) is distinct from (old.latitude,old.longitude,old.radius_meters,old.starts_at,old.ends_at,old.checkpoints,old.institution,old.college) and exists(select 1 from public.public_attendance_submissions where event_id=old.id) then raise exception using errcode='22023',message='Venue, eligibility and checkpoint configuration are locked after the first public submission';end if;
 return new;
end $$;
create trigger freeze_public_event_evidence before update on public.events for each row execute function app_private.freeze_public_event_evidence();

create function public.save_operational_event(p_actor uuid,p_event uuid,p_version integer,p_fields jsonb,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.events;new_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='A decision reason is required';end if;
 if p_event is null then
  if p_version is distinct from 0 or not app_private.operational_capable(p_actor,'events.manage','institution',p_fields->>'institution') then raise exception using errcode='42501',message='Event creation is outside your assigned institution';end if;
 else
  if not app_private.operational_capable(p_actor,'events.manage','event',p_event::text) then raise exception using errcode='42501',message='Event management is outside your access';end if;
  select * into e from public.events where id=p_event for update;
  if not found or e.operational_version is distinct from p_version then raise exception using errcode='40001',message='Event changed. Reload before saving';end if;
  if (p_fields->>'institution') is distinct from e.institution and not app_private.operational_capable(p_actor,'events.manage','institution',p_fields->>'institution') then raise exception using errcode='42501',message='Moving event affiliation is outside your assigned institution';end if;
 end if;
 if p_fields->>'college' is not null and not exists(select 1 from public.colleges where institution=p_fields->>'institution' and name=p_fields->>'college' and active) then raise exception using errcode='22023',message='Choose an active college belonging to the event institution';end if;
 if p_event is null then
  insert into public.events(name,latitude,longitude,radius_meters,starts_at,ends_at,institution,college,checkpoints,max_check_in_attempts) values(p_fields->>'name',(p_fields->>'latitude')::double precision,(p_fields->>'longitude')::double precision,(p_fields->>'radius_meters')::double precision,(p_fields->>'starts_at')::timestamptz,(p_fields->>'ends_at')::timestamptz,p_fields->>'institution',p_fields->>'college',p_fields->'checkpoints',(p_fields->>'max_check_in_attempts')::integer) returning id into new_id;
  insert into public.event_public_links(event_id,updated_by) values(new_id,p_actor);
 else
  update public.events set name=p_fields->>'name',latitude=(p_fields->>'latitude')::double precision,longitude=(p_fields->>'longitude')::double precision,radius_meters=(p_fields->>'radius_meters')::double precision,starts_at=(p_fields->>'starts_at')::timestamptz,ends_at=(p_fields->>'ends_at')::timestamptz,institution=p_fields->>'institution',college=p_fields->>'college',checkpoints=p_fields->'checkpoints',max_check_in_attempts=(p_fields->>'max_check_in_attempts')::integer,operational_version=operational_version+1 where id=p_event;new_id:=p_event;
 end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'event.configuration_saved','event',new_id::text,jsonb_build_object('reason',p_reason));
 return (select to_jsonb(x) from public.events x where id=new_id);
end $$;

create function public.get_operational_event(p_actor uuid,p_event uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'events.manage','event',p_event::text) then raise exception using errcode='42501',message='Event management access required';end if;
 return (select to_jsonb(e)||jsonb_build_object('public_configuration_locked',exists(select 1 from public.public_attendance_submissions where event_id=e.id)) from public.events e where id=p_event);
end $$;
update public.operational_features set available=true where key='events.manage';
create or replace function public.list_operational_events(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'events.view') then raise exception using errcode='42501',message='Event access is disabled';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'institution',e.institution,'college',e.college,'starts_at',e.starts_at,'ends_at',e.ends_at,'can_manage',app_private.operational_capable(p_actor,'events.manage','event',e.id::text),'can_set_class_lists',app_private.operational_capable(p_actor,'events.eligibility','event',e.id::text)) order by e.starts_at desc,e.id) from public.events e where e.archived_at is null and app_private.operational_capable(p_actor,'events.view','event',e.id::text)),'[]'::jsonb);
end $$;

-- Frozen eligibility also checks new pending public records, not only legacy logs.
alter function public.set_event_class_rosters(uuid,uuid,integer,jsonb,text) rename to set_event_class_rosters_base;
create function public.set_event_class_rosters(p_actor uuid,p_event uuid,p_expected_revision integer,p_sections jsonb,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 if not app_private.operational_capable(p_actor,'events.eligibility','event',p_event::text) then raise exception using errcode='42501',message='Event eligibility access required';end if;
 perform 1 from public.events where id=p_event for update;
 if exists(select 1 from public.public_attendance_submissions where event_id=p_event) then raise exception using errcode='22023',message='Eligibility is locked after a public submission';end if;
 return public.set_event_class_rosters_base(p_actor,p_event,p_expected_revision,p_sections,p_reason);
end $$;

create index public_attendance_throttle_expiry_idx on public.public_attendance_throttles(window_started);
do $$ declare t text;f record;begin
 foreach t in array array['event_public_links','public_attendance_submissions','public_attendance_signatures','public_submission_rosters','public_attendance_attempts','public_attendance_requests','public_attendance_throttles'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('public_distance_meters','valid_attendance_signature','take_public_attendance_rate','get_public_event_attendance','get_event_public_link','save_event_public_link','public_attendance_receipt','submit_public_attendance','freeze_public_event_evidence','save_operational_event','get_operational_event','set_event_class_rosters','set_event_class_rosters_base') loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.nspname,f.proname,f.args);
  execute format('grant execute on function %I.%I(%s) to service_role',f.nspname,f.proname,f.args);
 end loop;
end $$;
