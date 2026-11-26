# V2 deployment

Live website: https://col-ams-v2.vercel.app

Repository: TwaitTwix/COL-AMS-V2, main. Vercel project col11/col-ams-v2, ID prj_8Ri80VoMgW3Oorb60ZaLCNjydDTm. Root attendance-monitoring-system, Express / Node 24, Singapore functions sin1. Pushes to this repository deploy V2; never push revised work into the V1 repository.

Supabase project: col-ams-v2, jpdebursuvgxgdklpbod, Singapore ap-southeast-1. Schema and fresh-install order are described in supabase/v2-install-order.json. Do not use a blind migration push: hosted migration timestamps are recorded separately from the original source timestamps.

The V2 Vercel environment has its own Supabase URL, publishable key, private secret key, device-signing secret, scheduler secret and private attendance-reports bucket. ACCESS_MODE=revision, APP_MAINTENANCE=false, PUBLIC_APP_URL=https://col-ams-v2.vercel.app. No private values are stored in Git. Public signup is closed and email confirmation remains required. Auth redirects target the V2 host and local development.

A database pg_cron job runs review escalation once per minute and its successful execution was verified. This is independent of Vercel cron. The Vercel build explicitly packages worker files and their utility modules.

V2 is a fresh installation: no V1 accounts, passwords, sessions, classes, events or attendance were migrated. The first administrator must use the designated owner's verified V2 identity; custom SMTP is not copied from V1. Physical phone/QR/GPS, retention approval and DOCX visual validation remain acceptance steps.

V1 remains https://col-ams.vercel.app and Supabase wazszxhrocurhlkadfca, unchanged. Historical setup is retained in DEPLOYMENT_V1_REFERENCE.md; those instructions are not V2 targets.
