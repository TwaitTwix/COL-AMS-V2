-- Phase 2: additive, service-only class/roster APIs. No account or roster seeding.
do $$ begin
 if exists(select 1 from public.students group by upper(btrim(student_number)) having count(*)>1) then
  raise exception 'Resolve normalized school-ID collisions before applying class rosters';
 end if;
end $$;
create unique index students_normalized_school_id_key on public.students(upper(btrim(student_number)));

create table public.class_sections(
 id uuid primary key default gen_random_uuid(), institution text not null, college text not null, course text not null,
 name text not null check(length(btrim(name)) between 1 and 80),
 academic_year text not null check(academic_year ~ '^[0-9]{4}-[0-9]{4}$' and right(academic_year,4)::integer=left(academic_year,4)::integer+1),
 term text not null check(length(btrim(term)) between 1 and 40),
 version integer not null default 1 check(version>0), roster_revision integer not null default 0 check(roster_revision>=0),
 current_roster_version_id uuid, archived_at timestamptz,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 foreign key(institution,college,course) references public.courses(institution,college,name)
);
create unique index class_sections_identity_key on public.class_sections(institution,college,course,academic_year,lower(btrim(term)),lower(btrim(name)));
create index class_sections_institution_idx on public.class_sections(institution) where archived_at is null;
create table public.class_assignments(
 id uuid primary key default gen_random_uuid(), section_id uuid not null references public.class_sections(id) on delete restrict,
 user_id uuid not null references public.operational_accounts(user_id) on delete restrict,
 kind text not null check(kind in ('representative','editor')), role_at_assignment text not null,
 assigned_by uuid not null references auth.users(id), assigned_at timestamptz not null default now(),
 ended_by uuid references auth.users(id), ended_at timestamptz, reason text not null,
 check((ended_at is null)=(ended_by is null)),
 check((kind='representative' and role_at_assignment='classroom_representative') or (kind='editor' and role_at_assignment in ('club_president','col_regular','col_admin')))
);
create unique index class_one_representative_key on public.class_assignments(section_id) where kind='representative' and ended_at is null;
create unique index class_one_member_kind_key on public.class_assignments(section_id,user_id,kind) where ended_at is null;
create index class_assignments_user_idx on public.class_assignments(user_id,section_id) where ended_at is null;
create index class_assignments_history_idx on public.class_assignments(section_id,assigned_at desc);
create table public.class_roster_versions(
 id uuid primary key default gen_random_uuid(), section_id uuid not null references public.class_sections(id) on delete restrict,
 revision integer not null check(revision>0), content_hash text not null, section_snapshot jsonb not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 source_filename text not null, reason text not null, row_count integer not null check(row_count between 1 and 2000),
 unique(section_id,revision),unique(section_id,id)
);
alter table public.class_sections add foreign key(id,current_roster_version_id) references public.class_roster_versions(section_id,id);
create table public.class_roster_entries(
 version_id uuid not null references public.class_roster_versions(id) on delete restrict,
 school_id text not null, full_name text not null,
 student_id uuid not null references public.students(id) on delete restrict,
 primary key(version_id,school_id),unique(version_id,student_id)
);
create index class_roster_student_idx on public.class_roster_entries(student_id);
create table public.class_roster_previews(
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references public.operational_accounts(user_id),
 section_id uuid not null references public.class_sections(id), base_revision integer not null, base_section_version integer not null,
 rows jsonb not null, source_filename text not null, mode text not null check(mode in ('merge','replace')),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '30 minutes',
 committed_version_id uuid references public.class_roster_versions(id)
);
create index class_roster_preview_expiry_idx on public.class_roster_previews(expires_at);
create index class_roster_preview_actor_idx on public.class_roster_previews(actor_id,expires_at);
create table public.event_eligibility_versions(
 id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id) on delete restrict,
 revision integer not null check(revision>0),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),reason text not null,
 unique(event_id,revision),unique(event_id,id)
);
create table public.event_eligibility_rosters(
 eligibility_id uuid not null references public.event_eligibility_versions(id) on delete restrict,
 section_id uuid not null references public.class_sections(id) on delete restrict,
 roster_version_id uuid not null,
 primary key(eligibility_id,section_id),foreign key(section_id,roster_version_id) references public.class_roster_versions(section_id,id)
);
create index event_eligibility_roster_version_idx on public.event_eligibility_rosters(roster_version_id);
create index event_eligibility_section_idx on public.event_eligibility_rosters(section_id,eligibility_id);
create table public.event_eligibility_heads(
 event_id uuid primary key references public.events(id) on delete restrict,
 eligibility_id uuid not null,foreign key(event_id,eligibility_id) references public.event_eligibility_versions(event_id,id)
);

