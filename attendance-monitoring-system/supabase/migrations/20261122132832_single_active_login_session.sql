alter table public.user_profiles add column active_login_session_id uuid,add column active_login_started_at timestamptz;

-- Managed Auth tables are not readable by service_role. Expose only the
-- existence/start time of the exact verified user/session pair, in a private
-- schema. Never grant broad Auth-table access or browser execution privileges.
create schema if not exists app_private;
revoke all on schema app_private from public,anon,authenticated;
grant usage on schema app_private to service_role;
create function app_private.login_session_started(p_user uuid,p_session uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
 select s.created_at from auth.sessions s join auth.users u on u.id=s.user_id
 where s.id=p_session and s.user_id=p_user and u.deleted_at is null
 and (s.not_after is null or s.not_after>now());
$$;
revoke all on function app_private.login_session_started(uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.login_session_started(uuid,uuid) to service_role;

create function public.enforce_active_login(p_user uuid,p_session uuid,p_activate boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles;started timestamptz;
begin
 select * into strict p from public.user_profiles where user_id=p_user for update;
 if p.retired_at is not null then return jsonb_build_object('active',false);end if;
 started:=app_private.login_session_started(p_user,p_session);
 if started is null then return jsonb_build_object('active',false);end if;
 if p.active_login_session_id=p_session then return jsonb_build_object('active',true);end if;
 -- Only explicit new sign-ins/verification callbacks can replace a session.
 -- An older session cannot reclaim access by refreshing or calling activation.
 if p.active_login_session_id is null or (p_activate and (started>p.active_login_started_at or (started=p.active_login_started_at and p_session>p.active_login_session_id))) then
   update public.user_profiles set active_login_session_id=p_session,active_login_started_at=started where user_id=p_user;
   if p.active_login_session_id is not null then
     insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_user,'account.session_replaced','user_profile',p_user::text,jsonb_build_object('previous_session',p.active_login_session_id,'active_session',p_session));
   end if;
   return jsonb_build_object('active',true);
 end if;
 return jsonb_build_object('active',false);
end $$;
revoke all on function public.enforce_active_login(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.enforce_active_login(uuid,uuid,boolean) to service_role;
