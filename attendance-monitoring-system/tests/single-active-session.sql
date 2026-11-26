begin;
do $$
declare uid uuid:=gen_random_uuid();other_uid uuid:=gen_random_uuid();old_session uuid:=gen_random_uuid();new_session uuid:=gen_random_uuid();verification_session uuid:=gen_random_uuid();r jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(uid,uid||'@test.invalid',now()),(other_uid,other_uid||'@test.invalid',now());
 insert into public.user_profiles(user_id,full_name) values(uid,'Session fixture'),(other_uid,'Other fixture');
 insert into auth.sessions(id,user_id,created_at) values(old_session,uid,now()-interval '2 hours'),(new_session,uid,now()-interval '1 hour'),(verification_session,uid,now());
 perform set_config('role','service_role',true);
 r:=public.enforce_active_login(uid,old_session,false);if r->>'active'<>'true' then raise exception 'FAIL: migration enrollment';end if;
 r:=public.enforce_active_login(uid,new_session,false);if r->>'active'<>'false' then raise exception 'FAIL: unauthenticated takeover without activation';end if;
 r:=public.enforce_active_login(uid,new_session,true);if r->>'active'<>'true' then raise exception 'FAIL: explicit new login';end if;
 r:=public.enforce_active_login(uid,old_session,false);if r->>'active'<>'false' then raise exception 'FAIL: previous token retained API access';end if;
 r:=public.enforce_active_login(uid,old_session,true);if r->>'active'<>'false' then raise exception 'FAIL: stale session reclaimed access';end if;
 r:=public.enforce_active_login(uid,new_session,false);if r->>'active'<>'true' then raise exception 'FAIL: refresh/session-ID persistence';end if;
 r:=public.enforce_active_login(uid,verification_session,false);if r->>'active'<>'false' then raise exception 'FAIL: temporary password check displaced session';end if;
 r:=public.enforce_active_login(other_uid,new_session,true);if r->>'active'<>'false' then raise exception 'FAIL: cross-user session';end if;
 r:=public.enforce_active_login(uid,gen_random_uuid(),true);if r->>'active'<>'false' then raise exception 'FAIL: nonexistent Auth session';end if;
 if (select count(*) from public.audit_logs where actor_user_id=uid and action='account.session_replaced')<>1 then raise exception 'FAIL: session replacement audit';end if;
 if has_table_privilege('service_role','auth.sessions','SELECT') then raise exception 'FAIL: broad Auth privileges granted';end if;
 if has_function_privilege('authenticated','public.enforce_active_login(uuid,uuid,boolean)','EXECUTE') or has_function_privilege('anon','app_private.login_session_started(uuid,uuid)','EXECUTE') then raise exception 'FAIL: public session-management privilege';end if;
end $$;
select 'PASS: newest login, old-token denial, refresh, explicit activation, temporary verification isolation, subject ownership, audit and private permissions' as result;
rollback;