create function app_private.immutable_roster_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception using errcode='22023',message='Roster and event eligibility history is immutable';end $$;
create trigger immutable_class_roster_version before update or delete on public.class_roster_versions for each row execute function app_private.immutable_roster_history();
create trigger immutable_class_roster_entries before update or delete on public.class_roster_entries for each row execute function app_private.immutable_roster_history();
create trigger immutable_event_eligibility_version before update or delete on public.event_eligibility_versions for each row execute function app_private.immutable_roster_history();
create trigger immutable_event_eligibility_rosters before update or delete on public.event_eligibility_rosters for each row execute function app_private.immutable_roster_history();

alter table public.operational_features add column allowed_roles text[] not null default array['classroom_representative','club_president','col_regular','col_admin','administrator'];
insert into public.operational_features(key,label,description,default_roles,available) values
 ('sections.manage','Manage class sections','Create and archive sections within assigned institutions.',array['col_admin'],true),
 ('events.eligibility','Set event class lists','Select and freeze official roster versions for an assigned event.',array['col_admin'],true);
update public.operational_features set available=true where key in ('rosters.view','rosters.manage','representatives.assign');
update public.operational_features set allowed_roles=array['col_regular','col_admin','administrator'] where key in ('representatives.assign','sections.manage');

-- An event grant does not grant its attendees' class lists. Class editors are
-- explicitly assigned; a role change invalidates its old class assignment.
create or replace function app_private.operational_capable(p_user uuid,p_feature text,p_kind text default null,p_id text default null) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select a.role='administrator' or
 (coalesce(o.enabled,a.role=any(f.default_roles)) and f.delegable and a.role=any(f.allowed_roles) and
  (p_kind is null or exists(select 1 from public.operational_scopes s where s.user_id=a.user_id and
   ((s.kind=p_kind and s.scope_id=p_id) or (s.kind='institution' and a.role in ('col_regular','col_admin') and
    ((p_kind='event' and exists(select 1 from public.events e where e.id::text=p_id and e.institution=s.scope_id)) or
     (p_kind='section' and exists(select 1 from public.class_sections c where c.id::text=p_id and c.institution=s.scope_id)))))) or
   (p_kind='section' and exists(select 1 from public.class_assignments x where x.user_id=a.user_id and x.section_id::text=p_id and x.ended_at is null and x.role_at_assignment=a.role)) or
   (p_kind='event' and p_feature='events.view' and exists(select 1 from public.event_eligibility_heads h join public.event_eligibility_rosters r on r.eligibility_id=h.eligibility_id join public.class_assignments x on x.section_id=r.section_id where h.event_id::text=p_id and x.user_id=a.user_id and x.ended_at is null and x.role_at_assignment=a.role))
 ))
 from public.operational_accounts a join public.user_profiles p on p.user_id=a.user_id
 join public.operational_features f on f.key=p_feature left join public.operational_feature_overrides o on o.user_id=a.user_id and o.feature_key=f.key
 where a.user_id=p_user and a.enabled and p.retired_at is null),false);
$$;

