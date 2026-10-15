# Verification scope and provenance

This selective public source snapshot was prepared15 October2026 from the locally verified product. Product behavior in src/core, src/compiler, src/runtime, src/editor, server and tests is retained; the only source adaptation is case-study narrative pointing to this public document. Package root license metadata and public documentation were adapted. Private prompts, implementation notes, database/browser state and raw logs are not part of this snapshot.

## Historical executed evidence —14 October2026

The original local product-source checkpoint c14adca and final documentation checkpoint3f25329 recorded these actual results. Those short hashes identify local provenance; they are not asserted to be commits in this public repository.

| Check actually run | Result | Scope |
|---|---|---|
| npm run lint | PASS | Root meaningful checks retained |
| npm run typecheck; npm run build | PASS |2087 modules; deferred AST importer563.45kB warning retained |
| npm test | PASS |236 tests across18 files |
| Production npm run test:browser | PASS |19 tests49.2s: visual/code/recovery/version/export; two browsers/offline/permissions; numeric tokens/actions; public page/keyboard/phone |
| Scoped portfolio recapture | PASS |3 tests; render/image-ready actual desktop/phone captures inspected |
| Dev phone smoke | PASS |1 test |
| npm run verify:export | PASS |Fresh npmci/typecheck/build/start/Chromium,22-file ZIP equality, no Studio API/browser errors, owned preview stopped |
| npm run benchmark | PASS |Six100/500/1,000-node broad/balanced fixtures; semantic round trips and preselected budgets |
| npm run benchmark:browser | PASS |Six fixtures,72 measured samples/18 warmups, no errors; all budgets passed |

ZIP example SHA256:0b85d4a7256808d83495a903f07c764f3a8b13a05130d9060eb49b36b8a452fa. Its critical runtime/compiler/export source hashes were checked against the passing master report. Public examples are fictional. Raw reports remain local provenance, not downloadable links. Reproduction commands live in [RUNBOOK](RUNBOOK.md); [PERFORMANCE](PERFORMANCE.md) gives machine/shape/measurement boundaries and actual values. Browser timings include automation/network/DOM observation, not intrinsic paint/input latency or a production load guarantee.

The suite covers document invariants/migration/atomic refusal, token graph/responsive aliases, semantic TSX round trips/stable identities/refused constructs/source preservation/draft recovery, shared runtime DOM interactions, HTTP/WS authorization/revocation/server restart/corruption isolation, actual two-browser concurrent/offline convergence/actor-safe undo, inspected version restore and non-live AI schema/proposal/dependency/stale/cancellation fixtures. Recovery regressions preserve raw bad records, permit healthy canonical data, use actual server undo transactions for redo and retain unfinished source across restore.

## Fresh selective-snapshot checks —15 October2026

The selective snapshot was installed and checked on15 October2026 at10:15 IST, using Node24.13.0/npm11.6.2 on the same Windows workstation. These are fresh executions, distinct from the historical browser/export results above.

| Command | Actual snapshot result |
|---|---|
| npm ci --no-audit --no-fund | PASS;315 locked packages installed |
| npm run typecheck | PASS |
| npm run lint | PASS |
| npm test | PASS;18files/236tests,2.75s |
| npm run build | PASS; includes another typecheck; deferred importer563.45kB warning remains |

No production browser, export master or benchmark was rerun for this documentation/metadata packaging step. Corresponding historical evidence is identified above; it is not represented as a fresh public-snapshot run. Private-root product files and metadata were not changed. Snapshot core/compiler/runtime/server/editor/test source bytes were compared with the original; only the explicitly documented case-study narrative differs. Generated dependencies/build/test artifacts are ignored and excluded from the publication manifest.

## Explicitly unverified

No real model provider was configured. The actual server Responses adapter/review/permission/limits/evaluation code is implemented and non-live checks pass, but live inference, provider schema acceptance, model quality, real partial accept/reject/cancel/timeout/stale/revocation journeys remain NOT RUN. See the exact pending-provider instructions in RUNBOOK.

The backend has not been externally hosted. Production operations, verified-account identity/account recovery, live customer connectors, broader custom code and user research remain future work. Diagnostics/scoped keyboard checks are not complete accessibility certification. No interviews/testimonials/adoption/business impact or generalized performance claims are invented.
