# Revised attendance reports

Implemented locally for ACCESS_MODE=revision. No hosted migration, Storage write, account provisioning, or deployment was performed.

## Report contract

Participants submit account-free forms. Reports label them **Account-free participant**, never infer a participant role from an officer who entered or reviewed the record, and show the reviewer's role captured at decision time. Existing decisions whose role was not recorded show **Historical role unavailable**. Automatic approvals show **System / automatic**. Old login-based attendance and exports remain separate and preserved.

Each request creates a service-only, immutable dataset containing its event/checkpoint labels, selected frozen roster, totals, group rates, rows, and snapshot timestamp. Later roster edits, decisions, or role changes do not rewrite that dataset. Pending and rejected records appear explicitly. Original flags and final resolution are distinct; a flag alone does not mean a submission was malicious.

Official percentages count unique official school IDs once per event/checkpoint. The denominator includes every scheduled checkpoint, including checkpoints later that day. Only approved, official-list-matched slots increase the numerator. Approved off-list exceptions are counted separately. No frozen roster means N/A, not a fabricated percentage. If an ID appears in more than one selected frozen list, a deterministic section is used for grouping and it is counted once. Archived student records remain in historical frozen eligibility.

The dashboard uses the same rule for current events and events opening within one hour, grouped by institution and college. It labels rates **so far**, excludes archived/ended events, and exposes only permitted classes. Reports can include archived events for historical review.

## Permissions and evidence

- reports.view enables paginated on-screen previews for assigned classes or explicit event/institution scope. It works independently of events.view.
- reports.export additionally enables CSV, XLSX, PDF and DOCX files. A preview-only account is not given a signed PDF or download link.
- Signature and exact venue-distance inclusion is an explicit administrator-only option. Default snapshots redact venue distance. The on-screen view, PDF, XLSX and DOCX can display it; CSV records capture status and has a matching PDF evidence preview. Signatures are drawn from normalized application strokes, with no remote images, HTML or SVG interpretation.
- General report rows include original flag categories but redact venue distance. Coordinates, raw device identifiers, IP hashes and browser metadata are excluded even from evidence exports. Manual attendance says distance was not measured and does not fabricate consent, location or signature.
- Every status read rechecks owner, active account, current feature grants and all originally selected scopes. An old signed link is a bearer link and may remain usable for its remaining 60-second lifetime after revocation. Already downloaded data cannot be recalled.

## API and processing

POST /api/operational/reports accepts request_id (UUID), event_id, format (preview/csv/xlsx/pdf/docx) and include_signatures. The actor is taken from the verified server session. A repeated actor/request ID returns the same job; changing its parameters conflicts.

GET /api/operational/reports/events lists permitted report events. GET /api/operational/reports/summary supplies dashboard rates. GET /api/operational/reports/:id?page=1 reads ten rows and summary; download=true requires current export permission and creates short-lived links. Record page numbers are clickable. The report ID can resume a snapshot; the browser remembers only the last ID/format preference per account in session storage.

Export jobs live in operational_report_jobs and are separate from legacy report_jobs. Workers build files outside the Express event loop. Transactional claims prevent competing workers from owning a live lease. Four-minute build limits and six-minute stale-claim recovery bound processing. Each claim writes a unique revision/<job>/<claim> object prefix; an old worker cannot overwrite a newer attempt or mark it complete. A status poll resumes queued/stale work after a restart. If nobody polls after a terminated process, a queued job can wait until its owner resumes it; no hosted report scheduler was enabled.

The configured bucket must remain private; both generation and signing fail closed if it is public. No client-provided bucket/path is accepted. CSV/XLSX treat formula-like input as text, retain school-ID leading zeroes, and use explicit UTC timestamps. All export formats have a matching PDF snapshot preview. XLSX includes summary and group-rate sheets; CSV is the record dataset with event and snapshot metadata.

Supported bounds: 5,000 attendance records, or 200 when including signatures; three active exports per account; ten snapshot requests per fifteen minutes. Oversized jobs fail explicitly. Upload failures produce a safe error. Orphaned claim files can remain private; no deletion policy was guessed while retention awaits school approval.

## Local validation and limits

76 Node tests: 68 passed, 8 existing opt-in/live tests skipped. SQL: 19 fixtures and 14 independent-transaction checks passed on an isolated PostgreSQL 18 restore. The harness confirms original row counts remain unchanged, every application table has RLS, no new SECURITY DEFINER functions exist, and fixtures roll back. No managed Supabase services were emulated as fully tested.

Synthetic browser checks passed at 320px, 390px and desktop width for snapshot creation, compact records, clickable page 3, expandable rates, restricted signature option and the PDF preview controls. No real participant data or decisions were used. PDF summary and participant/signature pages were rasterized and visually inspected. CSV/XLSX/DOCX structures and embedded evidence were validated by automated tests.

DOCX visual rendering remains open: the bundled render_docx.py could not run because LibreOffice soffice.exe is not installed. Word/LibreOffice layout and normal-browser downloads remain release checks, as do hosted private-bucket upload/signing, Vercel worker lifecycle, real sessions, physical-phone GPS/printed QR and approved retention details. See REVISION_RELEASE_RUNBOOK.md.

Supabase documentation checked: [signed download URLs](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl), [CLI v3 migration behavior](https://supabase.com/changelog/supabase-cli-v3).