-- Preserve phase-1 context while appending actual, typed class assignments.
alter function public.get_operational_access(uuid) rename to get_operational_access_base;
create function public.get_operational_access(p_user uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select base||jsonb_build_object('scopes',coalesce(base->'scopes','[]'::jsonb)||coalesce((select jsonb_agg(jsonb_build_object('kind','section','scope_id',x.section_id,'assignment',x.kind) order by x.section_id,x.kind) from public.class_assignments x join public.operational_accounts a on a.user_id=x.user_id where x.user_id=p_user and x.ended_at is null and x.role_at_assignment=a.role),'[]'::jsonb)) from (select public.get_operational_access_base(p_user) base) b where base is not null;
$$;

create function public.save_class_section(p_actor uuid,p_id uuid,p_version integer,p_fields jsonb,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.class_sections;new_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='A decision reason is required';end if;
 if p_id is null then
  if p_version is distinct from 0 or not app_private.operational_capable(p_actor,'sections.manage','institution',p_fields->>'institution') then raise exception using errcode='42501',message='Section creation is outside your assigned access';end if;
  if not exists(select 1 from public.courses co join public.colleges cl on cl.institution=co.institution and cl.name=co.college where co.institution=p_fields->>'institution' and co.college=p_fields->>'college' and co.name=p_fields->>'course' and co.active and cl.active) then raise exception using errcode='22023',message='Choose an active course in the correct college and institution';end if;
  insert into public.class_sections(institution,college,course,name,academic_year,term,created_by) values(p_fields->>'institution',p_fields->>'college',p_fields->>'course',btrim(p_fields->>'name'),p_fields->>'academic_year',btrim(p_fields->>'term'),p_actor) returning id into new_id;
 else
  if not app_private.operational_capable(p_actor,'sections.manage','section',p_id::text) then raise exception using errcode='42501',message='Section management is outside your assigned access';end if;
  select * into c from public.class_sections where id=p_id for update;
  if not found or c.version is distinct from p_version then raise exception using errcode='40001',message='Section changed. Reload before saving';end if;
  if p_fields-'name'-'archived'<>'{}'::jsonb or jsonb_typeof(p_fields->'archived') is distinct from 'boolean' then raise exception using errcode='22023',message='Section affiliation/year/term cannot be rewritten. Create a new section instead';end if;
  update public.class_sections set name=btrim(p_fields->>'name'),archived_at=case when (p_fields->>'archived')::boolean then coalesce(archived_at,now()) else null end,version=version+1 where id=p_id;new_id:=p_id;
 end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'class.section_saved','class_section',new_id::text,jsonb_build_object('reason',p_reason,'fields',p_fields));
 return (select to_jsonb(s) from public.class_sections s where id=new_id);
end $$;

create function public.assign_class_officer(p_actor uuid,p_section uuid,p_user uuid,p_kind text,p_version integer,p_replace boolean,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.class_sections;a public.operational_accounts;old_user uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 if not app_private.operational_capable(p_actor,'representatives.assign','section',p_section::text) or not exists(select 1 from public.operational_accounts where user_id=p_actor and role in ('col_regular','col_admin','administrator')) then raise exception using errcode='42501',message='Assignment is outside your authorized class or officer role';end if;
 select * into c from public.class_sections where id=p_section for update;
 if not found or c.version is distinct from p_version then raise exception using errcode='40001',message='Class assignments changed. Reload before saving';end if;
 if c.archived_at is not null or p_kind not in ('representative','editor') or p_kind is null or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='Invalid assignment or archived class';end if;
 if p_user is not null then
  select * into a from public.operational_accounts where user_id=p_user and enabled;
  if not found or exists(select 1 from public.user_profiles where user_id=p_user and retired_at is not null) or (p_kind='representative' and a.role<>'classroom_representative') or (p_kind='editor' and a.role not in ('club_president','col_regular','col_admin')) then raise exception using errcode='22023',message='Choose an active account with the appropriate operational role';end if;
 end if;
 if p_kind='representative' then
  select user_id into old_user from public.class_assignments where section_id=p_section and kind=p_kind and ended_at is null;
  if old_user is not null and old_user is distinct from p_user and p_replace is distinct from true then raise exception using errcode='22023',message='A representative is already assigned. Confirm replacement explicitly';end if;
  update public.class_assignments set ended_at=now(),ended_by=p_actor where section_id=p_section and kind=p_kind and ended_at is null;
 else
  if p_user is null then raise exception using errcode='22023',message='Choose the editor to add or remove';end if;
  update public.class_assignments set ended_at=now(),ended_by=p_actor where section_id=p_section and kind=p_kind and user_id=p_user and ended_at is null;
 end if;
 if p_user is not null and (p_kind='representative' or p_replace is distinct from true) then
  insert into public.class_assignments(section_id,user_id,kind,role_at_assignment,assigned_by,reason) values(p_section,p_user,p_kind,a.role,p_actor,p_reason);
 end if;
 update public.class_sections set version=version+1 where id=p_section;
 update public.operational_accounts set version=version+1 where user_id in(p_user,old_user);
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'class.assignment_changed','class_section',p_section::text,jsonb_build_object('kind',p_kind,'user_id',p_user,'previous_user_id',old_user,'remove_editor',p_kind='editor' and p_replace,'reason',p_reason));
 return jsonb_build_object('saved',true);
end $$;

create function public.list_class_sections(p_actor uuid,p_search text default '',p_page integer default 1,p_archived boolean default false) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if p_page is null or p_page<1 or p_page>100000 or length(coalesce(p_search,''))>100 then raise exception using errcode='22023',message='Invalid class filters';end if;
 return (with filtered as(select c.* from public.class_sections c where (c.archived_at is not null)=p_archived and (app_private.operational_capable(p_actor,'rosters.view','section',c.id::text) or app_private.operational_capable(p_actor,'rosters.manage','section',c.id::text) or app_private.operational_capable(p_actor,'representatives.assign','section',c.id::text) or app_private.operational_capable(p_actor,'sections.manage','section',c.id::text)) and strpos(lower(concat_ws(' ',c.name,c.institution,c.college,c.course,c.academic_year,c.term)),lower(btrim(coalesce(p_search,''))))>0),items as(select * from filtered order by academic_year desc,name,id limit 10 offset(p_page-1)*10)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(i) order by i.academic_year desc,i.name,i.id) from items i),'[]'::jsonb),'total',(select count(*) from filtered),'page',p_page,'page_size',10));
