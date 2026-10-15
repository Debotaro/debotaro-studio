import { chromium, expect, type Browser, type Frame, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { arch, cpus, freemem, platform, release, totalmem } from 'node:os';
import { relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { compileDocument, importCode } from '../src/compiler';
import { serializeDocument, validateDocument } from '../src/core/document';
import { benchmarkShapes, benchmarkSizes, createBenchmarkFixture, describeBenchmarkFixture } from './fixtures';

// These budgets are committed in methodology.json before any browser measurement.
const budgetsMs: Record<number, number> = { 100: 500, 500: 750, 1_000: 1_000 };
const warmups = 3;
const repetitions = 12;
const viewport = { width: 1440, height: 1000 };
const port = 4188;
const origin = `http://localhost:${port}`;
const startedAt = new Date().toISOString();
const directory = resolve('artifacts', 'benchmarks', `browser-${startedAt.replace(/[:.]/g, '-')}`);
mkdirSync(directory, { recursive: true });
const reportPath = resolve(directory, 'report.json');
const logPath = resolve(directory, 'runner.log');
const serverLogPath = resolve(directory, 'server.log');
const pause = (milliseconds: number) => new Promise(resolvePause => setTimeout(resolvePause, milliseconds));
const rounded = (milliseconds: number) => Number(milliseconds.toFixed(3));

function log(message: string) {
  const line = `${new Date().toISOString()} ${message}\n`;
  appendFileSync(logPath, line);
  process.stdout.write(line);
}
function revisionContext() {
  return {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirtyPaths: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  };
}
function productionAssets() {
  const base = resolve('dist');
  if (!existsSync(resolve(base, 'index.html')) || !existsSync(resolve(base, 'preview.html'))) throw new Error('Production build is missing. Run npm run build before this benchmark.');
  const files: { path: string; bytes: number; sha256: string }[] = [];
  const visit = (directory: string) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) visit(path);
      else {
        const source = readFileSync(path);
        files.push({ path: relative(base, path).replaceAll('\\', '/'), bytes: source.length, sha256: createHash('sha256').update(source).digest('hex') });
      }
    }
  };
  visit(base);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
function sourceFiles() {
  const files: { path: string; bytes: number; sha256: string }[] = [];
  const visit = (directory: string) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) visit(path);
      else {
        const source = readFileSync(path);
        files.push({ path: relative(process.cwd(), path).replaceAll('\\', '/'), bytes: source.length, sha256: createHash('sha256').update(source).digest('hex') });
      }
    }
  };
  for (const directory of ['src', 'server', 'scripts']) visit(resolve(directory));
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
async function requireAvailablePort() {
  const probe = createServer();
  await new Promise<void>((resolveAvailable, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolveAvailable()));
  });
}
async function startServer() {
  await requireAvailablePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
    cwd: process.cwd(), windowsHide: true,
    env: { ...process.env, PORT: String(port), STUDIO_HOST: '127.0.0.1', STUDIO_ORIGIN: origin, STUDIO_DATA_DIR: resolve(directory, 'server-data'), OPENAI_API_KEY: '', OPENAI_MODEL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', chunk => appendFileSync(serverLogPath, chunk));
  child.stderr?.on('data', chunk => appendFileSync(serverLogPath, chunk));
  let launchError: Error | undefined;
  child.on('error', error => { launchError = error; });
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`Benchmark service exited ${child.exitCode}; inspect ${serverLogPath}`);
    try { const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1_000) }); if (response.ok) return child; } catch { /* Bounded startup polling. */ }
    await pause(100);
  }
  await stopServer(child);
  throw new Error(`Benchmark service did not become healthy; inspect ${serverLogPath}`);
}
async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>(resolveClosed => child.once('exit', () => resolveClosed()));
  child.kill('SIGTERM');
  await Promise.race([closed, pause(5_000)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
}
function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { medianMs: rounded(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2), p95Ms: rounded(sorted[Math.ceil(sorted.length * .95) - 1]), minimumMs: rounded(sorted[0]), maximumMs: rounded(sorted[sorted.length - 1]) };
}
async function readDocument(page: Page, projectId: string) {
  const response = await page.request.get(`/api/projects/${projectId}`);
  if (!response.ok()) throw new Error(`Authenticated document read failed ${response.status()}.`);
  return validateDocument((await response.json()).document);
}
async function observedServerEdit(page: Page, projectId: string, revision: number, value: string, start: number) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const document = await readDocument(page, projectId);
    if (document.revision > revision) throw new Error(`One inspector commit produced unexpected revision ${document.revision}; expected ${revision}.`);
    if (document.revision === revision && document.nodes['text-0']?.props.text === value) return performance.now() - start;
    await pause(10);
  }
  throw new Error('Inspector edit was not observed in authoritative server document within 10 seconds.');
}
interface Sample { index: number; revision: number; value: string; fillAndEnterMs: number; authoritativeObservedMs: number; previewDomObservedMs: number; completedObservedMs: number }
async function measureEdit(page: Page, frame: Frame, projectId: string, revision: number, index: number, phase: string): Promise<Sample> {
  const value = `Measured ${phase} inspector edit ${index}`;
  const input = page.getByRole('textbox', { name: 'text', exact: true });
  const start = performance.now();
  await input.fill(value);
  await input.press('Enter');
  const fillAndEnterMs = performance.now() - start;
  const [authoritativeObservedMs, previewDomObservedMs] = await Promise.all([
    observedServerEdit(page, projectId, revision, value, start),
    frame.waitForFunction(expected => document.querySelector('[data-studio-id="text-0"]')?.textContent === expected, value, { polling: 'raf', timeout: 10_000 }).then(async handle => { const observed = performance.now() - start; await handle.dispose(); return observed; }),
  ]);
  await expect(page.locator('.sync-status')).toHaveText('Live');
  return { index, revision, value, fillAndEnterMs: rounded(fillAndEnterMs), authoritativeObservedMs: rounded(authoritativeObservedMs), previewDomObservedMs: rounded(previewDomObservedMs), completedObservedMs: rounded(Math.max(authoritativeObservedMs, previewDomObservedMs)) };
}

