# Cloudflare acceptance checkpoint — 18 October 2026

Local Windows Node 24.13.0 verification, before account deployment:

- Lint, native TypeScript and separate Worker TypeScript: pass.
- Unit/integration suite: **355 passed in 25 files**. Includes 12 Workers AI transport fixtures; no live model inference is represented by those fixtures.
- Built Worker: **2,643.60 KiB raw / 453.44 KiB gzip** at this checkpoint; build-time source JSON and 24 static files prepared. This dry-run uploads nothing.
- Actual workerd + SQLite Durable Object black-box probe: **12 passed**. HTTP/session/schema/CSRF/origin boundaries; real WebSocket upgrades, two editors and presence; operation idempotency; viewer HTTP/WS denial; undo/history/version restore; live revocation and invitation invalidation; server ZIP; cold runtime restart retaining roles, versions, history and sessions; atomic capacity refusal preserving work and not issuing a new identity/session.
- Actual Chromium browser suite against Wrangler's local Worker/static runtime: **23 passed, 1.0 minute**. Includes offline recovery, two isolated collaborators, code review/recovery, visual editing, responsive tokens, sandbox preview, real downloaded ZIP and desktop/phone case study images.
- Exact ZIP obtained from the workerd API: clean `npm ci`, typecheck, production build and **12 interaction groups** in the independent built application passed, including phone no-overflow and no Studio API calls. Report: `artifacts/export-verification/2026-10-18T01-56-09-996Z-fa4c26cb/report.json`. ZIP SHA-256 is recorded in that report and the matching runtime report. This archive is distinct from the checked-in historical native example.

Initial browser acceptance failed because public static asset CORS and case-study image copying had been omitted from the migration. Both implementation defects were fixed; the complete 23-case rerun passed. Failures were not counted as passes.

Actual account dashboard: **Workers Free ($0), Current plan**. No billing/upgrade was activated. Local AI is disabled; no provider request was made. Public URL, edge CPU limits under real traffic, remote model schema/quality, platform hibernation, public restart/backup recovery and GitHub deployment integration still require separate acceptance. This file does not claim them complete. GitHub CI at the published source revision is authoritative for remote build/test results.

Run `npm run build:edge && npm run verify:edge && npm run test:browser:edge` to reproduce. CI also runs the received export through clean installation/build/browser execution. Private fixture SQLite and session data remain under ignored `artifacts/`, never in the repository.
