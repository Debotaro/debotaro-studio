# Decisions

## D001 — 2026-10-14 — independent local repository
Created as an independent application. The existing portfolio remains separate; hosting requirements are documented in HOSTING.md.

## D002 — 2026-10-14 — React/Vite + one Node service
Depart from preferred Next: client-heavy editor/no SSR need, single Node service embeds Vite + auth/realtime. Next+separate realtime adds second routing/build boundary. Independent export uses same bundler. Node24 built-in SQLite avoids native add-on Windows installation; experimental status documented. IndexedDB + Yjs retained.

## D003 — 2026-10-14 — managed TSX / catalog
JSON props/allowlisted actions; AST interpretation/no eval. Preserve custom source outside region and export as nonexecuted text until future custom-code workflow. See SUPPORTED_CODE.md. Limited honest bidirectionality, runnable managed React.

## D004 — 2026-10-14 — validated server-produced CRDT
Clients submit typed ops; permission/revision/whole-document validation precedes Yjs transaction. Raw client binary updates forbidden. Avoid invalid trees/permission bypass. Stale independent field merges need preconditions; structural batches refused. Conditional undo protects others. Implemented and locally tested; detailed contract docs/COLLABORATION.md, evidence VERIFICATION.

## D005 — 2026-10-14 — production sandbox assets
Real production benchmark found opaque-origin preview module/CSS loads failing CORS. Public built /assets receive cross-origin loading permission; protected API/auth/document routes never receive that header. Source+nonce messages still validated and no imported JS evaluated. Actual production journey/measurements verify this boundary.

## D006 — 2026-10-14 — numeric token aliases
Close original design-system scope gap by extending v1 scalar fields with typed numeric token references. Existing literals/snapshots/migration remain compatible; aliases resolve through validated graph and retain existing numeric constraints. Supported-code revision1.1; no arbitrary CSS expressions. See CONTRACTS rather than duplicating rules. Prior color-only documentation superseded when integration is verified, not treated as a permanent scope reduction.

## D007 — 2026-10-14 — lazy source tooling and reviewed regions
Pure validated IR generation does not load Babel. Actual source review/recovery uses the strict AST wrapper; CodeMirror and importer load on demand. Reviewed outside strings live separately from generated managed code and survive reload/visual revisions. Reduces initial editor loading without weakening syntax refusal. React lazy/Suspense follows https://react.dev/reference/react/lazy; initial App chunk137.56kB vs prior combined1113.90kB (different shared/deferred chunks, not a total-download claim). Deferred importer563.45kB still warns; threshold remains unchanged. See CONTRACTS.md and the compiler tests.

## D008 — 2026-10-15 — clarity-led editor design
Use a modern minimalist professional SaaS direction: light neutral chrome, restrained violet, readable controls and focused mobile panels. The editor is a precision workspace; visual effects should support orientation and feedback. Automatic width fitting addresses clipped initial canvases, while explicit zoom remains under user control. A working layer-search shortcut, compact workflow guide and readable inspector groups improve navigation without hiding the component catalog or changing document semantics. See [DESIGN_DIRECTION.md](DESIGN_DIRECTION.md).

Alternatives considered include decorative glass, persistent 3D and animation-heavy chrome; they would consume working space and compete with the application being edited. This direction is a reasoned design choice, not an empirically proven best design. Scoped browser checks verify behavior; first-time-user research and full accessibility assessment remain future work. The current larger-fixture workflow measurements pass their budgets but do not show a speed improvement over the previous run.
