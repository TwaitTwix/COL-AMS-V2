# Revision baseline — November 26, 2026

Phase 0 is documentation, inventory, backup, and isolated verification only. No production schema, account roles, attendance decisions, or deployed UI changed.

## Evidence

| Check | Result |
| --- | --- |
| Current source commit | `56789c8b0086cb6995fccda4939981fe4037faf0` |
| Default Node suite | 35 discovered: 27 passed, 0 failed, 8 skipped |
| SQL restoration | Passed in isolated PostgreSQL 18 with minimal managed Auth/Storage stubs |
| Existing rollback SQL fixtures | All 12 passed against the isolated restored data |
| Snapshot | 13 public tables, 544 application rows, 17 sanitized Auth users and 17 identities |
| Private storage files | 23 downloaded; 11 PDFs text-scanned; Office archives checked |
| Application schema | 27 functions; all 13 public tables have RLS enabled; no direct browser policies |
| Migration inventory | 23 local SQL files and 23 deployed history entries recorded |
| Safety | Password hashes, API keys, OTPs, active sessions, refresh tokens excluded; student bearer tokens regenerated for restore |

Machine-readable details, migration pairs and source hashes: [REVISION_BASELINE.json](REVISION_BASELINE.json). This inventory contains schema and aggregate counts, not a private student roster or secret credentials.

## Fresh pre-migration backup

`C:\Users\Leo\Documents\COL\backup_COL-AMS\COL-AMS_pre-revision_2026-11-26_00-59-33`

Data was captured at `2026-11-25T16:57:38.042104Z`, which is November 26, 2026, 00:57:38 in Asia/Shanghai. This is a consistent database statement snapshot; stored files were downloaded afterward and each downloaded object has a SHA-256 checksum. It is not an atomic cross-service physical backup of Supabase.

Contents: credential-free source, sanitized current application/Auth records, current schema/function/security definitions, migration-history evidence, stored reports, checksums, SQL restore script, Storage uploader, and restore-validation results. Source documentation may include the final phase-0 notes added after data capture; no runtime code changed during this phase.

Restore only into an empty isolated project/database. Follow the backup README. Managed Supabase Auth/Storage schemas, extensions and roles must exist; SQL restore is transactional. Storage is restored using supported uploads, not direct writes to storage.objects. Restored users need password recovery and new sessions. Managed provider/SMTP settings and passwords intentionally cannot be recovered from this sanitized copy.

## Baseline findings and controls

1. **Migration timestamps differ.** Local files and deployed history represent the same ordered feature sequence but use different version timestamps (and some descriptive names differ). Their ordered mapping is evidence, not permission to mark versions applied. Do not run a blind `db push`, repair remote history, or replay the original migrations. Before phase-1 deployment, establish a tested canonical migration baseline on staging and review the resulting pending list.
2. **Old and new roles are incompatible without a mapping.** Existing API routes authorize the old role strings. Updating labels alone would break access or widen permissions. Phase 1 must update server capability checks and migration mapping together; per-account scope review precedes production cutover.
3. **Public attendance is a new trust boundary.** Current submissions depend on authenticated users and signed rotating QR payloads. The new stable QR grants no authentication. Keep direct anonymous table access closed; validate/rate-limit public requests on the server and preserve atomic duplicate/device rules.
4. **Device ownership cannot be guaranteed by browser identifiers.** Keep the contract's explicit limits and manual identity-verification path. Unknown-roster claims must not permanently capture someone else's device binding.
5. **Some current database function labels contain a legacy encoding artifact.** The fresh backup preserves the exact live function definitions; do not silently rewrite them while making a baseline. Track display-label cleanup during the relevant UI/review phase.
6. **Full-platform and real-phone checks remain outstanding.** The isolated restore validates application SQL, row counts, foreign keys, functions, grants, and fixtures. It does not validate hosted Auth recovery, Storage access, browser geolocation/camera/signatures, scheduled escalation, or Vercel behavior.

## Isolated test method and recovery boundary

- Started a temporary loopback-only PostgreSQL instance with a random disposable password. Restored the exported SQL into empty managed-schema substitutes; never connected the restore process to production.
- Matched all 13 application row counts and sanitized Auth counts; checked cleared active logins and regenerated student tokens.
- Ran all existing SQL fixtures inside their rollback transactions and rechecked counts afterward.
- An initial single-session fixture failed because the substitute `auth` schema lacked the service role's normal schema USAGE privilege. Added only that privilege to the local substitute and repeated the entire restore/test run: 12/12 passed. No application patch was needed.
- Node tests used the default suite, without opt-in live credentials or write-producing hosted report tests. Skipped tests remain unverified; test count is not inflated to include them.
- Stopped the temporary PostgreSQL servers after validation. Temporary data is disposable and is not a new development service or public server.

Rollback policy for later phases: preserve original IDs/history; prefer additive schema changes with old/new paths controlled during rollout. A backup alone is not a safe production rollback after new submissions: reconcile new data before any restoration. Rehearse forward/rollback compatibility in staging before production migrations.

## Phase-0 outcome

The policy decisions are captured in [REVISION_POLICY_CONTRACT.md](REVISION_POLICY_CONTRACT.md). The next implementation phase is role/capability foundations. Production account mapping, school roster import, retention confirmation, full-platform staging and physical-venue verification remain explicit later gates; no setup is claimed completed merely because it is described here.
