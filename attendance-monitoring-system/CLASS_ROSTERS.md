# Phase 2 — sections, assignments, and official class lists

Implemented and verified locally November 26, 2026. Production remains unchanged and `ACCESS_MODE=legacy` remains the default. Use the phase-1 cutover gates in [OPERATIONAL_ACCESS.md](OPERATIONAL_ACCESS.md) before enabling the revised workspace on a hosted project.

## Class records and permissions

The revised workspace has a **Class lists** menu. A section records institution, college, course, academic year, term and name. Its course must be an active entry under the selected institution/college. Academic years span consecutive years, such as `2026-2027`. Section identity is unique within that academic context. Institution/course/year/term cannot be rewritten through a section rename: create another section for a different cohort. Renaming or archiving retains original roster versions and attendance references.

- Administrator has global access. COL admin defaults to section/assignment management within its scope. COL regular can receive the relevant feature grants within its assigned institutions/classes.
- Exactly one unended representative assignment is allowed per section, enforced by a partial unique index. Replacing that representative requires explicit confirmation and the current section version. Previous assignments retain their owner, time and end history.
- Classroom-representative accounts use the representative slot. They cannot receive an extra editor assignment to bypass the limit. Club presidents and COL staff can be explicitly assigned as class-list editors. Account creation or promotion is not part of assigning a section; choose an already provisioned active operational account.
- A club president gets no class-list access just from the presidency role. An event grant also does not grant its attendees' class records. Institution grants work only for COL roles, and class assignment privileges are restricted to COL regular/COL admin/administrator even if an unsupported override was previously stored for another role.
- Class assignments remember the account role at assignment. Changing that role invalidates the old class access until an authorized officer reviews the assignment again. Replacement/removal bumps the affected account's access version for session/UI refresh.
- Existing private student identities remain separate from Auth accounts. Imports create/reuse `students` rows, never Auth users or login profiles. An existing archived identity is not silently restored, renamed or transferred across institutions by an upload.

## Import and update workflow

1. Open a permitted class and download its **Excel template**.
2. Fill its single worksheet using exactly **School ID** and **Full name** headers. See [ROSTER_IMPORT_TEMPLATE.md](ROSTER_IMPORT_TEMPLATE.md).
3. Choose **Merge** or **Replace**, then **Validate and preview**. The response shows each uploaded row, valid/rejected counts and membership additions/removals. Nothing in the official list changes yet.
4. Correct rejected rows or, in merge mode, explicitly accept the valid subset. Replacement requires zero rejected rows and an explicit removal confirmation. Enter a change reason and save.
5. A successful import appends a version and moves the class's current-version pointer. The student table retains every identity; removing membership from a new version does not delete a student or past attendance.

Merge preserves existing members omitted from the workbook. Replace makes the next version contain the reviewed upload's valid members only. Empty lists cannot clear a class accidentally. Each upload accepts at most 1000 rows/2 MB, and a merged class contains at most 2000 members.

Numeric Excel IDs are rejected because lost leading zeroes cannot be reconstructed reliably. IDs are stored as text, trimmed/uppercased, with spaces and `. / _ -` preserved internally; allowed characters are documented in the template guide. Duplicate IDs within one upload are all rejected. Existing global IDs must match the normalized name and known institution; conflicts return a generic review message without another class's name or student details. Correcting a genuine identity mismatch requires a separately verified administrator decision, not an import overwrite.

## Preview safety and retries

Uncommitted previews are owned by the authenticated operator, expire after 30 minutes, and remember both section configuration and current roster revision. Commit rechecks current permissions, archive status, identity conflicts and preview freshness. A changed section/list or revoked editor cannot silently commit an old preview. A committed token can return its saved receipt until that expired cache row is purged.

Accepted changes, new student identities, immutable version rows and audit entry commit in one database transaction. New identities are serialized across sections, so simultaneous uploads cannot assign the same global ID to two different people. Repeating a committed token returns its original saved version; uploading an identical current list does not create duplicate versions. Once saved, staging row contents are cleared. Expired preview tokens are purged during subsequent preview creation; the later scheduled-maintenance phase should also call cache cleanup independently of import traffic. These transient processing limits do not establish a legal retention period for official school records.

Heavy file parsing runs in a worker, with a 10-second deadline, 128 MB worker heap and two concurrent parsers per application process. The parser caps expanded ZIP contents at 8 MB, verifies archive integrity, and rebuilds only checked entries before ExcelJS parsing. It rejects macros, embedded images/files, external links, XML entities, extra sheets/columns, merged cells, formula cells and formula-prefixed names. No original workbook is persisted: versioned normalized official records are reused for future events.

## Reusable event eligibility

