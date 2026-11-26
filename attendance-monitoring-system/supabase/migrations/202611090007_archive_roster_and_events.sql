-- Archive records instead of deleting rows referenced by attendance history.
alter table public.students add column if not exists archived_at timestamptz;
alter table public.events add column if not exists archived_at timestamptz;

create index if not exists students_active_name_idx
  on public.students(name) where archived_at is null;
create index if not exists events_active_window_idx
  on public.events(starts_at, ends_at) where archived_at is null;
