# Reproducible local measurements

## Final capacity and ledger-recovery integration — 15 October 2026, 18:26 IST

Fresh production browser measurement after the final persisted-counter guard. Same shared Windows10.0.26300 x64 workstation, Node24.13.0, Intel i7-14700K/28 logical CPUs,34,114,199,552 RAM bytes, Chromium156.0.8078.4, Playwright1.64.1 and1440×1000 viewport. Same exact broad/balanced fixtures,3 warmups/12 measured samples per fixture,72 samples/18 warmups total. All budgets PASS; zero errors; owned isolated service stopped. No other main CPU-heavy build/test was intentionally overlapped with this run.

| Shape | Nodes | Browser median ms | Browser p95 ms | Budget ms |
|---|---:|---:|---:|---:|
| Broad siblings |100|32.142|45.996|500|
| Broad siblings |500|101.817|128.552|750|
| Broad siblings |1,000|263.971|310.308|1,000|
| Balanced tree |100|29.727|47.642|500|
| Balanced tree |500|104.584|119.894|750|
| Balanced tree |1,000|250.708|312.773|1,000|

Metric includes automation/network/DOM observation, not intrinsic paint. Timing variation on a shared workstation does not establish an optimization effect or production-load guarantee. Report identifier browser-2026-10-15T12-55-57-766Z/report.json; rerun npm run benchmark:browser after npm run build. Earlier runs below remain historical. Compiler/core/runtime/export/dependency sources remain unchanged; Node-only measurements were not rerun. Current App143.96kB/43.39gzip; deferred importer563.45kB/131.08gzip warning retained. These are individual chunks, not total initial download.

## Earlier capacity pass — 15 October 2026

The final capacity-pass production build was measured on15 October2026 from13:47:57 to13:48:15 IST. Same environment and methodology as below: Windows10.0.26300 x64, Node24.13.0, Intel i7-14700K,28logical CPUs,34,114,199,552RAMbytes, Chromium156.0.8078.4, Playwright1.64.1, viewport1440×1000. The isolated service stopped after the run; no browser errors were reported. No artificial throttling was applied.

| Shape | Nodes | Browser median ms | Browser p95 ms | Budget ms |
|---|---:|---:|---:|---:|
| Broad siblings |100|31.487|32.979|500|
| Broad siblings |500|79.352|102.867|750|
| Broad siblings |1,000|142.378|160.494|1,000|
| Balanced tree |100|31.695|33.917|500|
| Balanced tree |500|86.049|108.405|750|
| Balanced tree |1,000|148.778|173.552|1,000|

All6fixtures/72retained samples/18warmups passed their preselected budgets. The worst observed p95 was173.552ms. These values differ from the preceding344.733ms and historical166.167ms; shared-workstation observations do not establish an optimization or causal performance improvement. Completion includes automation/network/revision polling/preview DOM observation, not intrinsic input or paint. No collaboration-load or public-network guarantee follows. Node-only measurements were not rerun; core/compiler/runtime remain unchanged.

Current build: initial App143.96kB/43.39gzip; shared React/runtime219.42kB/68.54gzip; deferred CodeMirror394.83kB/134.40gzip; deferred AST importer563.45kB/131.08gzip. The importer warning and500kB threshold are retained. Values describe individual chunks, not a total download claim.

## Earlier usability pass — 15 October 2026

The final usability-pass production build was measured on15 October2026 from13:08:04 to13:08:27 IST. Environment: Windows10.0.26300 x64, Node24.13.0, Intel i7-14700K,28logical CPUs,34,114,199,552RAMbytes, Chromium156.0.8078.4, Playwright1.64.1, viewport1440×1000. The workstation was shared. No artificial network/CPU throttling was used.

All six exact100/500/1,000-node broad/balanced fixtures passed the existing budgets. There were72 retained measurements after18 warmups and no reported browser errors. Each fixture uses fictional literal Text leaves, semantic tokens and a flex root; balanced fixtures add eight-way grid Frames. There are no ticket records or network connectors. Completion includes Playwright input, local HTTP/WebSocket work, revision polling and preview DOM observation. With12 samples, nearest-rank p95 is the observed maximum; it is not intrinsic paint/input latency or a concurrency-load guarantee.

