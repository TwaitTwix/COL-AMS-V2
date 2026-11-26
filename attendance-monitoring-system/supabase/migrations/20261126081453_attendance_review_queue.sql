-- Durable phase-5 review queue. No hosted scheduler is activated by this migration.
update public.operational_features set available=true where key in ('attendance.review','cases.evidence');
create table public.attendance_review_cases(
 id uuid primary key default gen_random_uuid(),submission_id uuid not null unique references public.public_attendance_submissions(id),
 level integer not null check(level between 0 and 3),owner_id uuid not null references public.operational_accounts(user_id),
 state text not null default 'open' check(state in ('open','approved','rejected')),version integer not null default 1,
 entered_at timestamptz not null default clock_timestamp(),due_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 decided_at timestamptz,decided_by uuid references auth.users(id),decision_reason text,
 check((level=3 and due_at is null) or (level<3 and due_at is not null))
);
create index review_owner_idx on public.attendance_review_cases(owner_id,state,created_at);
create index review_due_idx on public.attendance_review_cases(due_at,id) where state='open' and level<3;
create index review_decider_idx on public.attendance_review_cases(decided_by);
create table public.attendance_review_history(
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.attendance_review_cases(id),
 version integer not null,action text not null,level integer not null,owner_id uuid not null references auth.users(id),
 actor_id uuid references auth.users(id),reason text not null,created_at timestamptz not null default clock_timestamp(),unique(case_id,version)
);
create index review_history_owner_idx on public.attendance_review_history(owner_id);
create index review_history_actor_idx on public.attendance_review_history(actor_id);
create table public.attendance_review_notifications(
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.attendance_review_cases(id),
 version integer not null,recipient_id uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 read_at timestamptz,resolved_at timestamptz,unique(case_id,version,recipient_id)
);
create index review_notification_owner_idx on public.attendance_review_notifications(recipient_id,created_at desc);
create table public.attendance_review_worker_health(id boolean primary key default true check(id),last_success_at timestamptz,processed integer not null default 0);
insert into public.attendance_review_worker_health(id) values(true);

create function app_private.attendance_review_owner(p_submission uuid,p_level integer) returns uuid language plpgsql stable security invoker set search_path='' as $$
declare result uuid;event uuid;
begin
 select event_id into event from public.public_attendance_submissions where id=p_submission;
 if p_level=0 then
  select a.user_id into result from public.public_submission_rosters r join public.class_assignments a on a.section_id=r.section_id
  join public.operational_accounts o on o.user_id=a.user_id and o.enabled and o.role=a.role_at_assignment
  where r.submission_id=p_submission and a.ended_at is null and o.role in ('classroom_representative','club_president')
  and app_private.operational_capable(o.user_id,'attendance.review','section',r.section_id::text) and app_private.operational_capable(o.user_id,'cases.evidence','section',r.section_id::text)
  order by case when a.kind='representative' then 0 else 1 end,r.section_id,a.user_id limit 1;
 elsif p_level in (1,2) then
  select user_id into result from public.operational_accounts where enabled and role=case p_level when 1 then 'col_regular' else 'col_admin' end
  and app_private.operational_capable(user_id,'attendance.review','event',event::text) and app_private.operational_capable(user_id,'cases.evidence','event',event::text) order by (user_id=(select owner_id from public.attendance_review_cases where submission_id=p_submission and level=p_level)) desc nulls last,user_id limit 1;
 elsif p_level=3 then
  select user_id into result from public.operational_accounts where enabled and role='administrator' and app_private.operational_capable(user_id,'attendance.review') and app_private.operational_capable(user_id,'cases.evidence') order by (user_id=(select owner_id from public.attendance_review_cases where submission_id=p_submission and level=p_level)) desc nulls last,user_id limit 1;
 end if;
 return result;
end $$;

