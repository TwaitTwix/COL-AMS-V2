alter table public.user_profiles add column retired_at timestamptz,
  add column retired_student_id uuid references public.students(id),
  add column retired_personal_id text,
  add column email_release_completed_at timestamptz,
  add column email_release_reason text,
  add column retired_by uuid references auth.users(id);
create index user_profiles_retired_student_idx on public.user_profiles(retired_student_id) where retired_student_id is not null;
create index user_profiles_retired_by_idx on public.user_profiles(retired_by) where retired_by is not null;

create function public.begin_archived_email_release(p_actor uuid,p_student uuid,p_user uuid,p_email text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles;s public.students;
begin
  if p_actor=p_user or not exists(select 1 from public.user_profiles where user_id=p_actor and role in ('main_admin','admin') and approval_status='approved' and retired_at is null and privacy_version='2026-11-17') then raise exception 'Administrator access required';end if;
  if length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'A reason is required';end if;
  select * into strict p from public.user_profiles where user_id=p_user for update;
  select * into strict s from public.students where id=p_student for update;
  if s.archived_at is null then raise exception 'Archive the student record before releasing its email';end if;
  if p.role not in ('student','student_officer','pending') or lower(coalesce(p.email,''))='leonardolllmacalinaoisap@gmail.com' then raise exception 'Administrator and staff accounts cannot be retired here';end if;
  if lower(trim(coalesce(p_email,'')))<>lower(coalesce(p.email,'')) or p.email is null then raise exception 'The linked email changed. Refresh and confirm the current email';end if;
  if p.student_id is distinct from p_student and p.retired_student_id is distinct from p_student then raise exception 'This account is no longer linked to this student record';end if;
  if p.email_release_completed_at is not null then return jsonb_build_object('user_id',p.user_id,'completed',true);end if;
  if p.retired_at is null then
    update public.user_profiles set retired_at=now(),retired_by=p_actor,retired_student_id=p_student,retired_personal_id=personal_id,email_release_reason=trim(p_reason) where user_id=p_user;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'account.email_release_started','user_profile',p_user::text,jsonb_build_object('student_id',p_student,'email',p.email,'reason',trim(p_reason)));
  end if;
  return jsonb_build_object('user_id',p.user_id,'completed',false);
end $$;

create function public.finish_archived_email_release(p_actor uuid,p_user uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles;
begin
  if not exists(select 1 from public.user_profiles where user_id=p_actor and role in ('main_admin','admin') and approval_status='approved' and retired_at is null and privacy_version='2026-11-17') then raise exception 'Administrator access required';end if;
  select * into strict p from public.user_profiles where user_id=p_user for update;
  if p.retired_at is null then raise exception 'Retirement has not started';end if;
  if p.email_release_completed_at is not null then return jsonb_build_object('completed',true);end if;
  if not exists(select 1 from auth.users where id=p_user and deleted_at is not null) then raise exception 'The Auth login has not been retired. Retry email release';end if;
  update public.user_profiles set email_release_completed_at=now(),student_id=null,personal_id=null where user_id=p_user;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'account.email_released','user_profile',p_user::text,jsonb_build_object('student_id',p.retired_student_id,'email',p.email,'reason',p.email_release_reason));
  return jsonb_build_object('completed',true);
end $$;
revoke all on function public.begin_archived_email_release(uuid,uuid,uuid,text,text),public.finish_archived_email_release(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_archived_email_release(uuid,uuid,uuid,text,text),public.finish_archived_email_release(uuid,uuid) to service_role;
