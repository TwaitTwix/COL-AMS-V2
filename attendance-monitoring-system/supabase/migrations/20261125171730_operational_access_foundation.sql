-- Additive staging foundation. Does NOT migrate, deactivate or provision live accounts.
-- The application opts into this model with ACCESS_MODE=revision after reviewed cutover.
create table public.operational_features (
 key text primary key, label text not null, description text not null,
 default_roles text[] not null, delegable boolean not null default true,
 available boolean not null default false
);
insert into public.operational_features(key,label,description,default_roles,delegable,available) values
 ('events.view','View assigned events','View events within assigned scope.',array['classroom_representative','club_president','col_regular','col_admin'],true,true),
 ('events.manage','Manage events and geofences','Create and edit scoped events.',array['col_admin'],true,false),
 ('rosters.view','View class lists','View assigned participant records.',array['classroom_representative','club_president','col_regular','col_admin'],true,false),
 ('rosters.manage','Import and update class lists','Maintain reusable official lists within assigned classes.',array['classroom_representative','club_president','col_regular','col_admin'],true,false),
 ('representatives.assign','Assign class representatives','Replace representatives within assigned scope.',array['col_admin'],true,false),
 ('attendance.review','Review attendance incidents','Decide cases assigned to the current review level.',array['classroom_representative','club_president','col_regular','col_admin'],true,false),
 ('attendance.manual','Record manual attendance','Record a documented attendance exception.',array['col_admin'],true,false),
 ('cases.evidence','View sensitive case evidence','View device and location evidence only for assigned cases.',array['classroom_representative','club_president','col_regular','col_admin'],true,false),
 ('reports.view','Preview attendance reports','View reports within assigned scope.',array['classroom_representative','club_president','col_regular','col_admin'],true,false),
 ('reports.export','Export attendance reports','Download scoped reports.',array['col_regular','col_admin'],true,false),
 ('audit.view','View Audit Trail','View authorized account/case history.',array['classroom_representative','club_president','col_regular','col_admin'],true,false),
 ('accounts.manage','Manage accounts and access','Provision accounts, change roles, feature overrides and scopes.',array[]::text[],false,true);

create table public.operational_accounts (
 user_id uuid primary key references public.user_profiles(user_id) on delete restrict,
 role text not null check(role in ('classroom_representative','club_president','col_regular','col_admin','administrator')),
 full_name text not null check(length(trim(full_name)) between 1 and 120),
 enabled boolean not null default true,
 version integer not null default 1 check(version>0),
 created_by uuid references auth.users(id), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 active_session_id uuid, active_session_started_at timestamptz,
 sessions_valid_after timestamptz not null default now()
);
create table public.operational_feature_overrides (
 user_id uuid not null references public.operational_accounts(user_id) on delete cascade,
 feature_key text not null references public.operational_features(key), enabled boolean not null,
 primary key(user_id,feature_key)
);
-- Section/club scopes are added with their actual FK-backed models in phase 2.
create table public.operational_scopes (
 user_id uuid not null references public.operational_accounts(user_id) on delete cascade,
 kind text not null check(kind in ('institution','event')), scope_id text not null,
 primary key(user_id,kind,scope_id),
 constraint operational_scope_format check((kind='institution' and scope_id in ('MCNP','ISAP')) or (kind='event' and scope_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'))
);
create index operational_accounts_enabled_role_idx on public.operational_accounts(role) where enabled;
alter table public.operational_features enable row level security;
alter table public.operational_accounts enable row level security;
alter table public.operational_feature_overrides enable row level security;
alter table public.operational_scopes enable row level security;
revoke all on public.operational_features,public.operational_accounts,public.operational_feature_overrides,public.operational_scopes from public,anon,authenticated;
grant select,insert,update,delete on public.operational_features,public.operational_accounts,public.operational_feature_overrides,public.operational_scopes to service_role;

create function app_private.operational_capable(p_user uuid,p_feature text,p_kind text default null,p_id text default null) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select a.role='administrator' or
  (coalesce(o.enabled,a.role=any(f.default_roles)) and f.delegable and
   (p_kind is null or exists(select 1 from public.operational_scopes s where s.user_id=a.user_id and
    ((s.kind=p_kind and s.scope_id=p_id) or (p_kind='event' and s.kind='institution' and exists(select 1 from public.events e where e.id::text=p_id and e.institution=s.scope_id))))))
 from public.operational_accounts a join public.user_profiles p on p.user_id=a.user_id
 join public.operational_features f on f.key=p_feature
 left join public.operational_feature_overrides o on o.user_id=a.user_id and o.feature_key=f.key
 where a.user_id=p_user and a.enabled and p.retired_at is null),false);
