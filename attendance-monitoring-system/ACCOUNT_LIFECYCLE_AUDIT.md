# Phase 6 — account lifecycle and Audit Trail

Implemented locally behind `ACCESS_MODE=revision`. Production remains unchanged. No real account, Auth identity, email-release operation, attendance record or hosted database was changed during implementation or tests.

## Reversible account actions

Administrators use Student records → Show archived students → Deactivate Account, or Account & feature access → Deactivate / reactivate. The access editor also links to the explicit lifecycle action; its active-state checkbox is read-only. Student records have a search field, compact cards, and clickable page numbers.

Deactivation records a reason and actor, disables operational access, clears the active application session and advances the session cutoff. Every protected revision-mode request checks current access; an old JWT or refresh of an old Auth session cannot regain access. Reactivation is explicit, uses the current account and lifecycle versions, and requires a newly created sign-in session. Concurrent actions cannot overwrite each other. The final active administrator is protected transactionally, including two simultaneous self-deactivations.

The email stays reserved to the same Auth identity. The workflow retains profile, roles, explicit scopes, feature settings, class-assignment history, attendance, devices, penalties and audit entries. Reactivation preserves the current reviewed role/grants; it accepts no role, email, scope or password fields. Separate administrator edits to grants remain separately audited. Ended/replaced assignments are not recreated. Reactivation does not create an operational role for an unmapped legacy identity.

The server uses application session revocation and database access checks. It does not delete Auth users, release email addresses or pretend to erase data already displayed in an open browser. New protected requests are denied after the deactivation transaction commits; a fresh sign-in after explicit reactivation is required.

## Participant archival and historical accounts

Participant archival/restoration is a separate, confirmed, versioned administrator action. It preserves immutable class-list/event snapshots and all attendance/device history. It does not change linked account state, reset device bindings, forgive points or restore an operational session. Archival serializes with browser-binding checks.

The directory follows actual `student_id` and `retired_student_id` links. It does not guess accounts from matching names/emails. Account-free roster participants display “No login account is linked.” Previously retired or partially completed email-release accounts display read-only history. Neither lifecycle controls nor access editing can re-enable these identities, finish an old release, or silently attach them to a new participant.

The revision workspace uses the genuine lifecycle RPC and never calls the old irreversible email-release functions. Legacy production screens remain isolated behind legacy mode until the final cutover; the old `/api/admin` workflow is closed in revision mode. Existing release records are preserved without being replayed or repaired.

## Grouped Audit Trail

Audit Trail is last in the revision navigation. Search and clickable page numbers operate independently for the identity table (10 per page) and its detailed history table (20 per page).

- **Login accounts:** operational and retained legacy/retired profiles, including account actions performed by them and changes targeting them.
- **Account-free participants:** roster identities and separately labeled unverified school-ID claims. Attendance, manual records, device incidents and review transitions link to the participant without inventing an Auth account.
- **System activity:** known automated review events and explicitly unattributed historical records. Missing historical actors are not presented as authenticated accounts or assumed to be automated actions.

The projection combines retained audit records, sign-in history and legacy attendance facts. It includes role/grant changes, assignments, roster versions, archival, deactivation/reactivation, event changes, attendance decisions and escalation. Role/state and assignment/feature-setting counts are returned only through a fixed safe summary. Raw JSON, free-text private notes, GPS, signatures, IP/browser identifiers, session tokens and invitation/QR credentials are excluded from general audit responses. Original private evidence remains stored and is accessed through its authorized review workflow.

Administrators can inspect all retained audit identities. Other roles need effective `audit.view` access and see their own account history plus participant events for cases they can currently read. A case in one event does not grant access to that participant's unrelated event history. Revoked roles, scopes, evidence permissions and deactivated accounts fail current checks. Search results and entry counts use the same restrictions. Unknown claims remain separate from verified roster identities; their displayed names are unverified form claims.

Account actions retain their account actor, anonymous attendance is labeled account-free, and worker transitions are labeled System. Current retained profile/operational names identify account actors; original audit metadata is preserved. Account-to-participant associations use recorded student references rather than silently moving historical actions when an account link changes.

Audit and sign-in records are application append-only, with browser grants revoked and update/delete triggers. The service role already lacks audit deletion rights. Controlled retention maintenance requires an approved school policy; no guessed retention period or automatic deletion schedule was introduced.

## API and implementation

Service-only, security-invoker database functions support:

- `GET /api/operational/student-records` and `PUT .../:id/archive`.
- `GET` / `PUT /api/operational/accounts/:id/lifecycle`.
- `GET /api/operational/audit/groups` and `GET .../timeline`.

Routes use the verified authenticated actor, strict schemas, explicit confirmation/reasons, optimistic versions and current capabilities. There is no generic raw-audit or sensitive-evidence toggle. The lifecycle table is private with RLS; wrappers ensure deactivation is respected by access lookup, capability checks and account provisioning/enabling. General history is a sanitized projection rather than direct browser access to source tables. Group counts are calculated for the selected identity page using one materialized event projection.

## Validation and remaining release gates

`REVISION_PHASE6_VALIDATION.json` records local Node tests, isolated PostgreSQL fixtures and twelve independent-transaction concurrency guards. New checks cover exact-grant restoration, stale-session rejection, fresh login, last-administrator protection, conflicting reactivations, archival/account independence, retired-account immutability, anonymous attribution, safe role summaries, raw-evidence redaction and unrelated-event denial. Synthetic phone/desktop screens exercise archived records, lifecycle decisions, identity types and history pagination. No real lifecycle decision or message is sent.

Before production: complete navigation/mobile phase 7 and reporting/rehearsal phase 8; verify the complete hosted Auth session cutoff/reactivation flow and historical account mapping; reconcile migration timestamp drift; confirm school retention/privacy policy; configure and validate the phase-5 one-minute scheduler; repeat real-device and recovery checks. Production mode and all real accounts remain unchanged until the agreed release process.
