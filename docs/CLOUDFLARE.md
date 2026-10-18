# Card-free Cloudflare deployment

Current deployment target, 18 October 2026: Cloudflare **Workers Free**, SQLite Durable Objects, static assets and Workers AI. The owner's authenticated dashboard shows Free ($0) as the current plan. No card, billing setup, paid upgrade, external model key, VM or paid fallback is part of this deployment. Public deployment and live model acceptance are pending account authorization; local tests do not establish a live service.

## Runtime

The thin Worker routes `/api`, `/api/*` and `/collaborate` to one stable `StudioAuthority` Durable Object. Other requests use the static assets binding. The object owns the same identity, project, session hash, invitation, membership, immutable version, history and AI usage tables as native Studio. A separate schema metadata table replaces unsupported `PRAGMA user_version`. `StoreCore` shares all domain operations; the adapter uses actual synchronous Durable Object SQLite transactions, not a Node SQLite compatibility stub. One authority preserves the current global capacity and collaboration ordering; this is a bounded portfolio deployment, not a claim of horizontal scale.

WebSockets use `WebSocketPair`, native hibernating acceptance and serialized session/project attachments. Reconstruction checks current sessions and permissions before restoring peers. Every message and broadcast rechecks canonical membership; role changes close existing connections. Cold restart persistence and reconnect have local workerd evidence. Forced platform hibernation is not claimed from a reconnect test.

Exports use exact build-time public runtime/core source bundled by `prepare-edge.mjs`. The pure generator emits the same locked independent application. Runtime files, credentials, `.env`, host filesystem access and arbitrary executable code are not bundled. Reviewed screenshot files are copied separately into static assets. Public assets permit CORS for the opaque sandbox preview; protected APIs have no public CORS header.

## Free limits and failure behavior

The dashboard currently lists 100,000 Worker requests/day, 10 ms outer Worker CPU/request, 100,000 Durable Object requests/day, 13,000 GB-s/day, 5 million SQL rows read/day, 100,000 rows written/day and 5 GB SQL storage. Workers AI has 10,000 neurons/day. Free quotas stop service when exhausted; no paid fallback or automatic upgrade is configured. Limits can change; verify the actual account plan before deployment.

Application defaults in `wrangler.jsonc` are more conservative: 64 MB logical database, 250 projects, 10 per identity, 50 versions and 1,000 history entries per project, 50 connections total and 5 per identity. The adapter rejects saved values over 600,000 UTF-8 bytes and bound writes over 1,800,000 bytes to stay below the platform's 2 MB row limit. Capacity errors retain saved work. Daily AI attempts are durably reserved before inference, with 20 global and 2 per identity and one concurrent request. Pseudonymous identities are not abuse-proof account verification; provider quotas remain the final cost boundary. No SLA or unlimited capacity is promised.

## AI

The only eligible configured model is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. It supports the reviewed JSON schema flow. The adapter bounds input/output, rejects incomplete, malformed, executable and foreign-project proposals, and has cancellation/deadline handling. Requests transmit the disclosed instruction, design layers/tokens and safe bindings; fictional ticket datasets, source drafts and server configuration are excluded. Valid output remains a proposal until the user reviews and accepts operation groups. No network tools or arbitrary model/provider selection is exposed to clients.

`AI_PROVIDER` remains `disabled` until Free-plan verification and controlled remote acceptance. Transport fixtures are automated tests, not live model quality evidence. A failed or quota-limited AI request never silently applies edits.

## Build and verify

```sh
npm ci
npm run build:edge
npm run verify:edge
npm run test:browser:edge
npm run verify:export -- --archive artifacts/edge-verification/<run>/export.zip
```

`verify:edge` runs the bundled Worker in actual workerd with SQLite Durable Object storage and isolated fictional data, including HTTP/WS permissions, two editors, presence, operation idempotency, undo, version restore, export and a cold runtime restart. The export command installs, builds and interacts with the exact received ZIP in Chromium. Reports are written under ignored `artifacts/`; CI uploads the reports. Local browser tests keep AI disabled. Windows paths containing `&` require the process-local npm shell setting described in the main README.

## Deployment and recovery

Use the pinned local Wrangler CLI and owner-authorized OAuth, preferably OS keyring storage. Grant only account/user read, Workers scripts write (including Durable Objects/subdomains) and Workers AI write as necessary. No DNS, billing, R2, KV, D1, Pages, certificate or all-product permissions are needed for this architecture. Never commit credentials. Run the build and verification gates before `wrangler deploy`, then verify the returned HTTPS URL, sessions, real browser edits, invitation/role boundaries, WebSockets, export and model review/apply publicly. GitHub deployment integration must be restricted to this repository and validated at the exact source revision.

Durable Object SQLite storage persists across code deployments. Native `.studio-data` files are not automatically imported into this separate backend. Existing local work is retained; exporting it is supported. Do not reset the namespace/migration or delete stored objects to redeploy. Browser recovery downloads remain available for manual reconciliation; they are not a server backup/import mechanism. Cloudflare point-in-time recovery is host-specific; production backup/restore acceptance is still pending and no public backup claim is made.

Primary references: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [SQLite Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [reviewed model](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/).
