# V2 deployment provisioning

Updated November 27, 2026 (Asia/Shanghai).

V2 is isolated from V1. Repository: https://github.com/TwaitTwix/COL-AMS-V2 (main). Vercel: col-ams-v2, project prj_8Ri80VoMgW3Oorb60ZaLCNjydDTm, team COL/col11 (team_n2klO8w6Pfqwx1aIY5RZZaIl). Node 24.x, Express, root attendance-monitoring-system, Singapore functions sin1.

New Supabase: col-ams-v2, jpdebursuvgxgdklpbod, https://jpdebursuvgxgdklpbod.supabase.co, organization TwaitTwix's Org (ofzkcxekljmzniemuebs), Singapore ap-southeast-1. Healthy PostgreSQL 17.12.0.002. No V1 identities, sessions, students, attendance or secrets were copied.

## V2 schema installation

Use supabase/v2-install-order.json for this fresh project's logical dependencies. The fresh installer has 28 migrations. Do not blindly push/replay the original V1 history; hosted MCP migration timestamps differ from the source timestamps. Installation state was checked through the new project's migration inventory and catalog queries.

Automatic approval review rejected obsolete irreversible email-release migration functions. The safer V2 path omits all three legacy retirement/release migrations. Its replacement installs compatibility columns constrained to remain null; no begin_archived_email_release or finish_archived_email_release function exists. Reversible account_deactivations is used instead. The V1 source/database was not altered to make this change.

All 28 V2 migrations pass a fresh empty local PostgreSQL preflight; all application tables have RLS and the private report bucket is present. Managed Auth/Storage behavior is verified separately. Compatibility fields are not a mechanism for retiring or releasing identities. Legacy SQL fixtures requiring the removed email-release workflow are historical and do not apply to this fresh V2 installation.

## Configuration

New V2 Supabase keys are stored only in the new Vercel project's private environment; DEVICE_SIGNING_SECRET and CRON_SECRET are fresh independent values. No server keys are in this repository. Public configuration uses the V2 project URL and publishable key. ACCESS_MODE=revision; PUBLIC_APP_URL=https://col-ams-v2.vercel.app.

V2 Auth: public signup disabled, ten-character password minimum, upper/lower/digit/symbol requirements, email confirmation retained, Site URL https://col-ams-v2.vercel.app, redirects limited to this V2 host and local development. Only declared settings were pushed to jpdebursuvgxgdklpbod using an explicit --remote and --workdir. Custom SMTP has not been copied from V1.

## Preserved V1

Vercel col-ams (prj_RxYftMppZK2sxFfZum7O245EHlF1) still links to TwaitTwix/COL-AMS. Supabase COL-AMS remains wazszxhrocurhlkadfca. No V1 database, Auth, Storage, SMTP, source branch, deployment, domain or secret was changed.

## Remaining acceptance

V2 starts with no operational accounts, classes, events or attendance. Initial administrator onboarding must use the designated owner's verified identity and fresh V2 authentication; old passwords/sessions have not been copied. Do not fabricate email verification. Custom SMTP, physical-phone/printed QR tests, school retention approval and DOCX visual checks remain part of release acceptance; see REVISION_RELEASE_RUNBOOK.md. Do not treat successful deployment as school-wide acceptance.

## Managed scheduler

Supabase pg_cron is enabled on V2 only. Job col-ams-v2-review-escalation runs public.process_attendance_review_queue(100) every minute inside the database. This does not require a paid Vercel minute scheduler. Its SQL is listed as a managed add-on in the V2 install manifest and excluded from the minimal Windows PostgreSQL substitute. Verify cron.job_run_details and attendance_review_worker_health after activation.
