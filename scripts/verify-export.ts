/** Clean independent export verification. Run with npm run verify:export. */
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, isAbsolute, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { compileDocument } from '../src/compiler';
import { createStarterDocument } from '../src/core/starter';
import { generateProject } from '../src/export/project';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Treat generated filenames as untrusted even though the current generator is trusted. */
export function exportFilePath(directory: string, name: string): string {
  if (!name || isAbsolute(name) || win32.isAbsolute(name) || /[\\:]/.test(name) || [...name].some(character => character.charCodeAt(0) < 32)
    || name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe export path: ${name}`);
  }
  const base = resolve(directory);
  const target = resolve(base, name);
  if (!target.startsWith(base + sep)) throw new Error(`Export path escapes destination: ${name}`);
  return target;
}

export function verifyArchive(archive: Uint8Array, files: Record<string, string>): void {
  const extracted = unzipSync(archive);
  assert.deepEqual(Object.keys(extracted).sort(), Object.keys(files).sort(), 'ZIP filenames differ from the generated project.');
  for (const [name, text] of Object.entries(files)) {
    exportFilePath(root, name);
    assert.equal(strFromU8(extracted[name]), text, `ZIP bytes differ for ${name}.`);
  }
}

async function materialize(directory: string, files: Record<string, string>): Promise<void> {
  await mkdir(directory); // A fresh destination is required; never reuse/delete an old build.
  for (const [name, text] of Object.entries(files)) {
    const target = exportFilePath(directory, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, { encoding: 'utf8', flag: 'wx' });
  }
}

async function assertOriginalFiles(directory: string, files: Record<string, string>): Promise<void> {
  for (const [name, text] of Object.entries(files)) {
    assert.equal(await readFile(exportFilePath(directory, name), 'utf8'), text, `Install/build changed generated file ${name}.`);
  }
}

function gitContext() {
  try {
    return {
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      status: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    };
  } catch { return { revision: null, status: ['Git context unavailable'] }; }
}

async function sourceHashes(): Promise<Record<string, string>> {
  const files = ['package.json', 'package-lock.json', 'tsconfig.json', 'scripts/verify-export.ts', 'tests/export/verify-interactions.ts'];
  async function walk(relative: string) {
    for (const entry of await readdir(resolve(root, relative), { withFileTypes: true })) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile()) files.push(next);
    }
  }
  for (const directory of ['src/core', 'src/compiler', 'src/export', 'src/runtime']) await walk(directory);
  return Object.fromEntries(await Promise.all(files.sort().map(async name => [name, hash(await readFile(resolve(root, name)))])));
}

/** No application credentials or Studio configuration enter exported processes. */
function childEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP', 'TMPDIR', 'NPM_CONFIG_CACHE', 'PLAYWRIGHT_BROWSERS_PATH']);
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase()))), NO_COLOR: '1', CI: '1' };
}

interface CommandResult { command: string[]; directory: string; log: string; startedAt: string; finishedAt: string; exitCode: number | null; signal: string | null }
const commands: CommandResult[] = [];

async function stopOwnedProcess(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    // Exact owned PID/tree only; npm scripts use a shell that can otherwise leave Vite alive.
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
  await new Promise<void>((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Owned export process did not stop.')), 10_000);
    if (child.exitCode !== null || child.signalCode !== null) { clearTimeout(timeout); done(); return; }
    child.once('close', () => { clearTimeout(timeout); done(); });
  });
}

function startCommand(args: string[], directory: string) {
  const child = spawn(process.execPath, args, { cwd: directory, env: childEnvironment(), windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const output: string[] = [];
  child.stdout?.on('data', chunk => output.push(String(chunk)));
  child.stderr?.on('data', chunk => output.push(String(chunk)));
  return { child, output, startedAt: new Date().toISOString() };
}

async function runCommand(args: string[], directory: string, log: string, timeoutMs = 120_000): Promise<void> {
  const { child, output, startedAt } = startCommand(args, directory);
  const result = await new Promise<{ exitCode: number | null; signal: string | null }>((done, reject) => {
    const timeout = setTimeout(() => { void stopOwnedProcess(child).then(() => reject(new Error(`Command timed out after ${timeoutMs}ms.`)), reject); }, timeoutMs);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', (exitCode, signal) => { clearTimeout(timeout); done({ exitCode, signal }); });
  }).catch(async error => { await writeFile(log, output.join('') + `\n${String(error)}\n`); throw error; });
  await writeFile(log, output.join(''));
  commands.push({ command: [process.execPath, ...args], directory, log, startedAt, finishedAt: new Date().toISOString(), ...result });
  assert.equal(result.exitCode, 0, `Command failed: ${args.join(' ')}. Read ${log}.`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('No loopback port assigned.')); return; }
      server.close(error => error ? reject(error) : done(address.port));
    });
  });
}

async function awaitPreview(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Export preview stopped before it was ready.');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1_000) })).ok) return; } catch { /* Retry loopback readiness only. */ }
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error('Export preview did not become ready within 30 seconds.');
}

async function main(): Promise<void> {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Use npm run verify:export so the installed npm CLI path is supplied.');
  await readFile(npmCli); // Use Node + npm CLI on Windows rather than spawning npm.cmd as an executable.
  const startedAt = new Date().toISOString();
  const run = resolve(root, 'artifacts', 'export-verification', `${startedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  await mkdir(dirname(run), { recursive: true });
  await mkdir(run);
  const directory = resolve(run, 'project');
  const browserDirectory = resolve(run, 'browser');
  const sourceAtStart = await sourceHashes();
  const contextAtStart = gitContext();
  const report: Record<string, unknown> = {
    status: 'active', startedAt, timezone: 'Asia/Calcutta', directory, run, contextAtStart, sourceAtStart,
    environment: { node: process.version, npm: execFileSync(process.execPath, [npmCli, '--version'], { encoding: 'utf8', env: childEnvironment(), windowsHide: true }).trim(), os: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalRamBytes: totalmem() },
    scope: 'Current validated fictional starter, generated source ZIP, frozen clean install, typecheck, production build, loopback start and actual independent Chromium interactions. No Studio API/backend/provider dependency.',
    commands,
  };
  const saveReport = () => writeFile(resolve(run, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await saveReport();
  let preview: ReturnType<typeof startCommand> | undefined;
  try {
    const document = createStarterDocument('debotaro-verified-export-example');
    Object.assign(document.tokens.primitive, { exportGap: 24, exportTitle: 28, exportWeight: 700, exportPhonePadding: 12 });
    Object.assign(document.tokens.semantic, { exportGap: '$primitive.exportGap', exportTitle: '$primitive.exportTitle', exportWeight: '$primitive.exportWeight' });
    Object.assign(document.nodes.workspace.layout, { gap: '$semantic.exportGap', padding: '$primitive.exportGap' });
    document.nodes.workspace.responsive.phone = { ...document.nodes.workspace.responsive.phone, padding: '$primitive.exportPhonePadding' };
    document.nodes.workspace.props.radius = '$primitive.radius';
    Object.assign(document.nodes['workspace-title'].props, { size: '$semantic.exportTitle', weight: '$semantic.exportWeight' });
    const customText = '// Handwritten code remains a nonexecuted recovery artifact.\nthrow new Error("DEBOTARO_UNTRUSTED_EXPORT_SENTINEL");\n';
    const source = customText + compileDocument(document).code;
    const files = await generateProject(document, source);
    assert(files['recovery/custom-code.txt'].includes(customText), 'Custom source was not retained.');
    for (const [name, text] of Object.entries(files)) if (!name.startsWith('recovery/')) assert(!text.includes('DEBOTARO_UNTRUSTED_EXPORT_SENTINEL'), `Untrusted source leaked into ${name}.`);
    await materialize(directory, files);
    const archive = zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])), { level: 6 });
    verifyArchive(archive, files);
    await writeFile(resolve(run, 'generated-project.zip'), archive);
    report.generated = { projectId: document.id, revision: document.revision, schemaVersion: document.schemaVersion, fileCount: Object.keys(files).length, filesSha256: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, hash(text)])), archiveSha256: hash(archive), archiveBytes: archive.byteLength, customCode: 'Plain text recovery only; a throw sentinel would fail browser checks if executed.' };
    await saveReport();
    for (const [name, args] of [['install', ['ci', '--no-audit', '--no-fund']], ['typecheck', ['run', 'typecheck']], ['build', ['run', 'build']]] as const) {
      console.log(`Export verification: ${name}`);
      await runCommand([npmCli, ...args], directory, resolve(run, `${name}.log`));
      await assertOriginalFiles(directory, files);
      await saveReport();
    }
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    console.log('Export verification: start built project and test actual browser interactions');
    preview = startCommand([npmCli, 'run', 'preview', '--', '--port', String(port), '--strictPort'], directory);
    await awaitPreview(url, preview.child);
    report.preview = { url, command: [process.execPath, npmCli, 'run', 'preview', '--', '--port', String(port), '--strictPort'], startedAt: preview.startedAt, pid: preview.child.pid };
    await runCommand([require.resolve('tsx/cli'), resolve(root, 'tests/export/verify-interactions.ts'), url, browserDirectory, '--numeric-tokens'], root, resolve(run, 'browser.log'));
    report.browser = JSON.parse(await readFile(resolve(browserDirectory, 'report.json'), 'utf8'));
    await assertOriginalFiles(directory, files);
    verifyArchive(await readFile(resolve(run, 'generated-project.zip')), files);
    const sourceAtEnd = await sourceHashes();
    report.sourceAtEnd = sourceAtEnd;
    assert.deepEqual(sourceAtEnd, sourceAtStart, 'Relevant export/compiler/core/runtime sources changed during verification; rerun against the final source.');
    await stopOwnedProcess(preview.child);
    await writeFile(resolve(run, 'preview.log'), preview.output.join(''));
    report.previewStopped = true;
    preview = undefined;
    const publicExample = resolve(root, 'docs/export-example.zip');
    await writeFile(publicExample, archive);
    assert.equal(hash(await readFile(publicExample)), hash(archive), 'Public example differs from the verified archive.');
    report.publicExample = { path: 'docs/export-example.zip', sha256: hash(archive), sourceBytesVerified: true };
    report.status = 'pass';
  } catch (error) {
    report.status = 'fail';
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    if (preview) {
      try { await stopOwnedProcess(preview.child); report.previewStopped = true; }
      catch (error) { report.cleanupError = String(error); report.status = 'fail'; process.exitCode = 1; }
      await writeFile(resolve(run, 'preview.log'), preview.output.join(''));
    }
    report.finishedAt = new Date().toISOString();
    report.contextAtEnd = gitContext();
    await saveReport();
    console.log(JSON.stringify({ status: report.status, report: resolve(run, 'report.json'), publicExample: report.publicExample, error: report.error, previewStopped: report.previewStopped }, null, 2));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
