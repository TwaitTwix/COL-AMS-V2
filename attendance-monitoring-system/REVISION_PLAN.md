# Major revision — ordered implementation tracker

Updated: November 26, 2026 (Asia/Shanghai).

Status: phases 0–7 implemented/verified locally; production cutover remains gated. Phase 8 reports and local rehearsal are implemented; hosted, physical-device and document-rendering release gates remain open. Existing production behavior is unchanged. Policy contract: [REVISION_POLICY_CONTRACT.md](REVISION_POLICY_CONTRACT.md). Baseline: [REVISION_BASELINE.md](REVISION_BASELINE.md). Phase-1 cutover gates: [OPERATIONAL_ACCESS.md](OPERATIONAL_ACCESS.md). Phase-2 implementation: [CLASS_ROSTERS.md](CLASS_ROSTERS.md). Phase-3 implementation: [PUBLIC_ATTENDANCE.md](PUBLIC_ATTENDANCE.md). Phase-4 implementation: [PARTICIPANT_DEVICES.md](PARTICIPANT_DEVICES.md). Phase-5 implementation: [REVIEW_WORKFLOW.md](REVIEW_WORKFLOW.md). Phase-6 implementation: [ACCOUNT_LIFECYCLE_AUDIT.md](ACCOUNT_LIFECYCLE_AUDIT.md). Phase-7 implementation: [NAVIGATION_MOBILE.md](NAVIGATION_MOBILE.md).

Indicators: `[ ]` pending, `[~]` in progress, `[x]` complete, `[!]` awaiting a policy decision or external verification. Only mark implementation complete after its acceptance checks pass. Complete one numbered phase before starting the next. Update this note after each completed phase, recording checks, changed files/migrations, and any remaining limits.

## Agreed direction

- Attendance participants do not create accounts. They open an event's static QR link and submit name, school ID, and signature with location/device checks.
- Login accounts are restricted to classroom-representative, club-president, col-regular, col-admin, and administrator. Administrator is highest and has every application feature.
- Only one active classroom representative is assigned to a class section by authorized staff.
- Official Excel rosters are reusable and can be updated by authorized presidents and other explicitly permitted accounts.
- Suspicious device use enters review and notifies the responsible classroom representative, with escalation through col-regular, col-admin, and administrator.
- Feature access is configurable by an administrator and enforced on the server, not merely through hidden menu items.
- Existing attendance, identity links, device incidents, and audit history must be preserved during migration.

## 0. Baseline and policy contract — first priority

- [x] Inspect current role, attendance, checkpoint, archive, and task documentation.
- [x] Save a fresh credential-free local source backup: `C:\Users\Leo\Documents\COL\backup_COL-AMS\COL-AMS_2026-11-26_00-19-48` (165 files verified). This is source only; the separate November 24 backup contains the previous database snapshot.
- [x] Write this ordered tracker and identify dependencies and unresolved policies.
- [x] Capture a fresh sanitized database/storage backup before applying migrations; verify restore procedures. New pre-revision backup contains 544 application rows, 17 sanitized Auth users, and 23 stored files. Isolated SQL restore passed; full hosted Supabase restore remains a later release check.
- [x] Record baseline test results and migration inventory; prepare an isolated local SQL test environment with disposable fixture identities. Default Node suite: 27 passed, 8 skipped; isolated SQL fixtures: 12/12 passed. Hosted full-platform staging remains a phase-1/release prerequisite before production changes.
- [x] Write the role/permission matrix, legacy-role mapping, representative assignment rules, and attendance identity contract before changing authorization. Detailed defaults are recorded in the policy contract; per-account production mapping is deferred until cutover review.
- [x] Confirm class-list editors: classroom representatives and club presidents, only for explicitly assigned classes.
- [x] Confirm duplicate prevention: one attendance per globally unique school ID, event, and scheduled checkpoint; preserve historical checkpoints.
- [x] Confirm school-ID uniqueness: globally unique across MCNP/ISAP, with institution retained as affiliation.
- [x] Define device change: one point plus attendance review; approval of replacement binding is explicit and audited. Repeated retries do not multiply the incident/point.
- [x] Confirm missing-roster handling and escalation: exception queue; automatic escalation after one hour at each review level, with an assigned COL regular fallback and administrator as final owner.

Acceptance gate: migration, identity, duplicate, and permission rules are written and agreed; unresolved rules cannot silently change production behavior.

## 1. Role and feature-access foundation