$$;

create function public.get_operational_access(p_user uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select to_jsonb(a)-'active_session_id'-'active_session_started_at'-'sessions_valid_after'||jsonb_build_object(
  'scopes',coalesce((select jsonb_agg(jsonb_build_object('kind',s.kind,'scope_id',s.scope_id) order by s.kind,s.scope_id) from public.operational_scopes s where s.user_id=a.user_id),'[]'::jsonb),
  'overrides',coalesce((select jsonb_object_agg(o.feature_key,o.enabled) from public.operational_feature_overrides o where o.user_id=a.user_id),'{}'::jsonb),
  'features',(select jsonb_agg(to_jsonb(f)||jsonb_build_object('effective',app_private.operational_capable(p_user,f.key)) order by f.key) from public.operational_features f))
 from public.operational_accounts a join public.user_profiles p on p.user_id=a.user_id where a.user_id=p_user and p.retired_at is null;
$$;

create function public.enforce_operational_login(p_user uuid,p_session uuid,p_activate boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.operational_accounts; started timestamptz;
begin
 select * into a from public.operational_accounts where user_id=p_user for update;
 if not found or not a.enabled or exists(select 1 from public.user_profiles where user_id=p_user and retired_at is not null) then return jsonb_build_object('active',false);end if;
 started:=app_private.login_session_started(p_user,p_session);
 if started is null or started<a.sessions_valid_after then return jsonb_build_object('active',false);end if;
 if a.active_session_id=p_session then return jsonb_build_object('active',true);end if;
 if a.active_session_id is null or (p_activate and (started>a.active_session_started_at or (started=a.active_session_started_at and p_session>a.active_session_id))) then
  update public.operational_accounts set active_session_id=p_session,active_session_started_at=started where user_id=p_user;
  if a.active_session_id is not null then insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_user,'account.session_replaced','operational_account',p_user::text,'{}');end if;
  return jsonb_build_object('active',true);
 end if;
 return jsonb_build_object('active',false);
end $$;

create function public.save_operational_account(p_actor uuid,p_user uuid,p_role text,p_name text,p_enabled boolean,p_version integer,p_scopes jsonb,p_overrides jsonb,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare previous public.operational_accounts; item jsonb; k text; v jsonb; existing_version integer;
begin
 -- Serialize security changes, including concurrent attempts to remove different administrators.
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 if not app_private.operational_capable(p_actor,'accounts.manage') then raise exception using errcode='42501',message='Administrator access required';end if;
 if p_role is null or p_role not in ('classroom_representative','club_president','col_regular','col_admin','administrator') or p_enabled is null or length(trim(coalesce(p_name,''))) not between 1 and 120 or length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='Invalid account details or decision reason';end if;
 if jsonb_typeof(p_scopes) is distinct from 'array' or jsonb_array_length(p_scopes)>40 or jsonb_typeof(p_overrides) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_overrides))>30 then raise exception using errcode='22023',message='Invalid access configuration';end if;
 if not exists(select 1 from public.user_profiles where user_id=p_user and retired_at is null) then raise exception using errcode='22023',message='A non-retired verified account identity is required';end if;
 select * into previous from public.operational_accounts where user_id=p_user for update;
 existing_version:=coalesce(previous.version,0);
 if p_version is distinct from existing_version then raise exception using errcode='40001',message='Account changed. Reload before saving';end if;
 if previous.role='administrator' and previous.enabled and (p_role<>'administrator' or not p_enabled) and not exists(select 1 from public.operational_accounts a join public.user_profiles pr on pr.user_id=a.user_id where a.role='administrator' and a.enabled and a.user_id<>p_user and pr.retired_at is null) then raise exception using errcode='22023',message='The last active administrator cannot be removed';end if;
 for item in select value from jsonb_array_elements(p_scopes) loop
  if jsonb_typeof(item) is distinct from 'object' or item->>'kind' is null or item->>'scope_id' is null then raise exception using errcode='22023',message='Invalid scope';end if;
  if item->>'kind'='institution' then
   if p_role in ('classroom_representative','club_president') or item->>'scope_id' not in ('MCNP','ISAP') then raise exception using errcode='22023',message='Representatives and presidents require explicit class/event assignments';end if;
  elsif item->>'kind'='event' then
   if not exists(select 1 from public.events where id::text=item->>'scope_id') then raise exception using errcode='22023',message='Assigned event is unavailable';end if;
  else raise exception using errcode='22023',message='Unsupported scope';end if;
 end loop;
 for k,v in select * from jsonb_each(p_overrides) loop
  if jsonb_typeof(v)<>'boolean' or not exists(select 1 from public.operational_features where key=k and delegable) or p_role='administrator' then raise exception using errcode='22023',message='Invalid or protected feature override';end if;
 end loop;
 insert into public.operational_accounts(user_id,role,full_name,enabled,created_by) values(p_user,p_role,trim(p_name),p_enabled,p_actor)
 on conflict(user_id) do update set role=excluded.role,full_name=excluded.full_name,enabled=excluded.enabled,
  version=public.operational_accounts.version+1,updated_at=now(),
  active_session_id=case when not excluded.enabled or public.operational_accounts.enabled is distinct from excluded.enabled then null else public.operational_accounts.active_session_id end,
  active_session_started_at=case when not excluded.enabled or public.operational_accounts.enabled is distinct from excluded.enabled then null else public.operational_accounts.active_session_started_at end,
  sessions_valid_after=case when public.operational_accounts.enabled is distinct from excluded.enabled then clock_timestamp() else public.operational_accounts.sessions_valid_after end;
 delete from public.operational_scopes where user_id=p_user;
 insert into public.operational_scopes(user_id,kind,scope_id) select distinct p_user,value->>'kind',value->>'scope_id' from jsonb_array_elements(p_scopes);
 delete from public.operational_feature_overrides where user_id=p_user;
 insert into public.operational_feature_overrides(user_id,feature_key,enabled) select p_user,key,(value::text)::boolean from jsonb_each(p_overrides);
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'access.account_saved','operational_account',p_user::text,jsonb_build_object('previous_role',previous.role,'role',p_role,'enabled',p_enabled,'scopes',p_scopes,'overrides',p_overrides,'reason',trim(p_reason),'previous_version',existing_version));
 return public.get_operational_access(p_user);
