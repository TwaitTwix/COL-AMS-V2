-- Auth retirement is verified through the server-only Auth Admin API.
-- service_role has no SELECT privilege on the managed auth.users table.
drop function public.finish_archived_email_release(uuid,uuid);
create function public.finish_archived_email_release(p_actor uuid,p_user uuid,p_auth_retired boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles;
begin
  if not exists(select 1 from public.user_profiles where user_id=p_actor and role in ('main_admin','admin') and approval_status='approved' and retired_at is null and privacy_version='2026-11-17') then raise exception 'Administrator access required';end if;
  select * into strict p from public.user_profiles where user_id=p_user for update;
  if p.retired_at is null then raise exception 'Retirement has not started';end if;
  if p.email_release_completed_at is not null then return jsonb_build_object('completed',true);end if;
  if p_auth_retired is distinct from true then raise exception 'The Auth login has not been retired. Retry email release';end if;
  update public.user_profiles set email_release_completed_at=now(),student_id=null,personal_id=null where user_id=p_user;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'account.email_released','user_profile',p_user::text,jsonb_build_object('student_id',p.retired_student_id,'email',p.email,'reason',p.email_release_reason));
  return jsonb_build_object('completed',true);
end $$;

revoke all on function public.finish_archived_email_release(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.finish_archived_email_release(uuid,uuid,boolean) to service_role;
