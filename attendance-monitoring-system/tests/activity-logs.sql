begin;
do $$
declare uid uuid:=gen_random_uuid(); marker text:='Log fixture '||gen_random_uuid();
begin
  insert into auth.users(id,email,email_confirmed_at) values(uid,uid||'@test.invalid',now());
  insert into public.user_profiles(user_id,full_name,personal_id) values(uid,marker,uid::text);
  insert into public.login_logs(user_id,session_id,device_hash,user_agent,ip_address,changed_device,shared_device,created_at)
    select uid,'test-session-'||n,'test-device-'||n,'Sample browser','192.0.2.1',n<=5,false,now()-n*interval '1 second' from generate_series(1,125) n;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details,created_at)
    select uid,case when n%2=0 then 'attendance.approved' else 'device.trusted' end,'fixture',n::text,jsonb_build_object('note',marker),now()-n*interval '1 second' from generate_series(1,125) n;
  perform set_config('test.marker',marker,true);
end $$;
set local role service_role;
do $$
declare marker text:=current_setting('test.marker'); a jsonb; b jsonb; result jsonb; caught boolean;
begin
  a:=public.list_activity_logs('logins','all',upper(marker),1,10);b:=public.list_activity_logs('logins','all',marker,2,10);
  if (a->>'total')::integer<>125 or jsonb_array_length(a->'items')<>10 then raise exception 'FAIL: login history capped at 100';end if;
  if exists(select 1 from jsonb_array_elements(a->'items') x join jsonb_array_elements(b->'items') y on x->>'id'=y->>'id') then raise exception 'FAIL: repeated login pages';end if;
  result:=public.list_activity_logs('logins','all',marker,13,10);if jsonb_array_length(result->'items')<>5 then raise exception 'FAIL: last page incorrect';end if;
  result:=public.list_activity_logs('logins','flagged',marker,1,10);if (result->>'total')::integer<>5 then raise exception 'FAIL: flagged filter incorrect';end if;
  result:=public.list_activity_logs('logins','registered',marker,1,10);if (result->>'total')::integer<>120 then raise exception 'FAIL: registered filter incorrect';end if;
  result:=public.list_activity_logs('audit','all',marker,1,10);if (result->>'total')::integer<>125 then raise exception 'FAIL: audit history capped at 100';end if;
  result:=public.list_activity_logs('audit','attendance',marker,1,10);if (result->>'total')::integer<>62 then raise exception 'FAIL: audit action filter incorrect';end if;
  if result#>>'{items,0,details,details,note}'<>marker then raise exception 'FAIL: full audit details missing';end if;
  result:=public.list_activity_logs('audit','all','no-such-'||gen_random_uuid(),1,10);if (result->>'total')::integer<>0 or result->'items'<>'[]'::jsonb then raise exception 'FAIL: empty search incorrect';end if;
  caught:=false;begin perform public.list_activity_logs('audit','flagged','',1,10);exception when raise_exception then caught:=true;end;
  if not caught then raise exception 'FAIL: category mismatch accepted';end if;
  if has_function_privilege('anon','public.list_activity_logs(text,text,text,integer,integer)','EXECUTE') or has_function_privilege('authenticated','public.list_activity_logs(text,text,text,integer,integer)','EXECUTE') then raise exception 'FAIL: browser can directly access logs';end if;
end $$;
select 'PASS: 125 logins + 125 audits, search, page uniqueness, last page, browser/action filters, full details, private permissions' as result;
rollback;
