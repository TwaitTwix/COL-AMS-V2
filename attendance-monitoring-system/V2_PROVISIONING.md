# V2 isolated deployment setup

Updated November 26, 2026 (Asia/Shanghai). User requested keeping the old project and database untouched, and creating col-ams-v2 with its own Singapore database.

## Completed

- Created Vercel project col-ams-v2 in team COL (col11).
- Project ID: prj_8Ri80VoMgW3Oorb60ZaLCNjydDTm; team ID: team_n2klO8w6Pfqwx1aIY5RZZaIl.
- Express, Node 24.x, root directory attendance-monitoring-system; requested Singapore functions (sin1). Source vercel.json also selects sin1.
- Configured new-project non-secret environment variables: ACCESS_MODE=revision, APP_MAINTENANCE=false, PUBLIC_APP_URL=https://col-ams-v2.vercel.app, ATTENDANCE_REPORTS_BUCKET=attendance-reports.
- Verified the new project exists with no deployment yet. Did not link it to the shared Git repository or change the original .vercel/project.json.
- Validated all 30 migrations, in order, on an empty disposable local PostgreSQL 18 database with minimal managed-service stubs. No old data copied. Zero users, accounts, students, events or attendance created; all application tables have RLS; report bucket remains private. Evidence: .local-preview/fresh-install-validation.json.

## Separate Git repository

Published the credential-free revised source to https://github.com/TwaitTwix/COL-AMS-V2.git, branch main. Initial source commit: 5f67ee7a4cb51da51d547bf519470bf8fe536ef3. A fresh Git history was used; the old repository history and local .git metadata were not copied. The original COL-AMS origin and HEAD (56789c8b0086cb6995fccda4939981fe4037faf0) were unchanged. Runtime/schema/test files (198) match the verified workspace byte-for-byte; only V2-facing setup documentation and .env.example defaults differ.

The V2 checkout is at .local-preview/v2-repository within this workspace and has its own origin. Local credentials, old Vercel linkage, dependencies and previews are absent from the commit. The new Vercel project is not yet Git-connected or deployed; database capacity is still pending. Connect it only to TwaitTwix/COL-AMS-V2, never the shared V1 repository.

## Pending Supabase capacity

User selected TwaitTwix's Org (ofzkcxekljmzniemuebs) and Singapore (ap-southeast-1). The create_project request failed because the owner has reached the two-active-free-project limit. No new Supabase project ID was returned. get_cost quoted a project at $0/month, but that does not waive the active-project limit. No paid plan/cost was accepted or enabled.

User chose to free a slot personally. Wait for explicit confirmation that this is done before retrying creation. Do not pause or delete any existing project automatically.

## Preserved resources

Existing Vercel: col-ams, project prj_RxYftMppZK2sxFfZum7O245EHlF1; existing .vercel/project.json and deployment/domain unchanged.

Existing Supabase: COL-AMS, wazszxhrocurhlkadfca. No schema, data, Auth, Storage, SMTP or settings changes made. No existing Supabase projects were paused or deleted.

## Continue after a slot is available

1. Recheck project inventory to avoid duplicate creation, then create col-ams-v2 in the selected organization and ap-southeast-1. If provider quotes a nonzero charge, obtain agreement to that quoted cost first.
2. Wait for ACTIVE_HEALTHY, inspect empty schemas, then install the verified migration chain into that new project only. Do not replay migrations into the old database, restore old data, or copy legacy active sessions.
3. Configure the new private bucket/Auth redirects/password restrictions/signup closure and fresh server credentials. Send credentials only to the new Vercel project's private environment, never source control or chat. Never reuse the old database URL or service key as a placeholder.
4. Establish the new operational administrator through a verified owner/invitation workflow; do not create an unverified or guessed-password administrator. Configure SMTP separately when a supported sender is available; do not decrypt old secrets by default.
5. Deploy the local revised source exclusively to the new Vercel project with explicit team/project IDs, without overwriting the original local link or publishing revised source into a branch that automatically redeploys V1.
6. Verify new database region, live configuration, Auth/Storage/report behavior and deployment health. Physical-phone and retention/DOCX release gates from REVISION_RELEASE_RUNBOOK.md remain outstanding; the new instance is initially for validation, not an accepted school-wide rollout.
