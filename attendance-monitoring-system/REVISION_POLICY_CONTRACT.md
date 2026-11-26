# Revision policy contract — baseline v1

Recorded November 26, 2026 (Asia/Shanghai). This is the target behavior for the revision, not the behavior currently deployed. No existing account or attendance decision is changed by this document.

## Confirmed requirements and decisions

| Area | Policy | Basis |
| --- | --- | --- |
| Participant access | No student/ordinary-officer self-registration; attendance uses a public event form | Revision request |
| Operational roles | Classroom representative, club president, COL regular, COL admin, administrator | Revision request |
| Highest role | Administrator has all application features; protected from last-administrator lockout | Revision request; lockout guard is implementation policy |
| Class-list editors | Representatives and club presidents may edit only explicitly assigned classes, as may permitted staff | Confirmed November 26 |
| Representative limit | At most one active classroom representative per section, assigned by authorized officers | Revision request |
| Participant identity | School IDs are globally unique across institutions; institution remains an affiliation field | Confirmed November 26 |
| Attendance uniqueness | One attendance per school ID, event, and scheduled checkpoint | Confirmed November 26 |
| Missing roster entry | Hold in an exception queue for review; do not automatically approve | Confirmed November 26 |
| Device change | One penalty point plus attendance review | Confirmed November 26 |
| Escalation | Automatically advance unresolved incidents after one hour at each review level | Confirmed November 26 |
| QR | One stable URL/QR per event during normal operation; external phone cameras can open it | Revision request |
| Archive action | Deactivate Account replaces the old email-release feature; deactivation must preserve history | Revision request |

The detailed defaults below make the confirmed rules implementable. Record later changes here before writing their migrations; do not silently reinterpret a confirmed requirement.

## Identity, classes, and rosters

1. A participant is an attendance identity, separate from a login account; an official roster is optional. Operational account holders may also have roster identities and use the same public attendance flow.
2. Store the school ID as text. Trim outer whitespace and normalize letter case for uniqueness; preserve leading zeroes, internal punctuation, and original display value. Do not guess that two differently punctuated IDs are the same person. A name is not an identity key.
3. Existing school-ID duplicates/collisions must be reported before migration. Never merge identities automatically. Correcting an ID after attendance exists requires an administrator-controlled, audited correction preserving the original identity references.
4. A section belongs to an institution, college, course, academic year, and term. Representative assignment is exclusive per section for its active term; replacing a representative ends the old assignment and retains history. Database constraints must prevent two concurrent active assignments.
5. A club presidency does not imply class ownership. Representatives and presidents receive explicit class assignments. COL roles also have explicit organizational/event scopes; only administrator is global by default.
6. Imported lists are versioned, previewed before commit, reusable across events, and editable within scope. Imports must not create login accounts. Roster removal/archive never deletes attendance history.
7. Event eligibility records which roster/version or explicit exception justified acceptance. Reports must distinguish the event's recorded eligibility basis from later roster edits.
8. A missing-ID submission that passes required event/location/form checks becomes an unverified exception. It cannot create an approved roster identity, count as attendance, or permanently bind the claimed school ID to a device until reviewed. Review may confirm/add the participant or reject the claim, with evidence and audit history.

## Account roles, grants, and scope

Canonical proposed role keys use underscores in code: `classroom_representative`, `club_president`, `col_regular`, `col_admin`, `administrator`. Display labels may use the requested hyphenated names. These are new target keys, not a rename already applied to production.

Default capability matrix:

| Capability | Classroom representative | Club president | COL regular | COL admin | Administrator |
| --- | --- | --- | --- | --- | --- |
| Own dashboard, account/password/theme, notifications | Yes | Yes | Yes | Yes | Yes |
| View assigned events/QR and assigned class lists | Assigned scope | Assigned scope | Assigned scope | Assigned scope | Global |
| Import/update reusable class lists | Explicit class assignment | Explicit class assignment | Organizational scope | Organizational scope | Global |
| First-level attendance/device review | Assigned section/event | Explicit first-level event assignment | Fallback or escalated scope | Escalated scope | Global |
| Documented manual attendance | Off by default | Off by default | Grant required | Scoped default | Global |
| Create/manage events and geofences | Off by default | Off by default | Grant required | Scoped default | Global |
| Assign/replace representatives | No | No | Grant required, within scope | Scoped default | Global |
| Reports and student records | Scoped view; exports require grant | Scoped view; exports require grant | Scoped default | Scoped default | Global |
| Deactivate/reactivate operational accounts | No | No | No | Off by default | Global, lockout protected |
| Change roles, feature overrides, organizational scopes | No | No | No | No | Global |
| Audit Trail | Assigned case history only | Assigned case history only | Scoped operational history | Scoped operational history | Global |

