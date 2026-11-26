# Attendance checkpoints

Approved administrators and COL officers can record their own attendance under **Campus events / scan**. If an account has no linked attendance record, use **Set up my attendance profile** there. This links only the signed-in account's approved identity; staff without a personal ID receive a clearly generated ACCOUNT attendance identifier. Institution-restricted events still require the correct roster affiliation. Promoting an account preserves its existing attendance link unless explicitly cleared.

In **Events & geofencing**, select 1–8 required check-ins. Two defaults to Start/End, three to Start/Midpoint/End, and four to Morning arrival/Lunch departure/Afternoon return/Final departure. Set the opening and closing time of every checkpoint. Windows must be ordered, non-overlapping, and inside the event's attendance period (one hour before start through event end). A single default checkpoint inherits that entire period. Existing events retain one checkpoint.

The schedule cannot change after attendance has been recorded. Each checkpoint has an independent duplicate check and rejected-attempt counter (default three, configurable per event). The participant selects a checkpoint and scans the current event QR using the page camera; server-side time, GPS, geofence, device, and eligibility checks still apply. Closed checkpoints cannot be submitted. Administrators can select a checkpoint on the separate Manual attendance page for documented exceptions.

Event participation statistics count a person as complete only when all required checkpoints are approved. History, review details, account tracking, and newly generated CSV, Excel, PDF, and DOCX reports include the checkpoint. Previously generated report files must be regenerated to include the new column.

Validation includes rollback-only database fixtures for staff scanning, phase-specific retries and duplicates, manual attendance, closed windows, schedule locking, service-only function permissions, and completion statistics. Automated tests cover schedule validation and all report formats. Physical camera/GPS behavior still requires a real phone test.
