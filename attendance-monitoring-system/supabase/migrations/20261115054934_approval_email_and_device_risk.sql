-- Email verification is performed through the Auth admin API before this
-- service-only transaction; service_role cannot SELECT auth.users directly.
create or replace function public.approve_registration(p_actor uuid,p_user uuid,p_decision text,p_note text)
returns void language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles; sid uuid;
begin
  if not exists(select 1 from public.user_profiles where user_id=p_actor and approval_status='approved' and role in ('main_admin','admin','col_officer')) then raise exception 'Administrator access required'; end if;
  select * into strict p from public.user_profiles where user_id=p_user for update;
  if p.approval_status <> 'pending' or p.role <> 'pending' then raise exception 'Registration was already reviewed'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
  if p_decision='approved' then
    if p.personal_id is null or p.institution is null or p.college is null then raise exception 'Registration details are incomplete'; end if;
    if not exists(select 1 from public.colleges where institution=p.institution and name=p.college) then raise exception 'College is not registered'; end if;
    select id into sid from public.students where lower(student_number)=lower(p.personal_id) and archived_at is null;
    if sid is null then
      insert into public.students(name,student_number,student_token,institution,college)
      values(p.full_name,p.personal_id,gen_random_uuid()::text,p.institution,p.college) returning id into sid;
    else
      if exists(select 1 from public.user_profiles where student_id=sid and user_id<>p_user) then raise exception 'Personal ID is already linked to another account'; end if;
      update public.students set institution=p.institution,college=p.college where id=sid;
    end if;
  end if;
  update public.user_profiles set approval_status=p_decision,role=case when p_decision='approved' then 'student' else 'pending' end,
    student_id=sid,reviewed_by=p_actor,reviewed_at=now(),review_note=p_note where user_id=p_user;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'registration.'||p_decision,'user_profile',p_user::text,jsonb_build_object('note',p_note));
end $$;

create or replace function public.record_device_session(p_user_id uuid,p_session_id text,p_device_hash text,p_user_agent text,p_ip_address text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.user_profiles; changed boolean; shared boolean; incident public.device_incidents; inserted_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_device_hash,0));
  select * into strict p from public.user_profiles where user_id=p_user_id for update;
  changed := p.primary_device_hash is not null and p.primary_device_hash <> p_device_hash;
  shared := exists(select 1 from public.user_devices where device_hash=p_device_hash and user_id<>p_user_id);
  if p.primary_device_hash is null then
    update public.user_profiles set primary_device_hash=p_device_hash where user_id=p_user_id;
  end if;
  insert into public.user_devices(user_id,device_hash,user_agent) values(p_user_id,p_device_hash,p_user_agent)
  on conflict(user_id,device_hash) do update set last_seen_at=now(),user_agent=excluded.user_agent;
  insert into public.login_logs(user_id,session_id,device_hash,user_agent,ip_address,changed_device,shared_device)
  values(p_user_id,p_session_id,p_device_hash,p_user_agent,p_ip_address,changed,shared) on conflict do nothing;
  if changed or shared then
    insert into public.device_incidents(user_id,device_hash,changed_device,shared_device)
    values(p_user_id,p_device_hash,changed,shared) on conflict do nothing returning id into inserted_id;
    if inserted_id is not null then
      update public.user_profiles set penalty_points=penalty_points+1 where user_id=p_user_id;
      insert into public.admin_notifications(kind,user_id,incident_id,message)
      values('device',p_user_id,inserted_id,'Changed or shared browser device detected. One penalty point recorded; attendance requires review.');
    else
      select * into incident from public.device_incidents where user_id=p_user_id and device_hash=p_device_hash for update;
      if shared and not incident.shared_device then
        update public.device_incidents set status='open',reviewed_by=null,reviewed_at=null where id=incident.id;
        insert into public.admin_notifications(kind,user_id,incident_id,message) values('device',p_user_id,incident.id,'Previously reviewed device is now shared with another account. Review required again.');
      end if;
      update public.device_incidents set shared_device=shared_device or shared,changed_device=changed_device or changed where user_id=p_user_id and device_hash=p_device_hash;
    end if;
  end if;
  select * into incident from public.device_incidents where user_id=p_user_id and device_hash=p_device_hash;
  return jsonb_build_object('changed_device',changed,'shared_device',shared,'requires_review',coalesce(incident.status='open',false),'device_id',left(p_device_hash,12));
end $$;
