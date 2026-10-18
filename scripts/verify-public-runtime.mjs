// Real public HTTP/WSS acceptance. All identities/data are fictional.
// Session fixture is private and ignored; only report.json is shareable.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { unzipSync, strFromU8 } from 'fflate';
import * as Y from 'yjs';
const base = 'https://debotaro-studio.debotaro-studio.workers.dev';
const followup = process.argv.indexOf('--after-deploy');
const output = followup >= 0 ? resolve(process.argv[followup + 1]) : resolve('artifacts/public-runtime', randomUUID());
if (!output.startsWith(resolve('artifacts/public-runtime') + '\\') && !output.startsWith(resolve('artifacts/public-runtime') + '/')) throw new Error('Probe output must stay inside artifacts/public-runtime.');
await mkdir(output, { recursive: true });
const sockets = new Set(), checks = [];
const report = { endpoint: base, mode: followup < 0 ? 'initial-public-runtime' : 'persisted-state-after-deployment', startedAt: new Date().toISOString(), checks };
const check = async (name, fn) => { await fn(); checks.push({ name, passed: true }); process.stdout.write(`PASS ${name}\n`); };
class Client {
  constructor(cookie = '') { this.cookie = cookie; }
  async request(path, method = 'GET', body, headers = {}) {
    const response = await globalThis.fetch(base + path, { method, headers: { Origin: base, 'X-Studio-Request': '1', Cookie: this.cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: globalThis.AbortSignal.timeout(15000) });
    if (response.headers.has('set-cookie')) { const value = response.headers.get('set-cookie'); assert.match(value, /HttpOnly/); assert.match(value, /SameSite=Strict/); assert.match(value, /Secure/); this.cookie = value.split(';')[0]; }
    return response;
  }
  async json(path, method = 'GET', body, status = 200) { const response = await this.request(path, method, body); const value = await response.json(); assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(value)}`); return value; }
}
const connect = async (client, id) => {
  const socket = new WebSocket(`${base.replace('https:', 'wss:')}/collaborate?projectId=${id}`, { headers: { Origin: base, Cookie: client.cookie }, handshakeTimeout: 10000 });
  sockets.add(socket); const messages = [];
  socket.on('message', data => messages.push(JSON.parse(data.toString())));
  await new Promise((done, reject) => { socket.once('open', done); socket.once('error', reject); });
  const wait = async predicate => { for (let i = 0; i < 150; i++) { const value = messages.find(predicate); if (value) return value; await delay(40); } throw new Error('Public WebSocket message did not arrive'); };
  await wait(value => value.type === 'state'); return { socket, wait };
};
try {
  if (followup >= 0) {
    const saved = JSON.parse(await readFile(resolve(output, 'private-session-fixture.json'), 'utf8'));
    const owner = new Client(saved.ownerCookie), viewer = new Client(saved.viewerCookie);
    await check('session-project-canonical-document-retained-across-code-deployment', async () => {
      assert.ok((await owner.json('/api/session')).projects.some(item => item.id === saved.document.id));
      assert.deepEqual((await owner.json(`/api/projects/${saved.document.id}`)).document, saved.document);
    });
    await check('version-history-and-revoked-role-retained-across-code-deployment', async () => {
      const path = `/api/projects/${saved.document.id}`;
      assert.ok((await owner.json(path + '/versions')).some(item => item.id === saved.versionId));
      assert.ok((await owner.json(path + '/history')).length >= 1);
      await viewer.json(path, 'GET', undefined, 403);
      await connect(owner, saved.document.id);
    });
  } else {
    const owner = new Client(), viewer = new Client(), stranger = new Client(); let document, versionId, viewerUser;
    const path = suffix => `/api/projects/${document.id}${suffix ? '/' + suffix : ''}`;
    await check('public-health-html-assets-security-and-api-routing', async () => {
      const health = await owner.request('/api/health'); assert.equal(health.status, 200); assert.equal((await health.json()).ok, true);
      assert.equal(health.headers.get('access-control-allow-origin'), null); assert.equal(health.headers.get('cache-control'), 'no-store');
      const html = await owner.request('/'); assert.equal(html.status, 200); assert.match(await html.text(), /<div id="root"><\/div>/);
      const image = await owner.request('/screenshots/editor-desktop.png'); assert.equal(image.status, 200); assert.match(image.headers.get('content-type'), /image\/png/);
      assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
      await owner.json('/api/missing', 'GET', undefined, 404);
    });
    await check('public-secure-session-and-persistent-project-creation', async () => {
      const created = await owner.json('/api/demo', 'POST', { name: 'Fictional Public Runtime Owner' }, 201); document = created.document;
      assert.equal((await owner.json('/api/session')).user.id, created.user.id);
      assert.equal((await owner.json(path())).role, 'owner');
    });
    await check('public-authentication-csrf-and-cross-project-denials', async () => {
      await stranger.json(path(), 'GET', undefined, 401);
      await stranger.json('/api/demo', 'POST', { name: 'Fictional Public Stranger' }, 201);
      await stranger.json(path(), 'GET', undefined, 403);
      assert.equal((await owner.request('/api/demo', 'POST', { name: 'Denied' }, { Origin: 'https://attacker.invalid' })).status, 403);
      assert.equal((await owner.request('/api/demo', 'POST', { name: 'Denied' }, { 'X-Studio-Request': '' })).status, 403);
    });
    const peer = await connect(owner, document.id);
    await check('public-wss-edit-broadcast-and-sqlite-persistence', async () => {
      const op = { id: randomUUID(), projectId: document.id, baseRevision: document.revision, label: 'Fictional public acceptance edit', operations: [{ type: 'theme', theme: 'dark' }] };
      peer.socket.send(JSON.stringify({ type: 'operation', payload: { envelope: op } }));
      const state = await peer.wait(value => value.type === 'state' && value.opId === op.id);
      const ydoc = new Y.Doc(); Y.applyUpdate(ydoc, Buffer.from(state.state, 'base64')); assert.equal(JSON.parse(ydoc.getMap('studio').get('document')).theme, 'dark'); ydoc.destroy();
      document = (await owner.json(path())).document; assert.equal(document.revision, 1); assert.equal(document.theme, 'dark');
    });
    let viewerPeer;
    await check('public-invitation-viewer-read-and-write-denial', async () => {
      const { token } = await owner.json(path('invitations'), 'POST', { role: 'viewer' });
      const joined = await viewer.json('/api/join', 'POST', { token, name: 'Fictional Public Viewer' }); viewerUser = joined.user;
      assert.equal(joined.role, 'viewer'); viewerPeer = await connect(viewer, document.id);
      await viewer.json(path('operations'), 'POST', { envelope: { id: randomUUID(), projectId: document.id, baseRevision: 1, label: 'Denied', operations: [{ type: 'theme', theme: 'light' }] } }, 403);
    });
    await check('public-live-permission-revocation-closes-wss', async () => {
      const closed = new Promise(done => viewerPeer.socket.once('close', done));
      await owner.json(path(`members/${viewerUser.id}`), 'PATCH', { role: null });
      assert.equal(await Promise.race([closed, delay(10000).then(() => { throw new Error('Public revocation did not close peer'); })]), 4003);
      await viewer.json(path(), 'GET', undefined, 403);
    });
    await check('public-immutable-version-and-history', async () => {
      versionId = (await owner.json(path('versions'), 'POST', { label: 'Fictional pre-redeployment version' }, 201)).id;
      assert.ok((await owner.json(path('versions'))).some(item => item.id === versionId));
      assert.equal((await owner.json(path('history')))[0].revision, 1);
    });
    await check('public-server-generated-independent-zip', async () => {
      const response = await owner.request(path('export'), 'POST', { baseRevision: document.revision }); assert.equal(response.status, 200);
      const zip = new Uint8Array(await response.arrayBuffer()), files = unzipSync(zip);
      assert.equal(JSON.parse(strFromU8(files['studio-document.json'])).id, document.id); assert.ok(files['package-lock.json']); assert.ok(files['src/runtime/StudioRuntime.tsx']);
      await writeFile(resolve(output, 'public-export.zip'), zip);
      report.export = { fileCount: Object.keys(files).length, sha256: createHash('sha256').update(zip).digest('hex') };
    });
    await writeFile(resolve(output, 'private-session-fixture.json'), JSON.stringify({ ownerCookie: owner.cookie, viewerCookie: viewer.cookie, document, versionId }));
  }
  report.passed = true;
} catch (error) { report.passed = false; report.error = String(error); process.exitCode = 1; }
finally {
  for (const socket of sockets) socket.terminate();
  report.completedAt = new Date().toISOString();
  await writeFile(resolve(output, followup < 0 ? 'report.json' : 'after-deploy-report.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`${checks.length} public checks ${report.passed ? 'passed' : 'FAILED'}; ${output}${report.error ? '\n' + report.error : ''}\n`);
}
