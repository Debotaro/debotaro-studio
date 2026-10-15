# Verification scope and provenance

This selective public source snapshot was prepared15 October2026 from the locally verified product and updated with the usability pass described below. Current core, compiler, runtime, editor, server and test source is retained; the only source adaptation relative to that current product is case-study narrative pointing to this public document. Package root license metadata and public documentation were adapted. Private prompts, implementation notes, database/browser state and raw logs are not part of this snapshot.

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

## Usability pass — 15 October 2026

This update changes editor navigation, inspector presentation and interface styling; it adds a canvas-fitting hook and four browser regressions. It does not change schema, compiler, runtime, server, dependencies or lockfiles. The five updated source/test files were copied byte-for-byte into this snapshot and compared. The case-study narrative adaptation remains preserved.

| Executed product check | Actual result and scope |
|---|---|
| npm run lint; npm run typecheck; npm test | PASS;236 tests across18 files |
| npm run build | PASS; initial App143.79kB/43.31gzip, deferred importer563.45kB/131.08gzip; importer warning retained |
| Production npm run test:browser | PASS;23 tests57.9s, including four new usability regressions and existing visual/code/collaboration/recovery/export checks |
| Focused production browser rerun | PASS;5 tests10.3s after the final compact phone-guide and initial phone-preview refinements; the whole23-test suite was not rerun after those two refinements |
| npm run benchmark:browser | PASS;6fixtures,72 retained samples/18warmups, zero reported errors; worst observed p95344.733ms including automation/network/DOM observation |
| Export source comparison | PASS; all20 critical source hashes still match the passing14 October clean independent-export master; no new clean export installation is claimed |

The first broad browser attempt failed four checks because two controls had the same Workspace guide name. The duplicate control was consolidated and the unchanged checks passed in the subsequent full23-test run. No failing assertion was disabled. Actual desktop/phone layouts and inspector states were inspected. These are scoped local observations, not user-research results or accessibility certification.

The final public-copy checks ran on15 October2026 at13:12–13:13 IST with the existing pinned installation; no dependency installation or change was needed:

| Public-copy command | Actual result |
|---|---|
| npm run lint | PASS |
| npm run typecheck | PASS |
| npm test | PASS;236 tests/18 files,12.82s |
| npm run build | PASS;2088 modules, App143.79kB/43.31gzip; deferred importer warning retained |

No public-copy browser service or export master was started for this packaging step; the product browser evidence applies to the compared source files. Raw logs remain outside the public tree. Generated dependencies/build/test files remain ignored and are not publication content.

## Capacity pass — 15 October 2026

The latest update adds strict server capacity policy, additive SQLite schema2 migration, persistent global/user UTC-day AI attempts, process-local AI/connection gates and exact-origin startup validation. An editor message explains daily AI request limits and cancellation accounting. The application-document schema, compiler, runtime, dependencies and lockfiles are unchanged. Eleven approved code/test/environment-example files were compared byte-for-byte with the tested product source; the public CaseStudy narrative adaptation and UNLICENSED metadata remain preserved.

| Final product check actually run | Result |
|---|---|
| npm run lint; npm run typecheck; npm run build | PASS at13:45 IST; App143.96kB/43.39gzip; importer563.45kB warning retained |
| npm test | PASS at13:45 IST;301 tests/21 files,3.14s |
| Production npm run test:browser | PASS at13:47 IST; all23 tests54.8s on final source, including real two-browser/offline/permission/recovery/source/export journeys |
| npm run benchmark:browser | PASS at13:47–13:48 IST;6fixtures/72samples/18warmups, no errors, worst p95173.552ms including automation/network/DOM; owned service stopped |
| Export-critical source comparison | PASS; all20 current source hashes match the existing passing14 October clean-export master; no new independent installation is claimed |
| Local data-directory restart | PASS; stopped service and copied the complete existing data directory locally before restart; schema1 migrated to2 with document/version/history digests and identity/project/membership counts unchanged |

