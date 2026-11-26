begin;
do $$
declare admin_id uuid:=gen_random_uuid(); col_id uuid:=gen_random_uuid(); student_id uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid(); future_eid uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email,email_confirmed_at) values(admin_id,admin_id||'@test.invalid',now()),(col_id,col_id||'@test.invalid',now()),(student_id,student_id||'@test.invalid',now());
  insert into public.user_profiles(user_id,full_name,personal_id,role,approval_status,institution,college,course,privacy_version)
    values(admin_id,'Admin attendee fixture',admin_id::text,'admin','approved','ISAP','College of Information Technology and Engineering','Bachelor of Science in Information Technology','2026-11-17'),
    (col_id,'COL attendee fixture',col_id::text,'col_officer','approved','ISAP','College of Information Technology and Engineering','Bachelor of Science in Information Technology','2026-11-17'),
    (student_id,'Student checkpoint fixture',student_id::text,'pending','pending','ISAP','College of Information Technology and Engineering','Bachelor of Science in Information Technology','2026-11-17');
  insert into public.events(id,name,latitude,longitude,radius_meters,starts_at,ends_at,max_check_in_attempts,checkpoints) values
    (eid,'Two checkpoint fixture',17.6,121.7,100,now()-interval '30 minutes',now()+interval '1 hour',1,jsonb_build_array(jsonb_build_object('key','start','label','Start','opens_at',now()-interval '30 minutes','closes_at',now()),jsonb_build_object('key','end','label','End','opens_at',now(),'closes_at',now()+interval '30 minutes'))),
    (future_eid,'Four checkpoint fixture',17.6,121.7,100,now()-interval '1 hour',now()+interval '2 hours',3,jsonb_build_array(jsonb_build_object('key','morning','label','Morning arrival','opens_at',now()-interval '1 hour','closes_at',now()-interval '30 minutes'),jsonb_build_object('key','lunch','label','Lunch departure','opens_at',now()-interval '30 minutes','closes_at',now()),jsonb_build_object('key','return','label','Afternoon return','opens_at',now(),'closes_at',now()+interval '30 minutes'),jsonb_build_object('key','finish','label','Final departure','opens_at',now()+interval '30 minutes','closes_at',now()+interval '1 hour')));
  perform set_config('test.admin',admin_id::text,true);perform set_config('test.col',col_id::text,true);perform set_config('test.student',student_id::text,true);perform set_config('test.event',eid::text,true);perform set_config('test.future',future_eid::text,true);
end $$;
set local role service_role;
do $$
declare admin_id uuid:=current_setting('test.admin')::uuid; col_id uuid:=current_setting('test.col')::uuid; student_id uuid:=current_setting('test.student')::uuid; eid uuid:=current_setting('test.event')::uuid; future_eid uuid:=current_setting('test.future')::uuid; sid uuid; q uuid; fq uuid; result jsonb; stats jsonb; caught boolean;
begin
  perform public.ensure_staff_attendance_profile(admin_id);perform public.ensure_staff_attendance_profile(col_id);
  perform public.approve_registration(admin_id,student_id,'approved','Disposable fixture approval');
  perform public.record_device_session(admin_id,'admin-test-session','admin-test-device','Sample browser','127.0.0.1');perform public.record_device_session(col_id,'col-test-session','col-test-device','Sample browser','127.0.0.1');perform public.record_device_session(student_id,'student-test-session','student-test-device','Sample browser','127.0.0.1');
  select qr_version into q from public.events where id=eid;select qr_version into fq from public.events where id=future_eid;
  result:=public.submit_checkpoint_attendance(admin_id,eid,'start',q,'admin-test-device',0,0,5);
  if result->>'error'<>'Outside geofence perimeter' or not (result#>>'{attempts,locked}')::boolean then raise exception 'FAIL: checkpoint geofence/attempt cap';end if;
  result:=public.submit_checkpoint_attendance(admin_id,eid,'end',q,'admin-test-device',17.6,121.7,5);
  if result#>>'{attendance,status}'<>'approved' or (result#>>'{attempts,rejected}')::int<>0 then raise exception 'FAIL: admin scan or isolated checkpoint quota';end if;
  result:=public.submit_checkpoint_attendance(admin_id,eid,'end',q,'admin-test-device',17.6,121.7,5);if (result->>'http_status')::int<>409 then raise exception 'FAIL: duplicate checkpoint accepted';end if;
  update public.events set max_check_in_attempts=2 where id=eid;
  result:=public.submit_checkpoint_attendance(admin_id,eid,'start',q,'admin-test-device',17.6,121.7,5);if result#>>'{attendance,status}'<>'approved' then raise exception 'FAIL: admin start scan';end if;
  result:=public.submit_checkpoint_attendance(col_id,eid,'start',q,'col-test-device',17.6,121.7,5);if result#>>'{attendance,status}'<>'approved' then raise exception 'FAIL: COL officer camera attendance';end if;
  stats:=public.event_attendance_statistics(eid);
  if not exists(select 1 from jsonb_array_elements(stats) s where s->>'institution'='ISAP' and s->>'level'='institution' and (s->>'attended')::int=1) then raise exception 'FAIL: partial attendance counted as complete';end if;
  perform public.submit_checkpoint_attendance(col_id,eid,'end',q,'col-test-device',17.6,121.7,5);
  perform public.submit_checkpoint_attendance(student_id,eid,'start',q,'student-test-device',17.6,121.7,5);
  -- Avoid variable/column ambiguity in the fixture lookup.
  select p.student_id into sid from public.user_profiles p where p.user_id=current_setting('test.student')::uuid;
  result:=public.record_checkpoint_manual(admin_id,sid,eid,'No device at final checkpoint','end');if result->>'checkpoint_label'<>'End' then raise exception 'FAIL: manual checkpoint attribution';end if;
  stats:=public.event_attendance_statistics(eid);
  if exists(select 1 from jsonb_array_elements(stats) s where (s->>'percentage')::numeric>100) or not exists(select 1 from jsonb_array_elements(stats) s where s->>'institution'='ISAP' and s->>'level'='institution' and (s->>'attended')::int=3) then raise exception 'FAIL: completion statistics inflated';end if;
  caught:=false;begin perform public.submit_checkpoint_attendance(admin_id,future_eid,'finish',fq,'admin-test-device',17.6,121.7,5);exception when raise_exception then caught:=true;end;if not caught then raise exception 'FAIL: future checkpoint accepted';end if;
  caught:=false;begin update public.events set checkpoints='[{"key":"default","label":"Attendance"}]' where id=eid;exception when raise_exception then caught:=true;end;if not caught then raise exception 'FAIL: used schedule changed';end if;
  if has_function_privilege('authenticated','public.submit_checkpoint_attendance(uuid,uuid,text,uuid,text,double precision,double precision,double precision,text)','EXECUTE') then raise exception 'FAIL: direct browser RPC permission';end if;
end $$;
select 'PASS: staff identity + camera, separate checkpoint attempts, two scans, duplicates, four-window timing, manual checkpoint, complete-event statistics, immutable used schedule, server-only access' as result;
rollback;
