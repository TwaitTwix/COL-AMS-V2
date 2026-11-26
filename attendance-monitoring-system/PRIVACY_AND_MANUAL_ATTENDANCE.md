# Privacy, account activity, and manual attendance

## Authentication and consent

Application registration and password-reset submissions require 10–128 characters, uppercase and lowercase ASCII letters, a digit, and a non-whitespace special character. Existing passwords are not rejected at sign-in merely because the policy changed. Reset submissions use the authenticated user's Auth token, preserving provider recovery/reauthentication checks.

The app records the privacy notice version `2026-11-17` and server acceptance time. Registration requires an unticked checkbox. Existing accounts see the notice before entering the workspace; API role guards also enforce acceptance. Viewing `/api/auth/me` does not add browser-device logs until acceptance. No existing account's consent is silently backfilled. Acceptance is not inferred from registration metadata controlled by a browser. The public notice lists data, intended attendance/security uses, access, location limitations, hosting services, rights and the supplied contact address. The retention period remains pending a school decision; automatic retention deletion is not yet implemented.

### Provider-wide password policy still requires setup

Application routes enforce the policy. Direct requests to Supabase Auth use its own configured rules. A partial `supabase/config.toml` is prepared to require the same character classes globally. The CLI preview failed with `AccessTokenRequiredError`; no remote Auth settings were changed. An authorized operator must run `npx supabase login`, then `npx supabase config diff --remote=wazszxhrocurhlkadfca`, review that only the two password settings change, and `npx supabase config push --remote=wazszxhrocurhlkadfca --yes`. Alternatively set these password requirements in the Supabase Auth dashboard. Do not commit access tokens. Existing leaked-password-protection advisor warning is unchanged.

## Administration pages

Activity logs contains recent login history and administrator audits, separated from the overview. Account tracker provides name/email/ID suggestions, recorded browser identifiers and user agents, login times/IPs, attendance coordinates and reported accuracy, venue distance, and manual-entry provenance. It displays the latest 100 entries per category. Account activity reads are audited. It does not collect GPS during login, continuously track users, claim exact location, or obtain MAC addresses. Only approved main administrators, administrators, and COL officers with current privacy acceptance can access these APIs.

Manual attendance searches active student records (including students without an Auth account), shows open nonarchived events, and requires a reason and in-person ID/presence attestation. Staff can submit any number of distinct eligible students without consuming or obeying the student's scan quota. Each student/event remains unique; existing rejected/pending attendance must be reviewed through the existing workflow and is not overwritten. Event window and institution/college eligibility still apply. No historical backdating is supported.

Manual records are approved, marked `entry_method=manual`, attributed to `recorded_by`, and audited atomically. Student device, GPS and distance remain NULL rather than fabricated. Exports display `Manual / not measured` for distance. Manual check-in does not prove GPS presence; it is an explicit staff verification.

## Verification

- Unit tests cover shared password validation and search behavior; opt-in API tests reject weak passwords and missing consent without creating accounts.
- Read-only demo HTTP tests verify the consent gate without consenting on anyone's behalf.
- `tests/manual-attendance.sql` rolls back disposable fixtures and verifies access, consent, reason, event window, scan-quota bypass, truthful location fields, audit provenance and duplicates.
- Existing attendance-attempt SQL checks and all four report worker formats pass.
- Mobile browser checks cover an unticked consent checkbox, readable password help, existing-account workspace gating, and the actual admin page modules with disposable sample data.

Production consent acceptance and real manual attendance were not performed as tests. The school's retention decision and provider-wide Auth password configuration remain separate operator tasks described above.
