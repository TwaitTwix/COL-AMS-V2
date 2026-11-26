begin;
do $$
declare actor uuid:=gen_random_uuid();uid uuid:=gen_random_uuid();other_actor uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();eid uuid:=gen_random_uuid();pid text:=uid::text;login_email text:=uid||'@test.invalid';r jsonb;caught boolean;
begin
 insert into auth.users(id,email,email_confirmed_at) values(actor,actor||'@test.invalid',now()),(uid,login_email,now()),(other_actor,other_actor||'@test.invalid',now());
 insert into public.students(id,name,student_number,student_token) values(sid,'Release fixture',pid,pid);
 insert into public.user_profiles(user_id,full_name,email,role,approval_status,privacy_version,student_id,personal_id) values(actor,'Admin fixture',actor||'@test.invalid','admin','approved','2026-11-17',null,null),(uid,'Release fixture',login_email,'student','approved','2026-11-17',sid,pid),(other_actor,'COL fixture',other_actor||'@test.invalid','col_officer','approved','2026-11-17',null,null);
 insert into public.events(id,name,latitude,longitude,radius_meters,starts_at,ends_at) values(eid,'Fixture',17,121,100,now(),now()+interval '1 hour');
 insert into public.attendance_logs(student_id,event_id,user_id,status,distance_from_venue_meters) values(sid,eid,uid,'approved',10);
 caught:=false;begin perform public.begin_archived_email_release(actor,sid,uid,login_email,'Correction');exception when raise_exception then caught:=true;end;if not caught then raise exception 'FAIL: active record retirement';end if;
 update public.students set archived_at=now() where id=sid;
 caught:=false;begin perform public.begin_archived_email_release(other_actor,sid,uid,login_email,'Correction');exception when raise_exception then caught:=true;end;if not caught then raise exception 'FAIL: COL retirement access';end if;
 caught:=false;begin perform public.begin_archived_email_release(actor,sid,uid,'wrong@test.invalid','Correction');exception when raise_exception then caught:=true;end;if not caught then raise exception 'FAIL: stale email';end if;
 update public.user_profiles set role='admin' where user_id=uid;
 caught:=false;begin perform public.begin_archived_email_release(actor,sid,uid,login_email,'Correction');exception when raise_exception then caught:=true;end;if not caught then raise exception 'FAIL: protected admin retirement';end if;
 update public.user_profiles set role='student' where user_id=uid;
 r:=public.begin_archived_email_release(actor,sid,uid,login_email,'Correction');
 caught:=false;begin update public.user_profiles set role='admin' where user_id=uid;exception when raise_exception then caught:=true;end;if not caught then raise exception 'FAIL: retired role reassignment';end if;
 if not exists(select 1 from public.user_profiles where user_id=uid and retired_at is not null and personal_id=pid) then raise exception 'FAIL: block pending retirement without freeing ID';end if;
 caught:=false;begin perform public.finish_archived_email_release(actor,uid);exception when raise_exception then caught:=true;end;if not caught then raise exception 'FAIL: release before Auth retirement';end if;
 -- Run completion with the same restricted role used by the deployed server.
 perform set_config('role','service_role',true);
 r:=public.finish_archived_email_release(actor,uid,true);
 if not exists(select 1 from public.user_profiles where user_id=uid and email_release_completed_at is not null and student_id is null and personal_id is null and retired_student_id=sid and retired_personal_id=pid and email=login_email) then raise exception 'FAIL: identity release/history mapping';end if;
 if not exists(select 1 from public.attendance_logs where user_id=uid and student_id=sid and status='approved') then raise exception 'FAIL: attendance history changed';end if;
 r:=public.begin_archived_email_release(actor,sid,uid,login_email,'Repeat');if r->>'completed'<>'true' then raise exception 'FAIL: retry completed release';end if;
 if (select count(*) from public.audit_logs where entity_id=uid::text and action='account.email_released')<>1 then raise exception 'FAIL: audit/idempotency';end if;
 if has_function_privilege('authenticated','public.begin_archived_email_release(uuid,uuid,uuid,text,text)','EXECUTE') then raise exception 'FAIL: browser RPC access';end if;
end $$;
select 'PASS: archived-only, stale identity, role protection, pending block, Auth completion gate, history, retry and audit' as result;
rollback;
