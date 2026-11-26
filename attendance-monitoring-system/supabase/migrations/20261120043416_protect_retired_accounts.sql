create function public.protect_retired_account() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.retired_at is not null and (
    new.role is distinct from old.role or new.approval_status is distinct from old.approval_status
    or new.retired_at is distinct from old.retired_at
    or new.retired_student_id is distinct from old.retired_student_id
    or new.retired_personal_id is distinct from old.retired_personal_id
    or new.email is distinct from old.email
    or (new.student_id is not null and new.student_id is distinct from old.student_id)
    or (new.personal_id is not null and new.personal_id is distinct from old.personal_id)
  ) then raise exception 'Retired accounts cannot be reactivated or reassigned';end if;
  return new;
end $$;
create trigger protect_retired_account before update on public.user_profiles for each row execute function public.protect_retired_account();
revoke all on function public.protect_retired_account() from public,anon,authenticated;
grant execute on function public.protect_retired_account() to service_role;
