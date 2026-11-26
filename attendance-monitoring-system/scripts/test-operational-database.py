"""Isolated PostgreSQL regression harness. Never accepts a remote connection URL.
Usage: python scripts/test-operational-database.py --backup-dir PATH
Requires PostgreSQL 18 binaries on Windows and the sanitized pre-revision backup.
"""
import argparse, pathlib, json, subprocess, os, secrets, socket, uuid, concurrent.futures, datetime, shutil, re
args=argparse.ArgumentParser();args.add_argument('--backup-dir',required=True);args.add_argument('--pg-bin',default=r'C:\Program Files\PostgreSQL\18\bin');opt=args.parse_args()
app=pathlib.Path(__file__).resolve().parent.parent;backup=pathlib.Path(opt.backup_dir).resolve();pg=pathlib.Path(opt.pg_bin).resolve()
snapshot=json.loads((backup/'database/snapshot.json').read_text(encoding='utf-8'))
staging=app/'.local-preview';staging.mkdir(exist_ok=True)
work=(staging/('operational-db-'+uuid.uuid4().hex)).resolve();work.mkdir(exist_ok=False)
assert work.parent==staging.resolve()
password=secrets.token_urlsafe(36);pw=work/'password.tmp';pw.write_text(password)
env=os.environ.copy();env['PGPASSWORD']=password;env['PGCLIENTENCODING']='UTF8'
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
def run(command,**kw):
 r=subprocess.run([str(v) for v in command],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',**kw)
 if r.returncode:raise RuntimeError((r.stderr or r.stdout)[-6000:])
 return r.stdout
started=False;results=[]
try:
 run([pg/'initdb.exe','-D',work/'data','-U','postgres','--encoding=UTF8','--locale=C','--auth=scram-sha-256','--pwfile',pw]);pw.unlink()
 with (work/'startup.log').open('w') as log:subprocess.run([str(pg/'pg_ctl.exe'),'-D',str(work/'data'),'-l',str(work/'server.log'),'-o',f'-h 127.0.0.1 -p {port}','-w','start'],env=env,stdout=log,stderr=log,check=True)
 started=True
 psql=[pg/'psql.exe','-X','-h','127.0.0.1','-p',str(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1']
 cols=[]
 for k in snapshot['auth_users'][0]:
  typ='uuid' if k in {'id','instance_id'} else 'boolean' if k in {'is_sso_user','is_anonymous'} else 'jsonb' if k in {'raw_app_meta_data','raw_user_meta_data'} else 'timestamptz' if k.endswith('_at') or k=='banned_until' else 'text'
  cols.append('"'+k+'" '+typ+(' PRIMARY KEY' if k=='id' else ''))
 run(psql+['-c','''CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
 CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions; GRANT USAGE ON SCHEMA auth TO service_role;
 CREATE TABLE auth.users ('''+','.join(cols)+''');
 CREATE TABLE auth.identities (id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),provider text,created_at timestamptz,updated_at timestamptz,provider_id text,identity_data jsonb,last_sign_in_at timestamptz,email text GENERATED ALWAYS AS (identity_data->>'email') STORED);
 CREATE TABLE auth.sessions (id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),created_at timestamptz,not_after timestamptz);
 CREATE TABLE storage.buckets (id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);'''])
 run(psql+['-f',backup/'database/restore.sql'],cwd=backup/'database')
 migrations=[next((app/'supabase/migrations').glob('*_'+name+'.sql')) for name in ['operational_access_foundation','class_rosters_and_assignments','public_event_attendance','public_device_binding','attendance_review_queue','account_lifecycle_and_audit_trail','revision_report_snapshots']]
 for migration in migrations:run(psql+['-1','-f',migration])
 assert run(psql+['-Atc','select count(*) from public.operational_accounts']).strip()=='0','Migration provisioned accounts automatically'
 for fixture in sorted((app/'tests').glob('*.sql')):
  r=subprocess.run([str(x) for x in psql+['-f',fixture]],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace')
  item={'file':fixture.name,'passed':r.returncode==0}
  if r.returncode:item['error']=(r.stderr or r.stdout)[-3000:]
  results.append(item)
 for name,rows in snapshot['data'].items():assert int(run(psql+['-Atc','select count(*) from public."'+name+'"']).strip())==len(rows),'Fixture leaked changes: '+name
 assert run(psql+['-Atc','select count(*) from public.operational_accounts']).strip()=='0'
 # Real independent transactions race to remove the two remaining administrators.
 first,second=str(uuid.uuid4()),str(uuid.uuid4())
 for identity in [first,second]:
  run(psql+['-c',f"insert into auth.users(id,email,email_confirmed_at) values('{identity}','{identity}@test.invalid',now()); insert into public.user_profiles(user_id,full_name) values('{identity}','Concurrency fixture'); insert into public.operational_accounts(user_id,role,full_name) values('{identity}','administrator','Concurrency fixture');"])
 def deactivate(identity):
  sql=f"begin;set local role service_role; select public.save_operational_account('{identity}','{identity}','administrator','Concurrency fixture',false,1,'[]','{{}}','Concurrent self deactivation');select pg_sleep(0.1);commit;"
  return subprocess.run([str(x) for x in psql+['-c',sql]],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:races=list(pool.map(deactivate,[first,second]))
 assert sum(r.returncode==0 for r in races)==1,'Both concurrent administrator removals succeeded or both failed'
 assert any('last active administrator' in r.stderr for r in races if r.returncode),'Race failed for an unexpected reason'
 assert run(psql+['-Atc',"select count(*) from public.operational_accounts where role='administrator' and enabled"]).strip()=='1'
 admin=run(psql+['-Atc',"select user_id from public.operational_accounts where role='administrator' and enabled"]).strip()
 reps=[str(uuid.uuid4()),str(uuid.uuid4())]
 for identity in reps:
  run(psql+['-c',f"insert into auth.users(id,email,email_confirmed_at) values('{identity}','{identity}@test.invalid',now());insert into public.user_profiles(user_id,full_name) values('{identity}','Representative race');insert into public.operational_accounts(user_id,role,full_name) values('{identity}','classroom_representative','Representative race');"])
 def create_section(name):
  sql=f"select public.save_class_section('{admin}',null,0,jsonb_build_object('institution',institution,'college',college,'course',name,'name','{name}','academic_year','2026-2027','term','Race test'),'Disposable race fixture')->>'id' from public.courses where institution='ISAP' and active order by name limit 1"
  return run(psql+['-Atc',sql]).strip()
 section=create_section('Representative '+uuid.uuid4().hex)
 def appoint(identity):
  sql=f"begin;set local role service_role;select public.assign_class_officer('{admin}','{section}','{identity}','representative',1,false,'Concurrent appointment');select pg_sleep(0.1);commit;"
  return subprocess.run([str(x) for x in psql+['-c',sql]],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:appointments=list(pool.map(appoint,reps))
 assert sum(r.returncode==0 for r in appointments)==1,'Concurrent representative assignment did not resolve to one success'
 assert any('Class assignments changed' in r.stderr for r in appointments if r.returncode),'Representative race failed unexpectedly'
 assert run(psql+['-Atc',f"select count(*) from public.class_assignments where section_id='{section}' and kind='representative' and ended_at is null"]).strip()=='1'
 sections=[create_section('Import A '+uuid.uuid4().hex),create_section('Import B '+uuid.uuid4().hex)]
 shared_id='RACE-'+uuid.uuid4().hex[:16].upper();previews=[]
 for index,section_id in enumerate(sections):
  sql=f"set role service_role;select public.preview_class_roster('{admin}','{section_id}',jsonb_build_array(jsonb_build_object('row_number',2,'school_id','{shared_id}','full_name','Race identity {index}')),'race.xlsx','merge')->>'id';"
  previews.append(run(psql+['-Atc',sql]).strip().splitlines()[-1])
 def commit_preview(preview):
  sql=f"begin;set local role service_role;select public.commit_class_roster('{admin}','{preview}',false,false,'Concurrent identity import');select pg_sleep(0.1);commit;"
  return subprocess.run([str(x) for x in psql+['-c',sql]],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:imports=list(pool.map(commit_preview,previews))
 assert sum(r.returncode==0 for r in imports)==1,'Conflicting cross-class identity imports both succeeded or both failed'
 assert any('identity changed since preview' in r.stderr for r in imports if r.returncode),'Identity race failed unexpectedly'
 assert run(psql+['-Atc',f"select count(*) from public.students where upper(btrim(student_number))='{shared_id}'"]).strip()=='1'
 # Public attendance: independent transactions compete for the same school/checkpoint slot.
 public_section=create_section('Public attendance '+uuid.uuid4().hex)
 public_school='PUBLIC-'+uuid.uuid4().hex[:16].upper()
 preview=run(psql+['-Atc',f"select public.preview_class_roster('{admin}','{public_section}',jsonb_build_array(jsonb_build_object('row_number',2,'school_id','{public_school}','full_name','Public race identity')),'race.xlsx','merge')->>'id'"]).strip()
 run(psql+['-c',f"select public.commit_class_roster('{admin}','{preview}',false,false,'Public race roster')"])
 public_event=str(uuid.uuid4())
 run(psql+['-c',f"insert into public.events(id,name,institution,latitude,longitude,radius_meters,starts_at,ends_at) values('{public_event}','Public concurrency','ISAP',17,121,100,now()+interval '2 days',now()+interval '3 days');select public.set_event_class_rosters('{admin}','{public_event}',0,jsonb_build_array('{public_section}'),'Public race eligibility');"])
 public_token=run(psql+['-Atc',f"select public.save_event_public_link('{admin}','{public_event}',0,true,false,'','Public race publishing')->>'token'"]).strip()
 run(psql+['-c',f"update public.events set starts_at=now()-interval '1 minute',ends_at=now()+interval '1 hour' where id='{public_event}'"])
 def submit_public(parameters):
  request_id,school=parameters
  sql=f"begin;set local role service_role;select public.submit_public_attendance('{public_token}','{request_id}',repeat('a',64),repeat('b',64),'Race browser',repeat('c',64),'{school}','Public race identity','ISAP','','default',17,121,5,clock_timestamp(),'[[[0.1,0.1],[0.2,0.2],[0.3,0.1],[0.4,0.2],[0.5,0.1],[0.6,0.2],[0.7,0.1],[0.8,0.2]]]','2026-11-26-attendance-v1',true);select pg_sleep(0.1);commit;"
  out=run(psql+['-Atc',sql]);return json.loads(next(line for line in out.splitlines() if line.startswith('{')))
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:submissions=list(pool.map(submit_public,[(str(uuid.uuid4()),public_school),(str(uuid.uuid4()),public_school)]))
 assert sorted(x['status_code'] for x in submissions)==[202,409],'Parallel submissions did not reserve exactly one attendance slot'
 assert run(psql+['-Atc',f"select count(*) from public.public_attendance_submissions where event_id='{public_event}' and school_id='{public_school}'"]).strip()=='1'
 replay_id=str(uuid.uuid4());replay_school='REPLAY-'+uuid.uuid4().hex[:16].upper()
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:replays=list(pool.map(submit_public,[(replay_id,replay_school)]*2))
 assert all(x['status_code']==202 for x in replays) and replays[0]['body']['receipt_id']==replays[1]['body']['receipt_id'],'Concurrent request replay was not idempotent'
 assert run(psql+['-Atc',f"select count(*) from public.public_attendance_requests where request_id='{replay_id}'"]).strip()=='1'
 # Cross-event races must serialize by participant/browser, not just by event.
 device_section=create_section('Device race '+uuid.uuid4().hex)
 device_ids=['DEVICE-'+uuid.uuid4().hex[:12].upper() for _ in range(3)]
 device_rows=json.dumps([{'row_number':i+2,'school_id':school,'full_name':'Device race participant'} for i,school in enumerate(device_ids)])
 device_preview=run(psql+['-Atc',f"select public.preview_class_roster('{admin}','{device_section}','{device_rows}'::jsonb,'devices.xlsx','merge')->>'id'"]).strip()
 run(psql+['-c',f"select public.commit_class_roster('{admin}','{device_preview}',false,false,'Device race roster')"])
 device_events=[str(uuid.uuid4()),str(uuid.uuid4())];device_tokens=[]
 for device_event in device_events:
  run(psql+['-c',f"insert into public.events(id,name,institution,latitude,longitude,radius_meters,starts_at,ends_at) values('{device_event}','Cross-event device race','ISAP',17,121,100,now()+interval '2 days',now()+interval '3 days');select public.set_event_class_rosters('{admin}','{device_event}',0,jsonb_build_array('{device_section}'),'Device race eligibility');"])
  device_tokens.append(run(psql+['-Atc',f"select public.save_event_public_link('{admin}','{device_event}',0,true,false,'','Device race link')->>'token'"]).strip())
  run(psql+['-c',f"update public.events set starts_at=now()-interval '1 minute',ends_at=now()+interval '1 hour' where id='{device_event}'"])
 def submit_device(parameters):
  link,school,browser=parameters
  sql=f"begin;set local role service_role;select public.submit_public_attendance('{link}','{uuid.uuid4()}',repeat('{browser}',64),repeat('b',64),'Cross-event race browser',repeat('c',64),'{school}','Device race participant','ISAP','','default',17,121,5,clock_timestamp(),'[[[0.1,0.1],[0.2,0.2],[0.3,0.1],[0.4,0.2],[0.5,0.1],[0.6,0.2],[0.7,0.1],[0.8,0.2]]]','2026-11-26-attendance-v1',true);select pg_sleep(0.1);commit;"
  out=run(psql+['-Atc',sql]);return json.loads(next(line for line in out.splitlines() if line.startswith('{')))
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:device_race=list(pool.map(submit_device,[(device_tokens[0],device_ids[0],'d'),(device_tokens[1],device_ids[0],'e')]))
 assert all(x['status_code']==202 for x in device_race)
 assert run(psql+['-Atc',f"select count(*) from public.participant_device_bindings b join public.students s on s.id=b.student_id where s.student_number='{device_ids[0]}' and b.ended_at is null"]).strip()=='1'
 assert run(psql+['-Atc',f"select coalesce(sum(points),0) from public.participant_penalty_ledger l join public.students s on s.id=l.student_id where s.student_number='{device_ids[0]}'"]).strip()=='1'
 assert run(psql+['-Atc',f"select count(*) from public.public_attendance_submissions where school_id='{device_ids[0]}' and status='approved'"]).strip()=='0'
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:shared_race=list(pool.map(submit_device,[(device_tokens[0],device_ids[1],'f'),(device_tokens[1],device_ids[2],'f')]))
 assert all(x['status_code']==202 for x in shared_race)
 assert run(psql+['-Atc',"select count(*) from public.participant_device_bindings where device_hash=repeat('f',64) and ended_at is null"]).strip()=='1'
 assert run(psql+['-Atc',"select count(*) from public.participant_device_incidents where candidate_device=repeat('f',64) and kind='shared_browser'"]).strip()=='2'
 assert run(psql+['-Atc',"select count(*) from public.participant_penalty_ledger where incident_id in(select id from public.participant_device_incidents where candidate_device=repeat('f',64))"]).strip()=='0'
 # Existing shared-browser risk must follow a later checkpoint/event, without another point.
 shared_owner=run(psql+['-Atc',"select s.student_number from public.participant_device_bindings b join public.students s on s.id=b.student_id where b.device_hash=repeat('f',64) and b.ended_at is null"]).strip()
 first_shared_event=run(psql+['-Atc',f"select event_id from public.public_attendance_submissions where school_id='{shared_owner}' order by created_at limit 1"]).strip()
 next_shared_token=device_tokens[1 if first_shared_event==device_events[0] else 0]
 later_shared=submit_device((next_shared_token,shared_owner,'f'))
 assert later_shared['status_code']==202
 later_id=later_shared['body']['receipt_id']
 assert run(psql+['-Atc',f"select 'shared_browser'=any(review_reasons) from public.public_attendance_submissions where id='{later_id}'"]).strip()=='t','Shared-browser risk did not follow later attendance'
 # Resolve-vs-resolve: only one optimistic-version decision may commit.
 review_case=run(psql+['-Atc',f"select c.id from public.attendance_review_cases c join public.public_attendance_submissions a on a.id=c.submission_id where a.event_id='{public_event}' and a.school_id='{public_school}'"]).strip()
 def decide_review(parameters):
  reviewer,case_id,action=parameters
  sql=f"begin;set local role service_role;select public.decide_attendance_review('{reviewer}','{case_id}',1,'{action}','Concurrency-reviewed attendance',true);select pg_sleep(0.1);commit;"
  return subprocess.run([str(x) for x in psql+['-c',sql]],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:decisions=list(pool.map(decide_review,[(admin,review_case,'approve'),(admin,review_case,'reject')]))
 assert sum(r.returncode==0 for r in decisions)==1,'Concurrent attendance decisions both succeeded or both failed'
 assert any('Attendance case changed' in r.stderr for r in decisions if r.returncode),'Decision race failed unexpectedly'
 assert run(psql+['-Atc',f"select count(*) from public.attendance_review_history where case_id='{review_case}' and action in ('approve','reject')"]).strip()=='1'
 # Deadline worker vs a current review decision: whichever commits first is authoritative.
 regular=str(uuid.uuid4())
 run(psql+['-c',f"insert into auth.users(id,email,email_confirmed_at) values('{regular}','{regular}@test.invalid',now());insert into public.user_profiles(user_id,full_name) values('{regular}','Worker race reviewer');select public.save_operational_account('{admin}','{regular}','col_regular','Worker race reviewer',true,0,'[{{\"kind\":\"institution\",\"scope_id\":\"ISAP\"}}]','{{}}','Worker concurrency fixture');"])
 timed_event=str(uuid.uuid4())
 run(psql+['-c',f"insert into public.events(id,name,institution,latitude,longitude,radius_meters,starts_at,ends_at) values('{timed_event}','Worker concurrency','ISAP',17,121,100,now()+interval '2 days',now()+interval '3 days');select public.set_event_class_rosters('{admin}','{timed_event}',0,jsonb_build_array('{public_section}'),'Worker concurrency eligibility');"])
 public_token=run(psql+['-Atc',f"select public.save_event_public_link('{admin}','{timed_event}',0,true,false,'','Worker concurrency link')->>'token'"]).strip()
 run(psql+['-c',f"update public.events set starts_at=now()-interval '1 minute',ends_at=now()+interval '1 hour' where id='{timed_event}'"])
 submit_public((str(uuid.uuid4()),public_school))
 timed_case=run(psql+['-Atc',f"select c.id from public.attendance_review_cases c join public.public_attendance_submissions a on a.id=c.submission_id where a.event_id='{timed_event}' and a.school_id='{public_school}'"]).strip()
 run(psql+['-c',f"update public.attendance_review_cases set due_at=clock_timestamp()-interval '1 second' where id='{timed_case}'"])
 def process_reviews(_=None):
  return subprocess.run([str(x) for x in psql+['-c',"begin;set local role service_role;select public.process_attendance_review_queue(100);select pg_sleep(0.1);commit;"]],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  advance=pool.submit(process_reviews);decision=pool.submit(decide_review,(regular,timed_case,'approve'));advanced=advance.result();decided=decision.result()
 assert advanced.returncode==0,'Deadline worker failed during review race'
 if decided.returncode==0:
  assert run(psql+['-Atc',f"select state from public.attendance_review_cases where id='{timed_case}'"]).strip()=='approved'
 else:
  assert 'Attendance case changed' in decided.stderr or 'current assigned reviewer' in decided.stderr
  assert run(psql+['-Atc',f"select state||':'||level from public.attendance_review_cases where id='{timed_case}'"]).strip()=='open:3'
 unknown_school='WORKER-'+uuid.uuid4().hex[:12].upper();submit_public((str(uuid.uuid4()),unknown_school))
 worker_case=run(psql+['-Atc',f"select c.id from public.attendance_review_cases c join public.public_attendance_submissions a on a.id=c.submission_id where a.event_id='{timed_event}' and a.school_id='{unknown_school}'"]).strip()
 run(psql+['-c',f"update public.attendance_review_cases set due_at=clock_timestamp()-interval '1 second' where id='{worker_case}'"])
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:workers=list(pool.map(process_reviews,[None,None]))
 assert all(r.returncode==0 for r in workers),'Competing workers failed'
 assert run(psql+['-Atc',f"select level||':'||version from public.attendance_review_cases where id='{worker_case}'"]).strip()=='3:2'
 assert run(psql+['-Atc',f"select count(*) from public.attendance_review_notifications where case_id='{worker_case}'"]).strip()=='2','Concurrent workers duplicated notifications'
 # Dedicated lifecycle actions keep the same atomic last-administrator guarantee.
 recovery_admin=str(uuid.uuid4())
 run(psql+['-c',f"insert into auth.users(id,email,email_confirmed_at) values('{recovery_admin}','{recovery_admin}@test.invalid',now());insert into public.user_profiles(user_id,full_name) values('{recovery_admin}','Lifecycle recovery administrator');select public.save_operational_account('{admin}','{recovery_admin}','administrator','Lifecycle recovery administrator',true,0,'[]','{{}}','Lifecycle race fixture');"])
 lifecycle_states=[]
 for account_id in [admin,recovery_admin]:
  lifecycle_states.append(json.loads(run(psql+['-Atc',f"select public.get_account_lifecycle('{admin}','{account_id}')"]).strip()))
 def change_lifecycle(parameters):
  actor_id,state,activate=parameters
  sql=f"begin;set local role service_role;select public.set_account_lifecycle('{actor_id}','{state['user_id']}',{state['account_version']},{state['lifecycle_version']},{str(activate).lower()},'Explicit lifecycle concurrency fixture',true);select pg_sleep(0.1);commit;"
  return subprocess.run([str(x) for x in psql+['-c',sql]],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:lifecycle_removals=list(pool.map(change_lifecycle,[(state['user_id'],state,False) for state in lifecycle_states]))
 assert sum(r.returncode==0 for r in lifecycle_removals)==1,'Dedicated lifecycle removed both last administrators or both failed'
 assert any('last active administrator' in r.stderr for r in lifecycle_removals if r.returncode),'Lifecycle last-admin race failed unexpectedly'
 admin=run(psql+['-Atc',"select user_id from public.operational_accounts where app_private.operational_capable(user_id,'accounts.manage')"]).strip()
 assert len(admin.splitlines())==1
 previous=json.loads(run(psql+['-Atc',f"select public.get_account_lifecycle('{admin}','{regular}')"]).strip())
 assert change_lifecycle((admin,previous,False)).returncode==0
 disabled=json.loads(run(psql+['-Atc',f"select public.get_account_lifecycle('{admin}','{regular}')"]).strip())
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:reactivations=list(pool.map(change_lifecycle,[(admin,disabled,True)]*2))
 assert sum(r.returncode==0 for r in reactivations)==1,'Concurrent reactivation was not optimistic-version protected'
 assert any('Account changed' in r.stderr for r in reactivations if r.returncode),'Reactivation race failed unexpectedly'
 assert run(psql+['-Atc',f"select role||':'||enabled from public.operational_accounts where user_id='{regular}'"]).strip()=='col_regular:true'
 assert run(psql+['-Atc',f"select count(*) from public.operational_scopes where user_id='{regular}' and kind='institution' and scope_id='ISAP'"]).strip()=='1'
 missing_rls=run(psql+['-Atc',"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity"]).strip();assert missing_rls=='0'
 # Report requests and worker claims race in independent transactions.
 report_request=str(uuid.uuid4())
 def create_report(_):
  return run(psql+['-Atc',f"begin;set local role service_role;select public.create_operational_report('{admin}','{report_request}','{public_event}','csv',false)->>'job_id';select pg_sleep(0.1);commit;"])
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:report_results=list(pool.map(create_report,range(2)))
 report_job=run(psql+['-Atc',f"select id from public.operational_report_jobs where requested_by='{admin}' and request_id='{report_request}'"]).strip()
 assert all(report_job in result for result in report_results),'Concurrent report replay created different jobs'
 def claim_report(_):
  return run(psql+['-Atc',f"begin;set local role service_role;select coalesce(public.claim_operational_report('{report_job}')->>'claim_id','NO_CLAIM');select pg_sleep(0.1);commit;"])
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:claim_results=list(pool.map(claim_report,range(2)))
 assert sum('NO_CLAIM' in result for result in claim_results)==1,'Competing report workers both claimed or neither claimed'
 new_names=set(['get_operational_access_base','set_event_class_rosters_base','submit_public_attendance_base','submit_public_attendance_device_base','save_event_public_link_review_base','verify_participant_device_form_base','operational_capable_lifecycle_base','get_operational_access_lifecycle_base','save_operational_account_lifecycle_base'])
 for migration in migrations:new_names.update(re.findall(r'create\s+(?:or\s+replace\s+)?function\s+(?:public|app_private)\.(\w+)',migration.read_text(encoding='utf-8'),re.I))
 names=','.join("'"+name+"'" for name in sorted(new_names))
 security_definers=run(psql+['-Atc',"select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ("+names+") and p.prosecdef"]).strip();assert security_definers=='0'
 report={'date':datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),'database':'isolated PostgreSQL 18 with minimal Auth/Storage stubs','migration':migration.name,'migrations':[p.name for p in migrations],'automatic_account_migration':False,'rollback_fixtures':results,'concurrent_last_administrator_guard_passed':True,'concurrent_representative_guard_passed':True,'concurrent_identity_guard_passed':True,'concurrent_public_attendance_slot_guard_passed':True,'concurrent_public_request_replay_passed':True,'concurrent_first_device_binding_guard_passed':True,'concurrent_shared_browser_guard_passed':True,'concurrent_review_decision_guard_passed':True,'concurrent_worker_decision_guard_passed':True,'concurrent_worker_notification_guard_passed':True,'concurrent_lifecycle_last_admin_guard_passed':True,'concurrent_reactivation_version_guard_passed':True,'concurrent_report_replay_guard_passed':True,'concurrent_report_claim_guard_passed':True,'new_tables_missing_rls':0,'new_security_definer_functions':0,'full_supabase_platform_tested':False}
 (staging/'operational-database-validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
 print(json.dumps({'fixtures_passed':sum(x['passed'] for x in results),'fixtures_total':len(results),'failed':[x for x in results if not x['passed']],'concurrent_last_admin_guard':True,'concurrent_representative_guard':True,'concurrent_identity_guard':True,'concurrent_public_slot_guard':True,'concurrent_public_replay':True,'concurrent_first_device_guard':True,'concurrent_shared_browser_guard':True,'concurrent_review_decision_guard':True,'concurrent_worker_decision_guard':True,'concurrent_worker_notification_guard':True,'concurrent_lifecycle_last_admin_guard':True,'concurrent_reactivation_version_guard':True,'concurrent_report_replay':True,'concurrent_report_claim':True,'live_database_changed':False}))
 if not all(x['passed'] for x in results):raise SystemExit(1)
finally:
 stopped=not started
 if started:
  with (work/'shutdown.log').open('w') as log:
   stopped=subprocess.run([str(pg/'pg_ctl.exe'),'-D',str(work/'data'),'-m','fast','-w','stop'],env=env,stdout=log,stderr=log).returncode==0
 if stopped:
  assert work.parent==staging.resolve() and not (work/'data/postmaster.pid').exists()
  shutil.rmtree(work)
