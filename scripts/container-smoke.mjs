// Fictional fixtures only. Never load .env or forward provider credentials.
// --native checks the HTTP/WS probe locally; default mode checks real Docker.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { WebSocket } from 'ws';
import * as Y from 'yjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const native = process.argv.includes('--native');
const project = `studio-smoke-${randomUUID().slice(0, 8)}`;
const output = resolve(root, 'artifacts/container-smoke');
await mkdir(output, { recursive: true });
const listener = createServer();
await new Promise((done, reject) => listener.once('error', reject).listen(0, '127.0.0.1', done));
const port = listener.address().port;
await new Promise(done => listener.close(done));
const base = `http://127.0.0.1:${port}`;
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA)$/i.test(key)));
Object.assign(environment, {
  PORT: String(port), STUDIO_HOST: '127.0.0.1', STUDIO_ORIGIN: base,
  STUDIO_HTTP_PORT: String(port), STUDIO_DATA_DIR: resolve(output, project),
  STUDIO_AI_DAILY_REQUESTS: '0', STUDIO_AI_USER_DAILY_REQUESTS: '0',
  AI_PROVIDER: 'disabled', OPENAI_API_KEY: '', OPENAI_MODEL: '', NODE_ENV: 'production',
});
const checks = [];
const peers = new Set();
let child;
let logs = '';
let composeStarted = false;
const report = { mode: native ? 'native-probe-only' : 'docker-compose', startedAt: new Date().toISOString(), fixture: 'fictional-isolated', checks };
const command = async (program, args, timeout = 180_000) => new Promise((done, reject) => {
  const proc = spawn(program, args, { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let text = '';
  proc.stdout.on('data', data => { text += data; });
  proc.stderr.on('data', data => { text += data; });
  const timer = globalThis.setTimeout(() => { proc.kill(); reject(new Error(`${program} timed out`)); }, timeout);
  proc.once('error', error => { globalThis.clearTimeout(timer); reject(error); });
  proc.once('close', code => { globalThis.clearTimeout(timer); if (code === 0) done(text); else reject(new Error(`${program} exited ${code}: ${text.slice(-6000)}`)); });
});
const compose = (...args) => command('docker', ['compose', '-p', project, '-f', resolve(root, 'compose.yaml'), ...args], 600_000);
const start = async () => {
  if (native) {
    assert.equal(existsSync(resolve(root, '.env')), false, 'Native smoke refuses a checkout .env; Docker never includes it');
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', data => { logs += data; });
    child.stderr.on('data', data => { logs += data; });
    child.on('error', error => { logs += error.message; });
  } else {
    composeStarted = true;
    await compose('up', '--build', '-d', '--wait', '--wait-timeout', '90');
  }
  await ready();
};
const stop = async () => {
  if (child && child.exitCode === null) {
    const stopped = new Promise(done => child.once('close', done));
    child.kill('SIGTERM');
    await Promise.race([stopped, delay(10_000, undefined, { ref: false }).then(() => { if (child?.exitCode === null) child.kill('SIGKILL'); })]);
    child = undefined;
  }
};
const ready = async () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await globalThis.fetch(`${base}/api/health`, { signal: globalThis.AbortSignal.timeout(1000) }); if (response.ok && (await response.json()).ok) return; } catch { /* startup window */ }
    if (native && child?.exitCode !== null) throw new Error(`Server stopped: ${logs.slice(-4000)}`);
    await delay(100);
  }
  throw new Error(`Studio did not become ready: ${logs.slice(-4000)}`);
};
class Client {
  cookie = '';
  async request(path, method = 'GET', body, headers = {}) {
    const response = await globalThis.fetch(base + path, { method, headers: {
      Origin: base, 'X-Studio-Request': '1', ...(this.cookie ? { Cookie: this.cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: globalThis.AbortSignal.timeout(10_000) });
    const cookie = response.headers.get('set-cookie');
    if (cookie) { assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Strict/i); this.cookie = cookie.split(';')[0]; }
    return response;
  }
  async json(path, method = 'GET', body, expected = 200) {
    const response = await this.request(path, method, body);
    assert.equal(response.status, expected, `${method} ${path}`);
    return response.json();
  }
}
const wsUrl = id => `${base.replace('http:', 'ws:')}/collaborate?projectId=${encodeURIComponent(id)}`;
const connect = async (client, id) => {
  const socket = new WebSocket(wsUrl(id), { headers: { Origin: base, Cookie: client.cookie } });
  peers.add(socket);
  const messages = [];
  socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
  await new Promise((done, reject) => { socket.once('open', done); socket.once('error', reject); });
  const wait = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) { const message = messages.find(predicate); if (message) return message; await delay(30); }
    throw new Error('Expected WebSocket message did not arrive');
  };
  await wait(message => message.type === 'state');
  return { socket, wait };
};
const denied = (id, headers) => new Promise((done, reject) => {
  const socket = new WebSocket(wsUrl(id), { headers, handshakeTimeout: 3000 });
  socket.on('error', () => { /* denied upgrade emits an error after the response */ });
  socket.once('unexpected-response', (_request, response) => { response.resume(); socket.terminate(); done(response.statusCode); });
  socket.once('open', () => { socket.terminate(); reject(new Error('Forbidden WebSocket was accepted')); });
  globalThis.setTimeout(() => { socket.terminate(); reject(new Error('Denied WebSocket did not settle')); }, 4000).unref();
});
const check = async (name, action) => { await action(); checks.push({ name, passed: true }); process.stdout.write(`PASS ${name}\n`); };
const zipCheck = async (client, doc) => {
  const response = await client.request(`/api/projects/${doc.id}/export`, 'POST', { baseRevision: doc.revision });
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /application\/zip/);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  for (const path of ['package.json', 'package-lock.json', 'src/App.tsx', 'src/runtime/StudioRuntime.tsx', 'studio-document.json', 'EXPORT_MANIFEST.json']) assert.ok(files[path], path);
  const saved = JSON.parse(strFromU8(files['studio-document.json']));
  assert.equal(saved.id, doc.id); assert.equal(saved.revision, doc.revision); assert.equal(saved.theme, doc.theme);
};
try {
  report.sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).stdout.trim();
  report.sourceDirty = Boolean(spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).stdout.trim());
  await start();
  if (!native) await check('nonroot-readonly-volume-and-node-sqlite-runtime', async () => {
    const id = (await compose('ps', '-q', 'studio')).trim();
    const [info] = JSON.parse(await command('docker', ['inspect', id]));
    assert.equal(info.Config.User, '1000:1000'); assert.equal(info.HostConfig.ReadonlyRootfs, true);
    assert.ok(info.HostConfig.CapDrop.includes('ALL'));
    assert.ok(info.HostConfig.SecurityOpt.some(value => value.startsWith('no-new-privileges')));
    assert.ok(info.HostConfig.Tmpfs['/tmp']);
    assert.ok(info.Mounts.some(mount => mount.Type === 'volume' && mount.Destination === '/data' && mount.RW));
    assert.equal(info.State.Health.Status, 'healthy');
    const runtime = await compose('exec', '-T', 'studio', 'node', '--input-type=module', '-e', "import{DatabaseSync}from'node:sqlite';const db=new DatabaseSync(':memory:');if(db.prepare('SELECT 1 AS ok').get().ok!==1)process.exit(1);db.close();console.log(JSON.stringify({node:process.version,uid:process.getuid()}))");
    const value = JSON.parse(runtime.trim().split('\n').find(line => line.startsWith('{'))); assert.equal(value.uid, 1000); assert.match(value.node, /^v24\./); report.runtime = value;
  });
  const owner = new Client(), viewer = new Client(), stranger = new Client();
  let document, viewerUser;
  await check('built-client-health-and-unconfigured-ai', async () => {
    const html = await (await globalThis.fetch(base)).text(); assert.match(html, /<div id="root"><\/div>/); assert.match(html, /\/assets\//);
    const status = await owner.json('/api/ai/status'); assert.equal(status.available, false);
    assert.equal((await owner.json('/api/session')).user, null);
  });
  await check('server-issued-session-and-project-creation', async () => {
    const created = await owner.json('/api/demo', 'POST', { name: 'Fictional Container Owner' }, 201); document = created.document;
    assert.equal(created.role, 'owner'); assert.ok(owner.cookie.startsWith('studio_session='));
    assert.equal((await owner.json('/api/session')).user.id, created.user.id);
    assert.equal((await owner.json(`/api/projects/${document.id}`)).document.id, document.id);
  });
  await check('csrf-and-unauthenticated-http-boundaries', async () => {
    assert.equal((await stranger.request(`/api/projects/${document.id}`)).status, 401);
    assert.equal((await owner.request('/api/demo', 'POST', { name: 'Fictional Denied' }, { Origin: 'https://attacker.invalid' })).status, 403);
  });
  await check('cross-project-and-websocket-origin-auth-boundaries', async () => {
    await stranger.json('/api/demo', 'POST', { name: 'Fictional Stranger' }, 201);
    assert.equal((await stranger.request(`/api/projects/${document.id}`)).status, 403);
    assert.equal(await denied(document.id, { Origin: base }), 403);
    assert.equal(await denied(document.id, { Origin: 'https://attacker.invalid', Cookie: owner.cookie }), 403);
    assert.equal(await denied(document.id, { Origin: base, Cookie: stranger.cookie }), 403);
  });
  await check('authorized-websocket-edit-is-persisted', async () => {
    const peer = await connect(owner, document.id), opId = randomUUID();
    peer.socket.send(JSON.stringify({ type: 'operation', payload: { envelope: { id: opId, projectId: document.id, baseRevision: document.revision, label: 'Fictional container theme check', operations: [{ type: 'theme', theme: 'dark' }] } } }));
    const state = await peer.wait(message => message.type === 'state' && message.opId === opId);
    const ydoc = new Y.Doc(); Y.applyUpdate(ydoc, Buffer.from(state.state, 'base64'));
    const live = JSON.parse(ydoc.getMap('studio').get('document')); assert.equal(live.theme, 'dark'); ydoc.destroy();
    document = (await owner.json(`/api/projects/${document.id}`)).document;
    assert.equal(document.revision, 1); assert.equal(document.theme, 'dark');
  });
  let viewerPeer;
  await check('viewer-http-and-websocket-edit-denied', async () => {
    const { token } = await owner.json(`/api/projects/${document.id}/invitations`, 'POST', { role: 'viewer' });
    const joined = await viewer.json('/api/join', 'POST', { token, name: 'Fictional Container Viewer' }); viewerUser = joined.user;
    assert.equal((await viewer.json(`/api/projects/${document.id}`)).role, 'viewer');
    const envelope = { id: randomUUID(), projectId: document.id, baseRevision: document.revision, label: 'Forbidden viewer edit', operations: [{ type: 'theme', theme: 'light' }] };
    assert.equal((await viewer.request(`/api/projects/${document.id}/operations`, 'POST', { envelope })).status, 403);
    viewerPeer = await connect(viewer, document.id); viewerPeer.socket.send(JSON.stringify({ type: 'operation', payload: { envelope } }));
    assert.match((await viewerPeer.wait(message => message.type === 'error' && message.opId === envelope.id)).error, /permission/i);
    assert.equal((await owner.json(`/api/projects/${document.id}`)).document.revision, 1);
  });
  await check('live-revocation-closes-socket-and-denies-reconnect', async () => {
    const closed = new Promise(done => viewerPeer.socket.once('close', done));
    await owner.json(`/api/projects/${document.id}/members/${viewerUser.id}`, 'PATCH', { role: null });
    assert.equal(await Promise.race([closed, delay(4000, undefined, { ref: false }).then(() => { throw new Error('Revoked peer remained open'); })]), 4003);
    assert.equal((await viewer.request(`/api/projects/${document.id}`)).status, 403);
    assert.equal(await denied(document.id, { Origin: base, Cookie: viewer.cookie }), 403);
  });
  await check('independent-export-contains-runtime-and-lockfile', () => zipCheck(owner, document));
  for (const peer of peers) peer.terminate(); peers.clear();
  await check('same-volume-service-restart-retains-session-project-and-permissions', async () => {
    if (native) { await stop(); await start(); } else { await compose('restart', 'studio'); await ready(); }
    const session = await owner.json('/api/session'); assert.ok(session.user); assert.ok(session.projects.some(item => item.id === document.id));
    const saved = (await owner.json(`/api/projects/${document.id}`)).document;
    assert.equal(saved.id, document.id); assert.equal(saved.revision, 1); assert.equal(saved.theme, 'dark');
    assert.equal((await viewer.request(`/api/projects/${document.id}`)).status, 403);
    await connect(owner, document.id);
    await zipCheck(owner, saved);
  });
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
  process.stderr.write(`${report.error}\n`);
} finally {
  for (const peer of peers) peer.terminate();
  await stop();
  if (composeStarted) {
    try { logs += await compose('logs', '--no-color', '--tail', '100', 'studio'); } catch { /* preserve primary failure */ }
    // This random project owns only fictional fixtures and its own named volume.
    try { await compose('down', '--volumes', '--remove-orphans'); } catch (error) { report.cleanupError = String(error); report.passed = false; process.exitCode = 1; }
  }
  report.completedAt = new Date().toISOString();
  report.passedChecks = checks.length;
  await writeFile(resolve(output, native ? 'native-report.json' : 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(resolve(output, native ? 'native-service.log' : 'service.log'), logs);
  process.stdout.write(`${report.mode}: ${checks.length} checks ${report.passed ? 'passed' : 'FAILED'}\n`);
}
