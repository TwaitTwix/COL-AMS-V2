# Phase 1 — operational roles and feature permissions

Implemented and verified locally November 26, 2026. Not deployed or applied to production. Phase-0 policy: [REVISION_POLICY_CONTRACT.md](REVISION_POLICY_CONTRACT.md). Current progress: [REVISION_PLAN.md](REVISION_PLAN.md).

Phase 2 now extends this foundation with sections, officer assignments and reusable rosters: [CLASS_ROSTERS.md](CLASS_ROSTERS.md). The screens and test counts below describe the original phase-1 checkpoint; use the phase-2 notes for the latest verification.

## Staged behavior

`ACCESS_MODE=legacy` is the default. Existing account roles and attendance paths continue to operate; the new operational API returns 404. Neither app startup nor the migration provisions, maps, retires, or disables existing accounts.

`ACCESS_MODE=revision` uses the new five-role operational model and a separate workspace. Public app registration/completion routes return 403, registration controls are hidden, and old `/api/student`, `/api/admin`, and `/api/attendance` routes are closed. This deliberately prevents old global queries or legacy SQL role rules from bypassing new scopes. Later phases must port individual features to scoped APIs before those features become available in revision mode. Do not enable revision mode on the live site while the attendance/class-list replacement is unfinished.

Working revision screens are dashboard, assigned-event listing, own account/password settings, and administrator Account & feature access. The editor supports name/email search, existing-identity suggestions, ten accounts per page with clickable page numbers, role choice, explicit institution/event scopes, feature default/enable/disable controls, effective-access previews, an inline reason, and optimistic version checks. Later-phase features are explicitly marked unavailable; their permissions can be prepared without exposing old endpoints.

Class-section scope and its foreign keys are implemented in phase 2. Representatives use the sole representative assignment; club presidents use explicitly assigned class-editor access. Neither role receives institution-wide class-list access. Separate club-wide resource access is not inferred from the presidency role.

## Database and security

Generated with installed Supabase CLI 3.2.0:
`supabase/migrations/20261125171730_operational_access_foundation.sql`

Four additive tables: `operational_features`, `operational_accounts`, `operational_feature_overrides`, `operational_scopes`. All have RLS enabled and no browser grants/policies. Only the server service role can access them. New RPCs are SECURITY INVOKER with an empty search path and no PUBLIC/anon/authenticated execution. The existing narrowly scoped private Auth-session lookup is reused; no broad Auth-table read grant or new SECURITY DEFINER helper was introduced.

- Every operational request verifies the token with Auth, matches verified subject/session, loads current server-owned role/grants, checks active status, and enforces the one-active-login rule. User-editable metadata is ignored for authorization.
- Event listing rechecks feature access and scope inside SQL. No assignments means no scoped results. An institution assignment does not grant access to an unaffiliated school-wide event; assign that event explicitly.
- Administrator security management cannot be granted to a lower role using feature overrides. Administrators have every feature regardless of role defaults. Decisions are audited atomically with account changes, including scope/grant changes.
- Account security changes serialize under a transaction advisory lock and use expected versions. Conflicting edits return 409. Removing the last active administrator is rejected, including concurrent requests against different administrators.
- Deactivating an operational account clears its active login and closes API access. Reactivating advances a minimum Auth-session timestamp: old sessions remain unusable and a new sign-in is required. This is reversible application-access deactivation; it never releases an email or deletes Auth/attendance history. The archived-student UI replacement remains phase 6.
- Operational login evidence is recorded once per user/session/device without invoking legacy attendance-device penalties. Actual attendee device binding is a later phase.
- Existing identities must be verified/non-retired before first assignment through the editor. Newly provisioned invited identities must verify their email before protected access.

## Provisioning and invitations

Administrator provisioning validates grants/scopes before contacting Auth, creates an unconfirmed identity with no generated password, creates its historical profile, then saves operational access transactionally. No email is sent automatically. An explicit Generate invitation link action returns a private one-time Supabase invitation URL for secure delivery to the owner; the URL is not included in audit data or stored by this application. Closing the editor discards it. Verified accounts use normal password recovery instead of invitation regeneration.

Provisioning spans Auth and the application database, so it cannot be one cross-service transaction. Partial failure leaves a blocked/unconfirmed identity rather than deleting it or retrying with a new account. The error includes the Auth ID; use Resume unfinished provisioning with the same ID and matching email. Healthy already-provisioned identities are edited through search. No actual accounts were provisioned and no invitations/messages were sent during implementation/tests.

