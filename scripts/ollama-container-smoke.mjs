// Infrastructure only: no model download and no inference request.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = `studio-ollama-smoke-${randomUUID().slice(0, 8)}`;
const env = { ...process.env, STUDIO_ORIGIN: 'http://127.0.0.1:4173' };
const prefix = ['compose', '-p', project, '-f', 'compose.yaml', '-f', 'compose.local-ai.yaml', '--profile', 'local-ai'];
const run = args => execFileSync('docker', args, { cwd: root, env, encoding: 'utf8', timeout: 600_000, maxBuffer: 4_000_000, windowsHide: true });
const compose = (...args) => run([...prefix, ...args]);
const output = resolve(root, 'artifacts/ollama-container-smoke');
mkdirSync(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), modelDownloaded: false, inferenceRequested: false, checks: [] };
try {
  compose('config', '--quiet');
  compose('up', '--build', '-d', '--no-deps', '--wait', '--wait-timeout', '90', 'ollama');
  const [info] = JSON.parse(run(['inspect', compose('ps', '-q', 'ollama').trim()]));
  assert.equal(info.Config.User, '1000:1000');
  assert.equal(info.HostConfig.ReadonlyRootfs, true);
  assert.ok(info.HostConfig.CapDrop.includes('ALL'));
  assert.ok(info.HostConfig.SecurityOpt.some(value => value.startsWith('no-new-privileges')));
  assert.ok(info.HostConfig.Tmpfs['/tmp']);
  assert.ok(info.Mounts.some(value => value.Type === 'volume' && value.Destination === '/models' && value.RW));
  assert.equal(Object.keys(info.HostConfig.PortBindings ?? {}).length, 0);
  assert.equal(info.State.Health.Status, 'healthy');
  report.checks.push('unprivileged-readonly-healthy-model-volume-no-public-port');
  const networks = Object.keys(info.NetworkSettings.Networks);
  assert.equal(networks.length, 1);
  const [network] = JSON.parse(run(['network', 'inspect', networks[0]]));
  assert.equal(network.Internal, true);
  report.checks.push('only-internal-network-no-external-route');
  const probe = "const base='http://ollama:11434';const version=await(await fetch(base+'/api/version')).json();if(version.version!=='0.40.5')throw Error('Unexpected Ollama version');const tags=await(await fetch(base+'/api/tags')).json();if(tags.models.length!==0)throw Error('Infrastructure check unexpectedly has models');console.log(JSON.stringify({version:version.version,modelCount:tags.models.length}))";
  const response = run(['run', '--rm', '--network', networks[0], '--entrypoint', 'node', 'debotaro-studio:local', '--input-type=module', '-e', probe]);
  report.runtime = JSON.parse(response.trim());
  report.checks.push('private-api-access-from-node-and-empty-model-store');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  try { writeFileSync(resolve(output, 'service.log'), compose('logs', '--no-color', '--tail', '100', 'ollama')); } catch { /* preserve primary error */ }
  // This unique project owns an empty fictional verification volume only.
  try { compose('down', '--volumes', '--remove-orphans'); } catch (error) { report.cleanupError = String(error); report.passed = false; process.exitCode = 1; }
  report.completedAt = new Date().toISOString();
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`${report.checks.length} private Ollama infrastructure checks ${report.passed ? 'passed' : 'FAILED'}\n`);
  if (report.error) process.stderr.write(`${report.error}\n`);
}
