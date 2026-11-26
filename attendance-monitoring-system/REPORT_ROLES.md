# Report account roles

New CSV, Excel, PDF, DOCX and matching PDF-preview exports include **Role (current)** after the student number. Labels include Student, Student Officer, COL Officer, Officer, Administrator, Main Administrator and Pending.

The report uses the attendance record's attendee `user_id` to load the current role from `user_profiles`. For legacy attendance without a user ID, it looks up the account currently linked to the student record. It never uses `recorded_by` to label the attendee: a manual entry by a COL officer remains the student's role. Missing explicitly recorded accounts are labelled Account unavailable; unlinked roster records are labelled No linked account. Historical roles at check-in time are not reconstructed. Existing files must be regenerated to contain the new column.

PDF column widths were adjusted to keep the added role column within the page. Footer placement now avoids adding an extra blank page. Preview generation and file privacy remain unchanged.

Validation includes attendee-vs-recorder and missing/legacy account cases, nonempty sample rows in CSV/Excel/DOCX, matching PDF signatures and page counts, live report-worker format generation, and a rendered PDF with all role labels visible. No real account or attendance record was modified.
