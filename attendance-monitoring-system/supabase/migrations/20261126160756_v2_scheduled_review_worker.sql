-- Managed Supabase add-on; pg_cron is not available in the local Windows substitute.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
select cron.schedule('col-ams-v2-review-escalation','* * * * *','select public.process_attendance_review_queue(100);');
