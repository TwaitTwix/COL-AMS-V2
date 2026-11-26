begin;
do $$
declare admin uuid;rep uuid:=gen_random_uuid();other uuid:=gen_random_uuid();e uuid:=gen_random_uuid();section uuid;section2 uuid;course public.courses;r jsonb;v uuid;elig uuid;j jsonb;data jsonb;claim jsonb;claim2 jsonb;sid uuid:=gen_random_uuid();sid2 uuid:=gen_random_uuid();caseid uuid;live_event uuid:=gen_random_uuid();live_elig uuid;request uuid:=gen_random_uuid();school text:='RPT-'||upper(left(gen_random_uuid()::text,16));
begin
 admin:=(select user_id from public.user_profiles where role='main_admin' and retired_at is null and approval_status='approved' limit 1);
 select * into strict course from public.courses where institution='ISAP' and active order by name limit 1;
 insert into auth.users(id,email,email_confirmed_at) values(rep,rep::text||'@test.invalid',now()),(other,other::text||'@test.invalid',now());
 insert into public.user_profiles(user_id,full_name) values(rep,'Scoped report representative'),(other,'Other report representative');
 perform set_config('role','service_role',true);perform public.bootstrap_operational_administrator(admin);
 perform public.save_operational_account(admin,rep,'classroom_representative','Scoped report representative',true,0,'[]','{}','Report fixture');
 perform public.save_operational_account(admin,other,'classroom_representative','Other report representative',true,0,'[]','{}','Report fixture');
 r:=public.save_class_section(admin,null,0,jsonb_build_object('institution','ISAP','college',course.college,'course',course.name,'name','Report class '||e::text,'academic_year','2026-2027','term','First semester'),'Report fixture');section:=(r->>'id')::uuid;
 r:=public.save_class_section(admin,null,0,jsonb_build_object('institution','ISAP','college',course.college,'course',course.name,'name','Other report class '||e::text,'academic_year','2026-2027','term','First semester'),'Report fixture');section2:=(r->>'id')::uuid;
 perform public.assign_class_officer(admin,section,rep,'representative',1,false,'Report assignment');
 r:=public.preview_class_roster(admin,section,jsonb_build_array(jsonb_build_object('row_number',2,'school_id',school,'full_name','Official Report Participant')),'report.xlsx','merge');
 perform public.commit_class_roster(admin,(r->>'id')::uuid,false,false,'Report fixture import');
 r:=public.preview_class_roster(admin,section2,jsonb_build_array(jsonb_build_object('row_number',2,'school_id',school||'-OTHER','full_name','Other Class Participant')),'report.xlsx','merge');
 perform public.commit_class_roster(admin,(r->>'id')::uuid,false,false,'Report fixture import');
 insert into public.events(id,name,institution,latitude,longitude,radius_meters,starts_at,ends_at,checkpoints) values(e,'Scoped report fixture','ISAP',17,121,100,now()+interval '1 day',now()+interval '2 days',jsonb_build_array(jsonb_build_object('key','morning','label','Morning','opens_at',now()+interval '1 day','closes_at',now()+interval '36 hours'),jsonb_build_object('key','afternoon','label','Afternoon','opens_at',now()+interval '36 hours','closes_at',now()+interval '2 days')));
 perform public.set_event_class_rosters(admin,e,0,jsonb_build_array(section,section2),'Report frozen rosters');
 select eligibility_id into elig from public.event_eligibility_heads where event_id=e;
 select current_roster_version_id into v from public.class_sections where id=section;
 insert into public.public_attendance_submissions(id,event_id,checkpoint_key,checkpoint_label,school_id,submitted_name,institution,class_label,student_id,eligibility_id,status,review_reasons,device_hash,ip_hash,user_agent,latitude,longitude,accuracy_meters,location_captured_at,distance_from_venue_meters,event_snapshot,privacy_version)
 select sid,e,'morning','Morning',school,'Submitted Report Participant','ISAP','Test class',re.student_id,elig,'approved',array['device_changed'],repeat('a',64),repeat('b',64),'Secret user agent',17,121,5,now(),8,'{}','test' from public.class_roster_entries re where re.version_id=v;
 insert into public.public_submission_rosters(submission_id,section_id,roster_version_id) values(sid,section,v);
 insert into public.public_attendance_signatures(submission_id,strokes) values(sid,'[[[0.1,0.1],[0.2,0.2],[0.3,0.4]]]');
 insert into public.attendance_review_cases(submission_id,level,owner_id,state) values(sid,3,admin,'open') returning id into caseid;
 update public.attendance_review_cases set state='approved',decided_by=rep,decided_at=now() where id=caseid;
 -- An off-list approved exception is visible only for full-event reporting, never in the denominator.
 insert into public.public_attendance_submissions(id,event_id,checkpoint_key,checkpoint_label,school_id,submitted_name,institution,eligibility_id,status,review_reasons,device_hash,ip_hash,user_agent,latitude,longitude,accuracy_meters,location_captured_at,distance_from_venue_meters,event_snapshot,privacy_version)
 values(sid2,e,'morning','Morning',school||'-EX','Exception participant','ISAP',elig,'approved',array['not_on_roster'],repeat('c',64),repeat('d',64),'Secret agent',17,121,5,now(),9,'{}','test');
  update public.operational_feature_overrides set enabled=false where user_id=rep and feature_key='events.view';
 insert into public.operational_feature_overrides(user_id,feature_key,enabled) values(rep,'events.view',false) on conflict(user_id,feature_key) do update set enabled=false;
 if not exists(select 1 from jsonb_array_elements(public.list_operational_report_events(rep)->'events') item where item->>'id'=e::text) then raise exception 'FAIL: report viewing improperly depends on events.view';end if;
 j:=public.create_operational_report(rep,request,e,'preview',false);data:=public.get_operational_report(rep,(j->>'job_id')::uuid);
 if (data->>'total')::int<>1 or data->'summary'->'totals'->>'eligible_participants'<>'1' or data->'summary'->'totals'->>'eligible_checkpoint_slots'<>'2' or data->'summary'->'totals'->>'approved_eligible_slots'<>'1' then raise exception 'FAIL: class scope / frozen checkpoint denominator %',data;end if;
 if data->'items'->0->'distance_meters'<>'null'::jsonb or data->'items'->0->>'distance_restricted'<>'true' then raise exception 'FAIL: venue-distance evidence leak';end if;
 if data::text like '%Secret user agent%' or data::text like '%latitude%' or data::text like '%device_hash%' or data->'items'->0->'signature'<>'null'::jsonb then raise exception 'FAIL: sensitive report evidence leak';end if;
 if data->'items'->0->>'reviewer_role'<>'classroom_representative' or data->'items'->0->>'participant_type'<>'Account-free participant' then raise exception 'FAIL: participant and reviewer roles';end if;
 if public.create_operational_report(rep,request,e,'preview',false)->>'job_id'<>j->>'job_id' then raise exception 'FAIL: request replay';end if;
 begin perform public.create_operational_report(rep,request,e,'pdf',false);raise exception 'FAIL: export role bypass';exception when insufficient_privilege then null;end;
 begin perform public.create_operational_report(rep,gen_random_uuid(),e,'preview',true);raise exception 'FAIL: signature bypass';exception when insufficient_privilege then null;end;
 begin perform public.get_operational_report(other,(j->>'job_id')::uuid);raise exception 'FAIL: cross-owner report';exception when insufficient_privilege then null;end;
 begin perform public.create_operational_report(other,gen_random_uuid(),e,'preview',false);raise exception 'FAIL: unassigned class report';exception when insufficient_privilege then null;end;
 j:=public.create_operational_report(admin,gen_random_uuid(),e,'xlsx',true);data:=public.get_operational_report(admin,(j->>'job_id')::uuid);
 if data->'summary'->'totals'->>'approved_exceptions'<>'1' or data->'summary'->'totals'->>'eligible_checkpoint_slots'<>'4' or data->'summary'->'totals'->>'approved_eligible_slots'<>'1' then raise exception 'FAIL: exception inflated denominator';end if;
 begin update public.operational_report_jobs set dataset='{}' where id=(j->>'job_id')::uuid;raise exception 'FAIL: direct mutable snapshot';exception when sqlstate '22023' then null;end;
 if jsonb_array_length(public.operational_attendance_rates(rep)->'groups')<>0 then raise exception 'FAIL: future event included in live rates';end if;
 -- Later source decisions do not mutate the report snapshot.
 update public.public_attendance_submissions set status='rejected' where id=sid;
 if (public.get_operational_report(admin,(j->>'job_id')::uuid)->'summary'->'totals'->>'approved')::int<>2 then raise exception 'FAIL: mutable snapshot';end if;
 claim:=public.claim_operational_report((j->>'job_id')::uuid);
 if claim is null or public.claim_operational_report((j->>'job_id')::uuid) is not null then raise exception 'FAIL: competing claims';end if;
 if public.finish_operational_report((j->>'job_id')::uuid,gen_random_uuid(),true) then raise exception 'FAIL: unowned completion';end if;
 update public.operational_report_jobs set started_at=now()-interval '7 minutes' where id=(j->>'job_id')::uuid;
 claim2:=public.claim_operational_report((j->>'job_id')::uuid);
 if claim2->>'claim_id'=claim->>'claim_id' or public.finish_operational_report((j->>'job_id')::uuid,(claim->>'claim_id')::uuid,true) then raise exception 'FAIL: stale lease fencing';end if;
 if not public.finish_operational_report((j->>'job_id')::uuid,(claim2->>'claim_id')::uuid,true) then raise exception 'FAIL: valid completion';end if;
 data:=public.get_operational_report(admin,(j->>'job_id')::uuid,1,true);
 if data->>'file_path' not like 'revision/%/'||(claim2->>'claim_id')||'.xlsx' then raise exception 'FAIL: isolated object path';end if;
 j:=public.create_operational_report(rep,gen_random_uuid(),e,'preview',false);
 update public.attendance_review_cases set decided_by=admin,decided_at=clock_timestamp() where id=caseid;
 if public.get_operational_report(rep,(j->>'job_id')::uuid)->'items'->0->>'reviewer_role'<>'classroom_representative' then raise exception 'FAIL: reviewer history changed in saved report';end if;
 insert into public.events(id,name,institution,latitude,longitude,radius_meters,starts_at,ends_at) values(live_event,'Live report rates','ISAP',17,121,100,now()+interval '2 days',now()+interval '3 days');
 perform public.set_event_class_rosters(admin,live_event,0,jsonb_build_array(section,section2),'Live rate fixture');
 select eligibility_id into live_elig from public.event_eligibility_heads where event_id=live_event;
 update public.events set starts_at=now()-interval '1 minute',ends_at=now()+interval '1 hour' where id=live_event;
 data:=public.operational_attendance_rates(rep);
 if data->'groups'->0->>'eligible'<>'1' or data->'groups'->0->>'approved'<>'0' then raise exception 'FAIL: scoped live denominator %',data;end if;
 insert into public.public_attendance_submissions(event_id,checkpoint_key,checkpoint_label,school_id,submitted_name,institution,class_label,student_id,eligibility_id,status,review_reasons,device_hash,ip_hash,user_agent,latitude,longitude,accuracy_meters,location_captured_at,distance_from_venue_meters,event_snapshot,privacy_version)
 select live_event,'default','Attendance',school_id,submitted_name,institution,class_label,student_id,live_elig,'approved','{}',device_hash,ip_hash,user_agent,latitude,longitude,accuracy_meters,location_captured_at,distance_from_venue_meters,event_snapshot,privacy_version from public.public_attendance_submissions where id=sid;
 data:=public.operational_attendance_rates(rep);
 if data->'groups'->0->>'approved'<>'1' or (data->'groups'->0->>'percentage')::numeric<>100 then raise exception 'FAIL: scoped live approved numerator';end if;
 data:=public.operational_attendance_rates(admin);
 if data->'groups'->0->>'eligible'<>'2' or (data->'groups'->0->>'percentage')::numeric<>50 then raise exception 'FAIL: event-wide live denominator';end if;
 update public.class_assignments set ended_at=now(),ended_by=admin where section_id=section and user_id=rep;
 begin perform public.get_operational_report(rep,(j->>'job_id')::uuid);raise exception 'FAIL: revoked assignment report';exception when insufficient_privilege then null;end;
end $$;
rollback;

