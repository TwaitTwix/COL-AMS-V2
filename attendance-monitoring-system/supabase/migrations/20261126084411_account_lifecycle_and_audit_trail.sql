-- Additive phase-6 lifecycle and sanitized audit projection. No real accounts are changed.
create table public.account_deactivations(
 user_id uuid primary key references public.user_profiles(user_id) on delete restrict,
 disabled boolean not null,version integer not null default 1 check(version>0),changed_by uuid not null references auth.users(id),
 changed_at timestamptz not null default clock_timestamp(),reason text not null check(length(btrim(reason)) between 3 and 500)
);
create index account_deactivation_actor_idx on public.account_deactivations(changed_by);
alter table public.account_deactivations enable row level security;
revoke all on public.account_deactivations from public,anon,authenticated;
grant select,insert,update,delete on public.account_deactivations to service_role;

alter function app_private.operational_capable(uuid,text,text,text) rename to operational_capable_lifecycle_base;
create function app_private.operational_capable(p_user uuid,p_feature text,p_kind text default null,p_id text default null) returns boolean language sql stable security invoker set search_path='' as $$
 select not exists(select 1 from public.account_deactivations where user_id=p_user and disabled) and not exists(select 1 from public.user_profiles where user_id=p_user and email_release_completed_at is not null) and app_private.operational_capable_lifecycle_base(p_user,p_feature,p_kind,p_id);
