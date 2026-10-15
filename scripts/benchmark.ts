import { performance } from 'node:perf_hooks';
import { arch, cpus, freemem, platform, release, totalmem } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { applyOperations, serializeDocument, validateDocument } from '../src/core/document';
import { compileDocument, importCode } from '../src/compiler';
import { benchmarkShapes, benchmarkSizes, createBenchmarkFixture } from './fixtures';

const repetitions = 12;
const warmups = 3;
const budgetsMs = { validate: 100, operation: 175, compile: 1_000, import: 1_000 };

function measure(run: () => unknown) {
  for (let index = 0; index < warmups; index++) run();
  const samples: number[] = [];
  for (let index = 0; index < repetitions; index++) { const start = performance.now(); run(); samples.push(performance.now() - start); }
  const sorted = [...samples].sort((a, b) => a - b);
  return { medianMs: Number(((sorted[5] + sorted[6]) / 2).toFixed(3)), p95Ms: Number(sorted[Math.ceil(repetitions * .95) - 1].toFixed(3)), samplesMs: samples.map(value => Number(value.toFixed(3))) };
}
function revisionContext() {
  try { return { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0 }; }
  catch { return { revision: null, dirty: true }; }
}
const results = [];
for (const shape of benchmarkShapes) {
  for (const size of benchmarkSizes) {
    const document = createBenchmarkFixture(size, shape);
    const code = compileDocument(document).code;
    const roundTrip = importCode(code, document);
    if (!roundTrip.document || serializeDocument(roundTrip.document) !== serializeDocument(document)) throw new Error('Benchmark fixture did not retain semantic meaning through TSX round trip.');
    const op = { id: randomUUID(), projectId: document.id, baseRevision: 0, label: 'Measured independent text property edit', operations: [{ type: 'update' as const, nodeId: 'text-0', patch: { props: { ...document.nodes['text-0'].props, text: 'Measured change' } } }] };
    const row = {
      shape, nodes: Object.keys(document.nodes).length, codeBytes: Buffer.byteLength(code),
      validate: measure(() => validateDocument(document)),
      operation: measure(() => applyOperations(document, op)),
      compile: measure(() => { const compiled = compileDocument(document); if (compiled.diagnostics.some(item => item.severity === 'error')) throw new Error('Compilation failed during measurement.'); }),
      import: measure(() => { const imported = importCode(code, document); if (!imported.document) throw new Error(`Import failed during measurement: ${JSON.stringify(imported.diagnostics)}`); }),
    };
    results.push(row);
  }
}
const violations = results.flatMap(row => (Object.keys(budgetsMs) as (keyof typeof budgetsMs)[]).filter(name => row[name].p95Ms > budgetsMs[name]).map(name => ({ shape: row.shape, nodes: row.nodes, operation: name, observedP95Ms: row[name].p95Ms, budgetMs: budgetsMs[name] })));
const report = {
  timestamp: new Date().toISOString(), ...revisionContext(),
  environment: { node: process.version, platform: platform(), release: release(), arch: arch(), cpuModel: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, totalRamBytes: totalmem(), freeRamBytesAtReport: freemem() },
  methodology: { clock: 'performance.now wall time', warmups, repetitions, percentile: 'nearest-rank p95', fixtures: 'exact node counts; deterministic IDs/text; broad root siblings or balanced 8-way container tree with roughly 15 text children per frame', scope: 'Node document validation/atomic operation/compiler/AST importer only. Not browser paint, input latency, network or a production load test.', budgetsRationale: 'Conservative local processing limits chosen before measurement: <=100ms validation, <=175ms atomic edit, <=1000ms compilation and import for all fixtures up to1000 nodes. Interactive browser budgets require separate measured evidence.' },
  budgetsMs, results, violations, pass: violations.length === 0,
};
const directory = resolve('artifacts', 'benchmarks'); mkdirSync(directory, { recursive: true });
const target = resolve(directory, `benchmark-${report.timestamp.replace(/[:.]/g, '-')}.json`); writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ report: target, environment: report.environment, budgetsMs, results: results.map(row => ({ shape: row.shape, nodes: row.nodes, validateP95Ms: row.validate.p95Ms, operationP95Ms: row.operation.p95Ms, compileP95Ms: row.compile.p95Ms, importP95Ms: row.import.p95Ms })), violations, pass: report.pass }, null, 2) + '\n');
if (!report.pass) process.exitCode = 1;
