# Fictional-demo capacity and retention

Studio implements server-owned capacity controls for its isolated fictional demo. Cookie-based identity is pseudonymous and does not provide verified-account recovery. These controls are locally tested; they do not mean an external service has been deployed or a real model provider has been verified.

## Configuration

`server/limits.ts` defines `DemoLimits`, frozen `DEFAULT_DEMO_LIMITS`, `resolveDemoLimits`, `limitsFromEnv` and `LimitError`. Values must be finite safe integers within the ranges below. Unknown override keys are rejected. Environment values must contain decimal digits; empty/unset uses defaults, while invalid, fractional, negative, exponential or infinite values stop startup. There is no public policy-override endpoint.

| Setting | Default | Allowed range | Environment variable |
|---|---:|---:|---|
| Main database bytes |268435456|65536–4294967296 through the internal interface|STUDIO_MAX_DATABASE_MB (integer MiB,1–4096)|
| Total projects |1000|1–100000|STUDIO_MAX_PROJECTS|
| Projects per owner |20|1–1000|STUDIO_MAX_PROJECTS_PER_OWNER|
| Versions per project |100|1–10000|STUDIO_MAX_VERSIONS|
| History entries per project |10000|1–1000000|STUDIO_MAX_HISTORY|
| Live connections |100|1–10000|STUDIO_MAX_CONNECTIONS|
| Live connections per user |5|1–100|STUDIO_MAX_CONNECTIONS_PER_USER|
| AI attempts per UTC day |100|0–100000|STUDIO_AI_DAILY_REQUESTS|
| AI attempts per user per UTC day |10|0–10000|STUDIO_AI_USER_DAILY_REQUESTS|
| Concurrent AI requests |2|1–100|STUDIO_AI_CONCURRENT|

`createStudioServer({directory, origin?, allowDevSocket?, limits?, now?})` normalizes supplied policy; the entry point reads environment policy after optional `.env` loading. Tests can supply small limits and a deterministic clock. Binding outside loopback requires `STUDIO_ORIGIN`, an exact HTTP(S) origin without path, query, credentials or trailing slash. The configured public host still needs HTTPS and WebSocket forwarding.

## Persistence and data preservation

SQLite schema2 adds `ai_usage(scope TEXT PRIMARY KEY, day INTEGER NOT NULL, requests INTEGER NOT NULL)` additively to schema1. The application-document schema remains version1. Existing documents, sessions, history and immutable versions are retained. Future database schemas are refused while retaining the original files.

SQLite `max_page_count` bounds logical main-database pages. Startup refuses an existing database already above the configured page limit and explains recovery; it does not delete saved work. This is not a whole-disk, WAL, temporary-file, memory or CPU quota. An actual host still needs volume and ingress controls.

Project creation checks total/owner counts in its transaction before inserting the project and Starting point version. New demo or invitation identities/sessions share the transaction, so rejected requests leave no orphan identity or new cookie. The version cap includes Starting point. The history cap includes ordinary edits, undo, restore and accepted AI changes. An over-capacity edit is rejected before canonical/CRDT mutation; already-committed idempotent retries still return their result.

Saved data above a newly reduced count limit remains readable/exportable. There is **no automatic pruning, project reset, TTL deletion or silent eviction** of versions/history. Cookie expiry does not delete documents. Failed writes preserve the original storage error even when SQLite has automatically rolled back. `SQLITE_FULL` becomes an actionable storage-capacity response (HTTP507); failed candidate CRDT state is destroyed instead of applied.

## AI allowances and live connections

`Store.reserveAI(userId, now)` atomically reserves global and user UTC-day counters. One mutable row per scope stores no prompts, tokens or ticket contents. Counts survive restart; moving the clock backward does not reset a future bucket. Zero disables live proposals. Failed/cancelled provider attempts retain their reservation because cancellation cannot establish zero provider billing.

Denied permission/schema/stale/no-key/context requests do not consume an allowance. An in-process concurrent-request gate releases in `finally` after completion/error/cancellation. Existing provider input/output/timeout/zero-retry bounds remain. **Request quotas are not a monetary spending guarantee**; a hosted provider key still needs provider-side spending controls. Live inference remains unverified without private application credentials and an explicit model.

Recovered day/count values must have integer storage types and be nonnegative safe integers. Malformed counters return503/AI_USAGE_RECOVERY before model execution, retaining original records for deliberate operator repair or verified restore. Unsafe SQLite integers are read as text before validation so Node conversion cannot mask that recovery error. Invalid records are never silently reset into a fresh allowance.

Authorized WebSocket upgrades check total/user live counts before computing initial CRDT state; excess upgrades receive HTTP429. Closing a connection frees capacity. Authentication, origin and role checks precede the count limit; quotas never grant access. HTTP errors retain `{error:string}` and may include `{code:string}`. WebSocket operation errors retain operation IDs for offline recovery. Existing read/export and role enforcement remain available at project/version/history count caps. Storage exhaustion may also block new session/metadata writes.

## Local evidence and operator response

Automated checks cover strict configuration, real HTTP/WS project/version/history limits, unchanged state after refusal, idempotency/convergence/read/export, additive migration/restart/storage exhaustion, daily reservation persistence/rollover/zero bounds, unauthorized/no-key nonconsumption, live connection release and startup origin validation. AI route tests use explicitly identified fixtures, not live inference. See [verification](VERIFICATION.md) for dated results.

At capacity, preserve saved data and browser recovery first. Stop Studio, make a private complete data-directory backup, then choose additional capacity or restore a separately verified backup; do not delete databases or disable validation to hide an error. See [RUNBOOK](RUNBOOK.md) and [HOSTING](HOSTING.md). No automatic off-machine backup, distributed quota, public ingress rate limiter, verified identity, external hosting or production-load guarantee is implemented.

Official references: [SQLite max_page_count](https://www.sqlite.org/pragma.html#pragma_max_page_count), [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/). Installed Node24.13 typings and actual SQLite tests establish this runtime's behavior; newer Node documentation must not be assumed to match it.
