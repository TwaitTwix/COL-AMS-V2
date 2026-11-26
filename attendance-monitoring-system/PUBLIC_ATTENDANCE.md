# Phase 3 — static links and account-free attendance

Current local status: phase-5 assigned review, manual exceptions and escalation processing are implemented; see [REVIEW_WORKFLOW.md](REVIEW_WORKFLOW.md). Only an authorized attendance decision changes pending attendance to approved/rejected. Hosted rollout and scheduler activation remain gated.
Implemented locally behind `ACCESS_MODE=revision`. Phase-4 recognized-browser enforcement is now implemented locally; see [PARTICIPANT_DEVICES.md](PARTICIPANT_DEVICES.md). Attendance still remains pending for phase-5 review. Production remains in legacy mode. Do not publish this flow to real participants until device verification (phase 4), review ownership (phase 5), privacy/retention approval, migration rehearsal, and physical-phone checks pass.

## Staff workflow

1. Open Events → Create event. Set institution/college, venue center, radius, start/end, location-attempt limit (default 3, configurable 1–20), and 1–8 scheduled checkpoints. A single checkpoint opens one hour before the event and closes at event end. Explicit checkpoint windows cannot overlap.
2. Before the attendance window opens, select official class lists using Set event class lists. The selected roster versions and section labels are frozen; later imports do not change that event's membership.
3. Open Attendance QR / link and publish it. New events are disabled by default; publishing requires pinned official lists. Print/download the static QR or copy its URL. The downloaded PNG includes a white quiet zone.
4. Ordinary edits and disable/enable preserve the URL. Authorized event managers can disable it. Only an administrator can replace a compromised link, with `REPLACE LINK` and a reason. Replacement invalidates old printed links and their public receipt lookup; private records remain intact.

Venue, affiliation, times, checkpoints and eligibility cannot change after the first public submission. Event names may change, while each submission retains the original venue/name/time snapshot. Optimistic versions prevent stale staff changes. Security/configuration changes are audited; public QR tokens are not put in audit details.

## Participant workflow

Any phone camera/QR reader opens `/attend/:token`. No account, Auth session, website camera, or QR-scanner permission is required. The participant enters full name, globally unique school ID, institution, optional section, a drawn signature, and privacy consent. Precise location is requested only after pressing Submit. The page uses 17px controls and 52px primary touch targets, with system light/dark appearance.

The server checks the current published link, checkpoint window, canonical ID, bounded inputs, privacy version, signature, duplicates, attempts, and location. Names are matched after whitespace/case normalization to the frozen roster, rather than looking up or exposing the roster through an anonymous search. Missing IDs, name/affiliation mismatches, and archived identities are flagged. Unknown IDs do **not** create global student identities, login accounts, device bindings, or penalty points.

**Phase-3 submissions are always `pending_review`, including roster matches.** `device_verification_required` prevents premature success. The public form displays an amber pending message. Green success is reserved for an actual approved receipt; there is no public approval endpoint. Review/device integration and notifications belong to phases 4–5. These records do not yet feed legacy dashboards or exports (phase 8).

## Location and attempt policy

- Haversine distance is computed inside PostgreSQL with Earth radius 6,371,000 m and a clamped intermediate value. Device-supplied distance/venue/approval fields are rejected by the API.
- Captured position must be no older than 30 seconds, no more than 5 seconds in the future, and have accuracy ≤ `min(50m, venue radius)`.
- Both the position and its accuracy envelope must fit inside: `distance + accuracy <= radius`. Outside, uncertain-boundary, stale and inaccurate positions are rejected with explicit messages. Location denial/unavailability does not submit to the API.
- Checkpoint windows are half-open `[opens_at, closes_at)`; at a shared boundary only the next checkpoint is open. Validation uses the clock **after** acquiring the event lock, so queued requests cannot use an earlier window.
- Only server-rejected location checks consume the event's configured attempt count, per event/checkpoint/school ID/recognized browser. Closed windows, duplicates, invalid fields, pending records and infrastructure failures do not consume location attempts. This browser-scoped cap avoids allowing another browser to exhaust a student's slot; stronger identity/device enforcement follows in phase 4.

One slot is reserved per canonical school ID/event/checkpoint across pending, approved, and rejected records, with a database unique constraint. A rejected review does not release the slot for anonymous resubmission; corrections/appeals must go through the authorized review workflow in phase 5. Historical legacy attendance is checked too.

## Retry and security contract

Public endpoints are `/api/public-attendance/:token`, `POST .../check-in`, and `GET .../requests/:requestId`. Legacy mode returns 404. Staff routes are under `/api/operational/events`, authenticated and capability/scope checked. No existing legacy endpoint was opened for anonymous use.

- Form POST requires same-origin JSON, a server HMAC form token bound to the event and signed browser cookie (15-minute expiry), and explicit consent to notice `2026-11-26-attendance-v1`.
- Metadata omits venue coordinates/radius, roster identities and signature/device evidence. Receipt lookup requires the original request UUID, current link, and same signed browser; it returns status only. Form/API responses are `no-store` and `no-referrer`.
- A request UUID plus canonical payload hash gives durable idempotency. Transport retries resend exactly the same payload; changing evidence with an old UUID returns 409. A committed result is recoverable even after the form token expires. Request/event transaction locks serialize concurrent retries and duplicate slots.
- The browser stores only a request UUID/checkpoint in optional session storage. Name, ID, signature and location are not persisted by this application in browser storage. A transport interruption locks the submitted fields and offers Retry same submission / Check saved submission. After a reload, check the saved result first; the full payload is deliberately not recoverable from local storage. A later open checkpoint becomes available independently.
- A pre-validation process limit is 900 requests/minute/IP. Durable database limits are 20 valid-form POST requests/minute/browser/event and 600/minute/network/event, allowing shared campus networks. Transient rate keys are pruned in bounded batches after ten minutes. Durable evidence/attempt retention needs the school's approved policy, not automatic deletion based on a guessed period.
- Signatures are normalized stroke vectors (≤32 strokes, ≤2048 points total, sufficient path length), held in a separate private RLS-protected table. No SVG/HTML/file execution or public signature URL is accepted. New tables and RPCs deny direct `anon`/`authenticated` access; only the server service role can call them. There are no new security-definer functions. Sensitive evidence viewing is deferred until a scoped review feature exists.
- Evidence includes the private signature, frozen roster references, claimed identity, GPS accuracy/time/distance, signed-browser hash, HMAC network identifier, browser agent, event snapshot and consent version/time. MAC addresses and permanent physical identity cannot be obtained through this browser flow. Precise location can be spoofed; venue phone testing and supervised exception processes remain necessary.

## Validation and release limits

See `REVISION_PHASE3_VALIDATION.json`: Node synthetic tests, isolated SQL regression fixtures, actual two-transaction duplicate/replay races, and synthetic desktop/mobile UI checks. The browser automation timed out while waiting for the PNG download event; QR rendering/publishing passed, but the actual download still needs a normal-browser release check. No hosted migration, real attendance, emails, penalties, invitations or production deployment were performed.

Before release: finish phases 4–8; confirm retention and privacy notice; verify invite/role/session flows on full hosted staging; reconcile documented legacy migration timestamp drift; rehearse recovery; test external-camera printed QR scanning, precise/denied/poor GPS, signatures and weak connections on physical phones at the venue. Do not blindly run `supabase db push` against the existing production migration history.
