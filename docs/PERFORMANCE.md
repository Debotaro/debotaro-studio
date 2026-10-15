# Reproducible local measurements — 14 October 2026

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
