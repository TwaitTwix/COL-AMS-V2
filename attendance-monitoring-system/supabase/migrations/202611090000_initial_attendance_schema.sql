-- Minimal schema required by the attendance check-in and reporting APIs.
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_meters double precision not null check (radius_meters > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  constraint events_active_window_valid check (starts_at <= ends_at)
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  student_number text not null unique,
  student_token text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete cascade,
  distance_from_venue_meters double precision not null check (distance_from_venue_meters >= 0),
  checked_in_at timestamptz not null default now()
);

create index if not exists attendance_logs_event_id_idx on public.attendance_logs(event_id);
create index if not exists attendance_logs_student_id_idx on public.attendance_logs(student_id);

alter table public.events enable row level security;
alter table public.students enable row level security;
alter table public.attendance_logs enable row level security;

-- The application uses a server-only secret key; no browser role gets table access.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.events to service_role;
grant select, insert, update, delete on public.students to service_role;
grant select, insert, update, delete on public.attendance_logs to service_role;
