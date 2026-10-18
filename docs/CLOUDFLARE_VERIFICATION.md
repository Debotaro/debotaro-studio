# Cloudflare acceptance checkpoint — 18 October 2026

## Public core acceptance

The full core application is live at https://debotaro-studio.debotaro-studio.workers.dev. First deployed version: `5a020109-1746-4245-b9c3-988f619bd10e`, source `7223600ebbe9c6d46529ae7a02a2ef45e5a6db12`. All five jobs in [CI run 39088486853](https://github.com/Debotaro/debotaro-studio/actions/runs/39088486853) succeeded, including Windows/Linux, actual workerd and AMD64/ARM64 native containers.

Public acceptance passed **23/23 actual browser cases (3.7 minutes)** and **8/8 HTTP/WSS runtime groups**: real sessions and server-side projects, authentication/origin/CSRF, persisted WebSocket edits, invitation/viewer restrictions, live revocation, versions/history and actual server ZIP generation. The public ZIP (`19` files; no custom-code recovery was supplied) SHA-256 is `dc8a0cdb55ac8b4eafb9a415a4bb554665ec18e32a56b8242c48f116b3d3e75a`. It passed its own clean install/typecheck/build and 12 Chromium interaction groups without Studio API calls. The newly registered subdomain initially failed TLS; public tests were rerun successfully after certificate activation, with no validation bypass.

## Real model findings and correction

Workers AI was called through the local workerd adapter using the actual authenticated **Free** account, fictional data only. The first full live set achieved four ordinary tasks; two ordinary responses were malformed at the 2,048-token output bound, one adversarial request timed out, and an adversarial foreign-project response was correctly rejected with 403 (the initial harness incorrectly expected only 400). No failed request automatically changed the document.

The OpenAI-style required-null schema inflated small update responses. A Workers-specific compact schema now makes only the genuinely optional maps optional, while preserving required top-level/operation identity, closed objects and the same mandatory semantic validation. A regression checks that the native schema stays unchanged. With the compact schema, theme, heading, spacing, token and phone-layout tasks passed, as did both adversarial semantic refusals. A layer-name harness used nonexistent `workspace-label`; it was corrected to the actual `workspace-eyebrow`, and that sixth ordinary task passed on its own rerun. Ordinary successful outputs required explicit group acceptance and were read back from storage. These results are controlled small fixtures, not a general model-quality benchmark. Public model/UI acceptance of the compact release and persistence across its automatic deployment are still pending at this checkpoint.

## Initial local acceptance

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