$$;
alter function public.get_operational_access(uuid) rename to get_operational_access_lifecycle_base;
create function public.get_operational_access(p_user uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select case when exists(select 1 from public.account_deactivations where user_id=p_user and disabled) or exists(select 1 from public.user_profiles where user_id=p_user and email_release_completed_at is not null) then base||jsonb_build_object('enabled',false) else base end from(select public.get_operational_access_lifecycle_base(p_user) base) x where base is not null;
$$;
alter function public.save_operational_account(uuid,uuid,text,text,boolean,integer,jsonb,jsonb,text) rename to save_operational_account_lifecycle_base;
create function public.save_operational_account(p_actor uuid,p_user uuid,p_role text,p_name text,p_enabled boolean,p_version integer,p_scopes jsonb,p_overrides jsonb,p_reason text) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 if p_enabled and exists(select 1 from public.user_profiles where user_id=p_user and (retired_at is not null or email_release_completed_at is not null)) then raise exception using errcode='22023',message='Historical retired accounts cannot be enabled';end if;
 if p_enabled and exists(select 1 from public.account_deactivations where user_id=p_user and disabled) then raise exception using errcode='22023',message='Reactivate this account explicitly before enabling or changing operational access';end if;
 if exists(select 1 from public.operational_accounts where user_id=p_user and role='administrator' and enabled) and (not p_enabled or p_role<>'administrator') and not exists(select 1 from public.operational_accounts where user_id<>p_user and app_private.operational_capable(user_id,'accounts.manage')) then raise exception using errcode='22023',message='The last active administrator cannot be removed';end if;
 return public.save_operational_account_lifecycle_base(p_actor,p_user,p_role,p_name,p_enabled,p_version,p_scopes,p_overrides,p_reason);
end $$;

create function public.get_account_lifecycle(p_actor uuid,p_user uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'accounts.manage') then raise exception using errcode='42501',message='Administrator account management required';end if;
 return (select jsonb_build_object('user_id',p.user_id,'name',coalesce(a.full_name,p.full_name),'email',p.email,'role',coalesce(a.role,p.role),'enabled',coalesce(a.enabled,true) and not coalesce(d.disabled,false) and p.retired_at is null and p.email_release_completed_at is null,'operational',a.user_id is not null,'account_version',coalesce(a.version,0),'lifecycle_version',coalesce(d.version,0),'historical_retired',p.retired_at is not null or p.email_release_completed_at is not null) from public.user_profiles p left join public.operational_accounts a on a.user_id=p.user_id left join public.account_deactivations d on d.user_id=p.user_id where p.user_id=p_user);
end $$;

create function public.set_account_lifecycle(p_actor uuid,p_user uuid,p_account_version integer,p_lifecycle_version integer,p_enabled boolean,p_reason text,p_confirm boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.operational_accounts;d public.account_deactivations;profile public.user_profiles;scopes jsonb;overrides jsonb;was_enabled boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 if not app_private.operational_capable(p_actor,'accounts.manage') then raise exception using errcode='42501',message='Administrator account management required';end if;
 if p_confirm is distinct from true or p_enabled is null or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='Confirm the account action and provide a reason';end if;
 select * into profile from public.user_profiles where user_id=p_user for update;
 if not found or profile.retired_at is not null or profile.email_release_completed_at is not null then raise exception using errcode='22023',message='Historical retired/email-release accounts are read-only; they cannot be deactivated or restored by this workflow';end if;
 select * into a from public.operational_accounts where user_id=p_user for update;
 select * into d from public.account_deactivations where user_id=p_user for update;
 if coalesce(a.version,0) is distinct from p_account_version or coalesce(d.version,0) is distinct from p_lifecycle_version then raise exception using errcode='40001',message='Account changed. Reload before deciding';end if;
 was_enabled:=coalesce(a.enabled,true) and not coalesce(d.disabled,false);
 if was_enabled=p_enabled then raise exception using errcode='22023',message='The account is already in this state';end if;
 if not p_enabled and a.role='administrator' and a.enabled and not exists(select 1 from public.operational_accounts where user_id<>p_user and app_private.operational_capable(user_id,'accounts.manage')) then raise exception using errcode='22023',message='The last active administrator cannot be removed';end if;
 if a.user_id is not null then
  select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'scope_id',scope_id)),'[]'::jsonb) into scopes from public.operational_scopes where user_id=p_user;
  select coalesce(jsonb_object_agg(feature_key,enabled),'{}'::jsonb) into overrides from public.operational_feature_overrides where user_id=p_user;
  -- Reuse the existing atomic last-administrator/session-cutoff guard. Preserve exact grants.
  perform public.save_operational_account_lifecycle_base(p_actor,p_user,a.role,a.full_name,p_enabled,a.version,scopes,overrides,p_reason);
 end if;
 insert into public.account_deactivations(user_id,disabled,changed_by,reason) values(p_user,not p_enabled,p_actor,p_reason)
 on conflict(user_id) do update set disabled=excluded.disabled,version=public.account_deactivations.version+1,changed_by=p_actor,changed_at=clock_timestamp(),reason=excluded.reason;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,case when p_enabled then 'account.reactivated' else 'account.deactivated' end,'operational_account',p_user::text,jsonb_build_object('reason',p_reason,'previous_role',a.role,'role',a.role,'fresh_sign_in_required',true,'student_id',coalesce(profile.student_id,profile.retired_student_id)));
 return jsonb_build_object('user_id',p_user,'enabled',p_enabled,'account_version',(select version from public.operational_accounts where user_id=p_user),'lifecycle_version',(select version from public.account_deactivations where user_id=p_user),'operational_account',a.user_id is not null,'fresh_sign_in_required',true);
end $$;

