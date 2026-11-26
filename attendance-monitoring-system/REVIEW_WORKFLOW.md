# Phase 5 — assigned attendance review and durable escalation

Implemented locally in `ACCESS_MODE=revision`. Production remains in legacy mode. No hosted migration, scheduler, real attendance decision, notification, email or account change was performed. Hosted scheduler setup and staging validation remain release gates.

## Ownership and access

Each pending public or manual submission has one durable review case. Creation runs in the submission transaction, after roster references and device checks. If no active administrator fallback exists, intake fails atomically as unavailable; publishing also checks a usable final fallback. The worker repairs older pending submissions that lack an open case.

| Level | Eligible owner | Deadline |
| --- | --- | --- |
| 0 | Current representative of a frozen event class containing the participant; an explicitly assigned club president is the fallback first-level editor | One hour |
| 1 | Active COL regular with event/institution scope and review/evidence access | One hour |
| 2 | Active COL admin with event/institution scope and review/evidence access | One hour |
| 3 | Active administrator | Remains open until decided |

Unavailable levels are skipped. Missing-roster claims have no class match and start at a scoped COL regular or the next available level. Multiple eligible first-level classes are ordered by representative before president, then section/user UUID; the one-owner choice is deterministic. COL/admin assignments retain an existing eligible owner; otherwise UUID order selects from explicitly scoped operational accounts. Feature overrides never create a new role or expand scope. Publication may use the final administrator directly when intermediate roles are not assigned.

Role, scope, feature access and current class assignment are rechecked on evidence access and decisions. Only the current owner can decide; administrator oversight can read all cases but cannot silently overwrite another active owner's decision. A lower reviewer who cannot resolve a risk escalates to the next available owner. Device replacements and point adjustments remain separate administrator actions. Representatives/presidents never gain institution-wide evidence access.

Changing a same-level assignee preserves `entered_at` and `due_at`. Reading notifications or refreshing a page never resets deadlines. New evidence can reopen earlier approved attendance: the submission becomes pending and a new audited review cycle begins. Original decisions and evidence remain in history. Existing unresolved shared-browser risk follows later qualifying attendance from that browser without another automatic point.

## Decisions and safe bulk approval

Attendance review provides search, state/risk filters, clickable page numbers, private GPS/accuracy/venue-distance/browser/signature evidence, and history. All actions require a reason, explicit verification confirmation and the current case version. Concurrent decisions cannot both commit. Expired ownership after worker escalation cannot be used from an old page.

- Approve/reject changes the new submission status and case atomically. Public browser-owned receipts return the current result, allowing the participant to check approval after a pending submission. New attendance is not copied into legacy report tables; report/dashboard integration belongs to phase 8.
- Open device incidents block approval. A replacement decision alone never approves attendance. Original risk flags remain evidence after an incident is closed; previously flagged forms still require individual administrator verification.
- Missing-list, name/institution mismatch, archived identity, unverified browser and manual exceptions require administrator approval. Lower owners can reject or escalate, but cannot approve these exceptions. Approving a missing-list claim does not invent an Auth account, global identity or browser binding.
- Bulk approval accepts 1–50 distinct, versioned, owned, unflagged public forms with only `review_workflow_required` remaining and no open device incident. The entire batch rolls back if any item is stale, unauthorized or flagged. There is no bulk rejection of suspicious forms.

## Manual attendance

Events → Manual attendance is available to administrators and scoped COL roles with `attendance.manual` enabled (COL admin by default; COL regular requires an explicit override). Search returns at most ten matches from the event's frozen official roster. A participant must be selected and independently verified in person, with a documented reason and an active checkpoint.

The record explicitly uses `attendance_source=manual`, authenticated staff actor/reason and a request UUID. GPS, accuracy, distance, participant signature, participant consent timestamp, IP and recognized browser are not manufactured. It is a pending exception requiring administrator approval after routing/escalation. It never binds the participant to the officer's browser or creates device penalties. Unknown/archived participants cannot be added silently through this path. The same school-ID/event/checkpoint slot and legacy duplicate checks apply. Request retries are idempotent; another conflicting request cannot create a second attendance. The officer can record another participant after saving.

## Notifications and monitoring

Assignment notifications are in-app only and unique per case/version/recipient. Review notifications show the recipient's paginated assignment history. Read and resolved/moved times are separate; resolved/moved assignments stop contributing to unread work. Old notifications do not confer continued evidence access after a case moves. Review transitions also enter immutable case history and the audit log.

Administrator review screens show the worker's last successful run, overdue cases, unavailable owners and pending records without an open case. A missing or older-than-two-minute success indicator requests attention. No precise location/signature is included in notification text, worker responses or ordinary monitoring counts.

## Scheduled processor — release setup still required

The database stores all deadlines; Express has no in-memory escalation timer. `process_attendance_review_queue(100)` processes a bounded batch under transaction locks, repairs missing/reopened cases, rechecks owners, advances expired cases and deduplicates notifications. Competing workers and a simultaneous review decision are serialized. A successful level advance starts a fresh hour at processing time; downtime does not cause instant approval/rejection or wrap final administrator cases back to the start. Processing is bounded, so repeated scheduled runs drain a backlog. Configure at least one run per minute and monitor completion/backlog; this code cannot guarantee exact wall-clock delivery without a working scheduler.

Two prepared entry points:

1. An approved scheduler can call `GET` or `POST /api/internal/review-escalation` with `Authorization: Bearer <CRON_SECRET>`. Use a newly generated server-only secret of at least 32 random characters. No query-string credentials. Legacy mode returns 404; missing configuration returns 503; invalid credentials return 401. Errors preserve queued work and return a generic 503 without database details.
2. A trusted scheduled environment can run `node scripts/process-attendance-reviews.mjs` with revision mode and server-only Supabase configuration. It performs one batch and exits. Do not run this against production before the agreed migration/release rehearsal.

No Vercel schedule or OS task was activated, and no production environment secrets were added. Before release, configure a supported one-minute scheduler, verify the complete hosted RPC/worker path, observe health/overdue counters during an outage/recovery rehearsal and repeat representative → COL regular → COL admin → administrator checks with actual staging assignments. Retention/privacy approval, physical-phone GPS, migration-history reconciliation and phase-8 report integration remain outstanding release gates.

## Local validation

`REVISION_PHASE5_VALIDATION.json` records Node HTTP/regression tests, isolated PostgreSQL fixtures and independent-transaction races. Cases cover scoped ownership, notification idempotency, deadline escalation/final stopping, old-reviewer denial, open-device approval blocking, manual provenance/idempotency, no officer-browser binding, atomic bulk rollback, optimistic decisions and competing worker notification deduplication. Synthetic phone/desktop UI uses fake names/location/signatures; no real attendance decision or message is sent.
