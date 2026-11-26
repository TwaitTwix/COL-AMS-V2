# Release an archived student's email

In Students & colleges → Student records → Archived students, admins and the main admin can choose Release email for registration on a linked student/student-officer account. COL officers cannot perform this action; administrator and staff logins, including the main administrator email, are protected.

The confirmation requires a reason and the exact word RELEASE. This permanently retires the old Auth login using Supabase's soft-delete API. It preserves the Auth ID and application profile so existing attendance, device evidence, and audit references remain. It releases the old email for a new Auth registration. No real login is retired during deployment or automated testing.

The application marks the profile retired before contacting Auth, so previously issued tokens cannot access the application while the release is being processed. The personal ID and active student link are cleared only after the server confirms Auth retirement through the Auth Admin API. Their original values and the email remain in the restricted profile for historical identification. Failures leave a blocked, resumable release; use Retry email release. Retired logins cannot be restored or promoted.

A replacement registration has a new user ID and must verify email and receive administrator approval. To reuse the same personal ID, restore the archived student record before approving the replacement; the student record retains its existing attendance and duplicate/attempt history. Restoring a student record never restores its retired login. The new profile does not inherit the old account's role, devices, or consent.

Tests: npm tests cover request validation, ordering, partial failure, and retry. `tests/email-release.sql` uses rollback-only fixtures to verify archive/role/identity checks, completion gating under the deployed service-role permissions, preserved attendance, audit, and retirement protection. Browser QA uses isolated sample data.
