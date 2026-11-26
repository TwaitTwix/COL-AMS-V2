# Numbered navigation and Activity logs

Review center and Activity logs share numbered page controls: first/last pages, nearby page numbers, ellipses, previous/next arrows, the current page marked with `aria-current`, and a validated Go to page field. Large collections never create thousands of buttons. Controls disable during loading; filtering resets to page one and out-of-range pages clamp to the last available page.

Activity logs now has Login history and Administrator actions tabs instead of the two long sections capped at 100 records. Each tab loads ten records at a time from a server-paginated endpoint, with exact totals and stable date/ID ordering. Search covers account name/email/personal ID and relevant browser, IP, action, entity or audit-note text. Login filters include flagged and registered browsers; administrator filters group action types. Summaries remain compact; View details opens the complete record in a native dialog. View account continues to open the existing account tracker.

Only approved main administrators, administrators and COL officers with current privacy consent can use `/api/admin/activity-logs`. The server-only SQL function is SECURITY INVOKER, uses an empty search path, validates category/filter combinations and bounds page size, and has no anon/authenticated EXECUTE privilege. No new location data is collected and no existing logs are changed.

The account tracker's separate per-account recent-history limit remains unchanged; the global Activity logs page is no longer limited to the latest 100 records.

Validation: shared page-range and API-filter unit tests, rollback-only SQL tests with 125 logins plus 125 audit records, protected HTTP access checks, and phone UI tests for direct page selection, page jumping, current-page highlighting, filters/search, details dialogs, and Review center pagination. All UI fixtures use sample data; no real decisions or records were changed during testing.