create function app_private.write_attendance_review_transition(p_case uuid,p_action text,p_actor uuid,p_reason text) returns void language plpgsql security invoker set search_path='' as $$
declare c public.attendance_review_cases;
begin
 select * into strict c from public.attendance_review_cases where id=p_case;
 update public.attendance_review_notifications set resolved_at=coalesce(resolved_at,clock_timestamp()) where case_id=c.id and version<c.version;
 insert into public.attendance_review_history(case_id,version,action,level,owner_id,actor_id,reason) values(c.id,c.version,p_action,c.level,c.owner_id,p_actor,p_reason);
 if c.state='open' then insert into public.attendance_review_notifications(case_id,version,recipient_id) values(c.id,c.version,c.owner_id) on conflict do nothing;end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'attendance.review_'||p_action,'attendance_review_case',c.id::text,jsonb_build_object('level',c.level,'version',c.version,'reason',p_reason));
end $$;

create function app_private.enqueue_attendance_review(p_submission uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare c public.attendance_review_cases;owner uuid;selected integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('participant-device-security',0));
 if not exists(select 1 from public.public_attendance_submissions where id=p_submission and status='pending_review') then return null;end if;
 select * into c from public.attendance_review_cases where submission_id=p_submission for update;
 if found and c.state='open' then return c.id;end if;
 while selected<=3 loop owner:=app_private.attendance_review_owner(p_submission,selected);exit when owner is not null;selected:=selected+1;end loop;
 if owner is null then raise exception using errcode='55000',message='No active administrator is available for attendance review';end if;
 if c.id is null then
  insert into public.attendance_review_cases(submission_id,level,owner_id,due_at) values(p_submission,selected,owner,case when selected<3 then clock_timestamp()+interval '1 hour' end) returning * into c;
  perform app_private.write_attendance_review_transition(c.id,'assigned',null,'Initial attendance review');
 else
  update public.attendance_review_cases set state='open',level=selected,owner_id=owner,entered_at=clock_timestamp(),due_at=case when selected<3 then clock_timestamp()+interval '1 hour' end,version=version+1,decided_at=null,decided_by=null,decision_reason=null where id=c.id returning * into c;
  perform app_private.write_attendance_review_transition(c.id,'reopened',null,'New unresolved attendance evidence');
 end if;
 return c.id;
end $$;

alter function public.submit_public_attendance(uuid,uuid,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,timestamptz,jsonb,text,boolean) rename to submit_public_attendance_device_base;
create function public.submit_public_attendance(p_token uuid,p_request uuid,p_device text,p_ip text,p_agent text,p_hash text,p_school_id text,p_name text,p_institution text,p_class text,p_checkpoint text,p_lat double precision,p_lon double precision,p_accuracy double precision,p_captured timestamptz,p_signature jsonb,p_privacy_version text,p_consent boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;candidate record;
begin
 result:=public.submit_public_attendance_device_base(p_token,p_request,p_device,p_ip,p_agent,p_hash,p_school_id,p_name,p_institution,p_class,p_checkpoint,p_lat,p_lon,p_accuracy,p_captured,p_signature,p_privacy_version,p_consent);
 if (result->>'status_code')::int=202 or result->'body'->'error'->>'code'='already_submitted' then
  for candidate in select submission_id from public.public_attendance_requests where request_id=p_request and submission_id is not null union select b.submission_id from public.participant_incident_submissions b join public.participant_device_incidents i on i.id=b.incident_id where i.state='open' and i.candidate_device=p_device loop
   perform app_private.enqueue_attendance_review(candidate.submission_id);
  end loop;
 end if;return result;
end $$;

create function app_private.can_read_attendance_case(p_actor uuid,p_case uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select app_private.operational_capable(p_actor,'cases.evidence') and exists(select 1 from public.attendance_review_cases c join public.operational_accounts a on a.user_id=p_actor where c.id=p_case and (a.role='administrator' or (c.owner_id=p_actor and app_private.attendance_review_owner(c.submission_id,c.level)=p_actor)));
$$;

create function public.list_attendance_review_cases(p_actor uuid,p_page integer default 1,p_search text default '',p_state text default 'open',p_risk text default 'all') returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'attendance.review') or p_page is null or p_page not between 1 and 100000 or length(coalesce(p_search,''))>100 or p_state not in ('open','approved','rejected') or p_risk not in ('all','unflagged','flagged') then raise exception using errcode='42501',message='Review access or query is invalid';end if;
 return (with filtered as(select c.id,c.version,c.level,c.state,c.due_at,c.owner_id,s.submitted_name,s.school_id,s.event_id,e.name event_name,s.checkpoint_label,s.review_reasons,
 exists(select 1 from public.participant_incident_submissions b join public.participant_device_incidents i on i.id=b.incident_id where b.submission_id=s.id and i.state='open') as device_pending
 from public.attendance_review_cases c join public.public_attendance_submissions s on s.id=c.submission_id join public.events e on e.id=s.event_id
 where c.state=p_state and app_private.can_read_attendance_case(p_actor,c.id) and (s.submitted_name ilike '%'||p_search||'%' or s.school_id ilike '%'||p_search||'%')),
 selected as(select * from filtered where p_risk='all' or (p_risk='unflagged')=(review_reasons<@array['review_workflow_required']::text[] and not device_pending))
 select jsonb_build_object('total',(select count(*) from selected),'page',p_page,'page_size',10,'items',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from selected order by due_at nulls last,id limit 10 offset (p_page-1)*10) x),'[]'::jsonb)));
