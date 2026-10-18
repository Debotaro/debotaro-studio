// Real bundled workerd + SQLite Durable Object. Fictional isolated data, AI disabled.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { Miniflare } from 'miniflare';
import { unzipSync, strFromU8 } from 'fflate';
import * as Y from 'yjs';

const output = resolve('artifacts/edge-verification', randomUUID());
await mkdir(output, { recursive: true });
const origin = 'https://studio.test';
const sockets = new Set(), checks = [];
const configuration = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
let runtime;
const report = { runtime: 'workerd + SQLite Durable Object (Miniflare)', fixture: 'fictional-isolated', liveInference: false, output, startedAt: new Date().toISOString(), checks };
const start = (overrides = {}) => { runtime = new Miniflare({ modules: true, scriptPath: 'edge-dist/index.js', compatibilityDate: configuration.compatibility_date, compatibilityFlags: configuration.compatibility_flags, durableObjects: { STUDIO: { className: 'StudioAuthority', useSQLite: true } }, bindings: { ...configuration.vars, ...overrides, AI_PROVIDER: 'disabled' }, serviceBindings: { ASSETS: () => new globalThis.Response('fixture-static-asset') }, durableObjectsPersist: resolve(output, 'storage') }); };
class Client {
  cookie = '';
  async request(path, method = 'GET', body, headers = {}) {
    const response = await runtime.dispatchFetch(origin + path, { method, headers: { Origin: origin, 'X-Studio-Request': '1', Cookie: this.cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const cookie = response.headers.get('set-cookie');
    if (cookie) { assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Secure/); this.cookie = cookie.split(';')[0]; }
    return response;
  }
  async json(path, method = 'GET', body, status = 200) {
    const response = await this.request(path, method, body);
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
    return result;
  }
}
const check = async (name, action) => { await action(); checks.push({ name, passed: true }); process.stdout.write(`PASS ${name}\n`); };
const connect = async (client, id, extra = {}) => {
  const response = await runtime.dispatchFetch(`${origin}/collaborate?projectId=${id}`, { headers: { Upgrade: 'websocket', Origin: origin, Cookie: client.cookie, ...extra } });
  if (response.status !== 101) return { status: response.status };
  const socket = response.webSocket, messages = [];
  sockets.add(socket);
  socket.addEventListener('message', event => messages.push(JSON.parse(event.data)));
  socket.accept();
  const wait = async predicate => {
    for (let i = 0; i < 100; i++) { const value = messages.find(predicate); if (value) return value; await delay(20); }
    throw new Error('Expected collaboration message did not arrive');
  };
  await wait(message => message.type === 'state');
  return { status: 101, socket, wait };
};
const closeSockets = async () => { for (const socket of sockets) { try { socket.close(1000, 'Probe complete'); } catch { /* already closed */ } } sockets.clear(); await delay(50); };
const envelope = (doc, operations, label = 'Fictional runtime operation') => ({ id: randomUUID(), projectId: doc.id, baseRevision: doc.revision, label, operations });
const owner = new Client(), viewer = new Client(), editor = new Client(), stranger = new Client();
let document, ownerPeer, viewerPeer, editorPeer, viewerUser, editorUser, version, viewerToken;
const path = suffix => `/api/projects/${document.id}${suffix ? '/' + suffix : ''}`;
try {
  start();
  await check('health-static-routing-unknown-api-and-disabled-ai', async () => {
    assert.equal((await owner.json('/api/health')).ok, true);
    assert.equal(await (await owner.request('/')).text(), 'fixture-static-asset');
    await owner.json('/api/missing', 'GET', undefined, 404);
    await owner.json('/api', 'GET', undefined, 404);
    assert.equal((await owner.json('/api/ai/status')).available, false);
  });
  await check('secure-server-issued-identity-and-sqlite-project', async () => {
    assert.equal((await owner.json('/api/session')).user, null);
    const result = await owner.json('/api/demo', 'POST', { name: 'Fictional Edge Owner' }, 201);
    document = result.document; assert.equal(result.role, 'owner');
    assert.equal((await owner.json('/api/session')).user.id, result.user.id);
    assert.equal((await owner.json(path())).document.id, document.id);
  });
  await check('http-origin-csrf-schema-and-cross-project-boundaries', async () => {
    await stranger.json(path(), 'GET', undefined, 401);
    assert.equal((await owner.request('/api/demo', 'POST', { name: 'Denied' }, { Origin: 'https://attacker.invalid' })).status, 403);
    assert.equal((await owner.request('/api/demo', 'POST', { name: 'Denied' }, { 'X-Studio-Request': '' })).status, 403);
    assert.equal((await owner.request('/api/demo', 'POST', { name: 'Denied' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    await owner.json('/api/demo', 'POST', { name: '', extra: true }, 400);
    await stranger.json('/api/demo', 'POST', { name: 'Fictional Edge Stranger' }, 201);
    await stranger.json(path(), 'GET', undefined, 403);
  });
  await check('authenticated-websocket-upgrade-and-origin-boundaries', async () => {
    assert.equal((await connect(new Client(), document.id)).status, 403);
    assert.equal((await connect(stranger, document.id)).status, 403);
    assert.equal((await connect(owner, document.id, { Origin: 'https://attacker.invalid' })).status, 403);
    ownerPeer = await connect(owner, document.id); assert.equal(ownerPeer.status, 101);
  });
  await check('native-websocket-edit-broadcast-and-operation-idempotency', async () => {
    const op = envelope(document, [{ type: 'theme', theme: 'dark' }]);
    ownerPeer.socket.send(JSON.stringify({ type: 'operation', payload: { envelope: op } }));
    const state = await ownerPeer.wait(message => message.opId === op.id && message.type === 'state');
    const ydoc = new Y.Doc(); Y.applyUpdate(ydoc, Buffer.from(state.state, 'base64'));
    assert.equal(JSON.parse(ydoc.getMap('studio').get('document')).theme, 'dark'); ydoc.destroy();
    document = (await owner.json(path())).document; assert.equal(document.revision, 1);
    await owner.json(path('operations'), 'POST', { envelope: op });
    assert.equal((await owner.json(path())).document.revision, 1);
  });
  await check('viewer-invitation-rejects-http-and-websocket-edit', async () => {
    const { token } = await owner.json(path('invitations'), 'POST', { role: 'viewer' });
    viewerToken = token;
    const result = await viewer.json('/api/join', 'POST', { token, name: 'Fictional Edge Viewer' });
    viewerUser = result.user; assert.equal(result.role, 'viewer');
    const op = envelope(document, [{ type: 'theme', theme: 'light' }]);
    await viewer.json(path('operations'), 'POST', { envelope: op }, 403);
    viewerPeer = await connect(viewer, document.id);
    viewerPeer.socket.send(JSON.stringify({ type: 'operation', payload: { envelope: op } }));
    assert.match((await viewerPeer.wait(message => message.type === 'error' && message.opId === op.id)).error, /permission/i);
  });
  await check('two-editor-presence-and-http-operation-broadcast', async () => {
    const { token } = await owner.json(path('invitations'), 'POST', { role: 'editor' });
    const result = await editor.json('/api/join', 'POST', { token, name: 'Fictional Edge Editor' }); editorUser = result.user;
    editorPeer = await connect(editor, document.id);
    editorPeer.socket.send(JSON.stringify({ type: 'presence', payload: { selection: 'workspace-title' } }));
    await ownerPeer.wait(message => message.type === 'presence' && message.people.some(person => person.id === editorUser.id && person.selection === 'workspace-title'));
    const op = envelope(document, [{ type: 'theme', theme: 'light' }]);
    document = (await editor.json(path('operations'), 'POST', { envelope: op })).document;
    await ownerPeer.wait(message => message.type === 'state' && message.opId === op.id);
    assert.equal(document.revision, 2);
  });
  await check('atomic-undo-history-and-version-restore-in-real-sqlite', async () => {
    document = (await editor.json(path('undo'), 'POST', {})).document;
    assert.equal(document.theme, 'dark'); assert.equal(document.revision, 3);
    version = await owner.json(path('versions'), 'POST', { label: 'Fictional saved version' }, 201);
    const op = envelope(document, [{ type: 'theme', theme: 'light' }]);
    document = (await owner.json(path('operations'), 'POST', { envelope: op })).document;
    document = (await owner.json(path('restore'), 'POST', { versionId: version.id, baseRevision: document.revision })).document;
    assert.equal(document.theme, 'dark'); assert.equal(document.revision, 5);
    assert.ok((await owner.json(path('history'))).length >= 5);
    assert.ok((await owner.json(path('versions'))).some(item => item.id === version.id));
  });
  await check('live-role-revocation-closes-socket-and-invalidates-invitation', async () => {
    const closed = new Promise(done => viewerPeer.socket.addEventListener('close', event => done(event.code), { once: true }));
    await owner.json(path(`members/${viewerUser.id}`), 'PATCH', { role: null });
    assert.equal(await Promise.race([closed, delay(3000).then(() => { throw new Error('Revocation did not close socket'); })]), 4003);
    await viewer.json(path(), 'GET', undefined, 403);
    assert.equal((await connect(viewer, document.id)).status, 403);
    await new Client().json('/api/join', 'POST', { token: viewerToken, name: 'Fictional Denied Rejoin' }, 400);
  });
  await check('server-generated-zip-with-independent-runtime-and-source-lock', async () => {
    const response = await owner.request(path('export'), 'POST', { baseRevision: document.revision });
    assert.equal(response.status, 200); assert.match(response.headers.get('Content-Type'), /application\/zip/);
    const archive = new Uint8Array(await response.arrayBuffer()), files = unzipSync(archive);
    for (const name of ['package.json', 'package-lock.json', 'src/App.tsx', 'src/runtime/StudioRuntime.tsx', 'studio-document.json', 'EXPORT_MANIFEST.json']) assert.ok(files[name], name);
    assert.equal(JSON.parse(strFromU8(files['studio-document.json'])).revision, document.revision);
    await writeFile(resolve(output, 'export.zip'), archive);
    report.export = { sha256: createHash('sha256').update(archive).digest('hex'), fileCount: Object.keys(files).length };
    await owner.json(path('export'), 'POST', { baseRevision: 0 }, 400);
  });
  await check('cold-runtime-restart-retains-identities-documents-history-roles-and-versions', async () => {
    await closeSockets(); await runtime.dispose(); start();
    assert.ok((await owner.json('/api/session')).projects.some(item => item.id === document.id));
    const saved = (await owner.json(path())).document;
    assert.deepEqual(saved, document);
    assert.equal((await editor.json(path())).role, 'editor');
    await viewer.json(path(), 'GET', undefined, 403);
    assert.ok((await owner.json(path('versions'))).some(item => item.id === version.id));
    assert.ok((await owner.json(path('history'))).length >= 5);
    assert.equal((await connect(owner, document.id)).status, 101);
  });
  await check('durable-capacity-refusal-preserves-saved-work-and-rolls-back-new-identity', async () => {
    await closeSockets(); await runtime.dispose(); start({ STUDIO_MAX_PROJECTS: '2' });
    const newcomer = new Client();
    await newcomer.json('/api/demo', 'POST', { name: 'Fictional Capacity Refusal' }, 429);
    assert.equal((await newcomer.json('/api/session')).user, null);
    assert.deepEqual((await owner.json(path())).document, document);
    await owner.json(path('ai/propose'), 'POST', { prompt: 'Use a light theme', baseRevision: document.revision }, 503);
  });
  report.passed = true;
} catch (error) { report.passed = false; report.error = String(error); process.exitCode = 1; process.stderr.write(`${String(error)}\n`); }
finally {
  await closeSockets(); await runtime?.dispose();
  report.completedAt = new Date().toISOString(); report.passedChecks = checks.length;
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`${checks.length} workerd checks ${report.passed ? 'passed' : 'FAILED'}; ${output}\n`);
}