end $$;

create function public.bootstrap_operational_administrator(p_user uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 if exists(select 1 from public.operational_accounts where role='administrator' and enabled) then raise exception using errcode='22023',message='An operational administrator already exists';end if;
 if not exists(select 1 from public.user_profiles where user_id=p_user and role='main_admin' and approval_status='approved' and retired_at is null and lower(email)='leonardolllmacalinaoisap@gmail.com') then raise exception using errcode='42501',message='Only the existing designated main administrator can bootstrap access';end if;
 insert into public.operational_accounts(user_id,role,full_name,created_by) select user_id,'administrator',coalesce(nullif(trim(full_name),''),'Administrator'),user_id from public.user_profiles where user_id=p_user;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_user,'access.administrator_bootstrapped','operational_account',p_user::text,'{}');
 return public.get_operational_access(p_user);
end $$;

create function public.list_operational_events(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'events.view') then raise exception using errcode='42501',message='Event access is disabled';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'institution',e.institution,'college',e.college,'starts_at',e.starts_at,'ends_at',e.ends_at) order by e.starts_at desc,e.id) from public.events e where e.archived_at is null and app_private.operational_capable(p_actor,'events.view','event',e.id::text)),'[]'::jsonb);
end $$;

create function public.list_operational_accounts(p_actor uuid,p_search text default '',p_page integer default 1) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not app_private.operational_capable(p_actor,'accounts.manage') then raise exception using errcode='42501',message='Administrator access required';end if;
 if p_page is null or p_page<1 or p_page>100000 or length(coalesce(p_search,''))>100 then raise exception using errcode='22023',message='Invalid account search';end if;
 with filtered as (select a.user_id,a.full_name,a.role,a.enabled,a.version,p.email from public.operational_accounts a join public.user_profiles p on p.user_id=a.user_id where p.retired_at is null and strpos(lower(concat_ws(' ',a.full_name,p.email)),lower(trim(coalesce(p_search,''))))>0),
 page_rows as (select * from filtered order by full_name,user_id limit 10 offset (p_page-1)*10)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)||public.get_operational_access(r.user_id) order by r.full_name,r.user_id) from page_rows r),'[]'::jsonb),'total',(select count(*) from filtered),'page',p_page,'page_size',10) into result;
 return result;
end $$;

