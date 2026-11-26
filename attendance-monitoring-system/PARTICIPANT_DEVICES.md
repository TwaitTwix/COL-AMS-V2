# Phase 4 — recognized attendance browsers

Current local status: phase-5 assigned review, manual exceptions and escalation processing are implemented; see [REVIEW_WORKFLOW.md](REVIEW_WORKFLOW.md). Only an authorized attendance decision changes pending attendance to approved/rejected. Hosted rollout and scheduler activation remain gated.
Implemented and verified locally behind `ACCESS_MODE=revision`. Production remains unchanged. All public attendance remains pending until the phase-5 review workflow is ready; a successful browser check alone never approves attendance.

## Binding and incident policy

- A fresh, inside-venue, roster/name/institution-matched submission from an unarchived participant creates the first binding. The participant is identified by the existing roster student UUID, independent of Auth accounts. Unknown IDs, wrong names, archived identities and invalid GPS cannot claim bindings or trigger device penalties.
- A signed server browser cookie supplies the browser hash. Login history, IP addresses and user agents are **not** used as permanent device identity. Existing legacy device/penalty tables are preserved separately; no real accounts or historical bindings are automatically migrated.
- One active binding per participant and one active participant per browser are enforced by partial unique indexes and a database mutex shared across all events. First submissions racing through separate events cannot create two active bindings. Competing browser submissions stay pending and create the device-change review evidence.
- A different browser creates one open `device_change` incident per participant/candidate browser and one point in an append-only participant penalty ledger. The same unresolved change reuses that incident across requests/checkpoints/events. Transport replay does not create another observation or point. Another candidate browser is a separate change.
- A browser already bound to someone else creates `shared_browser` incidents for both identities, links the affected submissions, and leaves them pending. It does not bind the second identity and adds no automatic shared-browser point. An independently established device change still receives its one confirmed-policy point.
- Duplicate school-ID/checkpoint submissions never create another attendance row. A qualifying duplicate from a changed browser can supply review evidence; it must independently pass fresh-location/accuracy/geofence and roster-name checks. Invalid/outside/mismatched duplicate claims cannot create incidents. The duplicate response stays generic and discloses no penalty, identity or signature details.
- A device check removes `device_verification_required` from a qualifying submission and adds `review_workflow_required`. Original risk flags remain evidence. All pending/rejected slots remain reserved; review corrections are a phase-5 concern.

## Private evidence and administrator controls

Administrators open Events → Device verification. The list is paginated; details show the participant's points, browser binding history, latest 25 candidate observations (timestamp, coordinates, accuracy, venue distance and browser agent), and latest signature. These are historical browser reports, never live location tracking. Audit entries retain anonymous participant actors versus authenticated administrator decisions.

The new nondelegable `devices.admin` capability is administrator-only during this phase. SQL also checks the current enabled administrator role. No lower-role evidence access is enabled before case ownership and escalation are implemented. Administrators have global scope; future assigned-case access must enforce narrower scope independently. APIs use the verified actor from authentication, reject caller-supplied browser/actor/status fields, return `no-store`, and have no browser-role table/RPC grants. Five new private RLS tables and their service-only security-invoker RPCs are covered by local permission checks.

Every decision requires a reason, an explicit independent-identity-verification confirmation, and the current incident version:

| Decision | Binding | Point | Attendance |
| --- | --- | --- | --- |
| Approve replacement browser | Ends previous binding; creates a new historical row for the observed candidate | Remains | Pending |
| Dismiss false flag | Unchanged | Appends −1 adjustment for a device-change point; original +1 retained | Pending |
| Reject change / close flag | Unchanged | Remains | Pending |

Replacement is available only for device-change incidents. The candidate must not be actively bound to another participant. The original binding must still be current; an obsolete incident cannot replace a newer binding. Concurrent/stale decisions fail with 409 rather than overwriting a decision. Replaying a resolved request never charges again. A genuinely new submission after an incident has been resolved may open a new incident if the device still differs.

Observations and penalty ledger rows reject UPDATE/DELETE through append-only triggers. Point corrections are new rows. Binding replacement retains the earlier row and reviewer/reason/time. Device decisions cannot silently approve attendance, clear original attendance evidence, or rebind to the officer's current browser.

## Exceptions and operational limits

- Cleared cookies, private browsing, a different browser or a lost/replaced phone can appear as a device change. The officer must verify identity independently, review the recorded candidate browser, and explicitly approve replacement. False points can be offset by dismissal; replacing a device alone does not offset them.
- If no usable phone/GPS/signature is available, staff must use the separately authorized manual-attendance exception workflow when phase 5 enables it. There is no GPS bypass or administrator-browser binding in these APIs. No bulk binding reset or self-service claim of an arbitrary browser is exposed.
- Roster details and signatures cannot prove that the first submitter owns a school ID. A contested first binding requires supervised verification. Browser cookies can be cleared and GPS spoofed; this is recognized-browser enforcement, not guaranteed one-human/one-physical-device identification or a MAC-address check.
- No automatic notification delivery/escalation worker is enabled yet. Incidents are durable and ready for phase-5 ownership/one-hour escalation. Do not deploy this intermediate flow to real participants before review, manual exceptions, privacy retention approval, full-platform staging and physical-phone tests are complete.

## Verification

See `REVISION_PHASE4_VALIDATION.json`. The local SQL harness restores sanitized data to disposable PostgreSQL with minimal managed-schema stubs. It tests first binding without penalties, invalid-claim rejection, repeat-change deduplication, shared-browser handling, immutable evidence, false-flag offsets, explicit replacement/history, stale-review rejection and private access. Independent transactions test cross-event competing first browsers and shared-browser first claims, plus all earlier race guards. Synthetic mobile/desktop UI and a fake replacement decision were checked; no real attendance, penalties, account changes, notifications, hosted migrations or deployment occurred.
