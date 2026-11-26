-- Add student identity links and the three application roles used by the portals.
alter table public.user_profiles
  add column if not exists email text,
  add column if not exists student_id uuid references public.students(id) on delete set null;

alter table public.user_profiles
  drop constraint if exists user_profiles_role_check;

alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role in ('pending', 'student', 'student_officer', 'col_officer', 'officer', 'admin'));

create unique index if not exists user_profiles_student_id_unique_idx
  on public.user_profiles(student_id)
  where student_id is not null;
