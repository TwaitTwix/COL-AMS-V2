-- Phase 8: immutable, scoped report datasets. Legacy reports remain separate.
alter table public.attendance_review_cases add column decided_role text;
create function app_private.capture_review_decision_role() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at then
  new.decided_role:=(select role from public.operational_accounts where user_id=new.decided_by);
 end if;return new;
end $$;
create trigger capture_review_decision_role before update on public.attendance_review_cases for each row execute function app_private.capture_review_decision_role();
create table public.operational_report_jobs(
 id uuid primary key default gen_random_uuid(),requested_by uuid not null references public.operational_accounts(user_id),request_id uuid not null,
 event_id uuid not null references public.events(id),format text not null check(format in ('preview','csv','xlsx','pdf','docx')),
 include_signatures boolean not null default false,section_ids uuid[] not null,full_event boolean not null,
 dataset jsonb not null,status text not null check(status in ('queued','processing','completed','failed')),
 claim_id uuid,started_at timestamptz,created_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
 file_path text,preview_path text,error text,unique(requested_by,request_id)
);
create index operational_report_queue_idx on public.operational_report_jobs(created_at,id) where status in ('queued','processing');
create index operational_report_owner_idx on public.operational_report_jobs(requested_by,created_at desc);
alter table public.operational_report_jobs enable row level security;
revoke all on public.operational_report_jobs from public,anon,authenticated;
grant select,insert,update on public.operational_report_jobs to service_role;
update public.operational_features set available=true where key in ('reports.view','reports.export');
create function app_private.report_allowed(p_actor uuid,p_event uuid,p_feature text,p_section uuid default null) returns boolean language sql stable security invoker set search_path='' as $$
 select app_private.operational_capable(p_actor,p_feature,'event',p_event::text) or (p_section is not null and app_private.operational_capable(p_actor,p_feature,'section',p_section::text));
