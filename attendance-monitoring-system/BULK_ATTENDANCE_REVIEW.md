# Filtered bulk attendance approval

Review center → Attendance decisions now has All attendance, No recorded flags, and Flagged for review filters. Search, status and numbered pagination work together. A flag means the record needs review, not that misconduct has been proven. Classification includes saved risk reasons and any open device incident linked to the account or browser, including shared-device incidents opened for another account.

For pending records outside the Flagged filter, “Approve matching unflagged attendance” previews matching IDs across all pages. A confirmation shows the search and exact batch count. Each batch holds at most 500 records; repeat to handle larger queues. Only the previewed IDs are submitted, so later arrivals are not silently added. The server rechecks pending status and current flags, skips changed records, and writes each decision and audit entry in the same transaction. Existing approved records are untouched.

Flagged attendance remains available for individual approval or rejection with a rejection reason. There is no blanket rejection of device flags. Routine successful QR attendance is already automatically approved, so a healthy system can have zero pending unflagged records.

Validation: `npm test`, rollback-only `tests/bulk-review.sql`, and mobile browser checks with isolated sample records. Tests never approve or reject real attendance.
