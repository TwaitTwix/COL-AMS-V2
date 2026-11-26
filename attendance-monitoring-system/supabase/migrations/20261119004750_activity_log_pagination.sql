create index if not exists login_log_page_idx on public.login_logs(created_at desc,id desc);
create index if not exists audit_log_page_idx on public.audit_logs(created_at desc,id desc);

create or replace function public.list_activity_logs(p_category text,p_filter text default 'all',p_search text default '',p_page integer default 1,p_size integer default 10)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_category is null or p_category not in ('logins','audit') or p_filter is null or
    (p_category='logins' and p_filter not in ('all','flagged','registered')) or
    (p_category='audit' and p_filter not in ('all','attendance','device','account','registration','privacy','event','student','college','course')) or
    p_page is null or p_page<1 or p_page>100000 or p_size is null or p_size<1 or p_size>50 or length(coalesce(p_search,''))>100 then raise exception 'Invalid log filters';end if;
  with entries as (
    select l.id,l.created_at,l.user_id,coalesce(p.full_name,p.email,'Unknown account') as user_name,p.email,
      case when l.changed_device or l.shared_device then 'flagged' else 'registered' end as category_filter,
      case when l.changed_device or l.shared_device then concat_ws(' · ',case when l.changed_device then 'Changed browser' end,case when l.shared_device then 'Shared browser' end) else 'Registered browser' end as label,
      to_jsonb(l) as details,concat_ws(' ',p.full_name,p.email,p.personal_id,l.device_hash,l.user_agent,l.ip_address) as search_text
      from public.login_logs l left join public.user_profiles p on p.user_id=l.user_id where p_category='logins'
    union all
    select a.id,a.created_at,a.actor_user_id,coalesce(p.full_name,p.email,'System'),p.email,split_part(a.action,'.',1),replace(replace(a.action,'.',' · '),'_',' '),to_jsonb(a),
      concat_ws(' ',p.full_name,p.email,p.personal_id,a.action,a.entity_type,a.entity_id,a.details::text)
      from public.audit_logs a left join public.user_profiles p on p.user_id=a.actor_user_id where p_category='audit'
  ), filtered as (
    select * from entries where (p_filter='all' or category_filter=p_filter) and strpos(lower(search_text),lower(trim(coalesce(p_search,''))))>0
  ), page_rows as (
    select * from filtered order by created_at desc,id desc limit p_size offset ((p_page-1)*p_size)
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)-'search_text' order by r.created_at desc,r.id desc) from page_rows r),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',p_page,'page_size',p_size) into result;
  return result;
end $$;
revoke all on function public.list_activity_logs(text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.list_activity_logs(text,text,text,integer,integer) to service_role;
