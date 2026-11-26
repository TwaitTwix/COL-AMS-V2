# V2 maintenance instructions

- When fixing a UI defect, inspect other screens and functions that use the same component, CSS selector or layout pattern. Apply the shared correction to matching cases instead of patching only the reported occurrence.
- Verify affected shared components at desktop and phone widths; preserve readable text and touch targets of at least 48px where practical. Check that form controls and header actions retain their distinct layout needs.
- This checkout is COL-AMS-V2. Push only to TwaitTwix/COL-AMS-V2 and deploy only to col-ams-v2. Do not change the V1 repository, deployment or database.