end $$;

create function public.class_assignment_candidates(p_actor uuid,p_section uuid,p_search text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'representatives.assign','section',p_section::text) or not exists(select 1 from public.operational_accounts where user_id=p_actor and role in ('col_regular','col_admin','administrator')) then raise exception using errcode='42501',message='Assignment access required';end if;
 if length(btrim(coalesce(p_search,''))) not between 2 and 100 then raise exception using errcode='22023',message='Enter at least two search characters';end if;
 -- Only operational name/role/ID, never email, GPS, or another class roster.
 return coalesce((select jsonb_agg(to_jsonb(r)) from(select a.user_id,a.full_name,a.role from public.operational_accounts a join public.user_profiles p on p.user_id=a.user_id where a.enabled and p.retired_at is null and a.role<>'administrator' and strpos(lower(a.full_name),lower(btrim(p_search)))>0 order by a.full_name,a.user_id limit 10) r),'[]'::jsonb);
end $$;

create function public.get_class_roster(p_actor uuid,p_section uuid,p_roster uuid default null,p_page integer default 1,p_search text default '') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c public.class_sections;v uuid;can_read boolean;
begin
 can_read:=app_private.operational_capable(p_actor,'rosters.view','section',p_section::text);
 if not can_read and not app_private.operational_capable(p_actor,'rosters.manage','section',p_section::text) and not app_private.operational_capable(p_actor,'representatives.assign','section',p_section::text) and not app_private.operational_capable(p_actor,'sections.manage','section',p_section::text) then raise exception using errcode='42501',message='This class is outside your access';end if;
 select * into c from public.class_sections where id=p_section;
 if not found then raise exception using errcode='22023',message='Class section not found';end if;
 if p_page is null or p_page<1 or p_page>100000 or length(coalesce(p_search,''))>100 then raise exception using errcode='22023',message='Invalid roster filters';end if;
 v:=coalesce(p_roster,c.current_roster_version_id);
 if v is not null and not exists(select 1 from public.class_roster_versions where section_id=p_section and id=v) then raise exception using errcode='22023',message='Roster version does not belong to this class';end if;
 return jsonb_build_object('section',to_jsonb(c),'selected_version_id',v,
 'permissions',jsonb_build_object('view',can_read,'manage',app_private.operational_capable(p_actor,'rosters.manage','section',p_section::text) and c.archived_at is null,'assign',app_private.operational_capable(p_actor,'representatives.assign','section',p_section::text) and c.archived_at is null,'section',app_private.operational_capable(p_actor,'sections.manage','section',p_section::text)),
 'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'user_id',x.user_id,'name',a.full_name,'role',a.role,'kind',x.kind,'assigned_at',x.assigned_at,'ended_at',x.ended_at,'active',x.ended_at is null and a.enabled and a.role=x.role_at_assignment) order by x.assigned_at desc,x.id) from public.class_assignments x join public.operational_accounts a on a.user_id=x.user_id where x.section_id=p_section),'[]'::jsonb),
 'versions',case when can_read then coalesce((select jsonb_agg(to_jsonb(r) order by r.revision desc) from public.class_roster_versions r where r.section_id=p_section),'[]'::jsonb) else '[]'::jsonb end,
 'rows',case when can_read then coalesce((select jsonb_agg(to_jsonb(r) order by r.full_name,r.school_id) from(select school_id,full_name from public.class_roster_entries where version_id=v and strpos(lower(full_name||' '||school_id),lower(btrim(coalesce(p_search,''))))>0 order by full_name,school_id limit 25 offset(p_page-1)*25) r),'[]'::jsonb) else '[]'::jsonb end,
 'total',case when can_read then (select count(*) from public.class_roster_entries where version_id=v and strpos(lower(full_name||' '||school_id),lower(btrim(coalesce(p_search,''))))>0) else 0 end,'page',p_page,'page_size',25);