alter table public.students add column lifecycle_version integer not null default 1 check(lifecycle_version>0);
create function public.operational_student_directory(p_actor uuid,p_search text default '',p_archived boolean default false,p_page integer default 1) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'accounts.manage') then raise exception using errcode='42501',message='Administrator student directory required';end if;
 if p_search is null or length(p_search)>100 or p_archived is null or p_page is null or p_page not between 1 and 100000 then raise exception using errcode='22023',message='Invalid directory query';end if;
 return (with matched as(select s.* from public.students s where (s.archived_at is not null)=p_archived and (s.name ilike '%'||p_search||'%' or s.student_number ilike '%'||p_search||'%')) select jsonb_build_object('page',p_page,'page_size',10,'total',(select count(*) from matched),'items',coalesce((select jsonb_agg(to_jsonb(x)) from(select s.id,s.name,s.student_number,s.institution,s.college,s.course,s.archived_at,s.lifecycle_version,
 coalesce((select jsonb_agg(jsonb_build_object('user_id',p.user_id,'email',p.email,'role',coalesce(o.role,p.role),'operational',o.user_id is not null,'enabled',coalesce(o.enabled,true) and not coalesce(d.disabled,false) and p.retired_at is null and p.email_release_completed_at is null,'account_version',coalesce(o.version,0),'lifecycle_version',coalesce(d.version,0),'historical_retired',p.retired_at is not null or p.email_release_completed_at is not null) order by p.user_id) from public.user_profiles p left join public.operational_accounts o on o.user_id=p.user_id left join public.account_deactivations d on d.user_id=p.user_id where p.student_id=s.id or p.retired_student_id=s.id),'[]'::jsonb) as accounts from matched s order by s.name,s.id limit 10 offset (p_page-1)*10) x),'[]'::jsonb)));
end $$;

create function public.set_participant_archive(p_actor uuid,p_student uuid,p_version integer,p_archived boolean,p_reason text,p_confirm boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.students;
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 if not app_private.operational_capable(p_actor,'accounts.manage') then raise exception using errcode='42501',message='Administrator student management required';end if;
 if p_archived is null or p_confirm is distinct from true or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='Confirm participant archival and give a reason';end if;
 perform pg_advisory_xact_lock(hashtextextended('participant-device-security',0));
 select * into s from public.students where id=p_student for update;
 if not found or s.lifecycle_version is distinct from p_version then raise exception using errcode='40001',message='Student record changed. Reload before saving';end if;
 if (s.archived_at is not null)=p_archived then raise exception using errcode='22023',message='The student record is already in this state';end if;
 update public.students set archived_at=case when p_archived then clock_timestamp() else null end,lifecycle_version=lifecycle_version+1 where id=p_student;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,case when p_archived then 'participant.archived' else 'participant.restored' end,'student',p_student::text,jsonb_build_object('reason',p_reason,'accounts_unchanged',true));
 return jsonb_build_object('id',p_student,'archived',p_archived,'lifecycle_version',s.lifecycle_version+1);
end $$;

revoke all on public.audit_logs,public.login_logs from public,anon,authenticated;

-- A service-only projection, never raw audit JSON, GPS, signatures, browser or session tokens.
create function app_private.audit_trail_events() returns table(reference_id text,occurred_at timestamptz,action text,actor_user_id uuid,target_user_id uuid,participant_key text,event_id uuid,case_id uuid,actor_kind text)
language sql stable security invoker set search_path='' as $$
 select 'audit:'||a.id::text,a.created_at,a.action,a.actor_user_id,
 subject.user_id,
 case when coalesce(s.student_id,i.student_id,ls.id,legacy.student_id) is not null then 'student:'||coalesce(s.student_id,i.student_id,ls.id,legacy.student_id)::text when s.school_id is not null then 'claim:'||s.school_id end,
 coalesce(s.event_id,legacy.event_id),c.id,
 case when a.actor_user_id is not null then 'account' when a.action in ('attendance.public_submitted','attendance.browser_bound','attendance.device_incident_opened') then 'participant' when a.action in ('attendance.review_assigned','attendance.review_reassigned','attendance.review_auto_escalated','attendance.review_reopened') then 'system' else 'unattributed' end
 from public.audit_logs a
 left join public.attendance_review_cases c on a.entity_type='attendance_review_case' and c.id::text=a.entity_id
 left join public.participant_device_incidents i on a.entity_type='participant_device_incident' and i.id::text=a.entity_id
 left join public.public_attendance_submissions s on (a.entity_type='public_attendance_submission' and s.id::text=a.entity_id) or s.id=c.submission_id or s.id=i.first_submission
 left join public.user_profiles subject on a.entity_type in ('operational_account','user_profile','user','account') and subject.user_id::text=a.entity_id
 left join public.students ls on (a.entity_type='student' and ls.id::text=a.entity_id) or ls.id::text=a.details->>'student_id'
 left join public.attendance_logs legacy on a.entity_type in ('attendance_log','attendance') and legacy.id::text=a.entity_id
 union all select 'login:'||l.id::text,l.created_at,'account.signed_in',l.user_id,l.user_id,null,null,null,'account' from public.login_logs l
 union all select 'legacy-attendance:'||l.id::text,l.checked_in_at,'legacy.attendance_recorded',coalesce(l.recorded_by,l.user_id),null,'student:'||l.student_id::text,l.event_id,null,case when coalesce(l.recorded_by,l.user_id) is null then 'participant' else 'account' end from public.attendance_logs l;
