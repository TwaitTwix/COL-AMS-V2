-- Execute against a migrated development project. Every fixture and action is
-- rolled back, including fake Auth identities; no real account is modified.
begin;
do $$
declare uid uuid:=gen_random_uuid(); other_uid uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email,email_confirmed_at) values(uid,uid||'@test.invalid',now()),(other_uid,other_uid||'@test.invalid',now());
  insert into public.user_profiles(user_id,full_name,personal_id,institution,college,course) values(uid,'Workflow fixture',uid::text,'ISAP','College of Information Technology and Engineering','Bachelor of Science in Information Technology'),(other_uid,'Shared device fixture',other_uid::text,'ISAP','College of Information Technology and Engineering','Bachelor of Science in Information Technology');
  insert into public.events(id,name,latitude,longitude,radius_meters,starts_at,ends_at) values(eid,'Workflow fixture',17.6,121.7,100,now()+interval '30 minutes',now()+interval '2 hours');
  perform set_config('test.uid',uid::text,true);perform set_config('test.other_uid',other_uid::text,true);perform set_config('test.eid',eid::text,true);
end $$;
set local role service_role;
do $$
declare uid uuid:=current_setting('test.uid')::uuid; other_uid uuid:=current_setting('test.other_uid')::uuid; eid uuid:=current_setting('test.eid')::uuid; actor uuid; version uuid; result jsonb; caught boolean; points integer;
begin
  select user_id into strict actor from public.user_profiles where role='main_admin';
  select qr_version into version from public.events where id=eid;
  caught:=false;begin perform public.approve_registration(uid,other_uid,'approved','Forbidden test');exception when raise_exception then caught:=true;end;
  if not caught then raise exception 'TEST FAILED: a student approved another student';end if;
  perform public.approve_registration(actor,uid,'approved','Test approval');
  perform public.approve_registration(actor,other_uid,'approved','Test approval');
  result:=public.record_device_session(uid,'session-a','device-a','Test browser','127.0.0.1');
  if (result->>'requires_review')::boolean then raise exception 'TEST FAILED: first device flagged';end if;
  caught:=false;begin perform public.submit_event_attendance(uid,eid,version,'device-a',0,0,5);exception when raise_exception then caught:=true;end;
  if not caught then raise exception 'TEST FAILED: outside geofence accepted';end if;
  caught:=false;begin perform public.submit_event_attendance(uid,eid,version,'device-a',17.6,121.7,200);exception when raise_exception then caught:=true;end;
  if not caught then raise exception 'TEST FAILED: inaccurate GPS accepted';end if;
  caught:=false;begin perform public.submit_event_attendance(uid,eid,gen_random_uuid(),'device-a',17.6,121.7,5);exception when raise_exception then caught:=true;end;
  if not caught then raise exception 'TEST FAILED: revoked QR accepted';end if;
  result:=public.submit_event_attendance(uid,eid,version,'device-a',17.6,121.7,5);
  if result->>'status'<>'approved' then raise exception 'TEST FAILED: valid early check-in was not approved';end if;
  caught:=false;begin perform public.submit_event_attendance(uid,eid,version,'device-a',17.6,121.7,5);exception when unique_violation then caught:=true;end;
  if not caught then raise exception 'TEST FAILED: duplicate attendance accepted';end if;
  result:=public.record_device_session(uid,'session-b','device-b','Different browser','127.0.0.1');
  if not (result->>'requires_review')::boolean then raise exception 'TEST FAILED: changed device not flagged';end if;
  perform public.record_device_session(uid,'session-b','device-b','Different browser','127.0.0.1');
  select penalty_points into points from public.user_profiles where user_id=uid;
  if points<>1 then raise exception 'TEST FAILED: device penalty not idempotent';end if;
  result:=public.record_device_session(other_uid,'session-c','device-a','Shared browser','127.0.0.1');
  if not (result->>'shared_device')::boolean then raise exception 'TEST FAILED: shared device not flagged';end if;
  result:=public.submit_event_attendance(other_uid,eid,version,'device-a',17.6,121.7,5);
  if result->>'status'<>'pending_review' then raise exception 'TEST FAILED: shared attendance not held';end if;
  result:=public.event_attendance_statistics(eid);
  if not exists(select 1 from jsonb_array_elements(result) r where r->>'institution'='ISAP' and r->>'level'='institution' and (r->>'attended')::integer=1) then raise exception 'TEST FAILED: pending attendance included in statistics';end if;
  update public.events set starts_at=now()+interval '3 hours',ends_at=now()+interval '4 hours' where id=eid;
  caught:=false;begin perform public.submit_event_attendance(other_uid,eid,version,'device-a',17.6,121.7,5);exception when raise_exception then caught:=true;end;
  if not caught then raise exception 'TEST FAILED: early closed event accepted';end if;
end $$;
select 'PASS: approvals, geofence, accuracy, QR rotation, one-hour access, duplicates, device penalties, shared-device review, statistics' as result;
rollback;