end $$;

create function app_private.class_roster_row_error(p_section uuid,p_id text,p_name text) returns text
language plpgsql stable security invoker set search_path='' as $$
declare student public.students;inst text;
begin
 if p_id is null or length(p_id) not between 1 and 40 or p_id!~'^[A-Z0-9][A-Z0-9 ./_-]*$' then return 'School ID must be text, at most 40 characters, using letters, numbers, spaces or . / _ -';end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 120 or p_name ~ '[[:cntrl:]]' or p_name ~ '^[=+@-]' then return 'Full name must be plain text, at most 120 characters, without formula prefixes or control characters';end if;
 select * into student from public.students where upper(btrim(student_number))=p_id;
 if found then
  select institution into inst from public.class_sections where id=p_section;
  if student.archived_at is not null then return 'This school ID is archived. Ask an administrator to review its identity';end if;
  if upper(regexp_replace(btrim(student.name),'\s+',' ','g'))<>upper(regexp_replace(btrim(p_name),'\s+',' ','g')) or (student.institution is not null and student.institution<>inst) then return 'This school ID conflicts with an existing identity. Ask an administrator to review it';end if;
 end if;
 return null;
end $$;

create function public.preview_class_roster(p_actor uuid,p_section uuid,p_rows jsonb,p_filename text,p_mode text default 'merge') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.class_sections;normalized jsonb;preview public.class_roster_previews;valid_count integer;bad_count integer;
begin
 if not app_private.operational_capable(p_actor,'rosters.manage','section',p_section::text) then raise exception using errcode='42501',message='Roster import is outside your assigned class';end if;
 select * into c from public.class_sections where id=p_section;
 if not found or c.archived_at is not null then raise exception using errcode='22023',message='Choose an active class';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 1000 or p_mode is null or p_mode not in ('merge','replace') or length(coalesce(p_filename,'')) not between 1 and 120 then raise exception using errcode='22023',message='Invalid roster preview';end if;
 with raw as(select value->>'school_id' as original_id,upper(btrim(coalesce(value->>'school_id',''))) as school_id,btrim(coalesce(value->>'full_name','')) as full_name,(value->>'row_number')::integer as row_number,nullif(left(value->>'error',240),'') as parser_error from jsonb_array_elements(p_rows)),
 validated as(select *,coalesce(parser_error,app_private.class_roster_row_error(p_section,school_id,full_name),case when count(*) over(partition by school_id)>1 then 'School ID is repeated in this upload' end) as error from raw)
 select jsonb_agg(jsonb_build_object('row_number',row_number,'school_id',school_id,'full_name',full_name,'error',error) order by row_number),count(*) filter(where error is null),count(*) filter(where error is not null) into normalized,valid_count,bad_count from validated;
 delete from public.class_roster_previews where expires_at<now();
 insert into public.class_roster_previews(actor_id,section_id,base_revision,base_section_version,rows,source_filename,mode) values(p_actor,p_section,c.roster_revision,c.version,normalized,p_filename,p_mode) returning * into preview;
 return jsonb_build_object('id',preview.id,'section_id',p_section,'base_revision',c.roster_revision,'expires_at',preview.expires_at,'mode',p_mode,'rows',normalized,'valid_count',valid_count,'rejected_count',bad_count,
 'added_count',(select count(*) from jsonb_array_elements(normalized) r where r->>'error' is null and not exists(select 1 from public.class_roster_entries x where x.version_id=c.current_roster_version_id and x.school_id=r->>'school_id')),
 'removed_count',case when p_mode='replace' then (select count(*) from public.class_roster_entries x where x.version_id=c.current_roster_version_id and not exists(select 1 from jsonb_array_elements(normalized) r where r->>'error' is null and r->>'school_id'=x.school_id)) else 0 end);
