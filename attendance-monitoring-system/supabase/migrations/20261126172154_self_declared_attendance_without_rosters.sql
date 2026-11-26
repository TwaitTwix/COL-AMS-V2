-- Official rosters are optional; unmatched identities remain pending administrator review.
alter table public.public_attendance_submissions add column declared_college text not null default '' check(length(declared_college)<=100),add column declared_course text not null default '' check(length(declared_course)<=150);
create or replace function public.save_event_public_link_review_base(p_actor uuid,p_event uuid,p_version integer,p_enabled boolean,p_replace boolean,p_confirmation text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.event_public_links;e public.events;empty_eligibility uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 if not app_private.operational_capable(p_actor,'events.manage','event',p_event::text) then raise exception using errcode='42501',message='Event management is outside your access';end if;
 select * into e from public.events where id=p_event for update;
 if not found or (p_enabled and (e.archived_at is not null or e.ends_at<=now())) or p_enabled is null or p_replace is null or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='Choose an available event and provide a decision reason';end if;
 if p_enabled and not exists(select 1 from public.event_eligibility_heads where event_id=p_event) then
  insert into public.event_eligibility_versions(event_id,revision,created_by,reason) values(p_event,1,p_actor,'No official class list: self-declared attendance requires review') returning id into empty_eligibility;
  insert into public.event_eligibility_heads(event_id,eligibility_id) values(p_event,empty_eligibility);
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'event.self_declared_attendance_enabled','event',p_event::text,jsonb_build_object('eligibility_id',empty_eligibility,'official_rosters',0));
 end if;
 if p_replace and (p_confirmation is distinct from 'REPLACE LINK' or not exists(select 1 from public.operational_accounts where user_id=p_actor and role='administrator' and enabled)) then raise exception using errcode='42501',message='Only an administrator can replace a compromised link with explicit confirmation';end if;
 select * into l from public.event_public_links where event_id=p_event for update;
 if coalesce(l.version,0) is distinct from p_version then raise exception using errcode='40001',message='The event link changed. Reload before saving';end if;
 insert into public.event_public_links(event_id,enabled,updated_by) values(p_event,p_enabled,p_actor)
 on conflict(event_id) do update set enabled=excluded.enabled,token=case when p_replace then gen_random_uuid() else public.event_public_links.token end,version=public.event_public_links.version+1,updated_by=p_actor,updated_at=now();
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,case when p_replace then 'event.public_link_replaced' else 'event.public_link_visibility_changed' end,'event',p_event::text,jsonb_build_object('enabled',p_enabled,'reason',p_reason));
 return public.get_event_public_link(p_actor,p_event);
end $$;

