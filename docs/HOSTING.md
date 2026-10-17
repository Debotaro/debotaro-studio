# Hosting, portfolio entry and backups

The full Studio backend has not been externally deployed. On 17 October 2026 the user explicitly requested full ₹0 deployment, superseding the earlier choice to keep Studio local. The repository now includes a pinned container, persistent Compose service and a runtime CI gate. Oracle Always Free is a conditional target only: existing-account access, eligibility, regional capacity and a real host acceptance check are still required. No VM, public application URL or guaranteed zero-cost capacity is claimed.

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

## Container service

The Dockerfile pins the official `node:24.22.0-bookworm-slim` multi-architecture image to `sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5`, resolved from Docker Hub on 17 October 2026. The index includes Linux amd64 and arm64. The build executes a real in-memory `node:sqlite` query before building the client; the runtime CI probe repeats it inside the running image. SQLite is a release candidate in this selected Node24 release; the historical Node24.13 local baseline emits an experimental warning. See the [official image source](https://github.com/nodejs/docker-node/tree/main/24/bookworm-slim) and [Node24 SQLite reference](https://nodejs.org/docs/latest-v24.x/api/sqlite.html).

The allowlisted build context excludes `.env`, credentials, databases, browser profiles and historical verification exports. A Linux `npm ci` installs exactly the lockfile. The runtime retains tsx and the source files read by ZIP generation; removing those development dependencies or export sources breaks the current supported startup/export path.

With Docker Engine and Compose v2 installed, start a local fictional demo from the repository root:

```sh
STUDIO_ORIGIN=http://localhost:4173 docker compose up --build -d
STUDIO_ORIGIN=http://localhost:4173 docker compose ps
```

For PowerShell set `$env:STUDIO_ORIGIN='http://localhost:4173'` before running the same Compose commands. No environment file is required. Open exactly that origin. The container binds 0.0.0.0 internally; only `127.0.0.1:4173` on the host is published. `STUDIO_HTTP_PORT` changes the host port only; match it in the exact browser origin. The health endpoint is `/api/health` on internal4173.

The service runs as UID/GID1000, with all Linux capabilities dropped, no-new-privileges, a read-only root and a 64MiB `/tmp` tmpfs. SQLite and its WAL/SHM live in the project-scoped `studio-data` named volume at `/data`, initially owned by UID1000 from the image. A reused or manually created volume must have that ownership; do not make it world-writable to hide an error. CPU, memory, process and log bounds are explicit; the 768MiB service setting is a starting budget, not a load or model-serving measurement. This is one writable Studio process, not a distributed deployment.

`AI_PROVIDER=disabled`, blank paid-provider credentials and zero AI request quotas make the base service an editor/collaboration/export deployment. There is no silent paid fallback. The optional local-model deployment is documented separately after its provider and actual model acceptance checks; the base CI downloads no model and makes no inference requests.

For a real host, set `STUDIO_ORIGIN` to its exact HTTPS origin and put an HTTPS reverse proxy on the same host in front of the loopback port. Forward WebSocket upgrades at `/collaborate`, preserve the browser Host/Origin and serve the whole origin (no path-prefix rewriting). A proxy running in another container cannot reach this service through its own loopback; use an explicitly configured shared private network and remove the host port if that topology is chosen. Do not expose4173 publicly. TLS is supplied by the proxy, not Compose. Secure cookies are controlled by the explicit HTTPS origin; there is no need to enable broad Express trust-proxy. No Cloudflare tunnel or platform-specific port convention is required.

[Oracle's Always Free documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) is the source for the conditional target. Check the actual tenancy's Always Free resources and current availability before provisioning; do not enable a paid upgrade, billable resource or paid model to make the instructions succeed. A model server needs its own measured memory/storage budget beyond Studio's baseline.

## Runtime validation

```sh
# Real Docker build, start, health, isolation, workflow and persistence checks:
node scripts/container-smoke.mjs
# Same HTTP/WebSocket workflow probe against a local production Node process:
npm run build
node scripts/container-smoke.mjs --native
```

The Docker probe uses a random isolated Compose project, a temporary loopback host port and only fictional fixtures. It checks image UID/root/tmpfs/volume/health restrictions and `node:sqlite`, then the built page, unavailable AI, server-issued HttpOnly/SameSite session, project creation, CSRF/HTTP and WebSocket authentication, cross-project access, an authorized live edit, viewer write denial, immediate live revocation, independent ZIP content, and session/document/permissions/export after restarting the same volume. Cleanup removes only that random probe project's containers and fictional volume. Ordinary deployment commands do not remove the persistent service volume; never run `docker compose down --volumes` on data you need.

Results are written under ignored `artifacts/container-smoke/`. Reports include the exact source commit and whether its checkout was dirty; sessions and invitation secrets are not recorded. `--native` refuses a checkout `.env` and uses an allowlisted child environment. It establishes workflow behavior, not Linux container isolation. Native Windows termination is a process restart check, not a claim about Linux SIGTERM handling. CI runs both OS gates first, then this real Docker probe and uploads its bounded report/log artifact. A green build alone is not a deployed-host acceptance check. Consult [the current workflow](https://github.com/Debotaro/debotaro-studio/actions) for actual results.

## Implemented capacity and retention

[DEMO_LIMITS](DEMO_LIMITS.md) specifies default/range/environment values for projects, owned projects, immutable versions, history entries, SQLite main-database pages, live connections and AI attempts/concurrency. Limits are validated at startup. Database schema2 migrates schema1 additively; future schemas or existing databases above a newly configured page limit are refused with originals retained.

There is no automatic TTL, reset, pruning or deletion. Saved work remains readable/exportable at project/version/history count caps. Preserve this policy when planning retention; cookie expiry does not remove data. Increasing a limit should follow a private backup and available-storage review. A main-database page cap does not cap WAL/temp files or the whole disk. Deployments still need actual volume quotas, ingress/request rate limits, monitoring and a backup/restore process. The service supports one writable process; these caps are not distributed controls or a production-load guarantee.

Persistent global/user UTC-day AI reservations and an in-process concurrent-request gate bound provider attempts. Failed/cancelled attempts count conservatively. Keep live AI disabled or unconfigured until an explicit model, private key and provider-side spending policy are supplied. Request quotas are not dollar limits, and cancellation does not establish zero provider billing. No real-provider or hosted verification is claimed.

If a reverse proxy is introduced, configure only the necessary trusted proxy path and ensure forwarded headers are overwritten by that proxy. Express currently does not configure trust proxy; do not set it broadly without matching the actual host. See [official Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/).

## GitHub.io remains the entry point

[GitHub Pages is a static host](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages). The [Studio portfolio spotlight](https://debotaro.github.io/#studio) is now live with the actual product screenshot, [case study](https://github.com/Debotaro/debotaro-studio/blob/main/docs/CASE_STUDY.md) and [source](https://github.com/Debotaro/debotaro-studio) links. The original portfolio feature and all ten existing applications are preserved. The [existing build/test workflow](https://github.com/Debotaro/Debotaro.github.io/actions/runs/38741209874) gated publication; 507 browser cases passed with 8 existing opt-in/browser-specific skips, and all ten new Studio-entry cases passed across five browser projects.

There is no hosted Studio application URL. The latest explicit ₹0 deployment request authorizes preparing and verifying the full service. Verify the actual host, HTTPS, persistence and boundaries below before adding **Open Studio** to this existing spotlight. Keep the existing source/case links and private-demo entry; no second project card is needed.

The React case-study component is in src/portfolio/CaseStudy.tsx; docs/CASE_STUDY.md is the portable narrative. An independently exported app can also be statically hosted after checking its own base path and source/licensing, but this does not host the Studio backend.

## Backup without silent data loss

1. Ask collaborators to finish/save pending work. Download recovery when the UI presents a conflict/recovery action; it includes local pending edits/drafts, so store it privately. Browser IndexedDB is separate from the server DB; a server backup does not include those drafts.
2. Stop Studio cleanly with Ctrl+C in its terminal. Copy the complete STUDIO_DATA_DIR to a user-chosen safe destination. Include any SQLite sidecar files that remain. Do not back up only the main file while writes are in progress.
3. Copy source, package.json, package-lock.json and environment-variable **names**/deployment configuration. Preserve secret values through the user’s private secret-management method, not repository docs or screenshots.
4. If desired, run `git bundle create <user-chosen-path> --all` after source checkpoints. The bundle excludes uncommitted files, ignored SQLite data and browser state.
5. Restore into a separate directory, npm ci, and point STUDIO_DATA_DIR at the restored copy. Confirm documents, roles, versions and collaboration recovery before replacing the working data directory.

There is currently no general recovery-file import UI or automated off-machine backup. Preserve downloaded recovery JSON for inspection/reconciliation rather than promising one-click restore. Corrupt/incompatible data should produce an error and retain the original; do not delete it to hide a failure. Local commits and files do not protect against workspace disappearance.

## Verify the hosted boundary

Use two isolated browsers to check invited editors/viewers, direct HTTP resource requests, WebSocket origin/authentication, live permission changes, reconnect/offline recovery and server restart. Check the opaque preview sandbox and independent ZIP download. Run a real AI proposal only when privately configured. Capture results with the exact code revision; no external hosting pass has been claimed.
