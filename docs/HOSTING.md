# Hosting, portfolio entry and backups

The full Studio backend has not been externally deployed. This source snapshot documents local setup and requirements for a future hosting decision.

## What the full product needs

Studio uses one Node-compatible service for HTTP, authenticated project APIs and WebSockets, plus a writable SQLite directory. The built React client is served by that service. Deploying only dist removes collaboration, permissions, server persistence, AI and export generation.

Requirements:

- Node24.13+ with the repository source and locked npm dependencies; npm start currently uses tsx and must have that development dependency available.
- Persistent local storage for STUDIO_DATA_DIR. Preserve the full SQLite directory across process restarts/releases; ephemeral containers without a mounted volume lose documents and sessions.
- HTTPS for the browser origin and WebSocket upgrade forwarding for /collaborate. Set STUDIO_ORIGIN to the exact public origin so HTTP origin checks, live connections and Secure session cookies agree.
- A single writable Studio process for this SQLite/local room architecture. Multi-instance distribution/shared storage is not implemented; do not imply horizontal scaling support.
- Private server environment variables for optional model credentials/model. No keys enter browser code or the preview.

```powershell
npm ci
npm run build
npm start
```

Set PORT, STUDIO_DATA_DIR and STUDIO_ORIGIN in the hosting environment. The server defaults to a loopback binding; use STUDIO_HOST with the host’s required interface when an authorized deployment must accept a reverse proxy or container network. A non-loopback binding refuses startup without an explicit STUDIO_ORIGIN; that value must be an exact HTTP(S) origin with no credentials, path, query or trailing slash. This configuration check does not supply TLS. Do not use npm ci --omit=dev with the current startup command: tsx is required. Node24.13’s SQLite API is experimental and emits a warning; verify the selected runtime version rather than assuming newer Node documentation describes it identically. Official reference: [Node SQLite](https://nodejs.org/api/sqlite.html).

The local demo’s display names are not verified identities. The current product uses fictional fixtures and server-issued sessions, with locally tested capacity controls. Before a public service accepts real data, complete production identity/account recovery, host-specific security/recovery review and operational policies. This guide does not imply it already runs a production customer service.

## Implemented capacity and retention

[DEMO_LIMITS](DEMO_LIMITS.md) specifies default/range/environment values for projects, owned projects, immutable versions, history entries, SQLite main-database pages, live connections and AI attempts/concurrency. Limits are validated at startup. Database schema2 migrates schema1 additively; future schemas or existing databases above a newly configured page limit are refused with originals retained.

There is no automatic TTL, reset, pruning or deletion. Saved work remains readable/exportable at project/version/history count caps. Preserve this policy when planning retention; cookie expiry does not remove data. Increasing a limit should follow a private backup and available-storage review. A main-database page cap does not cap WAL/temp files or the whole disk. Deployments still need actual volume quotas, ingress/request rate limits, monitoring and a backup/restore process. The service supports one writable process; these caps are not distributed controls or a production-load guarantee.

Persistent global/user UTC-day AI reservations and an in-process concurrent-request gate bound provider attempts. Failed/cancelled attempts count conservatively. Keep live AI disabled or unconfigured until an explicit model, private key and provider-side spending policy are supplied. Request quotas are not dollar limits, and cancellation does not establish zero provider billing. No real-provider or hosted verification is claimed.

If a reverse proxy is introduced, configure only the necessary trusted proxy path and ensure forwarded headers are overwritten by that proxy. Express currently does not configure trust proxy; do not set it broadly without matching the actual host. See [official Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/).

## GitHub.io remains the entry point

[GitHub Pages is a static host](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages). Keep Debotaro’s existing portfolio intact. Add a project card with two links after their actual destinations exist:

- **Read the case study** → a static narrative/screenshot page on the portfolio, or the authorized Studio host’s /case-study path.
- **Open Studio** → the full Node-hosted product origin, with a private-demo entry.

Suggested card copy: “Debotaro Studio — a visual application builder with a documented React contract. Product direction and AI-assisted implementation by Debotaro.”

Use actual destinations after they exist. Source publication does not imply a hosted Studio demo. The React case-study component is in src/portfolio/CaseStudy.tsx; docs/CASE_STUDY.md is the portable narrative. A static portfolio can adapt that content and actual screenshots without pointing its browser at Studio APIs. An independently exported app can also be statically hosted after checking its own base path and source/licensing, but this does not host the Studio backend.

## Backup without silent data loss

1. Ask collaborators to finish/save pending work. Download recovery when the UI presents a conflict/recovery action; it includes local pending edits/drafts, so store it privately. Browser IndexedDB is separate from the server DB; a server backup does not include those drafts.
2. Stop Studio cleanly with Ctrl+C in its terminal. Copy the complete STUDIO_DATA_DIR to a user-chosen safe destination. Include any SQLite sidecar files that remain. Do not back up only the main file while writes are in progress.
3. Copy source, package.json, package-lock.json and environment-variable **names**/deployment configuration. Preserve secret values through the user’s private secret-management method, not repository docs or screenshots.
4. If desired, run `git bundle create <user-chosen-path> --all` after source checkpoints. The bundle excludes uncommitted files, ignored SQLite data and browser state.
5. Restore into a separate directory, npm ci, and point STUDIO_DATA_DIR at the restored copy. Confirm documents, roles, versions and collaboration recovery before replacing the working data directory.

There is currently no general recovery-file import UI or automated off-machine backup. Preserve downloaded recovery JSON for inspection/reconciliation rather than promising one-click restore. Corrupt/incompatible data should produce an error and retain the original; do not delete it to hide a failure. Local commits and files do not protect against workspace disappearance.

## Verify the hosted boundary

Use two isolated browsers to check invited editors/viewers, direct HTTP resource requests, WebSocket origin/authentication, live permission changes, reconnect/offline recovery and server restart. Check the opaque preview sandbox and independent ZIP download. Run a real AI proposal only when privately configured. Capture results with the exact code revision; no external hosting pass has been claimed.