end $$;

create function public.commit_class_roster(p_actor uuid,p_preview uuid,p_accept_rejected boolean,p_confirm_replace boolean,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare preview public.class_roster_previews;c public.class_sections;incoming jsonb;final_rows jsonb;item jsonb;digest text;snapshot jsonb;v public.class_roster_versions;student_uuid uuid;bad integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 -- All identity-creating imports serialize before section locks, preventing a
 -- new ID/name pair being accepted inconsistently by two different sections.
 perform pg_advisory_xact_lock(hashtextextended('class-roster-identities',0));
 select * into preview from public.class_roster_previews where id=p_preview for update;
 if not found or preview.actor_id<>p_actor then raise exception using errcode='42501',message='This roster preview is unavailable to your account';end if;
 if not app_private.operational_capable(p_actor,'rosters.manage','section',preview.section_id::text) then raise exception using errcode='42501',message='Roster access has changed';end if;
 if preview.committed_version_id is not null then return jsonb_build_object('version_id',preview.committed_version_id,'replayed',true,'changed',false);end if;
 select * into c from public.class_sections where id=preview.section_id for update;
 if preview.expires_at<=now() or c.archived_at is not null or c.roster_revision<>preview.base_revision or c.version<>preview.base_section_version then raise exception using errcode='40001',message='The class list or preview changed/expired. Upload again to review the latest list';end if;
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='A roster change reason is required';end if;
 select count(*) into bad from jsonb_array_elements(preview.rows) r where r->>'error' is not null;
 if (bad>0 and p_accept_rejected is distinct from true) or (preview.mode='replace' and (bad>0 or p_confirm_replace is distinct from true)) then raise exception using errcode='22023',message='Confirm valid rows explicitly; replacement requires a fully valid list and removal confirmation';end if;
 select coalesce(jsonb_agg(r order by r->>'school_id'),'[]'::jsonb) into incoming from jsonb_array_elements(preview.rows) r where r->>'error' is null;
 if jsonb_array_length(incoming)=0 then raise exception using errcode='22023',message='There are no valid rows to import';end if;
 for item in select value from jsonb_array_elements(incoming) loop
  if app_private.class_roster_row_error(c.id,item->>'school_id',item->>'full_name') is not null then raise exception using errcode='40001',message='A participant identity changed since preview. Upload again for review';end if;
 end loop;
 with candidates as(select r->>'school_id' school_id,r->>'full_name' full_name,1 priority from jsonb_array_elements(incoming) r union all select school_id,full_name,0 from public.class_roster_entries where version_id=c.current_roster_version_id and preview.mode='merge'),
 chosen as(select distinct on(school_id) school_id,full_name from candidates order by school_id,priority desc)
 select jsonb_agg(to_jsonb(chosen) order by school_id) into final_rows from chosen;
 if jsonb_array_length(final_rows)>2000 then raise exception using errcode='22023',message='A class roster may contain at most 2000 students';end if;
 snapshot:=jsonb_build_object('id',c.id,'name',c.name,'institution',c.institution,'college',c.college,'course',c.course,'academic_year',c.academic_year,'term',c.term);
 digest:=encode(sha256(convert_to(jsonb_build_object('section',snapshot,'rows',final_rows)::text,'UTF8')),'hex');
 select * into v from public.class_roster_versions where id=c.current_roster_version_id;
 if v.content_hash=digest then
  update public.class_roster_previews set committed_version_id=v.id,rows='[]'::jsonb where id=p_preview;
  return jsonb_build_object('version_id',v.id,'revision',v.revision,'changed',false,'row_count',v.row_count);
 end if;
 insert into public.class_roster_versions(section_id,revision,content_hash,section_snapshot,created_by,source_filename,reason,row_count) values(c.id,c.roster_revision+1,digest,snapshot,p_actor,preview.source_filename,p_reason,jsonb_array_length(final_rows)) returning * into v;
 for item in select value from jsonb_array_elements(final_rows) loop
  select id into student_uuid from public.students where upper(btrim(student_number))=item->>'school_id';
  if student_uuid is null then
   insert into public.students(name,student_number,student_token,institution,college,course) values(item->>'full_name',item->>'school_id',gen_random_uuid()::text,c.institution,c.college,c.course) returning id into student_uuid;
  end if;
  insert into public.class_roster_entries(version_id,school_id,full_name,student_id) values(v.id,item->>'school_id',item->>'full_name',student_uuid);
 end loop;
 update public.class_sections set current_roster_version_id=v.id,roster_revision=v.revision where id=c.id;
 update public.class_roster_previews set committed_version_id=v.id,rows='[]'::jsonb where id=p_preview;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'class.roster_imported','class_roster_version',v.id::text,jsonb_build_object('section_id',c.id,'revision',v.revision,'rows',v.row_count,'rejected_rows',bad,'mode',preview.mode,'reason',p_reason));
 return jsonb_build_object('version_id',v.id,'revision',v.revision,'changed',true,'row_count',v.row_count,'rejected_count',bad);
