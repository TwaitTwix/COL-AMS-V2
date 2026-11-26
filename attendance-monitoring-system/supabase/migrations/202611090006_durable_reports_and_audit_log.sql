-- Persist report state and auditable, server-written actions.
create table if not exists public.report_jobs (
  id uuid primary key,
  requested_by uuid references auth.users(id) on delete set null,
  event_id uuid not null references public.events(id) on delete restrict,
  format text not null check (format in ('csv', 'xlsx', 'pdf', 'docx')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  file_path text,
  record_count integer check (record_count is null or record_count >= 0),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists report_jobs_status_created_idx
  on public.report_jobs(status, created_at);
create index if not exists report_jobs_requested_by_created_idx
  on public.report_jobs(requested_by, created_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx
  on public.audit_logs(created_at desc);
create index if not exists audit_logs_actor_created_idx
  on public.audit_logs(actor_user_id, created_at desc);

alter table public.report_jobs enable row level security;
alter table public.audit_logs enable row level security;

grant select, insert, update on public.report_jobs to service_role;
grant select, insert on public.audit_logs to service_role;
