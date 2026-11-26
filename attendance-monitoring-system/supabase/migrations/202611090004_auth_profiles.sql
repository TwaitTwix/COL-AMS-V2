-- App roles are server-managed; public sign-ups start pending until approved.
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'pending'
    check (role in ('pending', 'officer', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;
grant select, insert, update on public.user_profiles to service_role;
