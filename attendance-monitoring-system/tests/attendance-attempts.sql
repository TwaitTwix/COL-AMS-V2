-- Disposable fixtures and all attendance, audit, and device writes roll back.
begin;
do $$
declare uid uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid(); second_event uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email,email_confirmed_at) values(uid,uid||'@test.invalid',now());
  insert into public.user_profiles(user_id,full_name,personal_id,institution,college,course)
    values(uid,'Attempt limit fixture',uid::text,'ISAP','College of Information Technology and Engineering','Bachelor of Science in Information Technology');
  insert into public.events(id,name,latitude,longitude,radius_meters,starts_at,ends_at,max_check_in_attempts)
    values(eid,'Attempt limit fixture',17.6,121.7,100,now(),now()+interval '2 hours',3),
    (second_event,'Custom limit fixture',17.6,121.7,100,now(),now()+interval '2 hours',1);
  perform set_config('test.uid',uid::text,true);perform set_config('test.eid',eid::text,true);perform set_config('test.second',second_event::text,true);
end $$;
set local role service_role;
do $$
declare uid uuid:=current_setting('test.uid')::uuid; eid uuid:=current_setting('test.eid')::uuid; second_event uuid:=current_setting('test.second')::uuid;
  actor uuid; version uuid; result jsonb; sid uuid; tries integer;
begin
  select user_id into strict actor from public.user_profiles where role='main_admin';
  perform public.approve_registration(actor,uid,'approved','Test approval');
  perform public.record_device_session(uid,'attempt-session','attempt-device','Test browser','127.0.0.1');
  select student_id into sid from public.user_profiles where user_id=uid;
  select qr_version into version from public.events where id=eid;
  result:=public.attempt_event_attendance(uid,eid,version,'attempt-device',0,0,5);
  if result->>'error'<>'Outside geofence perimeter' or (result#>>'{attempts,remaining}')::integer<>2 then raise exception 'FAIL: first geofence rejection not persisted';end if;
  result:=public.attempt_event_attendance(uid,eid,version,'attempt-device',17.6,121.7,200);
  if (result#>>'{attempts,remaining}')::integer<>1 then raise exception 'FAIL: GPS rejection not counted';end if;
  result:=public.attempt_event_attendance(uid,eid,null,'attempt-device',17.6,121.7,5,'Invalid event QR code');
  if not (result#>>'{attempts,locked}')::boolean then raise exception 'FAIL: third rejection did not lock';end if;
  result:=public.attempt_event_attendance(uid,eid,version,'attempt-device',17.6,121.7,5);
  if result->>'error'<>'Attendance attempt limit reached. Contact an administrator.' then raise exception 'FAIL: valid scan bypassed lock';end if;
  select rejected_count into tries from public.attendance_attempts where student_id=sid and event_id=eid;
  if tries<>3 or exists(select 1 from public.attendance_logs where student_id=sid and event_id=eid) then raise exception 'FAIL: locked scan created attendance or incremented quota';end if;
  -- An administrator may increase the event cap without clearing history.
  update public.events set max_check_in_attempts=4 where id=eid;
  result:=public.attempt_event_attendance(uid,eid,version,'attempt-device',17.6,121.7,5);
  if result#>>'{attendance,status}'<>'approved' then raise exception 'FAIL: increased cap did not permit success';end if;
  result:=public.attempt_event_attendance(uid,eid,version,'attempt-device',17.6,121.7,5);
  if (result->>'http_status')::integer<>409 then raise exception 'FAIL: duplicate accepted';end if;
  select rejected_count into tries from public.attendance_attempts where student_id=sid and event_id=eid;
  if tries<>3 then raise exception 'FAIL: duplicate consumed a try';end if;
  select qr_version into version from public.events where id=second_event;
  result:=public.attempt_event_attendance(uid,second_event,version,'attempt-device',0,0,5);
  if (result#>>'{attempts,limit}')::integer<>1 or not (result#>>'{attempts,locked}')::boolean then raise exception 'FAIL: custom cap ignored';end if;
  if has_table_privilege('authenticated','public.attendance_attempts','UPDATE') or has_function_privilege('authenticated','public.attempt_event_attendance(uuid,uuid,uuid,text,double precision,double precision,double precision,text)','EXECUTE') then raise exception 'FAIL: client can alter quota';end if;
end $$;
select 'PASS: rejection persistence, three-try lock, custom cap, per-event isolation, cap edit, success, duplicates, private permissions' as result;
rollback;