const methodology = {
  clock: 'Node performance.now monotonic wall time', warmups, repetitions, viewport,
  browser: 'Headless Chromium; production Studio build; isolated private owner/context per fixture; local HTTP + authenticated WebSocket; no artificial throttling.',
  edit: 'Select actual Text 0 layer once and scroll its preview into view before warmups; start clock before Playwright textbox.fill; textbox.press Enter blurs/commits real inspector; await exact server revision and text through authenticated HTTP polling plus preview iframe text through requestAnimationFrame polling.',
  metric: 'Upper-bound automation completion latency includes Playwright input/actionability/protocol/Node scheduling, local network, polling and cross-process observations. Preview DOM observation is not a measurement of browser paint or intrinsic input latency; no claim is made about frame timing.',
  statistics: '12 retained samples per fixture after 3 warmup edits; nearest-rank p95 (the maximum with 12 samples); median; every sample retained. No failed sample is dropped.',
  budgetsRationale: 'Preselected diagnostic budgets for local complete visual-edit workflow: p95 <=500ms at100 nodes, <=750ms at500 and <=1000ms at1000. Allows disclosed automation observation overhead and document-size processing; passing does not imply imperceptible latency or production concurrency capacity.',
  limitations: 'Shared developer workstation; single owner editing deterministic Text-heavy fixtures; no intrinsic paint/input metric, collaboration load simulation or real network latency. Cold ready observations are separate and have no pass budget.',
  docs: ['https://playwright.dev/docs/api/class-browser', 'https://playwright.dev/docs/api/class-locator', 'https://playwright.dev/docs/api/class-page'],
};
const report: {
  startedAt: string; finishedAt?: string; gitStart: ReturnType<typeof revisionContext>; gitEnd?: ReturnType<typeof revisionContext>;
  environment: Record<string, unknown>; productionAssets: ReturnType<typeof productionAssets>; sourceFilesStart: ReturnType<typeof sourceFiles>; sourceFilesFinish?: ReturnType<typeof sourceFiles>; methodology: typeof methodology;
  budgetsMs: typeof budgetsMs; results: Record<string, unknown>[]; violations: Record<string, unknown>[];
  errors: string[]; pass: boolean; ownedServerStopped: boolean;
} = {
  startedAt, gitStart: revisionContext(),
  environment: { node: process.version, platform: platform(), release: release(), arch: arch(), cpuModel: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, totalRamBytes: totalmem(), freeRamBytesAtStart: freemem(), playwright: JSON.parse(readFileSync(resolve('node_modules/@playwright/test/package.json'), 'utf8')).version, viewport, server: { command: 'node --import tsx server/index.ts --production', port, isolatedDataDirectory: resolve(directory, 'server-data') } },
  productionAssets: productionAssets(), sourceFilesStart: sourceFiles(), methodology, budgetsMs, results: [], violations: [], errors: [], pass: false, ownedServerStopped: false,
};
writeFileSync(resolve(directory, 'methodology.json'), JSON.stringify({ recordedBeforeMeasurementAt: new Date().toISOString(), methodology, budgetsMs }, null, 2) + '\n');
const saveReport = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
saveReport();
let server: ChildProcess | undefined;
let browser: Browser | undefined;
try {
  log('Beginning actual production editor benchmark; budgets/methodology saved before measurements.');
  server = await startServer();
  report.environment.serverProcessId = server.pid;
  browser = await chromium.launch({ headless: true });
  report.environment.chromium = browser.version();
  for (const shape of benchmarkShapes) {
    for (const size of benchmarkSizes) {
      const fixture = createBenchmarkFixture(size, shape);
      const code = compileDocument(fixture).code;
      const imported = importCode(code, fixture);
      if (!imported.document || serializeDocument(imported.document) !== serializeDocument(fixture)) throw new Error(`Fixture ${shape}/${size} failed semantic compiler round trip.`);
      const context = await browser.newContext({ baseURL: origin, viewport });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
      page.setDefaultTimeout(15_000);
      try {
        const headers = { 'X-Studio-Request': '1', Origin: origin };
        const demo = await context.request.post('/api/demo', { headers, data: { name: 'Fictional performance observer' } });
        if (demo.status() !== 201) throw new Error(`Private owner seeding failed ${demo.status()}.`);
        const project = validateDocument((await demo.json()).document);
        const document = validateDocument({ ...fixture, id: project.id, revision: project.revision });
        const seeded = await context.request.post(`/api/projects/${project.id}/operations`, { headers, data: { envelope: { id: randomUUID(), projectId: project.id, baseRevision: project.revision, label: `Seed ${size}-node ${shape} benchmark fixture`, operations: [{ type: 'replace', document }] }, strict: true } });
        if (!seeded.ok()) throw new Error(`Validated fixture application failed ${seeded.status()}: ${await seeded.text()}`);
        let revision = validateDocument((await seeded.json()).document).revision;
        const readyStart = performance.now();
        await page.goto('/');
        await expect(page.locator('.sync-status')).toHaveText('Live');
        await expect(page.getByRole('combobox', { name: 'Project', exact: true })).toHaveValue(project.id);
        const preview = page.frameLocator('iframe').locator('[data-studio-id="text-0"]');
        await expect(preview).toHaveText(String(document.nodes['text-0'].props.text));
        const editorReadyObservedMs = rounded(performance.now() - readyStart);
        await page.getByRole('button', { name: 'Text 0', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'text', exact: true })).toBeEnabled();
        await preview.scrollIntoViewIfNeeded();
        await expect(preview).toBeVisible();
        const frame = page.frames().find(item => new URL(item.url()).pathname === '/preview.html');
        if (!frame) throw new Error('Production preview iframe is absent.');
        const warmupSamples: Sample[] = [];
        for (let index = 0; index < warmups; index++) warmupSamples.push(await measureEdit(page, frame, project.id, ++revision, index, 'warmup'));
        const samples: Sample[] = [];
        for (let index = 0; index < repetitions; index++) samples.push(await measureEdit(page, frame, project.id, ++revision, index, 'retained'));
        const completion = summarize(samples.map(sample => sample.completedObservedMs));
        const budgetMs = budgetsMs[size];
        if (completion.p95Ms > budgetMs) report.violations.push({ shape, nodes: size, metric: 'completedObservedMs', observedP95Ms: completion.p95Ms, budgetMs });
        if (pageErrors.length) throw new Error(`Browser errors during ${shape}/${size}: ${pageErrors.join(' | ')}`);
        const screenshotPath = resolve(directory, `${shape}-${size}.png`);
        await page.screenshot({ path: screenshotPath });
        report.results.push({ shape, ...describeBenchmarkFixture(document), codeBytes: Buffer.byteLength(code), serializedBytes: Buffer.byteLength(serializeDocument(document)), editorReadyObservedMs, budgetMs, completion, authoritative: summarize(samples.map(sample => sample.authoritativeObservedMs)), previewDom: summarize(samples.map(sample => sample.previewDomObservedMs)), fillAndEnter: summarize(samples.map(sample => sample.fillAndEnterMs)), warmupSamples, samples, screenshotPath, pageErrors, finalRevision: revision });
        saveReport();
        log(`${shape}/${size}: complete median ${completion.medianMs}ms; p95 ${completion.p95Ms}ms; budget ${budgetMs}ms.`);
      } catch (error) {
        await page.screenshot({ path: resolve(directory, `failure-${shape}-${size}.png`) }).catch(() => {});
        const frameDiagnostics = await Promise.all(page.frames().map(async frame => ({ url: frame.url(), body: await frame.locator('body').innerText().catch(() => 'Unavailable') })));
        writeFileSync(resolve(directory, `failure-${shape}-${size}.json`), JSON.stringify({ pageErrors, frames: frameDiagnostics }, null, 2) + '\n');
        throw error;
      } finally { await context.close(); }
    }
  }
  if (JSON.stringify(productionAssets()) !== JSON.stringify(report.productionAssets)) throw new Error('Production assets changed during measurement; rerun against one unchanged build.');
  report.pass = report.violations.length === 0;
} catch (error) {
  report.errors.push(error instanceof Error ? error.stack ?? error.message : String(error));
  log(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser?.close();
  if (server) { await stopServer(server); report.ownedServerStopped = server.exitCode !== null || server.signalCode !== null; }
  report.finishedAt = new Date().toISOString();
  report.gitEnd = revisionContext();
  report.sourceFilesFinish = sourceFiles();
  report.environment.freeRamBytesAtFinish = freemem();
  saveReport();
  log(`Report ${reportPath}; pass=${report.pass}; owned server stopped=${report.ownedServerStopped}.`);
}
if (!report.pass || report.errors.length || !report.ownedServerStopped) process.exitCode = 1;
