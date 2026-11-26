# COL Attendance Management System V2

> Major revision: phases 0–7 are verified locally. Phase 8 reports and local rehearsal are implemented; release gates remain open. Start with [REVISION_PLAN.md](REVISION_PLAN.md), [REVISION_REPORTS.md](REVISION_REPORTS.md), and [REVISION_RELEASE_RUNBOOK.md](REVISION_RELEASE_RUNBOOK.md). The production site still uses the legacy flow.

Node.js / Express, Supabase Auth and Postgres, private Storage, and a responsive browser interface for MCNP and ISAP.

V2 deployment target: https://col-ams-v2.vercel.app (pending the separate Supabase database). Legacy references below describe V1. Hosting details and remaining email redirect setup are in [DEPLOYMENT.md](DEPLOYMENT.md). Use Node.js 24.x for local development.

The ISAP/MCNP institution → college → course mappings and handling of legacy records are documented in [ACADEMIC_CATALOG.md](ACADEMIC_CATALOG.md).

## Start locally

From this folder run `npm install` once, copy `.env.example` to `.env` only if no local configuration exists, then run `npm run local`. You can also double-click `../Start-Attendance-System.cmd`. Keep the terminal open. The local app defaults to `http://127.0.0.1:3001`.

The starter checks `/api/health` before opening the browser. `npm run dev` restarts when source files change. Login/static pages start immediately without waiting for report queue recovery.

## Account workflow

Registration requires full name, personal/student ID, working email, institution, college, and a password of at least ten characters. The server creates a pending profile immediately. The user verifies the email through Supabase, and an administrator then approves or rejects the personal ID with a recorded reason. Approval creates or links a student record in one transaction. No student attendance endpoint is available before approval. Older pending accounts can complete missing details after signing in.

After three failed credential attempts in the current browser session, the password reset button appears. The user enters their account email and requests a reset link. Registration email verification and password recovery are separate flows. Passwords are never stored in application tables.

The designated existing account `leonardolllmacalinaoisap@gmail.com` is the single `main_admin`. Only this role can change another approved user's role; it cannot demote itself or assign another main administrator. Ordinary `admin` and `col_officer` accounts can review registrations, manage events and students, decide flagged attendance, and export reports. Student officers use the same self-attendance flow as students.

## Student attendance

The student dashboard lists current and upcoming events. An event opens one hour before its scheduled start and closes at its end. Institution and college restrictions are checked server-side. Opening an eligible event navigates to `/events/:eventId`.

An administrator displays the event QR from Events & geofencing. Codes are server-signed, expire after five minutes, and refresh every four minutes while the display is open. Revoking codes changes the event QR version immediately.

The student's page uses only the in-page camera scanner; it has no image upload or external scanner input. Upon detection it requests fresh high-accuracy GPS. `POST /api/student/check-in` derives the student from the authenticated account, verifies the QR signature and expiry, and records the location and browser device. A database transaction rechecks account approval, event/version/window, institution/college eligibility, GPS accuracy, Haversine distance, and duplicate attendance.

Successful normal attendance returns `Successfully recorded!`. Changed or shared device attendance returns a pending-review message. Administrators must accept or reject it with a reason.

Institution and college percentages count approved attendance divided by active eligible student records. Pending and rejected submissions do not count. Archived students are excluded from the current denominator, so these are live roster percentages, not historical enrollment snapshots. Assign institutions and colleges to legacy students before relying on these percentages.

## Device review and notifications

The server issues a signed HttpOnly, SameSite browser cookie and stores only its hashed identifier. The first browser becomes the account's baseline. Successful login sessions record the browser identifier, user agent, server-observed network address, time, and changed/shared-device signals. The same session/browser is logged once; refreshes do not add duplicate penalties.

Each newly detected changed or shared browser device produces one incident, one penalty point, and an administrator notification. Repeat use of the same incident does not repeatedly add points. An administrator can trust the browser or dismiss the incident; prior attendance still needs a separate decision. If a previously reviewed browser later becomes shared, it is flagged again. Decisions are audited. Penalty points remain a record of incidents; trusting a device does not erase history.