end $$;

create function public.get_attendance_review_case(p_actor uuid,p_case uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare c public.attendance_review_cases;
begin
 if not app_private.can_read_attendance_case(p_actor,p_case) then raise exception using errcode='42501',message='This attendance case is not assigned to you';end if;
 select * into strict c from public.attendance_review_cases where id=p_case;
 return jsonb_build_object('case',to_jsonb(c),'can_decide',c.state='open' and c.owner_id=p_actor and app_private.attendance_review_owner(c.submission_id,c.level)=p_actor and app_private.operational_capable(p_actor,'attendance.review'),
 'submission',(select to_jsonb(s) from public.public_attendance_submissions s where id=c.submission_id),
 'signature',(select strokes from public.public_attendance_signatures where submission_id=c.submission_id),
 'device_incidents',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'kind',i.kind,'state',i.state)) from public.participant_device_incidents i join public.participant_incident_submissions b on b.incident_id=i.id where b.submission_id=c.submission_id),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(to_jsonb(h) order by version) from public.attendance_review_history h where case_id=c.id),'[]'::jsonb));
end $$;

create function public.decide_attendance_review(p_actor uuid,p_case uuid,p_version integer,p_action text,p_reason text,p_confirm boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.attendance_review_cases;s public.public_attendance_submissions;owner uuid;next_level integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 perform pg_advisory_xact_lock(hashtextextended('participant-device-security',0));
 select * into c from public.attendance_review_cases where id=p_case for update;
 if not found or c.state<>'open' or c.version is distinct from p_version then raise exception using errcode='40001',message='Attendance case changed. Reload before deciding';end if;
 if not app_private.can_read_attendance_case(p_actor,p_case) or not app_private.operational_capable(p_actor,'attendance.review') or c.owner_id<>p_actor or app_private.attendance_review_owner(c.submission_id,c.level) is distinct from p_actor then raise exception using errcode='42501',message='Only the current assigned reviewer can decide this case';end if;
 if p_action is null or p_action not in ('approve','reject','escalate') or p_confirm is distinct from true or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='Confirm verification and provide a decision reason';end if;
 select * into strict s from public.public_attendance_submissions where id=c.submission_id for update;
 if p_action='escalate' then
  next_level:=c.level+1;while next_level<=3 loop owner:=app_private.attendance_review_owner(s.id,next_level);exit when owner is not null;next_level:=next_level+1;end loop;
  if owner is null then raise exception using errcode='22023',message='This case is already at the final available review level';end if;
  update public.attendance_review_cases set level=next_level,owner_id=owner,entered_at=clock_timestamp(),due_at=case when next_level<3 then clock_timestamp()+interval '1 hour' end,version=version+1 where id=c.id;
 else
  if p_action='approve' then
   if exists(select 1 from public.participant_incident_submissions b join public.participant_device_incidents i on i.id=b.incident_id where b.submission_id=s.id and i.state='open') then raise exception using errcode='22023',message='Resolve the open device incidents before approving attendance';end if;
   if not(s.review_reasons<@array['review_workflow_required']::text[]) and not exists(select 1 from public.operational_accounts where user_id=p_actor and role='administrator' and enabled) then raise exception using errcode='42501',message='Identity exceptions require administrator verification; escalate this case';end if;
  end if;
  update public.public_attendance_submissions set status=case p_action when 'approve' then 'approved' else 'rejected' end where id=s.id;
  update public.attendance_review_cases set state=case p_action when 'approve' then 'approved' else 'rejected' end,version=version+1,decided_at=clock_timestamp(),decided_by=p_actor,decision_reason=p_reason where id=c.id;
 end if;
 perform app_private.write_attendance_review_transition(c.id,p_action,p_actor,p_reason);
 if p_action='escalate' then return jsonb_build_object('id',c.id,'action','escalated');end if;
 return public.get_attendance_review_case(p_actor,c.id);
end $$;

create function public.process_attendance_review_queue(p_limit integer default 100) returns jsonb language plpgsql security invoker set search_path='' as $$
declare row record;c public.attendance_review_cases;owner uuid;n integer;processed_count integer:=0;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception using errcode='22023',message='Invalid worker batch size';end if;
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 perform pg_advisory_xact_lock(hashtextextended('participant-device-security',0));
 for row in select s.id from public.public_attendance_submissions s left join public.attendance_review_cases queued on queued.submission_id=s.id where s.status='pending_review' and (queued.id is null or queued.state<>'open') order by s.created_at limit p_limit loop perform app_private.enqueue_attendance_review(row.id);end loop;
 for c in select * from public.attendance_review_cases where state='open' and ((level<3 and due_at<=clock_timestamp()) or app_private.attendance_review_owner(submission_id,level) is distinct from owner_id) order by due_at nulls last,id limit p_limit for update skip locked loop
  owner:=app_private.attendance_review_owner(c.submission_id,c.level);
  if c.level<3 and (c.due_at<=clock_timestamp() or owner is null) then
   n:=c.level+1;while n<=3 loop owner:=app_private.attendance_review_owner(c.submission_id,n);exit when owner is not null;n:=n+1;end loop;
   if owner is not null then update public.attendance_review_cases set level=n,owner_id=owner,entered_at=clock_timestamp(),due_at=case when n<3 then clock_timestamp()+interval '1 hour' end,version=version+1 where id=c.id;perform app_private.write_attendance_review_transition(c.id,'auto_escalated',null,'One-hour deadline elapsed or assigned reviewer unavailable');processed_count:=processed_count+1;end if;
  elsif owner is not null and owner<>c.owner_id then
   update public.attendance_review_cases set owner_id=owner,version=version+1 where id=c.id;perform app_private.write_attendance_review_transition(c.id,'reassigned',null,'Current same-level assignment changed; original deadline retained');processed_count:=processed_count+1;
  end if;
 end loop;
 update public.attendance_review_worker_health set last_success_at=clock_timestamp(),processed=processed_count where id=true;
 return jsonb_build_object('processed',processed_count,'last_success_at',clock_timestamp());
end $$;

create function public.attendance_review_notifications(p_actor uuid,p_page integer default 1) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'attendance.review') or p_page is null or p_page not between 1 and 100000 then raise exception using errcode='42501',message='Review notifications unavailable';end if;
 return jsonb_build_object('unread',(select count(*) from public.attendance_review_notifications where recipient_id=p_actor and read_at is null and resolved_at is null),'items',coalesce((select jsonb_agg(to_jsonb(x)) from(select n.id,n.case_id,n.created_at,n.read_at,n.resolved_at,c.state as case_state from public.attendance_review_notifications n join public.attendance_review_cases c on c.id=n.case_id where n.recipient_id=p_actor order by n.created_at desc,n.id limit 10 offset (p_page-1)*10) x),'[]'::jsonb));