create function public.operational_account_candidates(p_actor uuid,p_search text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'accounts.manage') then raise exception using errcode='42501',message='Administrator access required';end if;
 if p_search is null or length(trim(p_search)) not between 2 and 100 then raise exception using errcode='22023',message='Enter at least two search characters';end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from (select p.user_id,p.email,p.full_name,p.role as legacy_role from public.user_profiles p where p.retired_at is null and not exists(select 1 from public.operational_accounts a where a.user_id=p.user_id) and strpos(lower(concat_ws(' ',p.full_name,p.email)),lower(trim(p_search)))>0 order by p.full_name,p.user_id limit 10) r),'[]'::jsonb);
end $$;

create function public.record_operational_login(p_actor uuid,p_session uuid,p_device text,p_agent text,p_ip text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.operational_accounts where user_id=p_actor and enabled and active_session_id=p_session) then raise exception using errcode='42501',message='Active operational login required';end if;
 if p_device is null or p_device!~'^[a-f0-9]{64}$' or length(coalesce(p_agent,''))>500 or length(coalesce(p_ip,''))>100 then raise exception using errcode='22023',message='Invalid login evidence';end if;
 insert into public.login_logs(user_id,session_id,device_hash,user_agent,ip_address,changed_device,shared_device) values(p_actor,p_session::text,p_device,coalesce(p_agent,'Unknown browser'),p_ip,false,false) on conflict(user_id,session_id,device_hash) do nothing;
 return jsonb_build_object('device_id',p_device);
end $$;

-- New functions are service-only APIs. None accepts a browser-supplied actor.
create function public.authorize_operational_invitation(p_actor uuid,p_user uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'accounts.manage') then raise exception using errcode='42501',message='Administrator access required';end if;
 if not exists(select 1 from public.operational_accounts a join public.user_profiles p on p.user_id=a.user_id where a.user_id=p_user and a.enabled and p.retired_at is null) then raise exception using errcode='22023',message='An active operational account is required';end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'access.invitation_requested','operational_account',p_user::text,'{}');
end $$;
revoke all on function public.authorize_operational_invitation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_operational_invitation(uuid,uuid) to service_role;
-- Preflight prevents malformed grants from creating an orphan Auth identity.
create function public.validate_operational_provision(p_actor uuid,p_role text,p_scopes jsonb,p_overrides jsonb) returns void
language plpgsql stable security invoker set search_path='' as $$
declare item jsonb;k text;v jsonb;
begin
 if not app_private.operational_capable(p_actor,'accounts.manage') then raise exception using errcode='42501',message='Administrator access required';end if;
 if p_role is null or p_role not in ('classroom_representative','club_president','col_regular','col_admin','administrator') or jsonb_typeof(p_scopes) is distinct from 'array' or jsonb_typeof(p_overrides) is distinct from 'object' then raise exception using errcode='22023',message='Invalid access configuration';end if;
 if jsonb_array_length(p_scopes)>40 or (select count(*) from jsonb_object_keys(p_overrides))>30 then raise exception using errcode='22023',message='Too many access assignments';end if;
 for item in select value from jsonb_array_elements(p_scopes) loop
  if item->>'kind'='institution' and item->>'scope_id' in ('MCNP','ISAP') and p_role not in ('classroom_representative','club_president') then continue;
  elsif item->>'kind'='event' and exists(select 1 from public.events where id::text=item->>'scope_id') then continue;
  else raise exception using errcode='22023',message='Invalid scope assignment';end if;
 end loop;
 for k,v in select * from jsonb_each(p_overrides) loop
  if jsonb_typeof(v)<>'boolean' or p_role='administrator' or not exists(select 1 from public.operational_features where key=k and delegable) then raise exception using errcode='22023',message='Invalid or protected feature override';end if;
 end loop;
end $$;
revoke all on function public.validate_operational_provision(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.validate_operational_provision(uuid,text,jsonb,jsonb) to service_role;
revoke all on function app_private.operational_capable(uuid,text,text,text),public.get_operational_access(uuid),public.enforce_operational_login(uuid,uuid,boolean),public.save_operational_account(uuid,uuid,text,text,boolean,integer,jsonb,jsonb,text),public.bootstrap_operational_administrator(uuid),public.list_operational_events(uuid),public.list_operational_accounts(uuid,text,integer),public.operational_account_candidates(uuid,text),public.record_operational_login(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function app_private.operational_capable(uuid,text,text,text),public.get_operational_access(uuid),public.enforce_operational_login(uuid,uuid,boolean),public.save_operational_account(uuid,uuid,text,text,boolean,integer,jsonb,jsonb,text),public.bootstrap_operational_administrator(uuid),public.list_operational_events(uuid),public.list_operational_accounts(uuid,text,integer),public.operational_account_candidates(uuid,text),public.record_operational_login(uuid,uuid,text,text,text) to service_role;