$$;
create function public.create_operational_report(p_actor uuid,p_request uuid,p_event uuid,p_format text,p_signatures boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.operational_report_jobs;sections uuid[];full_access boolean;eligibility uuid;e public.events;rows jsonb;totals jsonb;groups jsonb;f text;stamp timestamptz:=statement_timestamp();
begin
 perform pg_advisory_xact_lock(hashtextextended('report-request:'||p_actor::text,0));
 if p_request is null or p_format not in ('preview','csv','xlsx','pdf','docx') or p_signatures is null then raise exception using errcode='22023',message='Invalid report request';end if;
 f:=case when p_format='preview' then 'reports.view' else 'reports.export' end;
 if not app_private.operational_capable(p_actor,'reports.view') or not app_private.operational_capable(p_actor,f) then raise exception using errcode='42501',message='Report access required';end if;
 if p_signatures and not exists(select 1 from public.operational_accounts where user_id=p_actor and role='administrator' and enabled) then raise exception using errcode='42501',message='Only administrators can include signature evidence';end if;
 select * into e from public.events where id=p_event for share;
 if not found then raise exception using errcode='22023',message='Event not found';end if;
 full_access:=app_private.report_allowed(p_actor,p_event,'reports.view') and app_private.report_allowed(p_actor,p_event,f);
 select eligibility_id into eligibility from public.event_eligibility_heads where event_id=p_event;
 select coalesce(array_agg(r.section_id order by r.section_id),'{}'::uuid[]) into sections from public.event_eligibility_rosters r where r.eligibility_id=eligibility and app_private.report_allowed(p_actor,p_event,'reports.view',r.section_id) and app_private.report_allowed(p_actor,p_event,f,r.section_id);
 if not full_access and cardinality(sections)=0 then raise exception using errcode='42501',message='No assigned classes are available for this report';end if;
 select * into j from public.operational_report_jobs where requested_by=p_actor and request_id=p_request;
 if found then
  if (j.event_id,j.format,j.include_signatures) is distinct from (p_event,p_format,p_signatures) then raise exception using errcode='40001',message='Report request identifier already used';end if;
  return jsonb_build_object('job_id',j.id,'status',j.status);
 end if;
 if p_format<>'preview' and (select count(*) from public.operational_report_jobs where requested_by=p_actor and (status='queued' or (status='processing' and started_at>clock_timestamp()-interval '6 minutes')))>=3 then raise exception using errcode='22023',message='Wait for your existing exports to finish before creating another';end if;
 -- One statement snapshot for submissions, official participants and aggregates.
 with roster as (
  select distinct on (re.school_id) re.school_id,re.full_name,v.section_snapshot,r.section_id from public.event_eligibility_rosters r join public.class_roster_versions v on v.id=r.roster_version_id join public.class_roster_entries re on re.version_id=v.id where r.eligibility_id=eligibility and r.section_id=any(sections) order by re.school_id,r.section_id
 ), attendance as (
  select s.*,c.decided_by,c.decided_at,c.decided_role,c.state review_state,coalesce(o.full_name,up.full_name) reviewer_name,
   ro.full_name official_name,ro.section_snapshot,ro.school_id official_id,
   case when p_signatures then sig.strokes end signature
  from public.public_attendance_submissions s left join roster ro on ro.school_id=s.school_id
  left join public.attendance_review_cases c on c.submission_id=s.id left join public.operational_accounts o on o.user_id=c.decided_by left join public.user_profiles up on up.user_id=c.decided_by
  left join public.public_attendance_signatures sig on sig.submission_id=s.id
  where s.event_id=p_event and (full_access or exists(select 1 from public.public_submission_rosters sr where sr.submission_id=s.id and sr.section_id=any(sections)))
 ), row_data as (
  select jsonb_build_object('submission_id',s.id,'school_id',s.school_id,'participant_name',coalesce(s.official_name,s.submitted_name),'submitted_name',s.submitted_name,'participant_type','Account-free participant','institution',coalesce(s.section_snapshot->>'institution',s.institution),'college',coalesce(s.section_snapshot->>'college','Exception / no official class'),'course',coalesce(s.section_snapshot->>'course',''),'class_name',coalesce(s.section_snapshot->>'name',s.class_label),'official_roster_match',s.official_id is not null,'checkpoint_key',s.checkpoint_key,'checkpoint',s.checkpoint_label,'status',s.status,'source',s.attendance_source,'submitted_at',s.created_at,'distance_meters',case when p_signatures then s.distance_from_venue_meters end,'distance_restricted',not p_signatures and s.attendance_source<>'manual','flags',to_jsonb(s.review_reasons),'resolution',coalesce(s.review_state,case when s.status='approved' then 'automatic_approval' else s.status end),'reviewer_name',s.reviewer_name,'reviewer_role',case when s.decided_by is not null then coalesce(s.decided_role,'Historical role unavailable') when s.status='approved' then 'System / automatic' else null end,'decided_at',s.decided_at,'signature_collected',exists(select 1 from public.public_attendance_signatures z where z.submission_id=s.id),'signature',s.signature) item,s.created_at,s.id from attendance s
 ), denominator as (
  select ro.school_id,ro.section_snapshot,c->>'key' checkpoint_key,c->>'label' checkpoint from roster ro cross join jsonb_array_elements(e.checkpoints) c
 ), grouped as (
  select d.section_snapshot->>'institution' institution,d.section_snapshot->>'college' college,d.section_snapshot->>'course' course,d.checkpoint_key,d.checkpoint,count(*) eligible,count(*) filter(where exists(select 1 from attendance a where a.school_id=d.school_id and a.checkpoint_key=d.checkpoint_key and a.status='approved')) approved from denominator d group by 1,2,3,4,5
 )
 select coalesce((select jsonb_agg(item order by created_at,id) from row_data),'[]'::jsonb),jsonb_build_object('eligible_participants',(select count(*) from roster),'eligible_checkpoint_slots',(select count(*) from denominator),'approved_eligible_slots',(select coalesce(sum(approved),0) from grouped),'submissions',(select count(*) from attendance),'approved',(select count(*) from attendance where status='approved'),'pending_review',(select count(*) from attendance where status='pending_review'),'rejected',(select count(*) from attendance where status='rejected'),'approved_exceptions',(select count(*) from attendance where status='approved' and official_id is null)),coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('percentage',case when eligible>0 then round(100.0*approved/eligible,2) end) order by institution,college,course,checkpoint_key) from grouped g),'[]'::jsonb) into rows,totals,groups;
 if jsonb_array_length(rows)>5000 or (p_signatures and jsonb_array_length(rows)>200) then raise exception using errcode='22023',message='Report exceeds the supported limit (5000 records, or 200 with signatures)';end if;
 insert into public.operational_report_jobs(requested_by,request_id,event_id,format,include_signatures,section_ids,full_event,dataset,status,completed_at)
 values(p_actor,p_request,p_event,p_format,p_signatures,sections,full_access,jsonb_build_object('schema_version',1,'generated_at',stamp,'event',jsonb_build_object('id',e.id,'name',e.name,'starts_at',e.starts_at,'ends_at',e.ends_at,'checkpoints',e.checkpoints),'eligibility_id',eligibility,'scope',case when full_access then 'Event-wide' else 'Assigned classes only' end,'totals',totals,'groups',groups,'rows',rows,'includes_signatures',p_signatures),case when p_format='preview' then 'completed' else 'queued' end,case when p_format='preview' then stamp end) returning * into j;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'report.snapshot_created','operational_report',j.id::text,jsonb_build_object('event_id',p_event,'format',p_format,'records',jsonb_array_length(rows),'includes_signatures',p_signatures));
 return jsonb_build_object('job_id',j.id,'status',j.status);
