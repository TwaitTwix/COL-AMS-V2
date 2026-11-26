-- Preserve server-calculated evidence; historical distances remain unknown rather than inferred.
alter table public.public_attendance_requests add column distance_meters double precision,add column venue_snapshot jsonb,add column user_agent text,add column privacy_version text,add column claimed_name text;
create index public_attendance_requests_case_evidence_idx on public.public_attendance_requests(event_id,school_id,checkpoint_key,device_hash,created_at);
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
 if p_checkpoint is null or p_checkpoint!~'^[a-zA-Z0-9_-]{1,50}$' or coalesce(p_class,'') ~ '[[:cntrl:]]' or p_device is null or p_device!~'^[a-f0-9]{64}$' or p_ip is null or p_ip!~'^[a-f0-9]{64}$' or p_hash is null or p_hash!~'^[a-f0-9]{64}$' or length(coalesce(p_agent,''))>500 or p_consent is distinct from true or (p_privacy_version is null or p_privacy_version not in ('2026-11-26-attendance-v1','2026-11-27-attendance-v2','2026-11-27-attendance-v3')) or p_school_id is null or p_school_id!~'^[A-Z0-9][A-Z0-9 ./_-]{0,39}$' or length(btrim(coalesce(p_name,''))) not between 1 and 120 or p_name ~ '[[:cntrl:]]|^[=+@-]' or p_institution is null or p_institution not in ('MCNP','ISAP') or length(coalesce(p_class,''))>80 or not coalesce(p_lat between -90 and 90 and p_lon between -180 and 180 and p_accuracy between 0 and 100000,false) or p_captured is null or not isfinite(p_captured) or not app_private.valid_attendance_signature(p_signature) then return jsonb_build_object('status_code',400,'body',jsonb_build_object('error',jsonb_build_object('message','Complete the form, privacy consent, signature and valid location before submitting.','code','invalid_form')));end if;
 if not app_private.take_public_attendance_rate('ip:'||p_ip||':'||e.id::text,600) or not app_private.take_public_attendance_rate('browser:'||p_device||':'||e.id::text,20) then return jsonb_build_object('status_code',429,'body',jsonb_build_object('error',jsonb_build_object('message','Too many attendance requests. Wait a minute before retrying.','code','rate_limited')));end if;
 validation_time:=clock_timestamp();
 distance:=app_private.public_distance_meters(e.latitude,e.longitude,p_lat,p_lon);
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
   if p_captured<clock_timestamp()-interval '30 seconds' or p_captured>clock_timestamp()+interval '5 seconds' then error_message:='Location is stale or its timestamp is incorrect. Request a fresh location.';error_code:='stale_location';
   elsif p_accuracy>least(50.0,e.radius_meters) then error_message:='Location accuracy is too low. Allow precise location and try again.';error_code:='inaccurate_location';
   elsif distance>e.radius_meters then error_message:='You are outside the attendance area. Move closer to the venue and try again.';error_code:='outside_geofence';
   elsif distance+p_accuracy>e.radius_meters then error_message:='Your location accuracy overlaps the venue boundary. Move further inside the venue and try again.';error_code:='uncertain_boundary';
   end if;
  end if;
 end if;
 if error_message is not null then
  if charge then insert into public.public_attendance_attempts(event_id,checkpoint_key,school_id,device_hash,rejected_count,last_rejection) values(e.id,p_checkpoint,p_school_id,p_device,1,error_code) on conflict(event_id,checkpoint_key,school_id,device_hash) do update set rejected_count=public.public_attendance_attempts.rejected_count+1,last_rejection=excluded.last_rejection,updated_at=now() returning rejected_count into rejections;end if;
  result:=jsonb_build_object('status_code',case when error_code='already_submitted' then 409 else 400 end,'body',jsonb_build_object('error',jsonb_build_object('message',error_message,'code',error_code),'location',jsonb_build_object('distance_meters',round(distance::numeric,1),'radius_meters',e.radius_meters,'accuracy_meters',p_accuracy),'attempts',jsonb_build_object('limit',e.max_check_in_attempts,'remaining',greatest(0,e.max_check_in_attempts-coalesce(rejections,0)))));
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
 insert into public.public_attendance_requests(request_id,event_id,link_token,device_hash,payload_hash,school_id,checkpoint_key,ip_hash,submission_id,latitude,longitude,accuracy_meters,location_captured_at,response,distance_meters,venue_snapshot,user_agent,privacy_version,claimed_name) values(p_request,e.id,p_token,p_device,p_hash,p_school_id,p_checkpoint,p_ip,submission,p_lat,p_lon,p_accuracy,p_captured,result,distance,jsonb_build_object('latitude',e.latitude,'longitude',e.longitude,'radius_meters',e.radius_meters),coalesce(p_agent,''),p_privacy_version,p_name);
 return result;
