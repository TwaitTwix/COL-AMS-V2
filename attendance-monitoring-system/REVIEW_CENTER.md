# Review center

Numbered controls and a Go to page field are now shared with Activity logs; see [ACTIVITY_LOGS.md](ACTIVITY_LOGS.md).

The administrator dashboard now fetches four exact counts instead of fetching user lists and the latest 100 security records. Three compact cards link to unread notifications, attendance pending review, and open device incidents. A short registration summary links to the existing verification page.

Review center is a separate administration page available to approved main administrators, administrators and COL officers who accepted the current privacy notice. Each category supports server-side name/email/ID/event/message search, Needs attention / Resolved history / All filters, and stable pagination (10 items per page, newest first with ID tie-breaking). Exact totals include records beyond the old 100-row dashboard cap. Attendance history includes administrator-reviewed submissions and excludes unrelated successful scans/manual entries.

Rows show a short preview. View details opens a responsive native dialog with the full message or attendance/device evidence and appropriate actions. Attendance approval allows an optional note; rejection and device decisions require a reason. Actions use existing protected endpoints and audit behavior. Mark read and successful decisions refresh the current queue, preserving filters and moving back a page when its final item is removed. Already-reviewed attendance/device records retain the existing conflict protection. The device dialog reminds staff that trusting a browser does not approve attendance.

Requests are versioned so stale search/category responses cannot overwrite current results. Stale rows are cleared during loading, action buttons disable during submission, dialogs close on navigation/sign-out, and API failures show an inline retry. Dashboard counts refresh every minute.

Server-only `list_review_items` is SECURITY INVOKER with an empty search path and no public/anon/authenticated EXECUTE grant. Its parameters are validated both by the API and database. Existing row-level security and role/consent gates remain in place. Queue ordering indexes support pagination.

Validation: unit query-filter tests; protected HTTP endpoint checks; rollback-only `tests/review-center.sql` with 125 notifications, page uniqueness, counts beyond 100, search, pending/history transitions, attendance details and direct-access denial. Mobile UI tests use the real Review center module with disposable sample data to verify search, page navigation, notification read/history, attendance rejection, required device notes, and no horizontal overflow. No real decisions were made as tests.
