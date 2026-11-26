begin;
create function pg_temp.submit_fixture(token uuid,school text,request_id uuid default gen_random_uuid(),latitude double precision default 17,longitude double precision default 121,accuracy double precision default 5,captured timestamptz default clock_timestamp(),checkpoint text default 'first',browser text default repeat('a',64),name text default 'Participant One',payload text default repeat('c',64)) returns jsonb language sql as $$
 select public.submit_public_attendance(token,request_id,browser,repeat('b',64),'Synthetic browser',payload,school,name,'ISAP','Class A',checkpoint,latitude,longitude,accuracy,captured,'[[[0.1,0.1],[0.2,0.2],[0.3,0.1],[0.4,0.2],[0.5,0.1],[0.6,0.2],[0.7,0.1],[0.8,0.2]]]','2026-11-26-attendance-v1',true);
$$;
grant execute on function pg_temp.submit_fixture to service_role;
do $$
declare root uuid;staff uuid:=gen_random_uuid();e uuid:=gen_random_uuid();empty_event uuid:=gen_random_uuid();section uuid;course_row public.courses;r jsonb;p jsonb;link jsonb;token uuid;old_token uuid;request_id uuid:=gen_random_uuid();submission uuid;count_students integer;count_users integer;id1 text:='PA-'||left(replace(gen_random_uuid()::text,'-',''),12);i integer;rep uuid:=gen_random_uuid();regular uuid:=gen_random_uuid();fixture_case uuid;case2 uuid;third_case uuid;original_due timestamptz;
begin
 root:=(select user_id from public.user_profiles where role='main_admin' and retired_at is null and approval_status='approved');
 select * into strict course_row from public.courses where institution='ISAP' and active order by name limit 1;
 insert into auth.users(id,email,email_confirmed_at) values(staff,staff||'@test.invalid',now());insert into public.user_profiles(user_id,full_name) values(staff,'Staff fixture');
 insert into auth.users(id,email,email_confirmed_at) values(rep,rep||'@test.invalid',now()),(regular,regular||'@test.invalid',now());insert into public.user_profiles(user_id,full_name) values(rep,'Review representative'),(regular,'Review regular');
 perform set_config('role','service_role',true);perform public.bootstrap_operational_administrator(root);
 perform public.save_operational_account(root,staff,'col_admin','Staff fixture',true,0,'[{"kind":"institution","scope_id":"ISAP"}]','{}','Fixture provision');
 insert into public.events(id,name,institution,latitude,longitude,radius_meters,starts_at,ends_at) values(e,'Public test','ISAP',17,121,100,now()+interval '2 days',now()+interval '3 days'),(empty_event,'No roster','ISAP',17,121,100,now()+interval '2 days',now()+interval '3 days');
 r:=public.save_class_section(root,null,0,jsonb_build_object('institution','ISAP','college',course_row.college,'course',course_row.name,'name','Public class '||id1,'academic_year','2026-2027','term','First semester'),'Fixture class');section:=(r->>'id')::uuid;
 p:=public.preview_class_roster(root,section,jsonb_build_array(jsonb_build_object('row_number',2,'school_id',upper(id1),'full_name','Participant One'),jsonb_build_object('row_number',3,'school_id',upper(id1)||'-2','full_name','Participant Two'),jsonb_build_object('row_number',4,'school_id',upper(id1)||'-3','full_name','Participant Three')),'official.xlsx','merge');perform public.commit_class_roster(root,(p->>'id')::uuid,false,false,'Fixture roster');
 perform public.save_operational_account(root,rep,'classroom_representative','Review representative',true,0,'[]','{}','Review fixture');
 perform public.save_operational_account(root,regular,'col_regular','Review regular',true,0,'[{"kind":"institution","scope_id":"ISAP"}]','{}','Review fixture');
 perform public.assign_class_officer(root,section,rep,'representative',1,false,'Assign review representative');
 perform public.set_event_class_rosters(root,e,0,jsonb_build_array(section),'Fixture eligibility');
 begin perform public.save_event_public_link(root,empty_event,0,true,false,'','Publish without official list');raise exception 'FAIL: no-roster event published';exception when sqlstate '22023' then null;end;
 link:=public.save_event_public_link(root,e,0,true,false,'','Publish fixture');token:=(link->>'token')::uuid;
 update public.events set starts_at=now()-interval '1 minute',ends_at=now()+interval '2 hours',checkpoints=jsonb_build_array(jsonb_build_object('key','first','label','Attendance','opens_at',now()-interval '2 minutes','closes_at',now()+interval '2 hours')) where id=e;
 r:=pg_temp.submit_fixture(token,upper(id1),request_id);submission:=(r->'body'->>'receipt_id')::uuid;
 select id,due_at into fixture_case,original_due from public.attendance_review_cases where submission_id=submission;
 if not exists(select 1 from public.attendance_review_cases where id=fixture_case and level=0 and owner_id=rep) then raise exception 'FAIL: representative ownership';end if;
 perform pg_temp.submit_fixture(token,upper(id1),request_id);
 if (select count(*) from public.attendance_review_notifications where case_id=fixture_case)<>1 then raise exception 'FAIL: retry notification duplication';end if;
 begin perform public.get_attendance_review_case(regular,fixture_case);raise exception 'FAIL: unassigned reviewer read evidence';exception when insufficient_privilege then null;end;
 perform public.read_attendance_review_notification(rep,(select id from public.attendance_review_notifications where recipient_id=rep limit 1));
 if (select due_at from public.attendance_review_cases where id=fixture_case)<>original_due then raise exception 'FAIL: reading notification resets deadline';end if;
 r:=public.bulk_approve_attendance_reviews(rep,jsonb_build_array(jsonb_build_object('id',fixture_case,'version',1)),'Verified unflagged attendance',true);
 if (r->>'approved')::int<>1 or (public.public_attendance_receipt(token,request_id,repeat('a',64))->'body'->>'status') is distinct from 'approved' then raise exception 'FAIL: approval or participant receipt';end if;
 begin perform public.decide_attendance_review(rep,fixture_case,1,'reject','Stale decision',true);raise exception 'FAIL: stale case overwrite';exception when serialization_failure then null;end;
 -- Missing-roster claims go to scoped COL regular, and approval needs an administrator.
 r:=pg_temp.submit_fixture(token,'UNKNOWN-'||upper(id1),gen_random_uuid(),17,121,5,clock_timestamp(),'first',repeat('f',64),'Unknown participant');
 select id into case2 from public.attendance_review_cases where submission_id=(r->'body'->>'receipt_id')::uuid;
 if not exists(select 1 from public.attendance_review_cases where id=case2 and level=1 and owner_id=regular) then raise exception 'FAIL: missing roster fallback';end if;
 begin perform public.decide_attendance_review(regular,case2,1,'approve','Identity exception',true);raise exception 'FAIL: lower role approves unknown identity';exception when insufficient_privilege then null;end;
 begin perform public.bulk_approve_attendance_reviews(regular,jsonb_build_array(jsonb_build_object('id',case2,'version',1)),'Unsafe bulk request',true);raise exception 'FAIL: bulk approved flagged case';exception when sqlstate '22023' then null;end;
 r:=pg_temp.submit_fixture(token,upper(id1)||'-3',gen_random_uuid(),17,121,5,clock_timestamp(),'first',repeat('c',64),'Participant Three');
 select id into third_case from public.attendance_review_cases where submission_id=(r->'body'->>'receipt_id')::uuid;
 begin perform public.bulk_approve_attendance_reviews(rep,jsonb_build_array(jsonb_build_object('id',third_case,'version',1),jsonb_build_object('id',case2,'version',1)),'Atomic bulk review test',true);raise exception 'FAIL: mixed flagged bulk request accepted';exception when sqlstate '22023' then null;end;
 if (select state from public.attendance_review_cases where id=third_case) is distinct from 'open' then raise exception 'FAIL: mixed bulk request partially committed';end if;
 -- Deadline worker advances only one level per run, retains final admin work, and does not duplicate notifications.
 update public.attendance_review_cases set due_at=clock_timestamp()-interval '1 second' where id=case2;
 perform public.process_attendance_review_queue(100);
 if not exists(select 1 from public.attendance_review_cases where id=case2 and level=2 and owner_id=staff and version=2) then raise exception 'FAIL: timed COL admin escalation';end if;
 begin perform public.decide_attendance_review(regular,case2,2,'reject','Old reviewer attempt',true);raise exception 'FAIL: previous reviewer acts after escalation';exception when insufficient_privilege then null;end;
 update public.attendance_review_cases set due_at=clock_timestamp()-interval '1 second' where id=case2;
 perform public.process_attendance_review_queue(100);perform public.process_attendance_review_queue(100);
 if not exists(select 1 from public.attendance_review_cases where id=case2 and level=3 and owner_id=root and due_at is null and version=3) then raise exception 'FAIL: final admin escalation loop';end if;
 perform public.decide_attendance_review(root,case2,3,'approve','Independently verified missing-list exception',true);
 -- New device evidence reopens earlier approved attendance and blocks approval pending device review.
 perform pg_temp.submit_fixture(token,upper(id1),gen_random_uuid(),17,121,5,clock_timestamp(),'first',repeat('d',64));
 if not exists(select 1 from public.attendance_review_cases where id=fixture_case and state='open' and version=3 and level=0) then raise exception 'FAIL: new incident did not reopen review';end if;
 begin perform public.decide_attendance_review(rep,fixture_case,3,'approve','Open device incident',true);raise exception 'FAIL: unresolved device incident approved';exception when sqlstate '22023' then null;end;
 -- Manual exception preserves evidence provenance and never captures the officer browser/GPS.
 old_token:=gen_random_uuid();r:=public.record_manual_attendance(staff,old_token,e,'first',(select student_id from public.class_roster_entries where school_id=upper(id1)||'-2' limit 1),'Participant has no usable phone; independently checked school ID',true);
 if not exists(select 1 from public.public_attendance_submissions where id=(r->>'submission_id')::uuid and attendance_source='manual' and latitude is null and privacy_accepted_at is null and manual_actor=staff and status='pending_review') or exists(select 1 from public.participant_device_bindings where student_id=(select student_id from public.class_roster_entries where school_id=upper(id1)||'-2' limit 1)) then raise exception 'FAIL: manual record manufactures GPS or browser binding';end if;
 p:=public.record_manual_attendance(staff,old_token,e,'first',(select student_id from public.class_roster_entries where school_id=upper(id1)||'-2' limit 1),'Participant has no usable phone; independently checked school ID',true);
 if p<>r then raise exception 'FAIL: manual transport replay not idempotent';end if;
 perform pg_temp.submit_fixture(token,upper(id1)||'-2',gen_random_uuid(),17,121,5,clock_timestamp(),'first',repeat('a',64),'Participant Two');
 if exists(select 1 from public.participant_device_bindings where student_id=(select student_id from public.class_roster_entries where school_id=upper(id1)||'-2' limit 1)) then raise exception 'FAIL: duplicate public form bound a manual record to the officer browser';end if;
 begin perform public.record_manual_attendance(rep,gen_random_uuid(),e,'first',(select student_id from public.class_roster_entries where school_id=upper(id1)||'-2' limit 1),'Unauthorized manual attempt',true);raise exception 'FAIL: representative bypassed manual permission';exception when insufficient_privilege then null;end;
 if has_table_privilege('authenticated','public.attendance_review_cases','SELECT') or has_function_privilege('anon','public.process_attendance_review_queue(integer)','EXECUTE') then raise exception 'FAIL: review queue exposed directly';end if;
end $$;
rollback;
