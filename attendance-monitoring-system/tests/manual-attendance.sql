begin;
do $$
declare actor uuid:=gen_random_uuid(); student_user uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,actor||'@test.invalid',now()),(student_user,student_user||'@test.invalid',now());
  insert into public.students(id,name,student_number,student_token,institution,college,course) values(sid,'Manual attendance fixture',sid::text,sid::text,'ISAP','College of Information Technology and Engineering','Bachelor of Science in Information Technology');
  insert into public.user_profiles(user_id,role,approval_status,student_id) values(actor,'admin','approved',null),(student_user,'student','approved',sid);
  insert into public.events(id,name,latitude,longitude,radius_meters,starts_at,ends_at) values(eid,'Manual fixture',17.6,121.7,100,now(),now()+interval '2 hours');
  insert into public.attendance_attempts(student_id,event_id,rejected_count) values(sid,eid,3);
  perform set_config('test.actor',actor::text,true);perform set_config('test.sid',sid::text,true);perform set_config('test.eid',eid::text,true);perform set_config('test.student',student_user::text,true);
end $$;
set local role service_role;
do $$
declare actor uuid:=current_setting('test.actor')::uuid; sid uuid:=current_setting('test.sid')::uuid; eid uuid:=current_setting('test.eid')::uuid;
  student_user uuid:=current_setting('test.student')::uuid; result jsonb; caught boolean;
begin
  caught:=false;begin perform public.record_manual_attendance(actor,sid,eid,'No device');exception when raise_exception then caught:=true;end;
  if not caught then raise exception 'FAIL: manual entry without staff privacy consent';end if;
  update public.user_profiles set privacy_version='2026-11-17',privacy_accepted_at=now() where user_id=actor;
  caught:=false;begin perform public.record_manual_attendance(student_user,sid,eid,'Unauthorized');exception when raise_exception then caught:=true;end;
  if not caught then raise exception 'FAIL: student used manual entry';end if;
  caught:=false;begin perform public.record_manual_attendance(actor,sid,eid,'');exception when raise_exception then caught:=true;end;
  if not caught then raise exception 'FAIL: missing reason accepted';end if;
  update public.events set starts_at=now()+interval '3 hours',ends_at=now()+interval '4 hours' where id=eid;
  caught:=false;begin perform public.record_manual_attendance(actor,sid,eid,'No device');exception when raise_exception then caught:=true;end;
  if not caught then raise exception 'FAIL: closed event accepted';end if;
  update public.events set starts_at=now(),ends_at=now()+interval '2 hours' where id=eid;
  result:=public.record_manual_attendance(actor,sid,eid,'No device; ID and presence verified');
  if result->>'entry_method'<>'manual' or result->>'status'<>'approved' or result->>'recorded_by'<>actor::text or result->>'user_id'<>student_user::text then raise exception 'FAIL: manual provenance incorrect';end if;
  if result->>'distance_from_venue_meters' is not null or result->>'device_hash' is not null or result->>'latitude' is not null then raise exception 'FAIL: manual entry fabricates GPS/device';end if;
  caught:=false;begin perform public.record_manual_attendance(actor,sid,eid,'Duplicate');exception when unique_violation then caught:=true;end;
  if not caught then raise exception 'FAIL: duplicate manual attendance accepted';end if;
  if not exists(select 1 from public.audit_logs where actor_user_id=actor and action='attendance.manual_recorded' and entity_id=result->>'id') then raise exception 'FAIL: manual audit missing';end if;
  if (select rejected_count from public.attendance_attempts where student_id=sid and event_id=eid)<>3 then raise exception 'FAIL: manual entry altered scan quota';end if;
  if has_function_privilege('authenticated','public.record_manual_attendance(uuid,uuid,uuid,text)','EXECUTE') then raise exception 'FAIL: browser has direct manual entry permission';end if;
end $$;
select 'PASS: manual authorization, consent, reason, active window, quota bypass, truthful location fields, audit, and duplicates' as result;
rollback;