From **Events → Set event class lists**, an authorized operator selects one or more visible official class lists. Saving pins each class's **current roster version** in a new immutable event-eligibility revision. The same official version can be used by several events. Later class imports, section renames and archives never rewrite an already selected version or its recorded class label.

An operator must have both event-eligibility access for the event and roster-view access for each selected section. A selected class must match any event institution/college restriction. Existing bindings outside the operator's current roster scope cannot be silently replaced. The editor distinguishes the saved event snapshot from a class's newer current version.

Eligibility changes lock one hour before event start or once existing attendance is present. Phase 3 must preserve this lock for its new public-submission records too. For reports and attendance checks, combine selected lists as a union of globally unique student IDs, rather than summing class counts when a student appears in multiple lists. The class/eligibility snapshots are now the stable basis; attendance submission and report integration belong to phases 3 and 8 respectively and are not claimed implemented here.

## Storage and API boundaries

Migration generated by the installed Supabase CLI:
`supabase/migrations/20261125174653_class_rosters_and_assignments.sql`

Eight new private tables: `class_sections`, `class_assignments`, `class_roster_versions`, `class_roster_entries`, `class_roster_previews`, `event_eligibility_versions`, `event_eligibility_rosters`, `event_eligibility_heads`. All use RLS with no browser grants/policies. New invoker RPCs have empty search paths and service-only execution. History tables reject updates/deletes. Foreign keys preserve historical identities and cross-section version integrity. An indexed normalized school-ID uniqueness guard refuses migration if existing identities already collide.

The feature catalog adds scoped section/eligibility management and role applicability. Operational access context includes derived section assignments. Global account-access editing preserves these assignments; class officers are managed on Class lists. A representative/editor can view events that select their class, but that does not confer event-management access.

Main routes under `/api/operational`:

| Route | Purpose |
| --- | --- |
| `GET /sections` | Scoped search, archive filter, ten sections per page |
| `POST /sections`, `PATCH /sections/:id` | Create or rename/archive a permitted section |
| `GET /sections/:id/assignment-candidates`, `POST /sections/:id/assignments` | Scoped officer lookup and explicit assignment/replacement/removal |
| `GET /sections/:id/roster` | Current/historical roster search, 25 students per page |
| `GET /sections/:id/template.xlsx` | Authenticated text-ID Excel template |
| `POST /sections/:id/import-preview` | Bounded binary XLSX validation and owned preview |
| `POST /roster-previews/:id/commit` | Reviewed, atomic import |
| `GET`, `PUT /events/:id/class-lists` | Inspect/set pinned eligibility revisions |

Actor IDs come exclusively from verified server authentication. Clients cannot set another actor or change section affiliation through update requests. The legacy application remains in its existing mode until the controlled cutover; no hosted migrations, account assignments, official imports or invitations were performed during this implementation.

## Verification and remaining release gates

- Node suite: **55 discovered, 47 passed, zero failed, 8 existing opt-in/live tests skipped**.
- Local PostgreSQL restore plus both revision migrations: **14/14 rollback SQL fixtures passed**. Fixture coverage includes scoped reads/writes, officer-role restrictions, representative uniqueness, identity conflicts, valid-subset confirmation, repeated imports, historical roster retrieval, pinned event versions/labels, expired/foreign previews, archive preservation, access revocation and browser privilege denials.
- Real independent-transaction races passed for last-administrator protection, competing representative assignments, and conflicting cross-class identity imports. Exactly one representative/identity result survived each competing pair.
- Synthetic browser verification at desktop 1280 × 900 and mobile 390 × 844: pagination, historical versions, officer search, binary-file preview and frozen/current version distinction checked. Text was 16px, preview buttons 52px tall, and preview tables scrolled inside their card without horizontal page overflow. Saves/real assignments were disabled in that preview.
- Structured results and migration checksums: [REVISION_PHASE2_VALIDATION.json](REVISION_PHASE2_VALIDATION.json). The isolated SQL harness uses minimal managed Auth/Storage substitutes; hosted Auth/PostgREST/worker delivery and actual school imports still require the full-platform release checks.

Test commands:

```text
npm test
python scripts/test-operational-database.py --backup-dir PATH_TO_SANITIZED_BACKUP
```

The harness applies only the two named revision migrations to a temporary loopback database restored from the sanitized baseline, not the mismatched legacy migration timestamps. It stops and removes that database after tests. Do not use a general production `db push` or discard roster/history tables as a rollback: retain the documented staging and production-mapping gates.

References checked: [Supabase changelog](https://supabase.com/changelog.md), [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security), [Postgres partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html), and [ExcelJS](https://github.com/exceljs/exceljs).