end $$;
create function app_private.authorize_report(p_actor uuid,p_job uuid,p_export boolean default false) returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce((select j.requested_by=p_actor and app_private.operational_capable(p_actor,'reports.view') and (not p_export or (j.format<>'preview' and app_private.operational_capable(p_actor,'reports.export'))) and (not j.include_signatures or exists(select 1 from public.operational_accounts where user_id=p_actor and role='administrator' and enabled)) and (not j.full_event or app_private.report_allowed(p_actor,j.event_id,'reports.view')) and (not p_export or not j.full_event or app_private.report_allowed(p_actor,j.event_id,'reports.export')) and not exists(select 1 from unnest(j.section_ids) s where not app_private.report_allowed(p_actor,j.event_id,'reports.view',s) or (p_export and not app_private.report_allowed(p_actor,j.event_id,'reports.export',s))) from public.operational_report_jobs j where j.id=p_job),false);
$$;
create function public.get_operational_report(p_actor uuid,p_job uuid,p_page integer default 1,p_export boolean default false) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare j public.operational_report_jobs;items jsonb;
begin
 if p_page not between 1 and 100000 then raise exception using errcode='22023',message='Invalid report page';end if;
 if not app_private.authorize_report(p_actor,p_job,p_export) then raise exception using errcode='42501',message='Report not found or current access no longer permits it';end if;
 select * into strict j from public.operational_report_jobs where id=p_job;
 select coalesce(jsonb_agg(r),'[]'::jsonb) into items from(select r from jsonb_array_elements(j.dataset->'rows') with ordinality x(r,n) where n>(p_page-1)*10 and n<=p_page*10 order by n) x;
 return jsonb_build_object('job_id',j.id,'status',j.status,'format',j.format,'error',j.error,'created_at',j.created_at,'page',p_page,'page_size',10,'total',jsonb_array_length(j.dataset->'rows'),'items',items,'summary',j.dataset-'rows','file_path',case when p_export then j.file_path end,'preview_path',case when p_export then j.preview_path end);
end $$;
-- Leases fence stale workers: every attempt uploads to its own unique object prefix.
create function public.claim_operational_report(p_job uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.operational_report_jobs;
begin
 select * into j from public.operational_report_jobs where id=p_job for update;
 if not found or j.format='preview' or j.status in ('completed','failed') or (j.status='processing' and j.started_at>clock_timestamp()-interval '6 minutes') then return null;end if;
 if not app_private.authorize_report(j.requested_by,j.id,true) then update public.operational_report_jobs set status='failed',error='Report access changed. Create a new report.',completed_at=clock_timestamp() where id=j.id;return null;end if;
 update public.operational_report_jobs set status='processing',claim_id=gen_random_uuid(),started_at=clock_timestamp(),error=null where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'claim_id',j.claim_id,'format',j.format,'dataset',j.dataset);