$$;
update public.operational_features set available=true where key='audit.view';
create function app_private.audit_is_administrator(p_actor uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.operational_accounts where user_id=p_actor and enabled and role='administrator') and app_private.operational_capable(p_actor,'audit.view');
$$;
create function app_private.audit_participant_allowed(p_actor uuid,p_key text,p_event uuid default null) returns boolean language sql stable security invoker set search_path='' as $$
 select app_private.audit_is_administrator(p_actor) or exists(select 1 from public.attendance_review_cases c join public.public_attendance_submissions s on s.id=c.submission_id where (case when s.student_id is null then 'claim:'||s.school_id else 'student:'||s.student_id::text end)=p_key and (p_event is null or s.event_id=p_event) and app_private.can_read_attendance_case(p_actor,c.id));
$$;

create function public.list_audit_groups(p_actor uuid,p_kind text default 'account',p_search text default '',p_page integer default 1) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'audit.view') then raise exception using errcode='42501',message='Audit Trail access required';end if;
 if p_kind is null or p_kind not in ('account','participant','system') or p_search is null or length(p_search)>100 or p_page is null or p_page not between 1 and 100000 then raise exception using errcode='22023',message='Invalid audit query';end if;
 return (with identities as(
 select 'account'::text kind,p.user_id::text key,coalesce(o.full_name,p.full_name) name,coalesce(p.email,'') identifier,
 case when p.retired_at is not null then 'Historical retired account' when not coalesce(o.enabled,true) or coalesce(d.disabled,false) then 'Deactivated' when o.user_id is null then 'Legacy account (no operational access)' else o.role end status
 from public.user_profiles p left join public.operational_accounts o on o.user_id=p.user_id left join public.account_deactivations d on d.user_id=p.user_id
 where p_kind='account' and (app_private.audit_is_administrator(p_actor) or p.user_id=p_actor)
 union all select 'participant','student:'||s.id::text,s.name,s.student_number,case when s.archived_at is null then 'Roster participant' else 'Archived participant' end from public.students s where p_kind='participant' and app_private.audit_participant_allowed(p_actor,'student:'||s.id::text)
 union all select distinct on(s.school_id) 'participant','claim:'||s.school_id,s.submitted_name,s.school_id,'Unverified attendance claim' from public.public_attendance_submissions s where p_kind='participant' and s.student_id is null and app_private.audit_participant_allowed(p_actor,'claim:'||s.school_id,s.event_id)
 union all select 'system','background','System and unattributed history','','Automated or unattributed actions' where p_kind='system' and app_private.audit_is_administrator(p_actor)),
 matched as(select * from identities where name ilike '%'||p_search||'%' or identifier ilike '%'||p_search||'%'),
 paged as(select * from matched order by name,key limit 10 offset (p_page-1)*10), audit_events as materialized(select * from app_private.audit_trail_events()),
 counted as(select g.*,(select count(*) from audit_events e where (g.kind='account' and (e.actor_user_id::text=g.key or e.target_user_id::text=g.key)) or (g.kind='participant' and e.participant_key=g.key and app_private.audit_participant_allowed(p_actor,g.key,e.event_id)) or (g.kind='system' and e.actor_kind in ('system','unattributed'))) event_count from paged g)
 select jsonb_build_object('page',p_page,'page_size',10,'total',(select count(*) from matched),'items',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from counted order by name,key) x),'[]'::jsonb)));
