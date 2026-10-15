# Debotaro Studio

A visual application builder that connects structured design, a documented React/TypeScript subset, collaborative editing and independent export. Its starter is a functioning fictional customer-support workspace.

**By Debotaro — Digital Designer | AI-Assisted Product Design & Development.** Debotaro defined the product direction, audience, requirements and visual goals. Implementation was developed with Codex through scoped tasks, contracts, review and executable verification. No interviews, adoption, business impact or manual authorship of every line is claimed.

![Actual Studio editor with a layer tree, visual support workspace and contextual inspector](docs/screenshots/editor-desktop.png)

[Case study](docs/CASE_STUDY.md) · [Design direction](docs/DESIGN_DIRECTION.md) · [Architecture](docs/ARCHITECTURE.md) · [Verification](docs/VERIFICATION.md) · [Signature demo](docs/DEMO_SCRIPT.md)

## Run locally

Use Node24.13+ and npm. Verified environment: Node24.13.0/npm11.6.2 on Windows. Direct dependencies are pinned and transitive versions locked.

```sh
npm ci
npm run dev
```

Open http://localhost:4173 and choose **Open your private demo**. One command starts HTTP, WebSockets and Vite. Project → + New private demo creates an isolated starter. The case study is available locally at /case-study. These local addresses are setup instructions; there is no externally hosted Studio demo at this checkpoint.

Optional: copy .env.example to .env and configure it privately. Names: PORT, STUDIO_DATA_DIR, STUDIO_HOST, STUDIO_ORIGIN, OPENAI_API_KEY, OPENAI_MODEL. The default host is loopback; host spelling/origin must agree. Editor/export need no paid services. Real AI requires a separately configured application API key and explicit compatible model. ChatGPT model selection/subscription supplies neither.

## Implemented

- Palette/layers, canvas, contextual inspector, structured responsive flex/grid layouts, primitive/semantic color and numeric tokens, themes, CodeMirror and desktop/tablet/phone preview. Insertion, selection, nesting, reordering, resizing, alignment, copy/paste, duplication, deletion, zoom/pan and actor-safe undo/redo have visible or keyboard controls.
- A modern minimalist interface with automatic canvas fitting, retained manual zoom, Ctrl/Cmd+K layer search, a compact workflow guide, readable inspector groups/help and focused phone panels. The editor theme remains separate from the application theme.
- Shared catalog: frames, text, buttons, fields, selects, tabs, badges, tables and detail panels. Fictional tickets support working search, filtering, selection, assignment/status, activity and loading/empty/error/retry states.
- Babel AST import and deterministic generation for the [supported TSX subset](docs/SUPPORTED_CODE.md), stable identities/locations and inspected revision-aware changes. Invalid drafts retain the last valid preview. Outside handwritten source is recoverable text and is not executed in Studio/export.
- Server-issued pseudonymous sessions, ownership/editor/viewer permissions, invitations, Yjs collaboration/presence, conditional field merging, offline queues/reconnect, SQLite persistence, immutable versions and inspected restore. HTTP/WebSocket permission changes are enforced on live connections and reconnects. See [collaboration](docs/COLLABORATION.md).
- Strict configurable [demo capacity](docs/DEMO_LIMITS.md): project/owner/version/history bounds, SQLite logical-page limit, live-connection limits and persistent UTC-day AI attempt/concurrency controls. Existing work is retained at count limits; no automatic pruning or deletion. These controls do not replace ingress/volume/provider spending policies on an actual host.
- A real server-side OpenAI Responses adapter, bounded structured operation proposals, explicit grouped review, dependency/permission/revision checks, cancellation/timeouts and non-live evaluations. **Live provider inference, schema acceptance and model quality remain unverified without application configuration.** Fixtures are tests only.
- Complete React/TypeScript ZIP exports with the shared runtime, assets/tokens, exact dependencies/transitive lockfile and setup README. A [verified example](docs/export-example.zip) can run independently of Studio.

The product is a working local portfolio prototype. Arbitrary JavaScript/custom components do not round-trip. Demo identities are pseudonymous; verified-account recovery and live customer connectors remain future work. Label/contrast diagnostics and scoped keyboard checks are not accessibility certification. Browser recovery JSON supports manual reconciliation; general recovery-file import is not implemented.

## Verify

```powershell
npx playwright install chromium
npm run typecheck
npm run lint
npm test
npm run build
$env:STUDIO_TEST_PRODUCTION='1'
npm run test:browser
Remove-Item Env:STUDIO_TEST_PRODUCTION
npm run verify:export
npm run benchmark
npm run benchmark:browser
```

The latest15 October2026 capacity pass passed302 unit/integration tests, lint/typecheck/build and all23 production browser tests on the final source. The preceding usability pass and historical clean independent export verification are distinguished in [verification](docs/VERIFICATION.md). The browser suite owns isolated4183; browser benchmark owns4188 and requires a fresh build. Raw logs/browser state/databases are not distributed. [Performance](docs/PERFORMANCE.md) gives exact fixtures, hardware, budgets and observed timings; browser measurements include automation/network/DOM observation. The deferred AST importer still emits its bundle-size warning.

## Hosting and recovery

```sh
npm run build
npm start
```

Full Studio requires a Node HTTP/WebSocket service and writable persistent SQLite storage. A static GitHub Pages deployment cannot run its backend. Startup uses tsx, so keep development dependencies installed. Node24 SQLite is experimental; the warning is documented. One writable process is supported. Binding outside loopback requires an exact STUDIO_ORIGIN; review the capacity names in .env.example and [demo limits](docs/DEMO_LIMITS.md). SQLite schema2 additively migrates existing schema1 data; the application document remains schema1. No full-backend external deployment has been performed. [Hosting](docs/HOSTING.md) explains how to keep the existing GitHub.io portfolio separate and link source/case study before a hosted demo exists.

Server data defaults to .studio-data; browser drafts/queues use IndexedDB. Workspace guide → Download project recovery preserves browser work for manual reconciliation. Stop Studio before copying the full server data directory and SQLite sidecars. [Runbook](docs/RUNBOOK.md) includes reset, export and private backup/restore instructions. Local files/commits are not an external backup.

## Source and attribution

The [source](https://github.com/Debotaro/debotaro-studio) and [case study](https://github.com/Debotaro/debotaro-studio/blob/main/docs/CASE_STUDY.md) are published on GitHub. Source publication does not host the Studio backend; no live Studio deployment has been performed. The source is available for inspection with package metadata UNLICENSED; no separate project license or permissive grant has been selected. Third-party software retains its own licenses/notices. [Attribution](docs/ATTRIBUTION.md) documents authorship, Figma inspiration, fictional data and dependencies. [Decisions](docs/DECISIONS.md) and [contracts](docs/CONTRACTS.md) explain the system boundaries.

The [Studio spotlight on Debotaro's portfolio](https://debotaro.github.io/#studio) is live with an actual running-product capture and source/case links, preserving all ten existing portfolio applications. The user chose to keep Studio local for now. The [portfolio release checks](https://github.com/Debotaro/Debotaro.github.io/actions/runs/38741209874) passed 507 browser cases with 8 existing opt-in/browser-specific skips; all ten new Studio-entry cases passed. This static portfolio entry does not deploy the Studio backend or enable live AI.
