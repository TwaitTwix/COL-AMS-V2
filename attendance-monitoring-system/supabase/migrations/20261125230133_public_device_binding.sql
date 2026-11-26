-- Phase 4: attendance-only browser binding; legacy login/device history is untouched.
create table public.participant_device_bindings(
 id uuid primary key default gen_random_uuid(),student_id uuid not null references public.students(id),
 device_hash text not null check(device_hash~'^[a-f0-9]{64}$'),started_at timestamptz not null default clock_timestamp(),
 ended_at timestamptz,source_submission uuid not null references public.public_attendance_submissions(id),
 actor_user_id uuid references auth.users(id),reason text not null
);
create unique index participant_one_active_device on public.participant_device_bindings(student_id) where ended_at is null;
create unique index browser_one_active_participant on public.participant_device_bindings(device_hash) where ended_at is null;
create index participant_binding_source_idx on public.participant_device_bindings(source_submission);
create index participant_binding_actor_idx on public.participant_device_bindings(actor_user_id);
create table public.participant_device_incidents(
 id uuid primary key default gen_random_uuid(),student_id uuid not null references public.students(id),
 kind text not null check(kind in ('device_change','shared_browser')),candidate_device text not null,
 binding_id uuid references public.participant_device_bindings(id),first_submission uuid not null references public.public_attendance_submissions(id),
 state text not null default 'open' check(state in ('open','replaced','dismissed','rejected_change')),
 version integer not null default 1,created_at timestamptz not null default clock_timestamp(),
 resolved_at timestamptz,reviewer uuid references auth.users(id),decision_reason text
);
create unique index participant_open_device_incident on public.participant_device_incidents(student_id,kind,candidate_device) where state='open';
create index participant_incident_binding_idx on public.participant_device_incidents(binding_id);
create index participant_incident_source_idx on public.participant_device_incidents(first_submission);
create index participant_incident_reviewer_idx on public.participant_device_incidents(reviewer);
create table public.participant_device_observations(
 request_id uuid primary key references public.public_attendance_requests(request_id),
 student_id uuid not null references public.students(id),submission_id uuid not null references public.public_attendance_submissions(id),
 device_hash text not null,latitude double precision not null,longitude double precision not null,
 accuracy_meters double precision not null,captured_at timestamptz not null,distance_meters double precision not null,
 ip_hash text not null,user_agent text not null,signature jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index participant_observation_student_idx on public.participant_device_observations(student_id,created_at);
create index participant_observation_submission_idx on public.participant_device_observations(submission_id);
create table public.participant_incident_submissions(
 incident_id uuid not null references public.participant_device_incidents(id),submission_id uuid not null references public.public_attendance_submissions(id),
 primary key(incident_id,submission_id)
);
create index participant_incident_submission_idx on public.participant_incident_submissions(submission_id);
create table public.participant_penalty_ledger(
 id uuid primary key default gen_random_uuid(),student_id uuid not null references public.students(id),
 incident_id uuid not null references public.participant_device_incidents(id),
 kind text not null check(kind in ('device_change_point','false_flag_adjustment')),
 points integer not null,actor_user_id uuid references auth.users(id),reason text not null,
 created_at timestamptz not null default clock_timestamp(),unique(incident_id,kind),
 check((kind='device_change_point' and points=1) or (kind='false_flag_adjustment' and points=-1))
);
create index participant_penalty_student_idx on public.participant_penalty_ledger(student_id);
create index participant_penalty_actor_idx on public.participant_penalty_ledger(actor_user_id);
insert into public.operational_features(key,label,description,default_roles,delegable,available,allowed_roles)
 values('devices.admin','Device verification','Review attendance browser bindings; administrator only until case ownership is implemented.',array['administrator'],false,true,array['administrator']);

create function app_private.record_participant_device_incident(p_student uuid,p_kind text,p_device text,p_binding uuid,p_submission uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare incident uuid;
begin
 insert into public.participant_device_incidents(student_id,kind,candidate_device,binding_id,first_submission)
 values(p_student,p_kind,p_device,p_binding,p_submission) on conflict(student_id,kind,candidate_device) where state='open' do nothing returning id into incident;
 if incident is null then select id into incident from public.participant_device_incidents where student_id=p_student and kind=p_kind and candidate_device=p_device and state='open';
 else
  if p_kind='device_change' then insert into public.participant_penalty_ledger(student_id,incident_id,kind,points,reason) values(p_student,incident,'device_change_point',1,'Recognized attendance browser changed');end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(null,'attendance.device_incident_opened','participant_device_incident',incident::text,jsonb_build_object('kind',p_kind,'submission_id',p_submission));
 end if;
 insert into public.participant_incident_submissions(incident_id,submission_id) values(incident,p_submission) on conflict do nothing;
 update public.public_attendance_submissions set status='pending_review',review_reasons=case when p_kind=any(review_reasons) then review_reasons else array_append(review_reasons,p_kind) end where id=p_submission and status<>'rejected';
 return incident;
end $$;

create function app_private.verify_participant_device(p_request uuid,p_name text,p_institution text,p_signature jsonb,p_agent text) returns void
language plpgsql security invoker set search_path='' as $$
declare r public.public_attendance_requests;s public.public_attendance_submissions;e public.events;student uuid;official_name text;official_institution text;b public.participant_device_bindings;other public.participant_device_bindings;ignored uuid;prior record;distance double precision;
begin
 -- All binding creation, shared-device checks and review changes use this mutex.
 perform pg_advisory_xact_lock(hashtextextended('participant-device-security',0));
 if exists(select 1 from public.participant_device_observations where request_id=p_request) then return;end if;
 select * into r from public.public_attendance_requests where request_id=p_request;
 if not found or not ((r.response->>'status_code')::int=202 or r.response->'body'->'error'->>'code'='already_submitted') then return;end if;
 select * into s from public.public_attendance_submissions where event_id=r.event_id and checkpoint_key=r.checkpoint_key and school_id=r.school_id;
 if not found then return;end if;
 select x.student_id,x.full_name,v.section_snapshot->>'institution' into student,official_name,official_institution
 from public.event_eligibility_rosters er join public.class_roster_versions v on v.id=er.roster_version_id join public.class_roster_entries x on x.version_id=v.id
 where er.eligibility_id=s.eligibility_id and x.school_id=r.school_id order by er.section_id limit 1;
 if student is null or upper(regexp_replace(btrim(official_name),'\s+',' ','g'))<>upper(regexp_replace(btrim(p_name),'\s+',' ','g')) or official_institution<>p_institution or exists(select 1 from public.students where id=student and archived_at is not null) then return;end if;
 select * into e from public.events where id=r.event_id;
 distance:=app_private.public_distance_meters(e.latitude,e.longitude,r.latitude,r.longitude);
 -- Duplicate attempts were stopped before phase-3 GPS checking. They must not create flags from fabricated/outside/stale evidence.
 if r.location_captured_at<clock_timestamp()-interval '30 seconds' or r.location_captured_at>clock_timestamp()+interval '5 seconds' or r.accuracy_meters>least(50.0,e.radius_meters) or distance+r.accuracy_meters>e.radius_meters then return;end if;
 insert into public.participant_device_observations(request_id,student_id,submission_id,device_hash,latitude,longitude,accuracy_meters,captured_at,distance_meters,ip_hash,user_agent,signature)
 values(p_request,student,s.id,r.device_hash,r.latitude,r.longitude,r.accuracy_meters,r.location_captured_at,distance,r.ip_hash,coalesce(p_agent,''),p_signature);
 select * into b from public.participant_device_bindings where student_id=student and ended_at is null;
 select * into other from public.participant_device_bindings where device_hash=r.device_hash and student_id<>student and ended_at is null;
 if other.id is not null then
  ignored:=app_private.record_participant_device_incident(student,'shared_browser',r.device_hash,b.id,s.id);
  for prior in select other.source_submission as id union select a.id from public.public_attendance_submissions a where a.student_id=other.student_id and a.status<>'rejected' and (a.device_hash=r.device_hash or exists(select 1 from public.participant_device_observations o where o.submission_id=a.id and o.student_id=other.student_id and o.device_hash=r.device_hash)) loop
   ignored:=app_private.record_participant_device_incident(other.student_id,'shared_browser',r.device_hash,other.id,prior.id);
  end loop;
 end if;
 if b.id is not null and b.device_hash<>r.device_hash then ignored:=app_private.record_participant_device_incident(student,'device_change',r.device_hash,b.id,s.id);
 elsif b.id is null and other.id is null then
  insert into public.participant_device_bindings(student_id,device_hash,source_submission,reason) values(student,r.device_hash,s.id,'First qualifying roster-matched attendance submission');
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(null,'attendance.browser_bound','public_attendance_submission',s.id::text,'{}');
 end if;
 update public.public_attendance_submissions set review_reasons=array_append(array_remove(review_reasons,'device_verification_required'),'review_workflow_required') where id=s.id and 'device_verification_required'=any(review_reasons);
end $$;

alter function public.submit_public_attendance(uuid,uuid,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,timestamptz,jsonb,text,boolean) rename to submit_public_attendance_base;
create function public.submit_public_attendance(p_token uuid,p_request uuid,p_device text,p_ip text,p_agent text,p_hash text,p_school_id text,p_name text,p_institution text,p_class text,p_checkpoint text,p_lat double precision,p_lon double precision,p_accuracy double precision,p_captured timestamptz,p_signature jsonb,p_privacy_version text,p_consent boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 result:=public.submit_public_attendance_base(p_token,p_request,p_device,p_ip,p_agent,p_hash,p_school_id,p_name,p_institution,p_class,p_checkpoint,p_lat,p_lon,p_accuracy,p_captured,p_signature,p_privacy_version,p_consent);
 if (result->>'status_code')::int=202 or result->'body'->'error'->>'code'='already_submitted' then perform app_private.verify_participant_device(p_request,p_name,p_institution,p_signature,p_agent);end if;
 return result;
end $$;

create function public.list_participant_device_incidents(p_actor uuid,p_event uuid,p_page integer default 1) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'devices.admin','event',p_event::text) or not exists(select 1 from public.operational_accounts where user_id=p_actor and role='administrator' and enabled) then raise exception using errcode='42501',message='Administrator device review required';end if;
 if p_page is null or p_page not between 1 and 100000 then raise exception using errcode='22023',message='Invalid page';end if;
 return jsonb_build_object('page',p_page,'page_size',10,'total',(select count(distinct i.id) from public.participant_device_incidents i join public.participant_incident_submissions b on b.incident_id=i.id join public.public_attendance_submissions s on s.id=b.submission_id where s.event_id=p_event),
 'items',coalesce((select jsonb_agg(to_jsonb(x)) from(select i.id,i.kind,i.state,i.version,i.created_at,s.name,s.student_number,
 (select coalesce(sum(points),0) from public.participant_penalty_ledger where student_id=i.student_id) as penalty_points
 from public.participant_device_incidents i join public.students s on s.id=i.student_id where exists(select 1 from public.participant_incident_submissions b join public.public_attendance_submissions a on a.id=b.submission_id where b.incident_id=i.id and a.event_id=p_event) order by i.created_at desc,i.id limit 10 offset (p_page-1)*10) x),'[]'::jsonb));
end $$;

create function public.get_participant_device_incident(p_actor uuid,p_incident uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare i public.participant_device_incidents;
begin
 if not app_private.operational_capable(p_actor,'devices.admin') or not exists(select 1 from public.operational_accounts where user_id=p_actor and role='administrator' and enabled) then raise exception using errcode='42501',message='Administrator device review required';end if;
 select * into i from public.participant_device_incidents where id=p_incident;
 if not found then return null;end if;
 return jsonb_build_object('incident',to_jsonb(i),'binding',(select to_jsonb(b) from public.participant_device_bindings b where id=i.binding_id),
 'participant',(select jsonb_build_object('name',name,'school_id',student_number) from public.students where id=i.student_id),
 'penalty_points',(select coalesce(sum(points),0) from public.participant_penalty_ledger where student_id=i.student_id),
 'observations',coalesce((select jsonb_agg(to_jsonb(x)) from(select o.*,a.name as event_name from public.participant_device_observations o join public.events a on a.id=(select event_id from public.public_attendance_submissions where id=o.submission_id) where o.student_id=i.student_id and o.device_hash=i.candidate_device order by o.created_at desc limit 25) x),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(to_jsonb(b) order by b.started_at) from public.participant_device_bindings b where b.student_id=i.student_id),'[]'::jsonb));
end $$;

create function public.resolve_participant_device_incident(p_actor uuid,p_incident uuid,p_version integer,p_action text,p_reason text,p_confirm boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare i public.participant_device_incidents;b public.participant_device_bindings;
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 if not app_private.operational_capable(p_actor,'devices.admin') or not exists(select 1 from public.operational_accounts where user_id=p_actor and role='administrator' and enabled) then raise exception using errcode='42501',message='Administrator device review required';end if;
 if p_action is null or p_action not in ('replace','dismiss','reject_change') or length(btrim(coalesce(p_reason,''))) not between 3 and 500 or p_confirm is distinct from true then raise exception using errcode='22023',message='Confirm identity verification and provide a decision reason';end if;
 perform pg_advisory_xact_lock(hashtextextended('participant-device-security',0));
 select * into i from public.participant_device_incidents where id=p_incident for update;
 if not found or i.state<>'open' or i.version is distinct from p_version then raise exception using errcode='40001',message='Device incident changed. Reload before deciding';end if;
 if p_action='replace' then
  if i.kind<>'device_change' then raise exception using errcode='22023',message='Shared-browser incidents cannot authorize a device replacement';end if;
  select * into b from public.participant_device_bindings where student_id=i.student_id and ended_at is null;
  if b.id is distinct from i.binding_id then raise exception using errcode='40001',message='The active device changed after this incident. Review the current binding';end if;
  if exists(select 1 from public.participant_device_bindings where device_hash=i.candidate_device and ended_at is null and student_id<>i.student_id) then raise exception using errcode='22023',message='The replacement browser belongs to another participant';end if;
  update public.participant_device_bindings set ended_at=clock_timestamp() where id=b.id;
  insert into public.participant_device_bindings(student_id,device_hash,source_submission,actor_user_id,reason) values(i.student_id,i.candidate_device,i.first_submission,p_actor,p_reason);
 elsif p_action='dismiss' and i.kind='device_change' then
  insert into public.participant_penalty_ledger(student_id,incident_id,kind,points,actor_user_id,reason) values(i.student_id,i.id,'false_flag_adjustment',-1,p_actor,p_reason);
 end if;
 update public.participant_device_incidents set state=case p_action when 'replace' then 'replaced' when 'dismiss' then 'dismissed' else 'rejected_change' end,version=version+1,resolved_at=clock_timestamp(),reviewer=p_actor,decision_reason=p_reason where id=i.id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'attendance.device_incident_decided','participant_device_incident',i.id::text,jsonb_build_object('decision',p_action,'reason',p_reason));
 -- Device decisions never approve attendance or delete its original flags/evidence.
 return public.get_participant_device_incident(p_actor,i.id);
end $$;

create function app_private.immutable_participant_device_evidence() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception using errcode='22023',message='Device observations and penalty evidence are append-only';end $$;
create trigger immutable_participant_device_observation before update or delete on public.participant_device_observations for each row execute function app_private.immutable_participant_device_evidence();
create trigger immutable_participant_penalty_ledger before update or delete on public.participant_penalty_ledger for each row execute function app_private.immutable_participant_device_evidence();

do $$ declare t text;f record;begin
 foreach t in array array['participant_device_bindings','participant_device_incidents','participant_device_observations','participant_incident_submissions','participant_penalty_ledger'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select,insert,update,delete on public.%I to service_role',t);end loop;
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('immutable_participant_device_evidence','record_participant_device_incident','verify_participant_device','submit_public_attendance','submit_public_attendance_base','list_participant_device_incidents','get_participant_device_incident','resolve_participant_device_incident') loop
 execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.nspname,f.proname,f.args);execute format('grant execute on function %I.%I(%s) to service_role',f.nspname,f.proname,f.args);end loop;
end $$;