- The matrix defines safe defaults, not a simple numeric role comparison. A server capability check must also check resource scope and active account status on every request.
- Administrator may enable/disable supported operational features per account. Grants cannot implicitly expand the account's assigned sections/events/institutions. Role/security administration remains administrator-only; an export grant does not grant access to all identities, signatures, or precise locations.
- Revocations take effect on the next protected request. Never trust client menus or editable Auth user metadata for authorization. Public attendance gets a dedicated, limited API; it does not gain broad anonymous database access.
- There are no student account grants in the target model: student records carry attendance eligibility, while operational accounts carry feature access.
- Only authorized provisioning/invitations create operational accounts. Keep email verification, password policy/recovery, single active login, account deactivation, and administrator recovery safeguards.

## Legacy-role migration contract

| Existing role | Target handling |
| --- | --- |
| `main_admin` | Map the existing active designated main administrator to `administrator`, after identity/status validation. Preserve its Auth ID and history. |
| `admin` | Candidate for `col_admin`; review assignments/scope explicitly. Never automatically promote to highest administrator. |
| `col_officer` | Candidate for `col_regular`; grant only reviewed organizational/event scopes. |
| `student_officer` / legacy `officer` | Require explicit representative/president/staff assignment before activation under a new role; do not infer a section or club. |
| `student` | Preserve participant and historical account links; disable operational login at cutover after review. Never delete its historical Auth/profile references merely to remove registration. |
| `pending` / rejected / retired | No operational access by default; preserve status/history. No automatic activation or re-registration. |

The live snapshot has one main administrator, three COL officers, two student officers, and eleven students. These counts include historical/retired profiles; they are not a claim that every profile is currently eligible for access. Produce a reviewed per-account mapping before executing cutover, without publishing that private mapping in Git.

## Event form, geofence, duplicate, and retry policy

1. Each stable QR resolves to the public event page without login. Possession of the link is not evidence of physical presence. Event closure/disable must block submission even when a printed QR remains available.
2. Required form evidence: name, normalized school ID, touch signature, versioned privacy notice acceptance, and fresh location evidence. The public form also collects institution, college/department, program/course and class/section without exposing official class lists. Events may publish a stable attendance QR without any uploaded list; valid unmatched submissions are saved in the exception queue for review, not blocked.
3. Server time determines the active checkpoint. Non-overlapping checkpoint windows remain supported; a checkpoint key is immutable after submissions. Unique attendance is `(participant identity, event, checkpoint)`; pending/approved records reserve that slot. Multiple HTTP requests must never create multiple accepted records.
4. Rejected submissions and attempts remain evidence, not extra attendance rows. Retry/appeal references the same slot and follows the event's configured attempt policy; network retries reuse an idempotency identifier and do not consume extra attempts or penalties.
5. Retain existing per-checkpoint attempt limits (default three) unless explicitly revised. A missing-roster/device-review submission is pending, not a rejected attempt. Attempts for unauthenticated claims must not become a way to lock out another student's ID without rate-limit/review recovery.
6. Venue center/radius are server-owned. Calculate meters server-side and enforce the checkpoint window, active event, eligibility, and geofence in the same acceptance transaction. Never accept distance, role, approval status, or timestamps asserted by the client.
7. Conservative initial location defaults: request high accuracy with no cached fix; reject a fix older than 30 seconds, nonfinite/out-of-range values, or accuracy worse than the smaller of 50 meters and the event radius. Require the reported uncertainty circle to fit inside the venue (`distance + accuracy <= radius`). These are explicit initial engineering defaults, to be tested on actual venue phones before release; changes require a recorded policy update.
8. Denied/unavailable/poor location produces a clear recoverable error, not a silent geofence bypass. Documented manual attendance uses a separately authorized review path and must never manufacture GPS proof.
9. A static QR and browser GPS can be copied/spoofed. The application must not describe these checks as definitive proof of personal identity. Names and signatures alone also do not prove the submitting person owns a school ID; contested first submissions require human identity verification.