end $$;
create function public.read_attendance_review_notification(p_actor uuid,p_notification uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'attendance.review') then raise exception using errcode='42501',message='Review access unavailable';end if;
 update public.attendance_review_notifications set read_at=coalesce(read_at,clock_timestamp()) where id=p_notification and recipient_id=p_actor;
end $$;

-- Publishing must have a usable final fallback. Existing printed links remain stable.
alter function public.save_event_public_link(uuid,uuid,integer,boolean,boolean,text,text) rename to save_event_public_link_review_base;
create function public.save_event_public_link(p_actor uuid,p_event uuid,p_version integer,p_enabled boolean,p_replace boolean,p_confirmation text,p_reason text) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 if p_enabled and not exists(select 1 from public.operational_accounts where role='administrator' and enabled and app_private.operational_capable(user_id,'attendance.review')) then raise exception using errcode='22023',message='An active administrator review fallback is required before publishing';end if;
 return public.save_event_public_link_review_base(p_actor,p_event,p_version,p_enabled,p_replace,p_confirmation,p_reason);
end $$;

create function public.attendance_review_health(p_actor uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.operational_accounts where user_id=p_actor and role='administrator' and enabled) or not app_private.operational_capable(p_actor,'attendance.review') then raise exception using errcode='42501',message='Administrator monitoring required';end if;
 return (select to_jsonb(h)||jsonb_build_object('overdue',(select count(*) from public.attendance_review_cases where state='open' and level<3 and due_at<=now()),'unassigned',(select count(*) from public.attendance_review_cases where state='open' and app_private.attendance_review_owner(submission_id,level) is null),'unqueued',(select count(*) from public.public_attendance_submissions s left join public.attendance_review_cases c on c.submission_id=s.id where s.status='pending_review' and (c.id is null or c.state<>'open'))) from public.attendance_review_worker_health h where id=true);