- [x] Add the five new roles and server-side capabilities. Institution/event scopes work now; section/club scopes will use the actual phase-2 models. Representatives/presidents cannot receive institution-wide grants.
- [x] Define safe defaults and administrator-only security management. Lower roles cannot grant permissions or broaden scope. Unmigrated legacy endpoints are closed in revision mode.
- [x] Implement per-account feature overrides for operational accounts. Unprovisioned/student identities have no access in revision mode.
- [x] Provide searchable, paginated administrator controls with effective-access previews, optimistic version checks, and atomic audit entries. Later-phase features are explicitly unavailable.
- [x] Document the legacy-role mapping and add an explicit designated-administrator bootstrap command. No real accounts were mapped, promoted, deleted, or deactivated.
- [x] Close application registration UI/backend in staged revision mode; implement provisioning/private invitation links, strong-password setup/recovery, and operational deactivation/reactivation. No messages sent during tests.
- [x] Preserve single-active-login checks and reject old sessions after deactivation/reactivation. Last-administrator protection passed a real two-transaction race test.
- [!] Before production cutover: review private per-account assignments, reconcile legacy migration timestamp drift in staging, disable provider-level Supabase public signups, and verify the complete hosted invitation/session flow. Keep production in legacy mode until later attendance/roster phases are ready.

Local acceptance gate passed: 36 Node tests passed (8 existing opt-in tests skipped); all 13 SQL fixtures and the concurrent last-administrator guard passed; mobile synthetic editor checked. Revision-mode legacy APIs fail closed. Full provider/production migration checks remain the explicit cutover gate above; no hosted changes executed.

## 2. Classes, representative assignments, and reusable rosters

- [x] Model class sections/year/term with active course/institution/college validation and independent student identities. Imports never create login accounts.
- [x] Enforce one representative slot per section with a database unique index, versioned explicit replacement and assignment history. Extra representative access through an editor slot is rejected.
- [x] Build the downloadable text-ID Excel template and bounded worker import: 2 MB/1000 rows per upload, duplicate/conflicting/archived identity checks, plain text and leading-zero preservation.
- [x] Implement owned expiring previews and atomic reviewed commits. Merge supports explicit valid-subset acceptance; replacement requires every row valid and confirmed removals. Cross-class data is not returned in conflict messages.
- [x] Restrict representatives to their assigned section and presidents/COL editors to explicit class assignments or authorized COL institution scopes. Role changes/revocations are rechecked; lower roles cannot delegate class access through an inappropriate override.
- [x] Append immutable roster versions with section-label snapshots, searchable/paginated current/history views, import idempotency and archive preservation. Stored lists can be reused across events.
- [x] Pin event eligibility to selected official roster versions with an auditable revision and opening-window lock. Later roster/name changes preserve those snapshots; attendance/report consumption follows in phases 3/8.

Local acceptance gate passed: 47 Node tests passed (8 existing opt-in/live tests skipped), 14/14 SQL fixtures, and independent-transaction races for representative and cross-class identity conflicts. Snapshot membership/labels remain stable for later reporting. Desktop/mobile synthetic UI checked. Full hosted-platform validation and real school imports remain release gates; no production data changed.

## 3. Static QR and account-free attendance

- [x] Create a stable event URL and static QR image usable through a phone's normal camera or any QR reader. Remove dependence on the website camera scanner for this new flow.
- [x] Keep the link stable during normal event edits. Provide an administrator-only emergency disable/replacement procedure for compromised links, with an audit trail.
- [x] Build a mobile-first public form for name, school ID, signature, privacy notice/consent, and browser location permission. Capture a touch-friendly signature securely.
- [x] Match submission identity to the authorized roster; prevent anonymous school-ID lookup from exposing full class lists or student details. Name mismatches enter pending review.
- [x] Validate event activity, eligibility, normalized identity, input sizes, consent, and signature server-side. Store signatures privately with service-only access. School retention approval remains a release gate; no deletion period was invented.
- [x] Enforce geofencing on the server using venue coordinates/radius and fresh browser coordinates; reject missing/denied/stale/inaccurate location according to an explicit accuracy policy.
- [x] Enforce duplicate prevention with database uniqueness and transactional submission, including parallel requests and retries. Pending/rejected slots stay reserved; officer review handles corrections in phase 5.
- [x] Apply rate limits and abuse controls appropriate for shared school networks. Prevent replay/double submission without requiring participant registration.
- [x] Show clear success, duplicate, location, closed-event, pending-review, and recoverable error states. Never show “recorded successfully” for an unaccepted request.