end $$;

create function public.set_event_class_rosters(p_actor uuid,p_event uuid,p_expected_revision integer,p_sections jsonb,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.events;head public.event_eligibility_versions;c public.class_sections;item jsonb;next_id uuid;selection jsonb;old_selection jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('operational-account-security',0));
 if not app_private.operational_capable(p_actor,'events.eligibility','event',p_event::text) then raise exception using errcode='42501',message='Event eligibility is outside your access';end if;
 select * into e from public.events where id=p_event and archived_at is null for update;
 if not found or jsonb_typeof(p_sections) is distinct from 'array' or jsonb_array_length(p_sections) not between 1 and 100 or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='Choose an active event, one or more class lists and a reason';end if;
 select v.* into head from public.event_eligibility_heads h join public.event_eligibility_versions v on v.id=h.eligibility_id where h.event_id=p_event;
 if coalesce(head.revision,0) is distinct from p_expected_revision then raise exception using errcode='40001',message='Event class lists changed. Reload before saving';end if;
 if exists(select 1 from public.event_eligibility_rosters r where r.eligibility_id=head.id and not app_private.operational_capable(p_actor,'rosters.view','section',r.section_id::text)) then raise exception using errcode='42501',message='An existing event class list is outside your current access. Ask an administrator to review all its lists';end if;
 selection:='[]';
 for item in select distinct value from jsonb_array_elements(p_sections) loop
  select * into c from public.class_sections where id::text=item#>>'{}' and archived_at is null;
  if not found or c.current_roster_version_id is null or not app_private.operational_capable(p_actor,'rosters.view','section',c.id::text) or (e.institution is not null and c.institution<>e.institution) or (e.college is not null and c.college<>e.college) then raise exception using errcode='42501',message='A selected class list is unavailable, outside your access, or does not match the event affiliation';end if;
  selection:=selection||jsonb_build_array(jsonb_build_object('section_id',c.id,'roster_version_id',c.current_roster_version_id));
 end loop;
 select jsonb_agg(r order by r->>'section_id') into selection from jsonb_array_elements(selection) r;
 select jsonb_agg(jsonb_build_object('section_id',section_id,'roster_version_id',roster_version_id) order by section_id::text) into old_selection from public.event_eligibility_rosters where eligibility_id=head.id;
 if selection=old_selection then return jsonb_build_object('revision',head.revision,'eligibility_id',head.id,'changed',false);end if;
 if now()>=e.starts_at-interval '1 hour' or exists(select 1 from public.attendance_logs where event_id=p_event) then raise exception using errcode='22023',message='Event eligibility is locked once its attendance window opens or attendance exists';end if;
 insert into public.event_eligibility_versions(event_id,revision,created_by,reason) values(p_event,coalesce(head.revision,0)+1,p_actor,p_reason) returning id into next_id;
 insert into public.event_eligibility_rosters(eligibility_id,section_id,roster_version_id) select next_id,(r->>'section_id')::uuid,(r->>'roster_version_id')::uuid from jsonb_array_elements(selection) r;
 insert into public.event_eligibility_heads(event_id,eligibility_id) values(p_event,next_id) on conflict(event_id) do update set eligibility_id=excluded.eligibility_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'event.class_lists_set','event_eligibility_version',next_id::text,jsonb_build_object('event_id',p_event,'rosters',selection,'reason',p_reason));
 return jsonb_build_object('eligibility_id',next_id,'revision',coalesce(head.revision,0)+1,'changed',true);
