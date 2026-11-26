alter table public.user_profiles add column privacy_version text;
alter table public.user_profiles add column privacy_accepted_at timestamptz;
alter table public.attendance_logs alter column distance_from_venue_meters drop not null;
alter table public.attendance_logs add column entry_method text not null default 'qr' check(entry_method in ('qr','manual'));
alter table public.attendance_logs add column recorded_by uuid references auth.users(id);
alter table public.attendance_logs add column manual_reason text;
create index attendance_recorded_by_idx on public.attendance_logs(recorded_by);

create or replace function public.record_manual_attendance(p_actor uuid,p_student uuid,p_event uuid,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor public.user_profiles; s public.students; e public.events; a public.attendance_logs; uid uuid;
begin
  select * into strict actor from public.user_profiles where user_id=p_actor for share;
  if actor.approval_status<>'approved' or actor.role not in ('main_admin','admin','col_officer') then raise exception 'Administrator or COL officer access required';end if;
  if actor.privacy_version is distinct from '2026-11-17' then raise exception 'Accept the privacy notice before continuing';end if;
  if p_reason is null or length(trim(p_reason))<3 or length(p_reason)>1000 then raise exception 'Explain why manual attendance is needed';end if;
  select * into strict s from public.students where id=p_student and archived_at is null for share;
  select * into strict e from public.events where id=p_event and archived_at is null for share;
  if now()<e.starts_at-interval '1 hour' or now()>e.ends_at then raise exception 'Event is not currently accepting attendance';end if;
  if (e.institution is not null and e.institution is distinct from s.institution) or (e.college is not null and e.college is distinct from s.college) then raise exception 'This event is for a different institution or college';end if;
  select user_id into uid from public.user_profiles where student_id=s.id;
  insert into public.attendance_logs(student_id,event_id,user_id,distance_from_venue_meters,status,entry_method,recorded_by,manual_reason,reviewed_by,reviewed_at,review_note)
    values(s.id,e.id,uid,null,'approved','manual',p_actor,trim(p_reason),p_actor,now(),'In-person manual verification') returning * into a;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details)
    values(p_actor,'attendance.manual_recorded','attendance_log',a.id::text,jsonb_build_object('student_id',s.id,'event_id',e.id,'reason',trim(p_reason),'gps_verified',false));
  return to_jsonb(a);
end $$;
revoke all on function public.record_manual_attendance(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_manual_attendance(uuid,uuid,uuid,text) to service_role;
