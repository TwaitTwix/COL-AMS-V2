-- Keep this constraint as the final guard against concurrent duplicate check-ins.
create unique index if not exists attendance_logs_student_event_unique
  on public.attendance_logs (student_id, event_id);