## One identity, one recognized device

- The binding is to one recognized signed browser identifier across events/checkpoints, not a MAC address. Browsers cannot provide a trustworthy hardware MAC or guarantee a permanent one-physical-device identity. Cleared cookies, another browser, or private mode may appear to be a different device.
- First qualifying roster-matched submission binds atomically. An unverified missing-roster claim must not seize a student's permanent binding. Conflicting concurrent first submissions must be held/reviewed rather than both accepted.
- After binding, a different recognized browser creates a device-change incident, one penalty point, and pending attendance. The point belongs to the participant record even when there is no Auth account. Repeated requests for the same unresolved change must reuse the incident and never multiply points. Existing penalty/device history is retained separately as legacy evidence.
- A recognized browser used for multiple participant identities is a shared-device risk requiring review. No extra automatic shared-device point is introduced without an explicit policy; the confirmed point applies to a device change. Retired/unrelated login-only history must not create false attendance-sharing flags.
- An authorized review may approve a replacement binding, reject the submission, or dismiss a false flag. Approved replacement ends the previous active binding and records reviewer/reason/time. Dismissing an erroneous point uses an auditable adjustment, not deletion of evidence. Approving attendance alone must not silently replace a device or remove a penalty.
- Administrative/manual checking is an exception with a responsible authenticated staff actor and reason. It must not rebind the participant to the officer's device or trigger ordinary attendee shared-device penalties.

## Review ownership and one-hour escalation

1. Initial owner is the event/section's assigned classroom representative. An explicitly assigned president may handle first-level club cases. If there is no eligible first-level owner, route directly to the event's assigned COL regular. Event publication must validate a usable escalation chain; administrator is the final fallback.
2. Order: first-level representative/president → COL regular → COL admin → administrator. The timer is one hour at each level, measured using database UTC timestamps; display local time in the interface. At administrator level, remain open until decided; never automatically approve/reject or wrap back to the start.
3. Each level records `entered_at`, `due_at`, owner/scope, and escalation history. Opening a notification, adding a note, refreshing, or swapping the same-level assignee does not reset the deadline. A level advance starts a fresh one-hour timer.
4. Use a durable scheduled processor (target at least once per minute). Escalation occurs on the first successful run after the deadline. Server downtime/delays must be observable; overdue work is processed on recovery. Do not promise exact wall-clock delivery from request-only/serverless timers.
5. Claim and advance incidents transactionally; deduplicate notification delivery using incident plus level/transition identity. Concurrent resolution and escalation must not produce contradictory outcomes. A resolved incident stops escalation immediately. A previously escalated reviewer cannot override the current owner merely by retaining an old page.
6. In-app notifications are the initial delivery channel; email/SMS are not assumed or sent without a later requirement. Unknown-roster exceptions also receive an accountable review owner; they must not be mislabeled as proven malicious attendance.
7. Precise location, signature, and device evidence are limited to authorized reviewers of that case. General dashboards show counts/status, not everyone's location.

## Deactivation, audit, and data handling

- Deactivate Account revokes operational access and active sessions while preserving Auth/profile, roster, attendance, report, and audit references. Reactivation is explicit and audited. It does not release the email for a new registration and must not call the old irreversible email-retirement operation under a new label.
- Keep already-retired accounts as historical records. Do not finish pending historical release operations or revive real accounts as part of this revision without an explicit account decision.
- Audit Trail groups by operational account or participant identity, with filters, pagination, and an event/case detail trail. Distinguish anonymous submissions from authenticated reviewers; never invent an account actor for a public attendee.
- Privacy notice must describe names, IDs, signatures, location/device evidence, penalty points, and escalation uses. Existing contact: `leonardolllmacalinaoisap@gmail.com`. School retention duration remains unconfirmed; do not invent a legal retention period or enable automatic data deletion without policy approval.

## Phase-0 exit and later release gates

Phase 0 is complete when this contract, migration inventory, baseline tests, fresh sanitized data/storage backup, and isolated SQL restore verification are recorded. Production mappings and physical-device tests remain implementation/release gates, not permission to alter accounts now.

Before release, validate the geofence defaults at the real venue; resolve missing escalation assignees and roster imports; confirm privacy retention; test the complete Supabase Auth/Storage platform and hosted scheduled-worker path. An isolated SQL test with managed-schema stubs cannot establish those guarantees.
