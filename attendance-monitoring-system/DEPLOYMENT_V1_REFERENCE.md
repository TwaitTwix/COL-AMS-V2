# Vercel deployment

Production: https://col-ams.vercel.app

Project: `col11/col-ams`. GitHub: `TwaitTwix/COL-AMS`, production branch `main`.
The Vercel root directory is `attendance-monitoring-system`, the framework is Express,
the Node version is 24.x, and functions run in Singapore (`sin1`) near Supabase.

## Environment

The Supabase URL, publishable key, server secret, reports bucket, and canonical
`PUBLIC_APP_URL=https://col-ams.vercel.app` are configured in Vercel. Server secrets
are private Vercel environment variables. Local `.env`, demo credentials, previews,
dependencies, and Vercel authentication files are excluded from uploads and Git.

Do not copy production secrets into GitHub, browser code, or `vercel.json`.
`scripts/configure-vercel-env.js` can transfer the local application settings to an
already-linked Vercel project through stdin when explicitly authorized. It never
prints values and does not transfer the local development URL.

## Authentication redirects

In [Supabase URL Configuration](https://supabase.com/dashboard/project/wazszxhrocurhlkadfca/auth/url-configuration),
set the Site URL to `https://col-ams.vercel.app` and allow
`https://col-ams.vercel.app/` as a redirect. Retain localhost redirects if needed for
local development. This account-level configuration is separate from Vercel environment
variables; delivery and final redirects need verification from a real email inbox.

## Reports on Vercel

The app is exported from `src/app.js`; the local listening server is not started on
Vercel. Files in `public` are served through Vercel's CDN. Runtime bundles include
the report worker and its dependencies.

The report submission route uses `waitUntil` to keep the invocation alive after
the immediate HTTP 202 response. The worker still runs in a separate Node thread.
Report claims and status are persisted in Supabase; conditional claims prevent
duplicate processing across scaled instances. Polling a queued job resumes it.
A processing claim older than six minutes can be reclaimed on a subsequent poll.

Function duration is five minutes; workers are stopped after four minutes so a
failed result can be persisted before the platform timeout. Reports exceeding this
limit need a separately provisioned durable worker/queue. The app's local startup
queue continues to be used when running outside Vercel.

IP rate limits are per running instance, not a shared cross-instance quota.
For strict global quotas at larger scale, provision a shared limiter or Vercel
Firewall rules. Vercel requests use its trusted proxy for network and HTTPS metadata.

## Verification

The deployed homepage, health API, Auth configuration, college catalog, event
page routing, and logo returned HTTP 200. Student/admin demo sign-in and access
restrictions passed. Hosted CSV, XLSX, PDF, and DOCX jobs completed and their private
signed downloads had the expected file signatures. The expired deployment-test
event was archived immediately and never accepted attendance.

The Windows native Vercel CLI could not run a local Express build because it was
missing its bundled `@vercel/express` package. Vercel's remote Linux build succeeded.

Use `npm test` for offline tests. Opt-in hosted smoke tests require local ignored
demo credentials. `TEST_BASE_URL` enables the API test;
`TEST_REPORT_BASE_URL` enables the report test, which creates an archived test event.