end $$;
create or replace function public.get_attendance_review_case(p_actor uuid,p_case uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare c public.attendance_review_cases;
begin
 if not app_private.can_read_attendance_case(p_actor,p_case) then raise exception using errcode='42501',message='This attendance case is not assigned to you';end if;
 select * into strict c from public.attendance_review_cases where id=p_case;
 return jsonb_build_object('case',to_jsonb(c),'can_decide',c.state='open' and c.owner_id=p_actor and app_private.attendance_review_owner(c.submission_id,c.level)=p_actor and app_private.operational_capable(p_actor,'attendance.review'),
 'submission',(select to_jsonb(s) from public.public_attendance_submissions s where id=c.submission_id),
 'location_attempts',coalesce((select jsonb_agg(jsonb_build_object('request_id',r.request_id,'created_at',r.created_at,'checkpoint_key',r.checkpoint_key,'latitude',r.latitude,'longitude',r.longitude,'accuracy_meters',r.accuracy_meters,'location_captured_at',r.location_captured_at,'distance_meters',r.distance_meters,'venue_snapshot',r.venue_snapshot,'user_agent',r.user_agent,'code',r.response->'body'->'error'->>'code','message',r.response->'body'->'error'->>'message') order by r.created_at) from (select r.* from public.public_attendance_requests r join public.public_attendance_submissions s on s.id=c.submission_id where r.event_id=s.event_id and r.school_id=s.school_id and r.checkpoint_key=s.checkpoint_key and r.device_hash=s.device_hash and (r.response->>'status_code')::integer>=400 order by r.created_at desc limit 100) r),'[]'::jsonb),
 'signature',(select strokes from public.public_attendance_signatures where submission_id=c.submission_id),
 'device_incidents',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'kind',i.kind,'state',i.state)) from public.participant_device_incidents i join public.participant_incident_submissions b on b.incident_id=i.id where b.submission_id=c.submission_id),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(to_jsonb(h) order by version) from public.attendance_review_history h where case_id=c.id),'[]'::jsonb));
end $$;

-- Standalone rejected attempts remain available even if no attendance was submitted.
create function public.list_event_location_attempts(p_actor uuid,p_event uuid,p_page integer default 1,p_search text default '') returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;total bigint;
begin
 if not exists(select 1 from public.operational_accounts where user_id=p_actor and role='administrator' and enabled) or not app_private.operational_capable(p_actor,'attendance.review') then raise exception using errcode='42501',message='Administrator review access required';end if;
 if p_page is null or p_page not between 1 and 100000 or length(coalesce(p_search,''))>100 then raise exception using errcode='22023',message='Invalid search or page';end if;
 if not exists(select 1 from public.events where id=p_event) then raise exception using errcode='22023',message='Event not found';end if;
 select count(*) into total from public.public_attendance_requests r where r.event_id=p_event and (r.response->>'status_code')::integer>=400 and position(lower(coalesce(p_search,'')) in lower(r.school_id))>0;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.request_id),'[]'::jsonb) into result from (
 select r.request_id,r.school_id,r.claimed_name,r.checkpoint_key,r.created_at,r.location_captured_at,r.latitude,r.longitude,r.accuracy_meters,r.distance_meters,r.venue_snapshot,r.user_agent,left(r.device_hash,12) recognized_browser,r.response->'body'->'error'->>'code' code,r.response->'body'->'error'->>'message' message
 from public.public_attendance_requests r where r.event_id=p_event and (r.response->>'status_code')::integer>=400 and position(lower(coalesce(p_search,'')) in lower(r.school_id))>0 order by r.created_at desc,r.request_id limit 25 offset (p_page-1)*25) a;
 return jsonb_build_object('items',result,'total',total,'page',p_page,'page_size',25);
end $$;
revoke all on function public.list_event_location_attempts(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.list_event_location_attempts(uuid,uuid,integer,text) to service_role;