The65 added tests include47 strict-policy cases,15 actual HTTP/WS/SQLite capacity boundaries and3 startup checks. Boundaries cover project/owner/version/history caps, atomic refusal and retained export/read access, idempotency/convergence, live connection release, additive database migration/restart, storage exhaustion, daily AI reservation persistence/rollover and denied/no-key nonconsumption. AI route fixtures explicitly mock the provider; they are not live inference. A new AI-context fixture initially exceeded the existing4000-character property limit; it was corrected to35 valid4000-character Text nodes. No production validation or meaningful assertion was disabled.

Fresh checks of this public copy ran at13:50–13:51 IST using the existing pinned installation, without an install or dependency changes:

| Public-copy command | Actual result |
|---|---|
| npm run lint | PASS, exit0 |
| npm run typecheck | PASS, exit0 |
| npm test | PASS;301 tests/21 files,3.90s, exit0 |
| npm run build | PASS; App143.96kB/43.39gzip; deferred importer warning retained, exit0 |

The restarted local service returned healthy status. Manual browser inspection recovered the existing Live20-layer project and confirmed the AI limit disclosure and disabled no-key state. The local data copy is not an off-machine backup or a hosted disaster-recovery test. Raw logs/reports/data remain outside the public tree. The public packaging step started no browser service or independent-export installation. Existing clean-export evidence is historical; the capacity changes do not modify compiler/core/runtime/export sources. The current full browser suite does exercise generated ZIP behavior, but that is distinct from a new clean installation. Performance comparisons are observations on a shared workstation, not an optimization claim. Actual host operation, ingress/whole-volume limits, verified identities/account recovery, provider-side dollar controls and live inference remain unverified.

## Final ledger recovery verification — 15 October 2026, 18:25 IST

The final review added one recovery regression after finding that malformed persisted AI counters could bypass intended allowance handling. A real test then exposed Node's unsafe-integer conversion throwing before JavaScript validation. The ledger now reads values as text with SQLite storage types, rejects invalid/negative/fractional/unsafe counters with503/AI_USAGE_RECOVERY, retains original records and never calls the model. The16-case boundary suite exercises actual authenticated HTTP refusals for16 corrupt field/scope fixtures, intact design/CRDT/history and deliberate operator repair. These are explicit non-live fixtures.

Final root checks after that correction: lint PASS; build including TypeScript PASS;302 tests/21 files PASS17.97s at18:22; all23 production browser tests PASS59.3s at18:23. Final six-fixture production browser benchmark PASS72samples/18warmups at18:25–18:26, no errors, owned service stopped; highest p95312.773ms including automation/network/DOM observation. Earlier173.552/344.733ms observations remain historical, with no optimization or production-load claim.

The final public copy passed lint,302 tests/21 files15.28s and build including TypeScript at18:25, with no dependency changes. Eleven approved source/test/environment files match the tested product; metadata and the public case-study adaptation remain preserved. Main restarted the final local service, observed healthy status and repeated the before/after data-integrity check: metadata schema2 and existing document/version/history digests and counts remained intact. This supersedes the pre-recovery-guard test totals above. No fresh clean export installation or live-provider inference is claimed; unchanged export-critical sources retain their hash-backed master proof.

## Explicitly unverified

No real model provider was configured. The actual server Responses adapter/review/permission/limits/evaluation code is implemented and non-live checks pass, but live inference, provider schema acceptance, model quality, real partial accept/reject/cancel/timeout/stale/revocation journeys remain NOT RUN. See the exact pending-provider instructions in RUNBOOK.

The backend has not been externally hosted. Production operations, verified-account identity/account recovery, live customer connectors, broader custom code and user research remain future work. Diagnostics/scoped keyboard checks are not complete accessibility certification. No interviews/testimonials/adoption/business impact or generalized performance claims are invented.
