create index if not exists attendance_review_queue_idx on public.attendance_logs(status,checked_in_at desc,id desc);
create index if not exists device_review_queue_idx on public.device_incidents(status,created_at desc,id desc);
create index if not exists notification_review_queue_idx on public.admin_notifications(created_at desc,id desc);

create or replace function public.list_review_items(p_category text,p_state text default 'pending',p_search text default '',p_page integer default 1,p_size integer default 10)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_category not in ('notifications','attendance','devices') or p_state not in ('pending','history','all') or p_page is null or p_page<1 or p_page>100000 or p_size is null or p_size<1 or p_size>50 or length(coalesce(p_search,''))>100 then raise exception 'Invalid review filters';end if;
  with entries as (
    select n.id,n.created_at,coalesce(p.full_name,p.email,'Unknown account') as user_name,p.email,
      case when n.read_at is null then 'pending' else 'history' end as bucket,
      case when n.read_at is null then 'Unread' else 'Read' end as status,
      n.message as label,to_jsonb(n) as details,
      concat_ws(' ',p.full_name,p.email,p.personal_id,n.message) as search_text
      from public.admin_notifications n left join public.user_profiles p on p.user_id=n.user_id where p_category='notifications'
    union all
    select a.id,a.checked_in_at,coalesce(s.name,p.full_name,p.email,'Unknown student'),p.email,
      case when a.status='pending_review' then 'pending' else 'history' end,a.status,
      coalesce(e.name,'Event unavailable'),to_jsonb(a)||jsonb_build_object('event_name',e.name,'student_name',s.name),
      concat_ws(' ',s.name,s.student_number,p.email,e.name,a.risk_reasons::text,a.review_note)
      from public.attendance_logs a left join public.students s on s.id=a.student_id left join public.user_profiles p on p.user_id=a.user_id left join public.events e on e.id=a.event_id
      where p_category='attendance' and (a.status='pending_review' or (a.reviewed_at is not null and a.entry_method<>'manual'))
    union all
    select d.id,d.created_at,coalesce(p.full_name,p.email,'Unknown account'),p.email,
      case when d.status='open' then 'pending' else 'history' end,d.status,
      concat_ws(' · ',case when d.changed_device then 'Changed browser' end,case when d.shared_device then 'Shared browser' end),to_jsonb(d),
      concat_ws(' ',p.full_name,p.email,p.personal_id,d.device_hash,case when d.changed_device then 'Changed browser' end,case when d.shared_device then 'Shared browser' end)
      from public.device_incidents d left join public.user_profiles p on p.user_id=d.user_id where p_category='devices'
  ), filtered as (
    select * from entries where (p_state='all' or bucket=p_state) and strpos(lower(search_text),lower(trim(coalesce(p_search,''))))>0
  ), page_rows as (
    select * from filtered order by created_at desc,id desc limit p_size offset ((p_page-1)*p_size)
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)-'search_text' order by r.created_at desc,r.id desc) from page_rows r),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',p_page,'page_size',p_size) into result;
  return result;
end $$;
revoke all on function public.list_review_items(text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.list_review_items(text,text,text,integer,integer) to service_role;