end $$;

alter table public.public_attendance_submissions add column attendance_source text not null default 'public_form' check(attendance_source in ('public_form','manual'));
alter table public.public_attendance_submissions add column manual_actor uuid references auth.users(id),add column manual_reason text,add column manual_request_id uuid unique;
create index attendance_manual_actor_idx on public.public_attendance_submissions(manual_actor);
alter table public.public_attendance_submissions alter column latitude drop not null,alter column longitude drop not null,alter column accuracy_meters drop not null,alter column location_captured_at drop not null,alter column distance_from_venue_meters drop not null,alter column privacy_accepted_at drop not null;
alter table public.public_attendance_submissions add constraint attendance_evidence_source_check check(
 (attendance_source='public_form' and latitude is not null and longitude is not null and accuracy_meters is not null and location_captured_at is not null and distance_from_venue_meters is not null and privacy_accepted_at is not null and manual_actor is null and manual_request_id is null)
 or (attendance_source='manual' and latitude is null and longitude is null and accuracy_meters is null and location_captured_at is null and distance_from_venue_meters is null and privacy_accepted_at is null and manual_actor is not null and manual_request_id is not null and length(manual_reason) between 3 and 500));
-- A manual record is never a qualifying public-device binding, including duplicate browser claims.
alter function app_private.verify_participant_device(uuid,text,text,jsonb,text) rename to verify_participant_device_form_base;
create function app_private.verify_participant_device(p_request uuid,p_name text,p_institution text,p_signature jsonb,p_agent text) returns void language plpgsql security invoker set search_path='' as $$
declare incident record;ignored uuid;
begin
 if exists(select 1 from public.participant_device_observations where request_id=p_request) then return;end if;
 if exists(select 1 from public.public_attendance_requests r join public.public_attendance_submissions s on s.event_id=r.event_id and s.checkpoint_key=r.checkpoint_key and s.school_id=r.school_id where r.request_id=p_request and s.attendance_source='manual') then return;end if;
 perform app_private.verify_participant_device_form_base(p_request,p_name,p_institution,p_signature,p_agent);
 for incident in select i.*,o.submission_id observed_submission from public.participant_device_observations o join public.participant_device_incidents i on i.student_id=o.student_id and i.candidate_device=o.device_hash and i.state='open' where o.request_id=p_request loop
  ignored:=app_private.record_participant_device_incident(incident.student_id,incident.kind,incident.candidate_device,incident.binding_id,incident.observed_submission);
 end loop;
