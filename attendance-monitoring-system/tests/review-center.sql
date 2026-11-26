begin;
do $$
declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid(); marker text:='Review fixture '||gen_random_uuid();
begin
  insert into auth.users(id,email,email_confirmed_at) values(uid,uid||'@test.invalid',now());
  insert into public.user_profiles(user_id,full_name,personal_id) values(uid,marker,uid::text);
  insert into public.students(id,name,student_number,student_token) values(sid,marker,sid::text,sid::text);
  insert into public.events(id,name,latitude,longitude,radius_meters,starts_at,ends_at) values(eid,marker,17,121,100,now(),now()+interval '1 hour');
  insert into public.admin_notifications(kind,user_id,message,created_at,read_at)
    select 'test',uid,marker||' item '||n,now()-n*interval '1 second',case when n<=3 then now() else null end from generate_series(1,125) n;
  insert into public.device_incidents(user_id,device_hash,changed_device,shared_device,status) values(uid,'test-a',true,false,'open'),(uid,'test-b',false,true,'trusted');
  insert into public.attendance_logs(student_id,event_id,user_id,distance_from_venue_meters,status,risk_reasons) values(sid,eid,uid,25,'pending_review','["Changed browser"]');
  perform set_config('test.marker',marker,true);perform set_config('test.uid',uid::text,true);
end $$;
set local role service_role;
do $$
declare marker text:=current_setting('test.marker'); uid uuid:=current_setting('test.uid')::uuid; result jsonb; first_page jsonb; second_page jsonb; caught boolean;
begin
  first_page:=public.list_review_items('notifications','pending',upper(marker),1,10);
  if (first_page->>'total')::integer<>122 or jsonb_array_length(first_page->'items')<>10 then raise exception 'FAIL: count/search ignores records beyond 100';end if;
  second_page:=public.list_review_items('notifications','pending',marker,2,10);
  if exists(select 1 from jsonb_array_elements(first_page->'items') a join jsonb_array_elements(second_page->'items') b on a->>'id'=b->>'id') then raise exception 'FAIL: pagination repeats rows';end if;
  result:=public.list_review_items('notifications','pending',marker,13,10);
  if jsonb_array_length(result->'items')<>2 then raise exception 'FAIL: final page wrong';end if;
  result:=public.list_review_items('notifications','history',marker,1,10);
  if (result->>'total')::integer<>3 then raise exception 'FAIL: notification history wrong';end if;
  result:=public.list_review_items('devices','pending',marker,1,10);
  if (result->>'total')::integer<>1 then raise exception 'FAIL: device pending filter wrong';end if;
  result:=public.list_review_items('devices','history',marker,1,10);
  if (result->>'total')::integer<>1 then raise exception 'FAIL: resolved devices missing';end if;
  result:=public.list_review_items('attendance','pending',marker,1,10);
  if (result->>'total')::integer<>1 or result#>>'{items,0,details,event_name}'<>marker then raise exception 'FAIL: attendance event search/details missing';end if;
  update public.attendance_logs set status='approved',reviewed_at=now(),reviewed_by=uid where user_id=uid;
  result:=public.list_review_items('attendance','history',marker,1,10);
  if (result->>'total')::integer<>1 then raise exception 'FAIL: attendance decision not in history';end if;
  result:=public.list_review_items('notifications','all','no-such-'||uid::text,1,10);
  if (result->>'total')::integer<>0 or result->'items'<>'[]'::jsonb then raise exception 'FAIL: empty search result wrong';end if;
  caught:=false;begin perform public.list_review_items('invalid','pending','',1,10);exception when raise_exception then caught:=true;end;
  if not caught then raise exception 'FAIL: invalid category accepted';end if;
  if has_function_privilege('authenticated','public.list_review_items(text,text,text,integer,integer)','EXECUTE') or has_function_privilege('anon','public.list_review_items(text,text,text,integer,integer)','EXECUTE') then raise exception 'FAIL: direct browser access to review data';end if;
end $$;
select 'PASS: 125-record search, exact counts, stable pages, pending/history filters, attendance details, empty states, private permissions' as result;
rollback;
