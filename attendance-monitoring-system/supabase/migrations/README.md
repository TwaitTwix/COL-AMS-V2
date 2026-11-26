# Supabase migrations

Add ordered PostgreSQL migration files here (for example, `202611090001_initial_schema.sql`). Keep credentials in local environment configuration, never in migrations.

The attendance check-in endpoint expects `events`, `students`, and
`attendance_logs` tables; see the project README for required columns. Apply
the migrations in filename order. The `000` migration creates those tables,
`001` adds the unique check-in guard, and `002` creates the private report bucket.
