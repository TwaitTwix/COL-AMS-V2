# Revision release and recovery runbook

Status: local implementation/rehearsal only. Production remains ACCESS_MODE=legacy. This is a release checklist, not evidence that any hosted step happened.

## Completed locally

- All seven additive revision migrations restore on the sanitized baseline with no automatically provisioned operational accounts. The latest file is 20261126093828_revision_report_snapshots.sql.
- Original application row counts survive migration and rollback fixtures. Foreign-key constrained roster/history data remains valid. RLS is enabled for all application tables and new functions are invoker-only with browser execution revoked.
- 68 active Node tests, 19 SQL fixtures and 14 independent-transaction guards pass. Coverage includes scopes/revocation, geofence accuracy/time/distance, duplicate transport retries, roster import, device binding, review/escalation races, lifecycle, report replay/leases and emergency maintenance behavior. Eight hosted/opt-in tests remain skipped.
- Mobile form and workspace previews from phases 2–7 are retained as synthetic evidence. Phase-8 mobile report pagination/rates and PDF summary/signature rendering have been checked. DOCX package structure passes; visual rendering is still unverified.

Reproduce database rehearsal from the application directory:

    python scripts/test-operational-database.py --backup-dir C:/Users/Leo/Documents/COL/backup_COL-AMS/COL-AMS_pre-revision_2026-11-26_00-59-33

The harness refuses remote URLs, creates a disposable loopback PostgreSQL 18 instance, restores sanitized data, runs transactional fixtures plus independent races, writes .local-preview/operational-database-validation.json and stops/removes its temporary database. It is not a hosted Supabase Auth/Storage test.

## Required before a hosted pilot

1. Take a fresh source/database/Storage backup and verify restore into an isolated staging project. Keep credentials out of source backups and never copy real active Auth sessions into tests. The November-26 baseline is an earlier snapshot, not a promise of current production data.
2. Resolve the migration timestamp mapping documented in REVISION_BASELINE.json. Review the actual deployed schema/history against that map and establish a canonical staging baseline. Do not blindly push, replay old SQL, repair history, rename versions or mark them applied. Only the reviewed additive pending revision migrations should run, transactionally, on staging first.
3. Configure a separate staging application with ACCESS_MODE=revision, the correct private Storage bucket, server-only Supabase credentials and a stable DEVICE_SIGNING_SECRET. Browser configuration contains only the public key. Keep production legacy until all gates below pass.
4. Disable provider public signup and verify recovery/invitation redirect allowlists for the revision host. Review the designated main administrator and explicitly provision only approved operational accounts/scopes. No automatic promotion or historical account deletion is part of these migrations.
5. Configure the protected review-escalation worker and a supported one-minute scheduler with a private CRON_SECRET. Verify one-hour ownership deadlines, missing owners, repeated invocations and outage recovery. Observe real health timestamps; a configured scheduler alone is not a pass.
6. Validate all five roles and an unprovisioned identity through real Auth sessions: current-user verification, one active session, logout, refresh, email verification/recovery, revocation/deactivation, role/assignment changes and self-service password changes. Use designated synthetic test accounts and recipients.
7. Generate and resume each report format on staging. Verify private uploads, short-lived download/preview URLs, revoked access, public-bucket failure, stopped-worker recovery and normal-browser downloads on phone/desktop. Check DOCX in Word/LibreOffice; its local rendering gate is open because soffice is unavailable. Capacity-test the documented row limits and Vercel worker lifetime using synthetic data.
8. Confirm the school's privacy notice, contact and retention period; approve access to signatures, device history and precise location evidence. Do not invent a deletion duration or purge historical records.

## Physical acceptance checks

Use a printed static event QR through the phone's normal camera, without a participant account. Test inside/outside/boundary venue positions, denied permissions, stale/inaccurate GPS, slow connections, interrupted retry, multiple checkpoints, duplicate school IDs, cleared cookies, another browser/device and a documented manual exception. Verify signature/consent, flags/one-point policy, representative notifications and final decisions. GPS spoofing and permanent physical-device identity cannot be guaranteed by a browser. Do not count emulated viewport checks as this physical test.

## Controlled cutover

- Announce and schedule a pause outside active attendance. Do not start a new revision event during migration.
- Set APP_MAINTENANCE=true for the app and redeploy the reviewed build/configuration. This returns 503/Retry-After for application APIs except health, including mutating scheduled GET requests. It does not revoke Supabase-issued tokens, stop Auth itself, or cancel already-running jobs/invocations. Pause external schedulers and wait for in-flight invocations/jobs to drain before taking the final backup.
- Reconcile schema/history using the reviewed staging procedure, apply only approved additive migrations and verify row counts/grants. Provision the reviewed operational roles and assignments without bulk converting students.
- Deploy a known-good revision build with ACCESS_MODE=revision while maintenance remains enabled. This keeps legacy APIs and registration closed. Verify health and private configuration, then disable maintenance for the approved pilot. Watch geofence rejection/error rates, duplicate conflicts, worker health, unresolved owners and report failures.
- Roll out approved events/classes in small groups. Publish their stable QR only after roster eligibility, checkpoints and venue radius are reviewed. Keep former IDs, attendance, device incidents and exports read-only as history.
- Retire obsolete registration/scanner/rotating-QR screens only after revision acceptance; update role-specific instructions. Their source is intentionally retained while production still runs legacy mode.

## Recovery after revision attendance exists

1. Enable APP_MAINTENANCE=true, pause external schedulers and allow in-flight work to drain. Verify application APIs return 503 while health remains reachable. Preserve error/job/claim IDs and take a fresh backup.
2. Keep ACCESS_MODE=revision. Restore a known-good revision-compatible application build against the additive schema, or forward-fix the defect. Do not flip to legacy: that could reopen old writes and create conflicting attendance histories. Do not drop revision tables, delete incidents or restore an old snapshot over new submissions.
3. Reconcile committed attendance and request receipts before retrying. Database uniqueness/request IDs prevent replay; do not manually create a duplicate slot. Report claims are fenced and stale jobs can resume after six minutes through authorized status polling. Private orphan claim files need retention-approved cleanup, not a blanket bucket purge.
4. Recheck permissions, worker ownership, failed exports and totals, then resume only after the fault is corrected. Re-enable the scheduler and verify its first successful run and overdue backlog before lifting the pause.

Returning to legacy before *any* revision submissions is a separate reviewed decision; it still requires confirming no new writes or jobs need preserving. The safe default once revised attendance is recorded is a revision-compatible forward recovery.
