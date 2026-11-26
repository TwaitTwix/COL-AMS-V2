begin;
do $$
declare actor uuid:=gen_random_uuid(); student_actor uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid(); sid uuid; ids uuid[]:='{}'; marker text:='Bulk fixture '||gen_random_uuid(); r jsonb; caught boolean;
begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,actor||'@test.invalid',now()),(student_actor,student_actor||'@test.invalid',now());
  insert into public.user_profiles(user_id,full_name,personal_id,role,approval_status,privacy_version) values(actor,marker,actor::text,'admin','approved','2026-11-17'),(student_actor,marker,student_actor::text,'student','approved','2026-11-17');
  insert into public.events(id,name,latitude,longitude,radius_meters,starts_at,ends_at) values(eid,marker,17,121,100,now(),now()+interval '1 hour');
  for i in 1..5 loop
    sid:=gen_random_uuid();ids:=array_append(ids,gen_random_uuid());
    insert into public.students(id,name,student_number,student_token) values(sid,marker||i,sid::text,sid::text);
    insert into public.attendance_logs(id,student_id,event_id,device_hash,status,risk_reasons,distance_from_venue_meters)
      values(ids[i],sid,eid,'bulk-device-'||ids[i],case when i=4 then 'approved' else 'pending_review' end,case when i=2 then '["Shared browser"]'::jsonb else '[]'::jsonb end,10);
  end loop;
  insert into public.device_incidents(user_id,device_hash,changed_device,shared_device,status) values(student_actor,'bulk-device-'||ids[3],false,true,'open');
  r:=public.list_filtered_reviews('attendance','pending',marker,1,10,'unflagged');
  if (r->>'total')::int<>2 then raise exception 'FAIL: clean filter includes flagged or approved records';end if;
  r:=public.list_filtered_reviews('attendance','pending',marker,1,1,'flagged');
  if (r->>'total')::int<>2 or jsonb_array_length(r->'items')<>1 or r#>>'{items,0,details,flagged}'<>'true' then raise exception 'FAIL: flagged pagination/classification';end if;
  r:=public.preview_unflagged_attendance(marker);
  if (r->>'total')::int<>2 or jsonb_array_length(r->'ids')<>2 then raise exception 'FAIL: bulk preview';end if;
  -- A record that gained a flag after the preview must not be approved.
  update public.attendance_logs set risk_reasons='["Changed browser"]' where id=ids[5];
  r:=public.approve_unflagged_attendance(actor,ids);
  if (r->>'approved')::int<>1 or (r->>'skipped')::int<>4 then raise exception 'FAIL: bulk did not recheck current status and flags';end if;
  if not exists(select 1 from public.attendance_logs where id=ids[1] and status='approved' and reviewed_by=actor and reviewed_at is not null) then raise exception 'FAIL: decision provenance';end if;
  if (select count(*) from public.audit_logs where actor_user_id=actor and action='attendance.review_approved' and details->>'bulk'='true')<>1 then raise exception 'FAIL: atomic per-record audit';end if;
  r:=public.approve_unflagged_attendance(actor,ids);
  if (r->>'approved')::int<>0 then raise exception 'FAIL: repeated submission';end if;
  caught:=false;begin perform public.approve_unflagged_attendance(student_actor,ids);exception when raise_exception then caught:=true;end;
  if not caught then raise exception 'FAIL: student bulk access';end if;
  caught:=false;begin perform public.approve_unflagged_attendance(actor,array[ids[1],ids[1]]);exception when raise_exception then caught:=true;end;
  if not caught then raise exception 'FAIL: duplicate IDs';end if;
  if has_function_privilege('authenticated','public.approve_unflagged_attendance(uuid,uuid[])','EXECUTE') or has_function_privilege('anon','public.preview_unflagged_attendance(text)','EXECUTE') then raise exception 'FAIL: direct browser RPC access';end if;
end $$;
select 'PASS: filtered counts/pages, preview, current-risk recheck, skipped prior decisions, repeat safety, audits, admin-only permissions' as result;
rollback;