Local acceptance gate passed: 55 Node tests passed/8 existing live tests skipped; SQL 15/15; five independent-transaction race checks passed, including duplicate public attendance and request replay. Synthetic 390px/1280px UI, pointer signature, interrupted retry, multi-checkpoint editor and static QR publishing checked. All submissions remain pending until phase-4 device verification. Physical-phone GPS/printed-QR checks and a normal-browser PNG download check remain release gates (automation timed out on the download event).

Acceptance gate: opening a printed QR reaches the form without login; outside-venue requests fail; simultaneous identical IDs cannot create duplicate attendance; mobile signature/GPS and interruption/retry behavior work.

## 4. Device binding and suspicious-attendance evidence

- [x] Bind the roster identity to a server-issued signed browser/device identifier after the first qualifying submission, using atomic database checks.
- [x] Detect an identity switching browser identifiers and a browser submitting multiple student identities. Hold suspicious attendance for review and preserve evidence without silently accepting it.
- [x] Record timestamps, location, accuracy, calculated venue distance, browser/device metadata, and the reason for each flag. Limit access to sensitive evidence by capability and scope.
- [x] Define secure device replacement, cleared-cookie, private-mode, lost-phone, and documented manual-checking exception workflows. Repeated retries must not multiply incidents or penalties.
- [x] Preserve existing legacy incident/history tables separately. New bindings use qualifying public attendance only, preventing login-only historical activity from creating false positives.

Browser limitation: a website cannot read a device MAC address or prove permanent physical-device identity. Cookies can be cleared and GPS can be spoofed. This feature can enforce a recognized browser binding and flag changes, but cannot guarantee one human/one physical phone without additional supervised or stronger identity controls. A roster match and signature alone also do not prove who submitted the form.

Local acceptance gate passed: Node 56 passed/8 existing live tests skipped; SQL 16/16; seven independent-transaction guards passed, including cross-event first-browser and shared-browser races. Synthetic mobile/desktop evidence view and explicit replacement checked. Administrators have private device controls; lower-role ownership, notifications, manual attendance and escalation remain phase 5. All attendance remains pending; no real penalties, account changes or hosted mutations.

Acceptance gate: concurrent first submissions cannot bind two devices; switching devices triggers one review incident; normal refresh/retry does not flag a new device; approved replacement is traceable.

## 5. Review ownership, notifications, and escalation

- [x] Route pending attendance and linked device evidence to the current representative of its frozen class list; an explicitly assigned president is a first-level fallback. Missing class owners skip to scoped COL roles, then a verified administrator fallback.
- [x] Provide a compact review queue with filters, pagination, evidence, and explicit accept/reject/escalate actions.
- [x] Implement auditable escalation: classroom representative → col-regular → col-admin → administrator. Recheck current role, scope and capabilities. Overrides cannot expand scope or bypass current ownership; an old page cannot decide after escalation.
- [x] Implement one-hour database deadlines, a protected bounded worker, authorized manual escalation, and stale/overdue/unassigned monitoring. Final administrator cases stay open. Scheduler credentials/one-minute activation are an explicit hosted release gate; no schedule was enabled on production.
- [x] Deduplicate notifications, record read/resolved status, and ensure concurrent decisions cannot overwrite one another.
- [x] Retain safe bulk review only for eligible unflagged records; do not automatically reject every flagged submission.

- [x] Add documented manual attendance requests for scoped COL staff/administrators, official-list search, transport idempotency and administrator exception approval. No fabricated GPS/signature/consent or officer-browser binding.
- [!] Before release: configure a supported one-minute scheduler with a private credential; verify full hosted worker execution, notifications, owner reassignment and outage recovery.

Local acceptance gate passed: Node 58 passed/8 existing live tests skipped; SQL 17/17; ten independent-transaction race guards passed, including decision/decision, worker/decision and competing worker notifications. Synthetic mobile/desktop review, approval, manual search/submission, notification history and header bell checked. Production, real attendance and real messages are unchanged.

Acceptance gate: every incident has an accountable owner; unauthorized reviewers cannot view/decide it; retries do not spam notifications; the full escalation and resolution history is visible.

## 6. Account deactivation and Audit Trail

- [x] Provide the revision Student records directory with archived filtering and genuine Deactivate Account / Reactivate Account actions. New UI/API never invokes the old irreversible email-release flow. Legacy production remains isolated until cutover.
- [x] Define explicit, versioned deactivation/reactivation, current-grant preservation and fresh-sign-in/session-cutoff rules. Preserve identity/attendance/audit history; school retention duration remains unconfirmed and no automatic deletion was added.
- [x] Keep previously retired email-release accounts as historical records. Do not restore or further retire real accounts automatically.
- [x] Add Audit Trail last in revision navigation, with searchable account/participant/system groups, clickable identity/history pages, safe role/grant summaries and readable timelines. Raw audit JSON and sensitive case evidence stay outside general history.
- [x] Keep account actors distinct from account-free participants: anonymous attendance should link to roster identity without inventing a login account.
- [x] Include role/grant changes, assignments, roster versions, deactivation, event changes, attendance decisions, and escalation actions; restrict GPS/signature/device visibility.