end $$;
update public.operational_features set available=true where key='attendance.manual';
create function public.manual_attendance_candidates(p_actor uuid,p_event uuid,p_search text) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'attendance.manual','event',p_event::text) or not exists(select 1 from public.operational_accounts where user_id=p_actor and role in ('col_regular','col_admin','administrator') and enabled) then raise exception using errcode='42501',message='Manual attendance access required';end if;
 if length(btrim(coalesce(p_search,''))) not between 2 and 100 then raise exception using errcode='22023',message='Enter at least two characters';end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from(select distinct r.student_id,r.school_id,r.full_name from public.event_eligibility_heads h join public.event_eligibility_rosters er on er.eligibility_id=h.eligibility_id join public.class_roster_entries r on r.version_id=er.roster_version_id join public.students s on s.id=r.student_id where h.event_id=p_event and s.archived_at is null and (r.school_id ilike '%'||p_search||'%' or r.full_name ilike '%'||p_search||'%') order by r.school_id limit 10) x),'[]'::jsonb);
end $$;
create function public.record_manual_attendance(p_actor uuid,p_request uuid,p_event uuid,p_checkpoint text,p_student uuid,p_reason text,p_confirm boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.events;c jsonb;entry record;s public.public_attendance_submissions;eligibility uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 if not app_private.operational_capable(p_actor,'attendance.manual','event',p_event::text) or not exists(select 1 from public.operational_accounts where user_id=p_actor and role in ('col_regular','col_admin','administrator') and enabled) then raise exception using errcode='42501',message='Manual attendance access required';end if;
 if p_request is null or p_confirm is distinct from true or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='Confirm a documented manual attendance exception';end if;
 select * into s from public.public_attendance_submissions where manual_request_id=p_request;
 if found then
  if (s.manual_actor,s.event_id,s.checkpoint_key,s.student_id,s.manual_reason) is distinct from (p_actor,p_event,p_checkpoint,p_student,p_reason) then raise exception using errcode='40001',message='Manual request identifier already used';end if;
  return jsonb_build_object('submission_id',s.id,'status',s.status);
 end if;
 select * into e from public.events where id=p_event and archived_at is null for update;
 if not found then raise exception using errcode='22023',message='Event is unavailable';end if;
 select value into c from jsonb_array_elements(e.checkpoints) where value->>'key'=p_checkpoint;
 if c is null or clock_timestamp()<coalesce((c->>'opens_at')::timestamptz,e.starts_at-interval '1 hour') or clock_timestamp()>=coalesce((c->>'closes_at')::timestamptz,e.ends_at) then raise exception using errcode='22023',message='Manual attendance requires an active checkpoint';end if;
 select eligibility_id into eligibility from public.event_eligibility_heads where event_id=e.id;
 select r.*,v.section_snapshot into entry from public.event_eligibility_rosters er join public.class_roster_versions v on v.id=er.roster_version_id join public.class_roster_entries r on r.version_id=v.id join public.students st on st.id=r.student_id where er.eligibility_id=eligibility and r.student_id=p_student and st.archived_at is null order by er.section_id limit 1;
 if not found then raise exception using errcode='22023',message='Select a participant on the frozen official event list';end if;
 perform pg_advisory_xact_lock(hashtextextended('participant-device-security',0));
 if exists(select 1 from public.public_attendance_submissions where event_id=e.id and checkpoint_key=p_checkpoint and school_id=entry.school_id) or exists(select 1 from public.attendance_logs where event_id=e.id and checkpoint_key=p_checkpoint and student_id=p_student) then raise exception using errcode='23505',message='Attendance is already submitted for this checkpoint';end if;
 insert into public.public_attendance_submissions(event_id,checkpoint_key,checkpoint_label,school_id,submitted_name,institution,class_label,student_id,eligibility_id,review_reasons,device_hash,ip_hash,user_agent,event_snapshot,privacy_version,privacy_accepted_at,attendance_source,manual_actor,manual_reason,manual_request_id)
 values(e.id,p_checkpoint,c->>'label',entry.school_id,entry.full_name,entry.section_snapshot->>'institution',entry.section_snapshot->>'name',p_student,eligibility,array['manual_exception'],'not_collected','not_collected','Manual staff exception',jsonb_build_object('name',e.name,'latitude',e.latitude,'longitude',e.longitude,'radius_meters',e.radius_meters,'starts_at',e.starts_at,'ends_at',e.ends_at),'staff-authorized-manual-v1',null,'manual',p_actor,p_reason,p_request) returning * into s;
 insert into public.public_submission_rosters(submission_id,section_id,roster_version_id) select s.id,er.section_id,er.roster_version_id from public.event_eligibility_rosters er join public.class_roster_entries r on r.version_id=er.roster_version_id where er.eligibility_id=eligibility and r.student_id=p_student;
 perform app_private.enqueue_attendance_review(s.id);
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'attendance.manual_requested','public_attendance_submission',s.id::text,jsonb_build_object('reason',p_reason));
 return jsonb_build_object('submission_id',s.id,'status','pending_review');