end $$;

create function public.get_audit_timeline(p_actor uuid,p_kind text,p_key text,p_page integer default 1) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'audit.view') then raise exception using errcode='42501',message='Audit Trail access required';end if;
 if p_kind is null or p_kind not in ('account','participant','system') or p_key is null or length(p_key)>100 or p_page is null or p_page not between 1 and 100000 then raise exception using errcode='22023',message='Invalid audit timeline';end if;
 if (p_kind='account' and not app_private.audit_is_administrator(p_actor) and p_key<>p_actor::text) or (p_kind='participant' and not app_private.audit_participant_allowed(p_actor,p_key)) or (p_kind='system' and (p_key<>'background' or not app_private.audit_is_administrator(p_actor))) then raise exception using errcode='42501',message='This audit history is outside your access';end if;
 return (with filtered as(select e.reference_id,e.occurred_at,e.action,e.actor_kind,case when e.actor_kind='account' then coalesce(actor.full_name,p.full_name,'Historical account') when e.actor_kind='participant' then 'Account-free participant' when e.actor_kind='system' then 'System' else 'Unattributed historical actor' end actor_name,
 case when audit.action='access.account_saved' then jsonb_build_object(
 'previous_role',case when audit.details->>'previous_role' in ('classroom_representative','club_president','col_regular','col_admin','administrator') then audit.details->>'previous_role' end,
 'role',case when audit.details->>'role' in ('classroom_representative','club_president','col_regular','col_admin','administrator') then audit.details->>'role' end,
 'enabled',case when jsonb_typeof(audit.details->'enabled')='boolean' then audit.details->'enabled' end,
 'scope_count',case when jsonb_typeof(audit.details->'scopes')='array' then jsonb_array_length(audit.details->'scopes') end,
 'feature_settings',case when jsonb_typeof(audit.details->'overrides')='object' then (select count(*) from jsonb_object_keys(audit.details->'overrides')) end) else null end change_summary
 from app_private.audit_trail_events() e left join public.user_profiles p on p.user_id=e.actor_user_id left join public.operational_accounts actor on actor.user_id=e.actor_user_id left join public.audit_logs audit on left(e.reference_id,6)='audit:' and audit.id::text=right(e.reference_id,36)
 where (p_kind='account' and (e.actor_user_id::text=p_key or e.target_user_id::text=p_key)) or (p_kind='participant' and e.participant_key=p_key and app_private.audit_participant_allowed(p_actor,p_key,e.event_id)) or (p_kind='system' and e.actor_kind in ('system','unattributed')))
 select jsonb_build_object('page',p_page,'page_size',20,'total',(select count(*) from filtered),'items',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from filtered order by occurred_at desc,reference_id limit 20 offset (p_page-1)*20) x),'[]'::jsonb)));
end $$;

create index audit_entity_reference_idx on public.audit_logs(entity_type,entity_id,created_at desc);
create function app_private.immutable_audit_history() returns trigger language plpgsql security invoker set search_path='' as $$ begin raise exception using errcode='22023',message='Audit and login history is append-only';end $$;
create trigger immutable_application_audit before update or delete on public.audit_logs for each row execute function app_private.immutable_audit_history();
create trigger immutable_application_login before update or delete on public.login_logs for each row execute function app_private.immutable_audit_history();
do $$ declare f record;begin
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('get_account_lifecycle','immutable_audit_history','set_participant_archive','operational_capable','operational_capable_lifecycle_base','get_operational_access','get_operational_access_lifecycle_base','save_operational_account','save_operational_account_lifecycle_base','set_account_lifecycle','operational_student_directory','audit_trail_events','audit_is_administrator','audit_participant_allowed','list_audit_groups','get_audit_timeline') loop execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.nspname,f.proname,f.args);execute format('grant execute on function %I.%I(%s) to service_role',f.nspname,f.proname,f.args);end loop;
end $$;
