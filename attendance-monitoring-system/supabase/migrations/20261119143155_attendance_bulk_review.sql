-- Shared classification for filtering, previewing and committing bulk approvals.
create or replace function public.attendance_review_flagged(a public.attendance_logs)
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce(a.risk_reasons,'[]'::jsonb)<>'[]'::jsonb or exists(
    select 1 from public.device_incidents d where d.status='open'
    and (d.user_id=a.user_id or (a.device_hash is not null and d.device_hash=a.device_hash))
  );
$$;
create or replace function public.attendance_review_rows(p_state text,p_search text,p_risk text)
returns table(id uuid,created_at timestamptz,user_name text,email text,bucket text,status text,label text,details jsonb)
language sql stable security invoker set search_path='' as $$
  select a.id,a.checked_in_at,coalesce(s.name,p.full_name,p.email,'Unknown participant'),p.email,
    case when a.status='pending_review' then 'pending' else 'history' end,a.status,
    concat_ws(' · ',coalesce(e.name,'Event unavailable'),a.checkpoint_label),
    to_jsonb(a)||jsonb_build_object('event_name',e.name,'student_name',s.name,'flagged',public.attendance_review_flagged(a))
  from public.attendance_logs a
  left join public.students s on s.id=a.student_id
  left join public.user_profiles p on p.user_id=a.user_id
  left join public.events e on e.id=a.event_id
  where (a.status='pending_review' or (a.reviewed_at is not null and a.entry_method<>'manual'))
    and (p_state='all' or (p_state='pending' and a.status='pending_review') or (p_state='history' and a.status<>'pending_review'))
    and strpos(lower(concat_ws(' ',s.name,s.student_number,p.email,e.name,a.checkpoint_label,a.risk_reasons::text,a.review_note)),lower(trim(coalesce(p_search,''))))>0
    and (p_risk='all' or (p_risk='flagged' and public.attendance_review_flagged(a)) or (p_risk='unflagged' and not public.attendance_review_flagged(a)));
$$;
create or replace function public.list_filtered_reviews(p_category text,p_state text,p_search text,p_page integer,p_size integer,p_risk text default 'all')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_category not in ('notifications','attendance','devices') or p_state not in ('pending','history','all') or p_risk not in ('all','flagged','unflagged') or p_page is null or p_page<1 or p_page>100000 or p_size is null or p_size<1 or p_size>50 or length(coalesce(p_search,''))>100 then raise exception 'Invalid review filters';end if;
  if p_category<>'attendance' then return public.list_review_items(p_category,p_state,p_search,p_page,p_size);end if;
  with filtered as materialized (select * from public.attendance_review_rows(p_state,p_search,p_risk)),
    page_rows as (select * from filtered order by created_at desc,id desc limit p_size offset ((p_page-1)*p_size))
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc) from page_rows r),'[]'::jsonb),'total',(select count(*) from filtered),'page',p_page,'page_size',p_size) into result;
  return result;
end $$;
create or replace function public.preview_unflagged_attendance(p_search text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if length(coalesce(p_search,''))>100 then raise exception 'Invalid search';end if;
  with matches as materialized (select * from public.attendance_review_rows('pending',p_search,'unflagged')),
    batch as (select id from matches order by created_at desc,id desc limit 500)
  select jsonb_build_object('ids',coalesce((select jsonb_agg(id) from batch),'[]'::jsonb),'total',(select count(*) from matches)) into result;
  return result;
end $$;
create or replace function public.approve_unflagged_attendance(p_actor uuid,p_ids uuid[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare approved integer;requested integer;
begin
  if not exists(select 1 from public.user_profiles where user_id=p_actor and role in ('main_admin','admin','col_officer') and approval_status='approved' and privacy_version='2026-11-17') then raise exception 'Administrator access required';end if;
  requested:=cardinality(p_ids);
  if requested is null or requested<1 or requested>500 or array_position(p_ids,null) is not null or requested<>(select count(distinct v) from unnest(p_ids) v) then raise exception 'Choose 1 to 500 distinct attendance records';end if;
  -- Recheck status and risk at submission. New flags or prior decisions are skipped.
  with updated as (
    update public.attendance_logs a set status='approved',reviewed_by=p_actor,reviewed_at=now(),review_note='Bulk approval: no recorded risk flags or open device incidents at review'
    where a.id=any(p_ids) and a.status='pending_review' and not public.attendance_review_flagged(a)
    returning a.id
  ), audited as (
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details)
    select p_actor,'attendance.review_approved','attendance_log',id,jsonb_build_object('bulk',true,'note','No recorded risk flags or open device incidents at review') from updated returning id
  ) select count(*) into approved from audited;
  return jsonb_build_object('approved',approved,'skipped',requested-approved);
end $$;
revoke all on function public.attendance_review_flagged(public.attendance_logs),public.attendance_review_rows(text,text,text),public.list_filtered_reviews(text,text,text,integer,integer,text),public.preview_unflagged_attendance(text),public.approve_unflagged_attendance(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.attendance_review_flagged(public.attendance_logs),public.attendance_review_rows(text,text,text),public.list_filtered_reviews(text,text,text,integer,integer,text),public.preview_unflagged_attendance(text),public.approve_unflagged_attendance(uuid,uuid[]) to service_role;
