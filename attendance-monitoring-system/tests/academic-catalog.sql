-- All fixtures and test changes are rolled back; real records are untouched.
begin;
do $$
declare sid uuid:=gen_random_uuid(); uid uuid:=gen_random_uuid(); caught boolean; actor uuid;
begin
  if (select count(*) from public.colleges where active and institution='ISAP')<>4 then raise exception 'Expected 4 ISAP colleges';end if;
  if (select count(*) from public.colleges where active and institution='MCNP')<>6 then raise exception 'Expected 6 MCNP college/department entries';end if;
  if (select count(*) from public.courses where active)<>18 then raise exception 'Expected 18 listed courses';end if;
  caught:=false;
  begin
    insert into public.students(name,student_number,student_token,institution,college,course)
    values('Invalid cross-institution test',sid::text,sid::text,'ISAP','College of Nursing','Bachelor of Science in Nursing');
  exception when foreign_key_violation then caught:=true;end;
  if not caught then raise exception 'Cross-institution course was accepted';end if;
  caught:=false;
  begin
    insert into public.students(name,student_number,student_token,institution,college,course)
    values('Invalid cross-college test',sid::text,sid::text,'ISAP','College of Information Technology and Engineering','Bachelor of Science in Accountancy');
  exception when foreign_key_violation then caught:=true;end;
  if not caught then raise exception 'Cross-college course was accepted';end if;
  insert into auth.users(id,email,email_confirmed_at) values(uid,uid||'@test.invalid',now());
  insert into public.students(id,name,student_number,student_token,institution,college,course)
  values(sid,'Valid course fixture',sid::text,sid::text,'ISAP','College of Information Technology and Engineering','Bachelor of Science in Information Technology');
  insert into public.user_profiles(user_id,student_id,full_name,institution,college,course)
  values(uid,sid,'Valid profile fixture','ISAP','College of Information Technology and Engineering','Bachelor of Science in Information Technology');
  update public.students set course='Bachelor of Science in Computer Engineering' where id=sid;
  if (select course from public.user_profiles where user_id=uid)<>'Bachelor of Science in Computer Engineering' then raise exception 'Linked profile course did not update atomically';end if;
  update public.user_profiles set course=null,personal_id=uid::text where user_id=uid;
  select user_id into actor from public.user_profiles where role='main_admin';
  caught:=false;begin perform public.approve_registration(actor,uid,'approved','Missing course test');exception when raise_exception then caught:=true;end;
  if not caught then raise exception 'Registration without course was approved';end if;
end $$;
select 'PASS: catalog counts, institution/college isolation, required registration course, atomic profile synchronization' as result;
rollback;