Local acceptance gate passed: Node 59 passed/8 existing live tests skipped; SQL 18/18; twelve independent-transaction guards passed, including dedicated last-administrator protection and conflicting reactivations. Scoped audit/redaction, anonymous attribution, archival independence, historical retirement and fresh-login checks passed. Synthetic mobile/desktop lifecycle and audit pagination checked. Production, real identities and email-release records are unchanged.

Acceptance gate: deactivated tokens cannot act; restoration cannot elevate privileges; audit records remain readable for archived/retired identities and anonymous participants.

## 7. Navigation and mobile interface

- [x] Add an accessible hamburger button opening a responsive navigation drawer, with touch-sized controls, visible active state, keyboard support, close-on-navigation, and correct focus handling.
- [x] Order the menu by operational importance and permission: Dashboard → Events → Attendance/Review Center → Class Lists & Student Records → Reports → Account & Feature Access → Audit Trail (last). Show only applicable entries; keep account/theme controls outside the operational menu order.
- [x] Adapt dashboards to each role and assignment, making pending decisions and current events easy to find.
- [x] Preserve logo colors, readable mobile text, light/dark themes, notification bell, and desktop usability.

Local acceptance gate passed: Node 62 passed/8 existing opt-in/live tests skipped; synthetic 320px/390px/1280px browser checks, keyboard focus wrap/Escape/backdrop, close-on-navigation, refresh/Back restoration, role menus, themes and unavailable-count feedback passed. No production changes. Reports remain hidden until phase 8.

Acceptance gate: phone and desktop navigation work with touch/keyboard; no horizontal overflow or tiny controls; hiding menus never substitutes for server authorization.

## 8. Reports, migration rehearsal, and release — last priority

- [~] Update report previews and CSV/XLSX/PDF/DOCX exports for roster-based participants, role-bearing reviewers, signatures where authorized, device flags, and resolution status. Do not label every attendee with an account role.
- [x] Recompute dashboard attendance percentages using explicit roster eligibility and approved-attendance rules; keep historical event totals reproducible.
- [x] Rehearse migrations on sanitized data, verify row counts/foreign keys/history, and test recovery. Avoid destructive cleanup until migration results are accepted.
- [~] Run complete permission, geofence, duplicate-race, import, device, escalation, deactivation, report, and mobile regression checks.
- [!] Test physical phones at the venue, location denial/poor accuracy, weak connections, normal external-camera QR scanning, and privacy notice/signature behavior.
- [!] Roll out behind controlled feature flags in dependency order; prevent old and new attendance endpoints from creating conflicting records. Document database-compatible rollback and incident recovery.
- [!] After validation, retire obsolete registration/scanner/rotating-QR screens and update deployment/setup/user documentation. Preserve legacy attendance history.

Local work: revised report snapshots, scoped previews, four export formats, administrator signature evidence, decision-role capture, official dashboard rates, fenced background workers and an emergency API pause are implemented. Node 68 passed/8 existing hosted tests skipped; SQL 19/19 and 14 concurrency checks passed on the sanitized restore. Synthetic mobile/desktop and PDF visual checks passed. DOCX structural checks pass, but visual rendering needs LibreOffice/Word; no soffice is installed. See [REVISION_REPORTS.md](REVISION_REPORTS.md), [REVISION_RELEASE_RUNBOOK.md](REVISION_RELEASE_RUNBOOK.md) and [REVISION_PHASE8_VALIDATION.json](REVISION_PHASE8_VALIDATION.json). No hosted changes or deletion of legacy screens/data.

Acceptance gate: all earlier gates pass, policy decisions are resolved, source and current data are backed up, and production rollout/recovery steps are concrete and reviewable.

## Progress log

