begin;
do $$
declare marker text:='Directory '||gen_random_uuid();
begin
  insert into public.students(name,student_number,student_token,archived_at)
    select marker||' Student '||n,gen_random_uuid()::text,gen_random_uuid()::text,case when n<=5 then now() else null end from generate_series(1,125) n;
  perform set_config('test.marker',marker,true);
end $$;
set local role service_role;
do $$
declare marker text:=current_setting('test.marker'); a jsonb; b jsonb;
begin
  a:=public.list_student_records(upper(marker),'active',1,10);b:=public.list_student_records(marker,'active',2,10);
  if (a->>'total')::integer<>120 or jsonb_array_length(a->'items')<>10 then raise exception 'FAIL: active search or total incorrect';end if;
  if exists(select 1 from jsonb_array_elements(a->'items') x join jsonb_array_elements(b->'items') y on x->>'id'=y->>'id') then raise exception 'FAIL: pages repeat students';end if;
  a:=public.list_student_records(marker,'all',13,10);if jsonb_array_length(a->'items')<>5 then raise exception 'FAIL: final page incorrect';end if;
  a:=public.list_student_records(marker,'archived',1,10);if (a->>'total')::integer<>5 then raise exception 'FAIL: archived filter incorrect';end if;
  if exists(select 1 from jsonb_array_elements(a->'items') x where x?'student_token') then raise exception 'FAIL: student token exposed in directory';end if;
  if has_function_privilege('anon','public.list_student_records(text,text,integer,integer)','EXECUTE') or has_function_privilege('authenticated','public.list_student_records(text,text,integer,integer)','EXECUTE') then raise exception 'FAIL: direct client access';end if;
end $$;
select 'PASS: student search, 125 records, stable pages, archive filters, no tokens, private permissions' as result;
rollback;
