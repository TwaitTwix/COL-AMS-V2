# COL Attendance Management System V2

Revised account-free attendance system for MCNP and ISAP.

Repository: https://github.com/TwaitTwix/COL-AMS-V2

Vercel project: col-ams-v2. Live V2: https://col-ams-v2.vercel.app — deployed with its own Supabase database in Singapore.

The previous COL-AMS repository, live website and database are separate and must remain untouched. Never configure this project with the old database service key.

Application source: [attendance-monitoring-system](attendance-monitoring-system/README.md). Vercel root directory: attendance-monitoring-system; Express / Node 24; Singapore functions (sin1). New Supabase target: Singapore (ap-southeast-1).

## Setup

Copy attendance-monitoring-system/.env.example to a local .env and supply credentials for the new V2 database only. Keep ACCESS_MODE=revision. Install dependencies with npm ci, run npm test, then npm run local from the application directory. Never commit .env or server keys.

V2 starts empty; V1 accounts, passwords and attendance were not copied. The first administrator must complete verified V2 onboarding. Custom SMTP and physical-phone release checks remain separate.

Provisioning is tracked in [V2_PROVISIONING.md](attendance-monitoring-system/V2_PROVISIONING.md); acceptance gates are listed in [REVISION_PLAN.md](attendance-monitoring-system/REVISION_PLAN.md) and [REVISION_RELEASE_RUNBOOK.md](attendance-monitoring-system/REVISION_RELEASE_RUNBOOK.md). Existing legacy implementation and documentation are preserved for historical compatibility; they do not authorize using the V1 database or deployment.
