# COL Attendance System — Task List

> Major revision planned November 26, 2026: use [REVISION_PLAN.md](REVISION_PLAN.md) for the current ordered implementation tracker. The completed items below describe the previous system and are not completion claims for the new account-free attendance workflow.

## Completed in the application

- [x] Secure check-in endpoint with server-side geofence, event-window, and duplicate checks.
- [x] Supabase email/password authentication, email confirmation, password recovery, and role checks.
- [x] Student, student officer, and COL officer portals with separate permissions.
- [x] Student event dashboard, in-page event QR scanning, and personal attendance history.
- [x] Administrator registration approval, institution/college roster tools, event creation and geofencing.
- [x] Main-administrator-only promotion/demotion; designated verified main account configured.
- [x] Signed browser-device tracking, idempotent penalty points, shared-device attendance review, and in-app notifications.
- [x] Institution and college attendance percentages based on approved attendance.
- [x] CSV, XLSX, PDF, and DOCX report generation and private signed downloads.
- [x] Three confirmed demo accounts seeded in Supabase; generated passwords are in the ignored local `.demo-credentials.json` file.
- [x] Responsive mobile layout and touch-friendly controls.

## Completing locally without deployment or user setup

- [x] Persist report jobs so their status and downloads survive server restarts.
- [x] Record an audit trail for check-ins and COL officer changes.
- [x] Show recent audit activity in the COL officer workspace.
- [x] Add safe edit/archive actions for event and student records.
- [x] Add per-account API rate limits for check-in and COL officer management.

## Requires later human or deployment setup

- [x] Deploy the app on Vercel with HTTPS at https://col-ams.vercel.app.
- [ ] Configure production Supabase Auth email delivery and redirect URLs.
- [ ] Verify real-inbox signup/password recovery and physical-phone camera/GPS at the venue.
- [ ] Enable Supabase leaked-password protection in Auth settings.
- [ ] Import the real student roster and create real staff/student accounts.
- [ ] Replace or remove demo accounts before production; set the real venue coordinates and event windows.
- [ ] Review data retention, backups, and production monitoring for the school’s policy.
