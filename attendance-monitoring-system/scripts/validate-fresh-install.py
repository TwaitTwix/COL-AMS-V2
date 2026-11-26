"""Validate migrations in an empty loopback PostgreSQL. Never connects to Supabase."""
import pathlib, subprocess, os, secrets, socket, uuid, json, hashlib, shutil
app = pathlib.Path(__file__).resolve().parent.parent
pg = pathlib.Path(r'C:\Program Files\PostgreSQL\18\bin')
staging = (app / '.local-preview').resolve()
staging.mkdir(exist_ok=True)
work = (staging / ('fresh-db-' + uuid.uuid4().hex)).resolve()
assert work.parent == staging
work.mkdir()
env = os.environ.copy()
env['PGPASSWORD'] = secrets.token_urlsafe(36)
env['PGCLIENTENCODING'] = 'UTF8'
pw = work / 'password.tmp'
pw.write_text(env['PGPASSWORD'], encoding='utf-8')
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
def run(command):
    result = subprocess.run([str(v) for v in command], env=env, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout)[-5000:])
    return result.stdout
started = False
results = []
try:
    run([pg/'initdb.exe', '-D', work/'data', '-U', 'postgres', '--encoding=UTF8', '--locale=C', '--auth=scram-sha-256', '--pwfile', pw])
    pw.unlink()
    with (work/'startup.log').open('w') as log:
        subprocess.run([str(pg/'pg_ctl.exe'), '-D', str(work/'data'), '-l', str(work/'server.log'), '-o', f'-h 127.0.0.1 -p {port}', '-w', 'start'], env=env, stdout=log, stderr=log, check=True)
    started = True
    psql = [pg/'psql.exe', '-X', '-h', '127.0.0.1', '-p', str(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
    run(psql + ['-c', '''create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
create schema auth;create schema storage;create schema extensions;create extension pgcrypto with schema extensions;
grant usage on schema auth,extensions to service_role;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz,updated_at timestamptz);
create table auth.identities(id uuid primary key,user_id uuid references auth.users(id),provider text,provider_id text,identity_data jsonb);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz,not_after timestamptz);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);'''])
    for file in sorted((app/'supabase/migrations').glob('*.sql')):
        run(psql + ['-1', '-f', file])
        results.append({'file': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'passed': True})
    counts = {name: int(run(psql + ['-Atc', 'select count(*) from public.' + name]).strip()) for name in ['students', 'events', 'user_profiles', 'operational_accounts', 'public_attendance_submissions', 'operational_report_jobs']}
    assert all(n == 0 for n in counts.values()), 'Fresh install created identities or attendance'
    missing_rls = int(run(psql + ['-Atc', "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity"]).strip())
    assert missing_rls == 0
    assert run(psql + ['-Atc', "select public from storage.buckets where id='attendance-reports'"]).strip() == 'f'
    report = {'database': 'empty isolated PostgreSQL 18 with minimal Auth/Storage stubs', 'migrations': results, 'empty_data_counts': counts, 'tables_without_rls': missing_rls, 'report_bucket_private': True, 'full_supabase_platform_tested': False, 'hosted_database_changed': False}
    (staging/'fresh-install-validation.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'migrations_passed': len(results), 'empty_data_counts': counts, 'tables_without_rls': missing_rls, 'hosted_database_changed': False}))
finally:
    stopped = not started
    if started:
        with (work/'shutdown.log').open('w') as log:
            stopped = subprocess.run([str(pg/'pg_ctl.exe'), '-D', str(work/'data'), '-m', 'fast', '-w', 'stop'], env=env, stdout=log, stderr=log).returncode == 0
    if stopped:
        assert work.parent == staging and not (work/'data/postmaster.pid').exists()
        shutil.rmtree(work)