| Shape | Nodes | Browser median ms | Browser p95 ms | Budget ms |
|---|---:|---:|---:|---:|
| Broad siblings |100|26.359|48.642|500|
| Broad siblings |500|106.392|153.010|750|
| Broad siblings |1,000|285.046|316.005|1,000|
| Balanced tree |100|41.800|80.065|500|
| Balanced tree |500|108.261|147.593|750|
| Balanced tree |1,000|302.196|344.733|1,000|

The worst observed p95 in that earlier run was344.733ms, higher than the historical166.167ms below. This supports passing the stated local workflow budgets, not a claim that this interface pass improved speed. Node-only measurements were not rerun because the compiler/core/runtime sources are unchanged. The benchmark service used isolated persistence and stopped after the run.

Production chunks in that earlier run: initial editor App143.79kB/43.31gzip; shared React/runtime219.42kB/68.54gzip; deferred CodeMirror394.83kB/134.40gzip; deferred AST importer563.45kB/131.08gzip. These are individual chunks, not total initial download. The importer500kB warning remains visible and its threshold is unchanged. [Verification](VERIFICATION.md) records the source comparison and test boundaries.

## Historical baseline — 14 October 2026

Historical local source checkpoint c14adca (14 October 2026); see [verification provenance](VERIFICATION.md). Windows10.0.26300 x64, Node24.13.0, Intel i7-14700K,28logical CPUs,34,114,199,552RAMbytes; shared workstation. Browser Chromium156.0.8078.4, Playwright1.64.1, viewport1440×1000. These observations are not generalized production-load guarantees.

Run npm run build, npm run benchmark and npm run benchmark:browser. Both scripts save machine, source hashes/revision/dirty context, shape, samples, warmups, preselected budgets and failures in ignored artifacts/benchmarks. Exact100/500/1,000-node fixtures use literal Text leaves and a flex root; balanced trees add eight-way grid Frames. Fixtures have no tickets/network connectors. Node runner also checks semantic round trips.

Each fixture has3warmups/12measured samples. Browser completion spans inspector fill+Enter to observed authoritative revision/text and sandbox DOM text. It includes automation/network/polling; it does not measure intrinsic input or paint latency. The fresh production service used isolated data; it stopped after the run, with no browser errors.

| Shape | Nodes | Browser median ms | Browser p95 ms | Budget ms |
|---|---:|---:|---:|---:|
| Broad siblings |100|31.680|33.488|500|
| Broad siblings |500|79.460|98.878|750|
| Broad siblings |1,000|143.178|149.245|1,000|
| Balanced tree |100|29.470|35.325|500|
| Balanced tree |500|86.203|92.932|750|
| Balanced tree |1,000|143.045|166.167|1,000|

| Node processing at1,000nodes | Broad p95 ms | Balanced p95 ms | Budget ms |
|---|---:|---:|---:|
| Whole-document validation |4.549|4.743|100|
| Validated transaction |11.141|10.959|175|
| TSX generation |8.562|8.673|1,000|
| AST import |21.383|21.462|1,000|

All chosen budgets passed in the recorded local run. Raw reports and browser state are intentionally not part of this source snapshot. Rerunning the commands creates fresh local artifacts. Earlier production sandbox asset CORS failures were fixed for public assets while protected APIs retained their access boundary. The [verification summary](VERIFICATION.md) distinguishes historical evidence from fresh snapshot checks.

Production chunk observations: initial editor App139.06kB/41.77gzip, shared React/runtime219.42kB/68.54gzip, deferred CodeMirror394.83kB/134.40gzip, deferred AST importer563.45kB/131.08gzip. These are individual chunks, not a total initial-download claim; code recovery may load the importer. Its500kB size warning remains visible. No chunk threshold was raised to conceal it.