end $$;
create function public.finish_operational_report(p_job uuid,p_claim uuid,p_ok boolean) returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.operational_report_jobs;prefix text;
begin
 select * into j from public.operational_report_jobs where id=p_job and claim_id=p_claim and status='processing' for update;
 if not found then return false;end if;
 prefix:='revision/'||j.id::text||'/'||j.claim_id::text;
 update public.operational_report_jobs set status=case when p_ok then 'completed' else 'failed' end,completed_at=clock_timestamp(),file_path=case when p_ok then prefix||'.'||j.format end,preview_path=case when p_ok then prefix||case when j.format='pdf' then '.pdf' else '.preview.pdf' end end,error=case when not p_ok then 'Report generation failed. Retry with a new report.' end where id=j.id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(j.requested_by,case when p_ok then 'report.generated' else 'report.failed' end,'operational_report',j.id::text,jsonb_build_object('event_id',j.event_id,'format',j.format));
 return true;
end $$;
do $$ declare f record;begin
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('capture_review_decision_role','report_allowed','authorize_report','create_operational_report','get_operational_report','claim_operational_report','finish_operational_report') loop execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.nspname,f.proname,f.args);execute format('grant execute on function %I.%I(%s) to service_role',f.nspname,f.proname,f.args);end loop;
end $$;

create function public.operational_attendance_rates(p_actor uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not app_private.operational_capable(p_actor,'reports.view') then raise exception using errcode='42501',message='Report access required';end if;
 with roster as (
  select distinct on(e.id,re.school_id) e.id event_id,re.school_id,v.section_snapshot,e.checkpoints from public.events e join public.event_eligibility_heads h on h.event_id=e.id join public.event_eligibility_rosters r on r.eligibility_id=h.eligibility_id join public.class_roster_versions v on v.id=r.roster_version_id join public.class_roster_entries re on re.version_id=v.id
  where e.archived_at is null and now()>=e.starts_at-interval '1 hour' and now()<e.ends_at and app_private.report_allowed(p_actor,e.id,'reports.view',r.section_id) order by e.id,re.school_id,r.section_id
 ), slots as (
  select r.*,c->>'key' checkpoint from roster r cross join jsonb_array_elements(r.checkpoints) c
 ), grouped as (
  select section_snapshot->>'institution' institution,section_snapshot->>'college' college,count(*) eligible,count(*) filter(where exists(select 1 from public.public_attendance_submissions s where s.event_id=d.event_id and s.school_id=d.school_id and s.checkpoint_key=d.checkpoint and s.status='approved')) approved from slots d group by 1,2
 ) select jsonb_build_object('as_of',statement_timestamp(),'basis','Current and opening events; unique official school IDs per event/checkpoint; approved matched records only; all scheduled checkpoints included.','groups',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('percentage',round(100.0*approved/nullif(eligible,0),2)) order by institution,college) from grouped g),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.operational_attendance_rates(uuid) from public,anon,authenticated;
grant execute on function public.operational_attendance_rates(uuid) to service_role;

create function app_private.freeze_operational_report_snapshot() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.id,new.requested_by,new.request_id,new.event_id,new.format,new.include_signatures,new.section_ids,new.full_event,new.dataset,new.created_at) is distinct from (old.id,old.requested_by,old.request_id,old.event_id,old.format,old.include_signatures,old.section_ids,old.full_event,old.dataset,old.created_at) then raise exception using errcode='22023',message='Report snapshot content is immutable';end if;return new;
end $$;
create trigger freeze_operational_report_snapshot before update on public.operational_report_jobs for each row execute function app_private.freeze_operational_report_snapshot();
revoke all on function app_private.freeze_operational_report_snapshot() from public,anon,authenticated;
grant execute on function app_private.freeze_operational_report_snapshot() to service_role;

create function public.list_operational_report_events(p_actor uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'reports.view') then raise exception using errcode='42501',message='Report access required';end if;
 return jsonb_build_object('events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'starts_at',e.starts_at,'ends_at',e.ends_at,'archived',e.archived_at is not null) order by e.starts_at desc,e.id) from public.events e where app_private.report_allowed(p_actor,e.id,'reports.view') or exists(select 1 from public.event_eligibility_heads h join public.event_eligibility_rosters r on r.eligibility_id=h.eligibility_id where h.event_id=e.id and app_private.report_allowed(p_actor,e.id,'reports.view',r.section_id))),'[]'::jsonb));
end $$;
revoke all on function public.list_operational_report_events(uuid) from public,anon,authenticated;
grant execute on function public.list_operational_report_events(uuid) to service_role;