Invitation callbacks enter the strong-password setup screen. The application password endpoints and privacy consent remain protected by the operational session. Single-session heartbeat detects access-version changes so a changed role/menu refreshes; a routine token refresh preserves an unsaved access form.

## Migration and cutover gates

1. Use an isolated full Supabase staging project/stack before hosted cutover. The checked-in SQL test harness is application SQL staging with managed-schema substitutes; it does not validate live Auth invitation behavior or Supabase provider settings.
2. Reconcile the 23-file legacy timestamp drift recorded in `REVISION_BASELINE.json`. Do not blindly replay old files, repair production history, or run a general `db push`. Test the new additive migration against the real baseline and review the pending migration list; apply only the reviewed new migration during a later controlled rollout.
3. Prepare a private per-account role/scope mapping using the policy contract. No automatic conversion of students or student officers is included. Maintain original Auth IDs and historical links. Institution/event assignments require explicit review; class assignment awaits phase 2.
4. Bootstrap only the existing verified designated main administrator, in the intended environment, using the explicit command below. Its profile must already be approved `main_admin`; an active operational administrator must not already exist. This script has not been run against production.

   `node scripts/bootstrap-operational-admin.mjs --user-id UUID --project-url TARGET_URL --confirm-bootstrap`

   The target URL must exactly match the environment's Supabase URL. Sign in again after bootstrap so the new session is newer than the operational account's creation cutoff. Add an approved recovery administrator before any demotion/deactivation of the original one.

5. Before enabling revision mode, disable public signups at the Supabase provider level and test that direct `/auth/v1/signup` requests are denied while administrator provisioning/invitations still work. Application route closure alone does not disable Supabase's external signup API. Even while provider signup remains enabled, an unprovisioned Auth identity cannot enter the revised workspace.
6. Validate invitation/password setup, password recovery, privacy consent, direct API denials, two-browser replacement, deactivation/reactivation and scoped data on the full platform. Finish the replacement attendance/class-list features before switching production to revision mode.

Rollback boundary: before operational cutover the change is additive and the default legacy mode is unchanged. After accounts have been managed/deactivated in revision mode, blindly returning to legacy mode could restore their old legacy privileges. Keep revision authorization active, roll forward or reconcile all legacy account states/sessions before any legacy rollback. Never restore the pre-revision backup over newly collected attendance without reconciling new data.

## Validation

- Node suite: 44 tests discovered, 36 passed, zero failed, 8 existing opt-in/live tests skipped. New tests exercise real loopback Express middleware/routes with synthetic Auth/database clients plus actual application mounting in revision mode. No live Auth calls or real account changes.
- Isolated PostgreSQL: restore of the sanitized phase-0 backup, new migration, all 13 rollback SQL fixtures passed, and the real two-transaction last-administrator race passed. Original row counts remain intact after fixtures; migration itself creates zero operational accounts. New tables all have RLS; new functions expose no browser execution and introduce no security-definer code.
- Mobile synthetic preview at 390 × 844: 16px form text, 50px input height, no dialog/page horizontal overflow; account pagination/search and scope/feature previews checked. No save or messaging handlers were connected in that preview.
- The SQL harness starts only a random-password loopback PostgreSQL instance, stops it, and deletes its own checked temporary directory. Summary: `.local-preview/operational-database-validation.json` (ignored local artifact).
- Shareable test counts, fixture outcomes, mobile measurements and migration checksum: [REVISION_PHASE1_VALIDATION.json](REVISION_PHASE1_VALIDATION.json). This contains no account records or credentials.

Commands:

```text
npm test
python scripts/test-operational-database.py --backup-dir PATH_TO_SANITIZED_BACKUP
```

The baseline Windows environment needs loopback connections permitted for HTTP/SQL tests. The SQL harness requires PostgreSQL 18 and accepts a binary directory override; it never accepts a remote database connection string.

References checked before implementation: [Supabase changelog](https://supabase.com/changelog.md), [CLI v3 changes](https://supabase.com/changelog/supabase-cli-v3), [admin invitation-link generation](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), and [Auth general configuration](https://supabase.com/docs/guides/auth/general-configuration).
