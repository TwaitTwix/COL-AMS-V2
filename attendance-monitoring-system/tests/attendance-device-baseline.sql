begin;
do $$
declare users uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  sid uuid;eid uuid:=gen_random_uuid();manual_event uuid:=gen_random_uuid();version uuid;marker text:=gen_random_uuid()::text;
  pc text:=marker||'-pc';phone text:=marker||'-phone';retired_phone text:=marker||'-retired';r jsonb;points integer;
begin
 for i in 1..6 loop
   insert into auth.users(id,email,email_confirmed_at) values(users[i],users[i]||'@test.invalid',now());
   sid:=gen_random_uuid();insert into public.students(id,name,student_number,student_token) values(sid,'Device fixture '||i,sid::text,sid::text);
   insert into public.user_profiles(user_id,full_name,personal_id,role,approval_status,privacy_version,student_id)
     values(users[i],'Device fixture '||i,users[i]::text,case when i=6 then 'admin' else 'student' end,'approved','2026-11-17',sid);
 end loop;
 insert into public.events(id,name,latitude,longitude,radius_meters,starts_at,ends_at) values(eid,'Baseline fixture',17,121,100,now()-interval '1 hour',now()+interval '1 hour'),(manual_event,'Manual fixture',17,121,100,now()-interval '1 hour',now()+interval '1 hour');
 select qr_version into version from public.events where id=eid;
 update public.user_profiles set attendance_device_hash=retired_phone,attendance_device_bound_at=now()-interval '1 day',retired_at=now() where user_id=users[4];
 perform set_config('role','service_role',true);
 -- PC registration, phone verification, and repeat login: no baseline or penalty.
 perform public.record_device_session(users[1],'signup',pc,'PC','127.0.0.1');
 r:=public.record_device_session(users[1],'verify',phone,'Phone','127.0.0.1');
 if (r->>'changed_device')::boolean or (r->>'requires_review')::boolean then raise exception 'FAIL: verification device penalized';end if;
 if exists(select 1 from public.user_profiles where user_id=users[1] and (attendance_device_hash is not null or penalty_points<>0)) then raise exception 'FAIL: login established baseline';end if;
 -- Another account merely logging in on the same PC is not attendance sharing.
 r:=public.record_device_session(users[2],'login',pc,'PC','127.0.0.1');
 if (r->>'shared_device')::boolean then raise exception 'FAIL: login-only sharing';end if;
 r:=public.submit_checkpoint_attendance(users[1],eid,null,version,phone,0,0,5);
 if not r?'error' or exists(select 1 from public.user_profiles where user_id=users[1] and attendance_device_hash is not null) then raise exception 'FAIL: rejected scan established baseline';end if;
 r:=public.submit_checkpoint_attendance(users[1],eid,null,version,phone,17,121,5);
 if r#>>'{attendance,status}'<>'approved' or not exists(select 1 from public.user_profiles where user_id=users[1] and attendance_device_hash=phone and penalty_points=0) then raise exception 'FAIL: first valid phone attendance';end if;
 -- Only now does changing back to PC count as an attendance-device change.
 r:=public.record_device_session(users[1],'later-login',pc,'PC','127.0.0.1');
 if not (r->>'changed_device')::boolean then raise exception 'FAIL: post-attendance change not flagged';end if;
 perform public.record_device_session(users[1],'later-login',pc,'PC','127.0.0.1');
 select penalty_points into points from public.user_profiles where user_id=users[1];if points<>1 then raise exception 'FAIL: repeat point';end if;
 update public.device_incidents set status='trusted',reviewed_by=users[6],reviewed_at=now() where user_id=users[1] and device_hash=pc;
 r:=public.record_device_session(users[1],'trusted-login',pc,'PC','127.0.0.1');if (r->>'requires_review')::boolean then raise exception 'FAIL: admin trust ignored';end if;
 -- A genuine shared attendance browser still holds the new user's attendance.
 r:=public.record_device_session(users[3],'shared-first',phone,'Phone','127.0.0.1');
 if not (r->>'shared_device')::boolean or not (r->>'requires_review')::boolean then raise exception 'FAIL: real attendance sharing ignored';end if;
 r:=public.submit_checkpoint_attendance(users[3],eid,null,version,phone,17,121,5);
 if r#>>'{attendance,status}'<>'pending_review' then raise exception 'FAIL: shared attendance auto approved';end if;
 perform public.record_device_session(users[3],'shared-again',phone,'Phone','127.0.0.1');
 if exists(select 1 from public.user_profiles where user_id=users[3] and penalty_points<>0) then raise exception 'FAIL: shared first registration gained penalty';end if;
 r:=public.submit_checkpoint_attendance(users[2],eid,null,version,pc,17,121,5);
 if r#>>'{attendance,status}'<>'approved' then raise exception 'FAIL: PC used only for others login flagged';end if;
 -- Retired ownership is excluded, and manual attendance never binds a device.
 r:=public.record_device_session(users[5],'retired-reuse',retired_phone,'Phone','127.0.0.1');
 if (r->>'shared_device')::boolean then raise exception 'FAIL: retired account sharing';end if;
 select student_id into sid from public.user_profiles where user_id=users[5];
 perform public.record_checkpoint_manual(users[6],sid,manual_event,'ID and venue verified');
 if exists(select 1 from public.user_profiles where user_id=users[5] and attendance_device_hash is not null) then raise exception 'FAIL: manual attendance established browser';end if;
 if has_function_privilege('authenticated','public.evaluate_attendance_device(uuid,text,boolean)','EXECUTE') or has_function_privilege('anon','public.attendance_browser_shared(uuid,text)','EXECUTE') then raise exception 'FAIL: public device-policy RPC';end if;
end $$;
select 'PASS: PC signup/phone verification, invalid scan, first venue scan, later change, repeated login, trusted incident, real sharing without first-login penalty, retired ownership, manual attendance and permissions' as result;
rollback;
