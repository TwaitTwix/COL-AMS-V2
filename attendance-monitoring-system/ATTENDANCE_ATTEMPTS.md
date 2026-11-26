# Attendance attempts and administration UX

Each event has `max_check_in_attempts` (default 3, configurable 1–20 on creation or editing). It limits **server-rejected scan verification submissions**, per participant record, event, and checkpoint. Invalid, expired, wrong-event or replaced QR codes, outside-geofence coordinates, insufficient GPS accuracy, and failed device verification consume one attempt. Scanning pauses after one detection, so repeated camera frames do not consume extra tries. See [Attendance checkpoints](ATTENDANCE_CHECKPOINTS.md) for multi-check-in events.

Camera/location permission failures, GPS timeouts before submission, transport/server failures, duplicate submissions, and closed or ineligible events do not consume attempts. A successful submission or one pending administrator review is final; administrative review is a separate decision, not another scan attempt. Existing attendance is preserved.

The database stores rejected counts and locks the student's profile before checking quota, serializing simultaneous requests. Expected validation failures return a structured rejection rather than aborting the transaction, so rejection counts persist. Refreshing or changing devices does not reset the counter. Administrators can increase an event's cap to permit another try; prior attempts remain in the audit history. Only the server role can read/write counters or execute the submission function. Legacy administrator-assisted check-ins remain an administrator-only override.

The event page loads the remaining count from the server and disables scanning at the cap. It also prevents scanning after attendance is submitted or the event ends. All existing events receive a default cap of three.

Manage role access supports case-insensitive suggestions by account name, email and personal ID. Select a suggestion by touch, click, or arrow keys and Enter; Escape dismisses suggestions. Existing main-administrator-only authorization remains enforced by the API.

Decision notes appear in an accessible modal. Routine account/attendance approvals allow an optional note and receive a standard audit note if left blank. Rejections and device-trust/dismiss decisions require a reason. The actor and timestamp continue to be logged.

QR previews preserve the video aspect ratio and let html5-qrcode position the scan region using the actual rendered video size. Scan boxes are square and sized to the smaller video dimension in both scanner interfaces.

Validation: `npm test`; opt-in HTTP role/catalog tests; `tests/attendance-attempts.sql` (rollback-only database fixtures); mobile browser checks at 390px for suggestions, keyboard selection, dialog requirements, event attempt input, and no horizontal overflow. Physical phone camera/GPS capture still needs on-device verification.