| Date | Work | Verification | Next action |
| --- | --- | --- | --- |
| 2026-11-26 | Ordered revision plan created; existing architecture reviewed | Documentation only; no application, account, or live database changes | Complete phase 0 contracts and fresh pre-migration data backup, then implement phase 1 |
| 2026-11-26 | Phase 0 complete: confirmed policies, capability matrix, migration inventory, fresh private backup, isolated restore | Node 27 passed/8 skipped; SQL fixtures 12 passed; checksum and credential scans passed. See baseline notes for platform limits and migration timestamp drift | Start phase 1 only; review role/scope migration before any production cutover |
| 2026-11-26 | Phase 1 foundation implemented locally: five roles, scoped capabilities, feature editor, provisioning, session revocation and lockout protection | Node 36 passed/8 skipped; SQL 13/13; two-transaction administrator race passed; phone preview checked. No production changes or invitations | Phase 2: class/section assignments and reusable Excel rosters. Hosted cutover stays gated in OPERATIONAL_ACCESS.md |
| 2026-11-26 | Phase 2 implemented locally: class sections, sole representative/editor assignments, Excel template and preview/commit, immutable rosters and event eligibility snapshots | Node 47 passed/8 skipped; SQL 14/14; three concurrency guards; desktop/mobile synthetic preview passed. No real imports or account assignments | Phase 3: stable event QR links and account-free attendance forms, using pinned official lists |

| 2026-11-26 | Phase 3 implemented locally: stable QR publishing, mobile public form/signature/consent, frozen-roster matching, strict geofence, attempt caps and durable retries | Node 55 passed/8 skipped; SQL 15/15; five race guards; synthetic phone/desktop UI passed. All new submissions pending; no hosted changes | Phase 4: recognized-browser binding, suspicious-device evidence and deduplicated points/incidents |

| 2026-11-26 | Phase 4 implemented locally: atomic browser bindings, device/shared-browser incidents, deduplicated participant points, private evidence and explicit administrator replacement/false-flag decisions | Node 56 passed/8 skipped; SQL 16/16; seven concurrency guards; synthetic mobile/desktop UI checked. No production changes; attendance remains pending | Phase 5: assigned review ownership, manual exceptions, notifications and durable one-hour escalation |

| 2026-11-26 | Phase 5 implemented locally: scoped review ownership, in-app notifications/bell, private decisions, safe bulk approval, manual exceptions, durable one-hour escalation and worker health | Node 58 passed/8 skipped; SQL 17/17; ten concurrency guards; synthetic phone/desktop UI checked. No hosted scheduler or production changes | Phase 6: reversible deactivation and grouped Audit Trail. Scheduler activation and full staging remain release gates |

| 2026-11-26 | Phase 6 implemented locally: explicit reversible lifecycle, archived Student records, preserved retired identities and grouped sanitized Audit Trail | Node 59 passed/8 skipped; SQL 18/18; twelve concurrency guards; synthetic phone/desktop checks. No Auth deletion, email release or production mutations | Phase 7: accessible navigation drawer, role dashboards and mobile usability; hosted release gates remain unchanged |

| 2026-11-26 | Phase 7 implemented locally: accessible drawer, permitted page restoration, role dashboards and mobile header controls | Node 62 passed/8 skipped; synthetic phone/desktop, keyboard and outage checks; no production changes | Phase 8: revised reports, migration rehearsal and release gates |

| 2026-11-26 | Phase 8 reports and local rehearsal implemented; release remains in progress | Node 68 passed/8 skipped; SQL 19/19; 14 concurrency checks; synthetic report/PDF QA. No hosted mutations | Complete DOCX visual rendering, hosted Auth/Storage/scheduler tests, physical-phone acceptance and retention confirmation before controlled cutover |

The older `PROJECT_TASKS.md` records the previous system. Its completed entries are historical and do not mean this revision is implemented.

## Clarification implemented: optional official class lists (2026-11-27)

- [x] Allow stable QR publishing without uploaded class lists, preserving an immutable empty eligibility snapshot.
- [x] Collect institution, college/department, program/course and class/section on the public attendance form.
- [x] Save unmatched submissions for accountable review; retain checkpoint, geofence, duplicate and device checks.
- [x] Show self-declared details in review and report outputs without treating them as an official roster or inventing an attendance denominator.
- [x] Validate an empty installation and rollback fixtures for no-list submissions, duplicate/replay, geofence rejection, reporting and official-roster compatibility.

## Rejected attendance evidence (2026-11-27)

- [x] Clear outside-venue guidance with detected distance, allowed radius, GPS accuracy and remaining attempts.
- [x] Save immutable distance/venue snapshots and browser/notice details on request records; preserve original receipts on retries. Existing coordinate records remain; historical unknown distances are not reconstructed.
- [x] Show matching rejected attempts to assigned case reviewers; provide administrator-only paginated school-ID search from the static QR page, including unsuccessful-only participants. Claims remain unverified and GPS rejection is not proof of malicious activity.
- [x] Update privacy notice and validate rollback fixtures for evidence, authorization, replay and successful resubmission.
