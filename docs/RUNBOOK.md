# Local setup and operation

Run from the repository root with Node24.13+ and npm. Verified environment:24.13.0/npm11.6.2 on Windows. Exact versions are pinned/locked.

## Install and start

```powershell
npm ci
npx playwright install chromium
npm run dev
```

Open http://localhost:4173. One process serves HTTP/WebSockets and Vite. Choose Open your private demo. Production uses npm run build followed by npm start. Keep development dependencies: startup requires tsx. Stop with Ctrl+C. NodeSQLite experimental warning is expected.

Optional local environment file: Copy-Item .env.example .env. Names only: PORT, STUDIO_DATA_DIR, STUDIO_HOST, STUDIO_ORIGIN, OPENAI_API_KEY, OPENAI_MODEL. Never commit actual secrets. The default binding is loopback; exact origin/host spelling must match cookies and origin checks.

Binding outside loopback requires an explicit STUDIO_ORIGIN with an exact HTTP(S) origin and no credentials/path/query/trailing slash. It does not configure HTTPS for you. Capacity names in .env.example: STUDIO_MAX_DATABASE_MB, STUDIO_MAX_PROJECTS, STUDIO_MAX_PROJECTS_PER_OWNER, STUDIO_MAX_VERSIONS, STUDIO_MAX_HISTORY, STUDIO_MAX_CONNECTIONS, STUDIO_MAX_CONNECTIONS_PER_USER, STUDIO_AI_DAILY_REQUESTS, STUDIO_AI_USER_DAILY_REQUESTS, STUDIO_AI_CONCURRENT. Values are decimal integers; invalid values stop startup. See [DEMO_LIMITS](DEMO_LIMITS.md) for ranges/defaults.

SQLite schema2 additively migrates schema1 on startup; the application-document schema remains1. Back up the complete stopped data directory before upgrading. No automatic pruning/TTL/reset deletes existing work. At a project/version/history cap, open or export saved work and preserve browser recovery before requesting increased capacity. At storage capacity, stop Studio and back up the full directory/remaining sidecars before reviewing available volume space or restoring a verified separate backup. Do not delete data or bypass validation to hide the error. The logical-page limit excludes WAL/temp files; actual host volume/ingress policy is separate.

## Verification commands

```powershell
npm run typecheck
npm run lint
npm test
npm run build
$env:STUDIO_TEST_PRODUCTION='1'
npm run test:browser
Remove-Item Env:STUDIO_TEST_PRODUCTION
npm run benchmark
npm run benchmark:browser
npm run verify:export
```

Production browser tests require the fresh build and own4183/isolated artifacts/browser-data. Browser benchmark owns4188 and requires a Git checkout/build. Do not overlap those runners on the same ports. Export verification installs/builds/starts a fresh independent project, exercises Chromium, verifies ZIP/file bytes and stops its own preview. Raw outputs go into ignored artifacts and may contain local paths or session capabilities; do not publish them unchanged.

## Demo and safe reset

Follow [DEMO_SCRIPT](DEMO_SCRIPT.md). Project → + New private demo creates an isolated starter and preserves earlier shared projects. Reload retains selected project and recoverable drafts. Server restart retains SQLite state. Invalid code keeps the valid preview. Stale/structural conflicts require inspection; download recovery before discarding work. Workspace guide → Download project recovery is available even without a visible conflict. It preserves draft/queue data for manual reconciliation, not a one-click project import.

## Verify the independent export

Extract [export-example.zip](export-example.zip) into a new directory. Run these commands from that new directory:

```powershell
npm ci
npm run typecheck
npm run build
npm run preview -- --port 4191 --strictPort
```

From the Studio repository in another terminal:

```powershell
npx tsx tests/export/verify-interactions.ts http://127.0.0.1:4191 artifacts/manual-export-browser --numeric-tokens
```

Or run the integrated npm run verify:export. The generated application needs no Studio server/account/key. Outside code is nonexecuted recovery text.

## Private backup and separate restore

Stop Studio cleanly first. Choose a private destination outside the checkout. These commands prompt for actual paths and refuse an existing backup directory:

```powershell
$studioRoot=(Get-Location).Path
$studioBackupRoot=Read-Host 'New absolute private backup directory'
New-Item -ItemType Directory -Path $studioBackupRoot -ErrorAction Stop
$studioBackupSource=Join-Path $studioBackupRoot 'source'
robocopy $studioRoot $studioBackupSource /E /XD node_modules dist artifacts test-results playwright-report /XF .env
if ($LASTEXITCODE -gt 7) { throw 'Source backup failed' }
git bundle create (Join-Path $studioBackupRoot 'history.bundle') --all
```

This copies default .studio-data including remaining SQLite sidecars. If STUDIO_DATA_DIR points elsewhere, separately copy that complete private directory. Preserve environment secrets by your private method; .env is excluded. Download browser recovery JSON to the private backup because browser cookies/IndexedDB are not in the source/data copy or Git bundle. Local Git/files alone are not off-machine backup.

Restore to a NEW destination:

```powershell
$studioRestoreRoot=Read-Host 'New absolute restore directory'
if (Test-Path -LiteralPath $studioRestoreRoot) { throw 'Use a new destination' }
Copy-Item -LiteralPath $studioBackupSource -Destination $studioRestoreRoot -Recurse
Set-Location -LiteralPath $studioRestoreRoot
npm ci
npm run build
npm start
```

For external data set STUDIO_DATA_DIR to the restored copy. Verify projects/roles/versions/reconnect before replacing any working data. Existing pseudonymous sessions may need original browser cookies. A new origin does not inherit cookies/IndexedDB; preserve and manually reconcile recovery JSON. Retain corrupt/incompatible originals until a replacement is verified. These instructions do not claim an off-machine backup or hosted restore was performed.

## Pending live-provider checks

Privately configure OPENAI_API_KEY and explicit OPENAI_MODEL for a model supporting strict structured Responses output; restart. Request the assignment-panel example, inspect transmission disclosure, reject one real proposal, then request/accept a dependency-valid subset and undo. Verify real cancellation/timeout/refusal/malformed/stale output, revoked permission during inference and inaccessible-resource attempts. Record sanitized model/source/time/results, never key values. These checks were not run without application configuration; fixtures do not satisfy them. [VERIFICATION](VERIFICATION.md) states current evidence.

Choose global/user UTC-day attempt limits and concurrency before using a hosted key; zero daily allowance disables proposals. Failed/cancelled attempts retain their reservation and counts survive restart. Request counts are not a monetary guarantee: configure provider-side spending controls separately. Never disclose key values in commands, captured output or browser messages.
