alter table public.report_jobs add column preview_path text;

create or replace function public.list_student_records(p_search text default '',p_state text default 'active',p_page integer default 1,p_size integer default 10)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_state is null or p_state not in ('active','archived','all') or p_page is null or p_page<1 or p_page>100000 or p_size is null or p_size<1 or p_size>50 or length(coalesce(p_search,''))>100 then raise exception 'Invalid student filters';end if;
  with filtered as (
    select id,name,student_number,institution,college,course,archived_at from public.students
    where (p_state='all' or (p_state='active' and archived_at is null) or (p_state='archived' and archived_at is not null))
      and strpos(lower(concat_ws(' ',name,student_number,institution,college,course)),lower(trim(coalesce(p_search,''))))>0
  ), page_rows as (select * from filtered order by name,id limit p_size offset ((p_page-1)*p_size))
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r) order by r.name,r.id) from page_rows r),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',p_page,'page_size',p_size) into result;
  return result;
end $$;
revoke all on function public.list_student_records(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.list_student_records(text,text,integer,integer) to service_role;