The admin interface polls for new alerts every fifteen seconds while open. Notifications are stored in the database and shown on the overview. This is an in-app alert system, not email or closed-browser push notification delivery.

Websites cannot obtain a physical MAC address or prove that a browser is running on a particular physical device. Different browsers, private browsing, deleted cookies, and signing-secret rotation appear as new devices. Browser IDs and GPS are supporting signals and can be manipulated on a compromised client. Camera-only UI cannot prevent a determined user from calling an API or sharing a QR. Flagged activity is labeled for review, not treated as proof of misconduct.

If deployed behind a proxy, configure Express trusted proxies for that deployment before relying on recorded IP addresses; the server currently records the direct connection address and does not trust arbitrary forwarded headers.

## Server configuration

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SECRET_KEY` (legacy service role key supported).
- `PORT` defaults to `3001`; `HOST` defaults to `127.0.0.1`.
- `PUBLIC_APP_URL`: canonical application origin used in registration emails, default `http://127.0.0.1:3001`. Configure the production HTTPS URL before deployment.
- Optional `DEVICE_SIGNING_SECRET`: stable random secret of at least 32 characters. Defaults to the privileged Supabase key when omitted. Do not rotate casually: prior device cookies and event codes become invalid.
- `ATTENDANCE_REPORTS_BUCKET` defaults to `attendance-reports`.

In Supabase Auth, allow the canonical app URL, `http://127.0.0.1:3001/`, and `http://localhost:3001/` during local development. Keep email confirmation enabled, configure real SMTP/email delivery for production, and test both email confirmation and password recovery from an actual inbox. Use the same hostname consistently to preserve the browser device cookie. Camera and geolocation require HTTPS on a phone; localhost is only local to the device running the server.

## Database and reports

Apply files in `supabase/migrations` in filename order for a new project. The November 15 migrations add approvals, institutions/colleges, device logs, notifications, attendance review, protected RPCs, and the designated main administrator. All tables have RLS. Direct browser table access is denied; privileged operations are executed only through authenticated server routes. Database functions use SECURITY INVOKER and revoke execution from public/anon/authenticated.

CSV, XLSX, PDF and DOCX reports include approved attendance only. Files are generated in a worker thread, uploaded into private Supabase Storage, and returned through a signed download link valid for ten minutes. Jobs are persisted. The server processes one worker at a time; startup restores queued/stale jobs.

The previous administrator-assisted `POST /api/attendance/check-in` remains restricted to administrator roles for compatibility. Students cannot use it to submit another student's token or bypass device review.

## Verification

Run `npm test` for local authentication, QR tampering/expiry, and signed device-cookie checks.

`tests/attendance-workflow.sql` verifies approval permissions, one-hour access, geofence/GPS accuracy rejection, revoked QR rejection, duplicate prevention, idempotent penalties, shared-device review, and institution statistics. All fixtures and fake Auth identities are rolled back.

For an opt-in live API check with existing demo accounts, set `TEST_BASE_URL=http://127.0.0.1:3001` and run `node --test tests/http-workflow.test.js`. This records demo login/device incidents as intended; it does not create real attendance.

## Demo accounts

`npm run seed:demo` creates or resets student, student officer, and COL officer demo accounts. It assigns demo students to ISAP / CITE / Bachelor of Science in Information Technology. Every run resets demo passwords. Credentials are stored only in the ignored `.demo-credentials.json`. Do not use these accounts in production or run the seeder expecting to reset the main administrator.

## Deployment tasks

A phone camera/GPS field test at the real venue and actual inbox delivery tests remain necessary. Configure HTTPS hosting, canonical Auth redirect URLs, production email delivery, leaked-password protection, the real roster/college catalog, venue boundaries, data retention, backups, and monitoring before real attendance collection.