end $$;
create function public.bulk_approve_attendance_reviews(p_actor uuid,p_items jsonb,p_reason text,p_confirm boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb;c public.attendance_review_cases;s public.public_attendance_submissions;n integer:=0;
begin
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 or (select count(distinct value->>'id') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception using errcode='22023',message='Select 1 to 50 distinct cases';end if;
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));perform pg_advisory_xact_lock(hashtextextended('participant-device-security',0));
 for item in select value from jsonb_array_elements(p_items) order by value->>'id' loop
  select * into c from public.attendance_review_cases where id=(item->>'id')::uuid for update;
  select * into s from public.public_attendance_submissions where id=c.submission_id;
  if not found or not(s.review_reasons<@array['review_workflow_required']::text[]) or exists(select 1 from public.participant_incident_submissions b join public.participant_device_incidents i on i.id=b.incident_id where b.submission_id=s.id and i.state='open') then raise exception using errcode='22023',message='Bulk approval permits only unflagged verified public forms';end if;
  perform public.decide_attendance_review(p_actor,c.id,(item->>'version')::integer,'approve',p_reason,p_confirm);n:=n+1;
 end loop;return jsonb_build_object('approved',n);
end $$;
create trigger immutable_attendance_review_history before update or delete on public.attendance_review_history for each row execute function app_private.immutable_participant_device_evidence();

create function public.manual_attendance_context(p_actor uuid,p_event uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'attendance.manual','event',p_event::text) or not exists(select 1 from public.operational_accounts where user_id=p_actor and role in ('col_regular','col_admin','administrator') and enabled) then raise exception using errcode='42501',message='Manual attendance access required';end if;
 return (select jsonb_build_object('id',e.id,'name',e.name,'server_time',now(),'checkpoints',(select jsonb_agg(jsonb_build_object('key',c->>'key','label',c->>'label','opens_at',coalesce((c->>'opens_at')::timestamptz,e.starts_at-interval '1 hour'),'closes_at',coalesce((c->>'closes_at')::timestamptz,e.ends_at))) from jsonb_array_elements(e.checkpoints) x(c))) from public.events e where e.id=p_event and e.archived_at is null);
end $$;
do $$ declare t text;f record;begin
 foreach t in array array['attendance_review_cases','attendance_review_history','attendance_review_notifications','attendance_review_worker_health'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select,insert,update,delete on public.%I to service_role',t);end loop;
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('manual_attendance_context','manual_attendance_candidates','record_manual_attendance','bulk_approve_attendance_reviews','verify_participant_device','verify_participant_device_form_base','attendance_review_health','attendance_review_owner','write_attendance_review_transition','enqueue_attendance_review','submit_public_attendance','submit_public_attendance_device_base','can_read_attendance_case','list_attendance_review_cases','get_attendance_review_case','decide_attendance_review','process_attendance_review_queue','attendance_review_notifications','read_attendance_review_notification','save_event_public_link','save_event_public_link_review_base') loop execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.nspname,f.proname,f.args);execute format('grant execute on function %I.%I(%s) to service_role',f.nspname,f.proname,f.args);end loop;
end $$;