end $$;

create function public.get_event_class_rosters(p_actor uuid,p_event uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'events.eligibility','event',p_event::text) then raise exception using errcode='42501',message='Event eligibility management access required';end if;
 return jsonb_build_object('event_id',p_event,'revision',coalesce((select v.revision from public.event_eligibility_heads h join public.event_eligibility_versions v on v.id=h.eligibility_id where h.event_id=p_event),0),
 'rosters',coalesce((select jsonb_agg(jsonb_build_object('section_id',r.section_id,'name',v.section_snapshot->>'name','roster_version_id',r.roster_version_id,'roster_revision',v.revision,'row_count',v.row_count) order by c.name,c.id) from public.event_eligibility_heads h join public.event_eligibility_rosters r on r.eligibility_id=h.eligibility_id join public.class_sections c on c.id=r.section_id join public.class_roster_versions v on v.id=r.roster_version_id where h.event_id=p_event and app_private.operational_capable(p_actor,'rosters.view','section',r.section_id::text)),'[]'::jsonb));
end $$;

-- All persistent history is private and append-only. Browser roles receive no
create or replace function public.list_operational_events(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not app_private.operational_capable(p_actor,'events.view') then raise exception using errcode='42501',message='Event access is disabled';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'institution',e.institution,'college',e.college,'starts_at',e.starts_at,'ends_at',e.ends_at,'can_set_class_lists',app_private.operational_capable(p_actor,'events.eligibility','event',e.id::text)) order by e.starts_at desc,e.id) from public.events e where e.archived_at is null and app_private.operational_capable(p_actor,'events.view','event',e.id::text)),'[]'::jsonb);
end $$;

-- All persistent history is private and append-only. Browser roles receive no
-- direct table or RPC privileges, even though forms later become public.
do $$ declare t text;f record; begin
 foreach t in array array['class_sections','class_assignments','class_roster_versions','class_roster_entries','class_roster_previews','event_eligibility_versions','event_eligibility_rosters','event_eligibility_heads'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('immutable_roster_history','class_roster_row_error','get_operational_access','get_operational_access_base','save_class_section','assign_class_officer','list_class_sections','class_assignment_candidates','get_class_roster','preview_class_roster','commit_class_roster','set_event_class_rosters','get_event_class_rosters') loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.nspname,f.proname,f.args);
  execute format('grant execute on function %I.%I(%s) to service_role',f.nspname,f.proname,f.args);
 end loop;
end $$;
