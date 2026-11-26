# V2 synthetic test accounts

Created at the owner’s request. These are reserved example.com test identities, created through Auth Admin without sending emails. Each has a unique strong password saved only in the ignored local .local-preview/v2-test-accounts.md file. No passwords or tokens belong in this repository.

| Role | Email | Scope |
| --- | --- | --- |
| classroom_representative | test.classroom-rep@example.com | Representative of TEST ONLY - Role Testing (ISAP) |
| club_president | test.club-president@example.com | Editor of TEST ONLY - Role Testing (ISAP) |
| col_regular | test.col-regular@example.com | ISAP institution |
| col_admin | test.col-admin@example.com | ISAP and MCNP institutions |
| administrator | test.administrator@example.com | Global application access |

All five real sign-ins and application roles were verified. The accounts still require the tester to accept the privacy notice; consent was not fabricated. No real user password, existing role, student roster, attendance record, penalty or V1 resource was changed.

The helper scripts/seed-v2-test-accounts.mjs is pinned to the V2 project URL and requires --confirm-test-accounts. It refuses unrecognized existing identities and does not reset passwords on retry. Deactivate the test accounts through Account & feature access after testing.

The original designated administrator remains active and was verified before provisioning these fixtures.