create or replace function public.get_public_event_attendance(p_token uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('name',e.name,'institution',e.institution,'college',e.college,'class_list_available',exists(select 1 from public.event_eligibility_heads h join public.event_eligibility_rosters r on r.eligibility_id=h.eligibility_id where h.event_id=e.id),'starts_at',e.starts_at,'ends_at',e.ends_at,'server_time',now(),'max_attempts',e.max_check_in_attempts,
 'checkpoints',(select jsonb_agg(jsonb_build_object('key',c->>'key','label',c->>'label','opens_at',coalesce((c->>'opens_at')::timestamptz,e.starts_at-interval '1 hour'),'closes_at',coalesce((c->>'closes_at')::timestamptz,e.ends_at)) order by n) from jsonb_array_elements(e.checkpoints) with ordinality x(c,n)),
 'active_checkpoint_key',(select c->>'key' from jsonb_array_elements(e.checkpoints) with ordinality x(c,n) where now()>=coalesce((c->>'opens_at')::timestamptz,e.starts_at-interval '1 hour') and now()<coalesce((c->>'closes_at')::timestamptz,e.ends_at) order by n limit 1))
 from public.event_public_links l join public.events e on e.id=l.event_id where l.token=p_token and l.enabled and e.archived_at is null;
$$;


create function public.submit_public_attendance_details(p_token uuid,p_request uuid,p_device text,p_ip text,p_agent text,p_hash text,p_school_id text,p_name text,p_institution text,p_class text,p_college text,p_course text,p_checkpoint text,p_lat double precision,p_lon double precision,p_accuracy double precision,p_captured timestamptz,p_signature jsonb,p_privacy_version text,p_consent boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.events;matched boolean;result jsonb;
begin
 select ev.* into e from public.event_public_links l join public.events ev on ev.id=l.event_id where l.token=p_token and l.enabled;
 if not found then return public.submit_public_attendance(p_token,p_request,p_device,p_ip,p_agent,p_hash,p_school_id,p_name,p_institution,p_class,p_checkpoint,p_lat,p_lon,p_accuracy,p_captured,p_signature,p_privacy_version,p_consent);end if;
 select exists(select 1 from public.event_eligibility_heads h join public.event_eligibility_rosters r on r.eligibility_id=h.eligibility_id join public.class_roster_entries re on re.version_id=r.roster_version_id where h.event_id=e.id and re.school_id=p_school_id) into matched;
 if length(coalesce(p_college,''))>100 or length(coalesce(p_course,''))>150 or coalesce(p_college,'')~'[[:cntrl:]]' or coalesce(p_course,'')~'[[:cntrl:]]' or
 (not matched and (length(btrim(coalesce(p_class,''))) not between 1 and 80 or length(btrim(coalesce(p_college,'')))=0 or length(btrim(coalesce(p_course,'')))=0)) or
 ((coalesce(p_college,'')<>'' or coalesce(p_course,'')<>'') and not exists(select 1 from public.courses c join public.colleges d on d.institution=c.institution and d.name=c.college where c.institution=p_institution and c.college=p_college and c.name=p_course and c.active and d.active)) or
 (e.college is not null and p_college is distinct from e.college) then
  return jsonb_build_object('status_code',400,'body',jsonb_build_object('error',jsonb_build_object('code','invalid_class_details','message','Select your institution, college and program/course, then enter your class/section. Details must match the event affiliation.')));
 end if;
 result:=public.submit_public_attendance(p_token,p_request,p_device,p_ip,p_agent,p_hash,p_school_id,p_name,p_institution,p_class,p_checkpoint,p_lat,p_lon,p_accuracy,p_captured,p_signature,p_privacy_version,p_consent);
 if (result->>'status_code')::integer in (200,202) then
  update public.public_attendance_submissions set declared_college=coalesce(p_college,''),declared_course=coalesce(p_course,'') where id in(select submission_id from public.public_attendance_requests where request_id=p_request and device_hash=p_device and payload_hash=p_hash);
 end if;return result;
end $$;
revoke all on function public.submit_public_attendance_details(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,timestamptz,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.submit_public_attendance_details(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,timestamptz,jsonb,text,boolean) to service_role;
create or replace function public.create_operational_report(p_actor uuid,p_request uuid,p_event uuid,p_format text,p_signatures boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
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
  select jsonb_build_object('submission_id',s.id,'school_id',s.school_id,'participant_name',coalesce(s.official_name,s.submitted_name),'submitted_name',s.submitted_name,'participant_type','Account-free participant','institution',coalesce(s.section_snapshot->>'institution',s.institution),'college',coalesce(s.section_snapshot->>'college',nullif(s.declared_college,''),'Exception / no official class'),'course',coalesce(s.section_snapshot->>'course',s.declared_course,''),'class_name',coalesce(s.section_snapshot->>'name',s.class_label),'official_roster_match',s.official_id is not null,'affiliation_source',case when s.official_id is null then 'Self-declared' else 'Official roster' end,'checkpoint_key',s.checkpoint_key,'checkpoint',s.checkpoint_label,'status',s.status,'source',s.attendance_source,'submitted_at',s.created_at,'distance_meters',case when p_signatures then s.distance_from_venue_meters end,'distance_restricted',not p_signatures and s.attendance_source<>'manual','flags',to_jsonb(s.review_reasons),'resolution',coalesce(s.review_state,case when s.status='approved' then 'automatic_approval' else s.status end),'reviewer_name',s.reviewer_name,'reviewer_role',case when s.decided_by is not null then coalesce(s.decided_role,'Historical role unavailable') when s.status='approved' then 'System / automatic' else null end,'decided_at',s.decided_at,'signature_collected',exists(select 1 from public.public_attendance_signatures z where z.submission_id=s.id),'signature',s.signature) item,s.created_at,s.id from attendance s
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

-- Preserve old interrupted-request receipts while recording the new form notice version.
create or replace function public.submit_public_attendance_base(p_token uuid,p_request uuid,p_device text,p_ip text,p_agent text,p_hash text,p_school_id text,p_name text,p_institution text,p_class text,p_checkpoint text,p_lat double precision,p_lon double precision,p_accuracy double precision,p_captured timestamptz,p_signature jsonb,p_privacy_version text,p_consent boolean) returns jsonb
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
 if p_checkpoint is null or p_checkpoint!~'^[a-zA-Z0-9_-]{1,50}$' or coalesce(p_class,'') ~ '[[:cntrl:]]' or p_device is null or p_device!~'^[a-f0-9]{64}$' or p_ip is null or p_ip!~'^[a-f0-9]{64}$' or p_hash is null or p_hash!~'^[a-f0-9]{64}$' or length(coalesce(p_agent,''))>500 or p_consent is distinct from true or (p_privacy_version is null or p_privacy_version not in ('2026-11-26-attendance-v1','2026-11-27-attendance-v2')) or p_school_id is null or p_school_id!~'^[A-Z0-9][A-Z0-9 ./_-]{0,39}$' or length(btrim(coalesce(p_name,''))) not between 1 and 120 or p_name ~ '[[:cntrl:]]|^[=+@-]' or p_institution is null or p_institution not in ('MCNP','ISAP') or length(coalesce(p_class,''))>80 or not coalesce(p_lat between -90 and 90 and p_lon between -180 and 180 and p_accuracy between 0 and 100000,false) or p_captured is null or not isfinite(p_captured) or not app_private.valid_attendance_signature(p_signature) then return jsonb_build_object('status_code',400,'body',jsonb_build_object('error',jsonb_build_object('message','Complete the form, privacy consent, signature and valid location before submitting.','code','invalid_form')));end if;
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


