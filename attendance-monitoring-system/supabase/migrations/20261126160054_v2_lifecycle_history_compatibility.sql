-- Fresh V2 only. Schema compatibility for read-only legacy-history branches.
-- No release, retirement, Auth deletion, email reuse or reassignment functions are installed.
alter table public.user_profiles
 add column retired_at timestamptz,
 add column retired_student_id uuid references public.students(id),
 add column retired_personal_id text,
 add column email_release_completed_at timestamptz,
 add column email_release_reason text,
 add column retired_by uuid references auth.users(id);
alter table public.user_profiles add constraint v2_no_identity_retirement check(
 retired_at is null and retired_student_id is null and retired_personal_id is null
 and email_release_completed_at is null and email_release_reason is null and retired_by is null
);
