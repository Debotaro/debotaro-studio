import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNode, serializeDocument } from '../../src/core/document';
import type { AIProposal, StudioDocument, Version } from '../../src/core/types';
import { Store } from '../../server/store';
import { resolveDemoLimits } from '../../server/limits';
import * as aiService from '../../server/ai';
import { ApiClient, deniedWebSocket, envelope, Peer, startStudio, type RunningStudio } from './helpers';

const running = new Set<RunningStudio>();
const peers = new Set<Peer>();
const stores = new Set<Store>();
const pendingFixtures = new Set<() => void>();
afterEach(async () => {
  pendingFixtures.forEach(cancel => cancel()); pendingFixtures.clear();
  peers.forEach(peer => peer.destroy()); peers.clear();
  for (const studio of running) await studio.close(); running.clear();
  stores.forEach(store => store.close()); stores.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function start(directory?: string, options?: Parameters<typeof startStudio>[1]) {
  const studio = await startStudio(directory, options); running.add(studio); return studio;
}
async function stop(studio: RunningStudio) { await studio.close(); running.delete(studio); }
async function connect(client: ApiClient, id: string, previous?: Peer) {
  const peer = await Peer.connect(client, id, previous?.document); peers.add(peer); return peer;
}
function directory() {
  const parent = resolve('artifacts', 'server-tests'); mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, 'capacity-'));
}
function storeAt(path: string, overrides: Parameters<typeof resolveDemoLimits>[0] = {}) {
  const store = new Store(path, resolveDemoLimits(overrides)); stores.add(store); return store;
}
function closeStore(store: Store) { store.close(); stores.delete(store); }
function databaseState(studio: RunningStudio, id: string) {
  const row = studio.store.db.prepare('SELECT document,ystate FROM projects WHERE id=?').get(id)!;
  return { document: row.document, state: Array.from(row.ystate as Uint8Array), history: studio.store.db.prepare('SELECT * FROM history WHERE project_id=? ORDER BY revision').all(id) };
}
async function expectExport(client: ApiClient, document: StudioDocument) {
  const response = await client.request(`/api/projects/${document.id}/export`, 'POST', { baseRevision: document.revision });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/zip');
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  expect(strFromU8(files['src/App.tsx'])).toContain(document.id);
  expect(files['package-lock.json']).toBeDefined();
}
const edit = (document: StudioDocument, name: string) => ({ envelope: envelope(document, [{ type: 'update', nodeId: 'workspace-title', patch: { name } }]) });

describe('bounded fictional demo — actual HTTP, WebSocket and SQLite behavior', () => {
  it('enforces owner and global project limits atomically while existing projects remain readable/exportable', async () => {
    const studio = await start(undefined, { limits: { projects: 2, projectsPerOwner: 1 } });
    const owner = new ApiClient(studio), first = await owner.demo('First capacity owner');
    const counts = () => ['projects', 'members', 'versions', 'users', 'sessions'].map(table => studio.store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count);
    expect(counts()).toEqual([1, 1, 1, 1, 1]);
    const deniedOwner = await owner.request('/api/demo', 'POST', { name: 'First capacity owner' });
    expect(deniedOwner.status).toBe(429); expect(await deniedOwner.json()).toMatchObject({ code: 'DEMO_CAPACITY', error: expect.stringMatching(/project/i) });
    expect(counts()).toEqual([1, 1, 1, 1, 1]);
    const secondOwner = new ApiClient(studio), second = await secondOwner.demo('Second capacity owner');
    const deniedClient = new ApiClient(studio);
    const deniedGlobal = await deniedClient.request('/api/demo', 'POST', { name: 'Third capacity owner' });
    expect(deniedGlobal.status).toBe(429); expect(counts()).toEqual([2, 2, 2, 2, 2]); expect(deniedClient.cookie).toBe('');
    const invalidJoin = await deniedClient.request('/api/join', 'POST', { name: 'Unknown invite identity', token: '0'.repeat(48) });
    expect(invalidJoin.status).toBe(400); expect(counts()).toEqual([2, 2, 2, 2, 2]); expect(deniedClient.cookie).toBe('');
    expect(await owner.read(first.id)).toEqual(first); expect(await secondOwner.read(second.id)).toEqual(second);
    await expectExport(owner, first);
  });

  it('retains immutable versions at their cap and permits reads/export after restart with lower project limits', async () => {
    let studio = await start(undefined, { limits: { projects: 3, projectsPerOwner: 3, versionsPerProject: 2 } });
    let owner = new ApiClient(studio); const first = await owner.demo('Version capacity owner'), second = await owner.demo('Version capacity owner');
    const created = await owner.request(`/api/projects/${first.id}/versions`, 'POST', { label: 'Last allowed immutable snapshot' });
    expect(created.status).toBe(201);
    const versions = await (await owner.request(`/api/projects/${first.id}/versions`)).json() as Version[];
    expect(versions).toHaveLength(2); expect(versions.some(version => version.label === 'Starting point')).toBe(true);
    const denied = await owner.request(`/api/projects/${first.id}/versions`, 'POST', { label: 'Must not evict an old snapshot' });
    expect(denied.status).toBe(429); expect(await (await owner.request(`/api/projects/${first.id}/versions`)).json()).toEqual(versions);
    const path = studio.directory, cookie = owner.cookie; await stop(studio);
    studio = await start(path, { limits: { projects: 1, projectsPerOwner: 1, versionsPerProject: 1 } }); owner = new ApiClient(studio); owner.cookie = cookie;
    expect(await owner.read(first.id)).toEqual(first); expect(await owner.read(second.id)).toEqual(second);
    expect(await (await owner.request(`/api/projects/${first.id}/versions`)).json()).toEqual(versions);
    expect((await owner.request('/api/demo', 'POST', { name: 'No hidden eviction' })).status).toBe(429);
    expect((await owner.request(`/api/projects/${first.id}/versions`, 'POST', { label: 'Still full' })).status).toBe(429);
    await expectExport(owner, first);
  });

  it('rejects history-cap HTTP/WS writes without CRDT mutation and deduplicates accepted retries across reconnect/restart', async () => {
    let studio = await start(undefined, { limits: { historyPerProject: 1 } });
    let owner = new ApiClient(studio); const document = await owner.demo('History capacity owner');
    const peer = await connect(owner, document.id), accepted = edit(document, 'Only committed history entry');
    expect((await owner.submit(document.id, accepted)).status).toBe(200); await peer.revision(1);
    const committed = peer.current, state = databaseState(studio, document.id);
    const rejected = edit(committed, 'This must not be committed');
    const response = await owner.submit(document.id, rejected); expect(response.status).toBe(429);
    peer.send('operation', rejected);
    expect((await peer.wait(message => message.type === 'error' && message.opId === rejected.envelope.id)).error).toMatch(/history|capacity|limit/i);
    expect(databaseState(studio, document.id)).toEqual(state); expect(peer.current).toEqual(committed);
    expect((await owner.submit(document.id, accepted)).status).toBe(200);
    const from = peer.messages.length; peer.send('operation', accepted);
    await peer.wait(message => message.type === 'state' && message.opId === accepted.envelope.id, from);
    expect(databaseState(studio, document.id)).toEqual(state);
    const path = studio.directory, cookie = owner.cookie; await stop(studio);
    studio = await start(path, { limits: { historyPerProject: 1 } }); owner = new ApiClient(studio); owner.cookie = cookie;
    const reconnected = await connect(owner, document.id, peer); expect(reconnected.current).toEqual(committed);
    expect((await owner.submit(document.id, accepted)).status).toBe(200);
    expect((await owner.submit(document.id, rejected)).status).toBe(429);
    expect(databaseState(studio, document.id)).toEqual(state); await expectExport(owner, committed);
  });

  it('counts undo, inspected restore and explicitly reviewed AI fixture changes against the same history cap', async () => {
    const studio = await start(undefined, { limits: { historyPerProject: 1 } });
    const owner = new ApiClient(studio), document = await owner.demo('Shared history bound');
    const initial = studio.store.versions(document.id)[0];
    expect((await owner.submit(document.id, edit(document, 'Cap reached'))).status).toBe(200);
    const current = await owner.read(document.id); studio.engine.state(document.id); const state = databaseState(studio, document.id);
    const fixture: AIProposal = { projectId: document.id, baseRevision: 1, summary: 'Explicit validation fixture; no inference.', groups: [{ id: 'rename', title: 'Rename heading', dependsOn: [], operations: [{ type: 'update', nodeId: 'workspace-title', patch: { name: 'Reviewed but capacity denied' } }] }] };
    for (const [path, body] of [
      ['undo', {}], ['restore', { versionId: initial.id, baseRevision: 1 }], ['ai/apply', { proposal: fixture, groups: ['rename'] }],
    ] as const) expect((await owner.request(`/api/projects/${document.id}/${path}`, 'POST', body)).status).toBe(429);
    expect(databaseState(studio, document.id)).toEqual(state); expect(await owner.read(document.id)).toEqual(current);
    expect(studio.store.versions(document.id)).toHaveLength(1);
  });

  it('migrates v1 metadata additively without changing sessions, documents, history, versions or causal state', async () => {
    let studio = await start(); let owner = new ApiClient(studio); const document = await owner.demo('Existing v1 identity');
    const peer = await connect(owner, document.id);
    expect((await owner.submit(document.id, edit(document, 'Saved before additive migration'))).status).toBe(200); await peer.revision(1);
    expect((await owner.request(`/api/projects/${document.id}/versions`, 'POST', { label: 'Existing immutable v1 snapshot' })).status).toBe(201);
    const saved = databaseState(studio, document.id), versions = studio.store.versions(document.id), cookie = owner.cookie, path = studio.directory;
    await stop(studio);
    const legacy = new DatabaseSync(join(path, 'studio.sqlite')); legacy.exec('DROP TABLE ai_usage; PRAGMA user_version=1;'); legacy.close();
    studio = await start(path); owner = new ApiClient(studio); owner.cookie = cookie;
    expect(studio.store.db.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
    expect(studio.store.db.prepare('SELECT COUNT(*) AS count FROM ai_usage').get()?.count).toBe(0);
    expect(databaseState(studio, document.id)).toEqual(saved); expect(studio.store.versions(document.id)).toEqual(versions);
    const reconnected = await connect(owner, document.id, peer); expect(reconnected.current.revision).toBe(1);
    expect((await owner.submit(document.id, edit(reconnected.current, 'Successfully edited after migration'))).status).toBe(200);
    await reconnected.revision(2); expect(reconnected.current.nodes['workspace-title'].name).toBe('Successfully edited after migration');
  });

  it('reports real SQLite exhaustion as507 with its original error, preserves state, and recovers after operator space release', async () => {
    const studio = await start(undefined, { limits: { databaseBytes: 262144 } });
    const owner = new ApiClient(studio), document = await owner.demo('Storage capacity owner'), peer = await connect(owner, document.id);
    const before = databaseState(studio, document.id), editAtFull = edit(document, 'A recoverable pending edit');
    studio.store.db.exec('CREATE TABLE capacity_filler(value BLOB NOT NULL)');
    const insert = studio.store.db.prepare('INSERT INTO capacity_filler VALUES(zeroblob(?))');
    let observedFull = false;
    for (const size of [16384, 1024]) {
      for (let attempt = 0; attempt < 300; attempt++) {
        try { insert.run(size); } catch (error) { expect((error as Error).message).toMatch(/full/i); observedFull = true; break; }
      }
    }
    expect(observedFull).toBe(true);
    const denied = await owner.submit(document.id, editAtFull); expect(denied.status).toBe(507);
    const error = await denied.json() as { error: string }; expect(error.error).toMatch(/storage|full|capacity/i); expect(error.error).not.toMatch(/no transaction|rollback/i);
    expect(databaseState(studio, document.id)).toEqual(before); expect(peer.current).toEqual(document); expect(await owner.read(document.id)).toEqual(document);
    studio.store.db.exec('DROP TABLE capacity_filler');
    expect((await owner.submit(document.id, editAtFull)).status).toBe(200); await peer.revision(1);
    expect(peer.current.nodes['workspace-title'].name).toBe('A recoverable pending edit');
  });

  it('refuses startup under a database-page limit smaller than saved data without removing existing records', async () => {
    const path = directory(), store = storeAt(path);
    const user = store.createUser('Retained storage owner'); const session = store.createSession(user);
    store.db.exec('CREATE TABLE retained_fixture(value BLOB)'); store.db.prepare('INSERT INTO retained_fixture VALUES(zeroblob(?))').run(131072);
    closeStore(store);
    expect(() => new Store(path, resolveDemoLimits({ databaseBytes: 65536 }))).toThrow(/storage|database|capacity|limit/i);
    const restored = storeAt(path); expect(restored.userForSession(session)).toEqual(user);
    expect(restored.db.prepare('SELECT length(value) AS size FROM retained_fixture').get()?.size).toBe(131072);
  });

  it('atomically reserves global and per-user daily AI allowance without charging denied callers', () => {
    const store = storeAt(directory(), { aiRequestsPerDay: 2, aiRequestsPerUserPerDay: 1 });
    const [a, b, c] = ['Allowed A', 'Allowed B', 'Denied C'].map(name => store.createUser(name));
    const now = Date.UTC(2026, 9, 15, 10);
    expect(() => store.reserveAI(a.id, now)).not.toThrow();
    const firstRows = store.db.prepare('SELECT * FROM ai_usage ORDER BY scope').all();
    expect(() => store.reserveAI(a.id, now)).toThrow(/allowance|daily|limit|capacity/i);
    expect(store.db.prepare('SELECT * FROM ai_usage ORDER BY scope').all()).toEqual(firstRows);
    expect(() => store.reserveAI(b.id, now)).not.toThrow();
    const fullRows = store.db.prepare('SELECT * FROM ai_usage ORDER BY scope').all();
    expect(fullRows.map(row => row.requests).sort()).toEqual([1, 1, 2]);
    expect(() => store.reserveAI(c.id, now)).toThrow(/allowance|daily|limit|capacity/i);
    expect(store.db.prepare('SELECT * FROM ai_usage ORDER BY scope').all()).toEqual(fullRows);
  });

  it('fails closed on corrupt persisted AI counters, retains raw ledger/design data, and resumes only after operator repair', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'explicit-non-live-ledger-fixture'); vi.stubEnv('OPENAI_MODEL', 'explicit-non-live-fixture');
    const provider = vi.spyOn(aiService, 'proposeChanges').mockRejectedValue(new Error('The corrupt-ledger fixture must never reach inference'));
    const now = Date.UTC(2026, 9, 15), today = Math.floor(now / 86400000);
    const studio = await start(undefined, { limits: { aiRequestsPerDay: 2, aiRequestsPerUserPerDay: 2 }, now: () => now });
    const owner = new ApiClient(studio), document = await owner.demo('Counter recovery owner'); studio.engine.state(document.id);
    const beforeDesign = databaseState(studio, document.id);
    const userScope = `user:${owner.user!.id}`;
    const ledger = () => studio.store.db.prepare('SELECT scope,CAST(day AS TEXT) AS day,typeof(day) AS day_type,CAST(requests AS TEXT) AS requests,typeof(requests) AS requests_type FROM ai_usage ORDER BY scope').all();
    const repair = () => {
      for (const scope of ['global', userScope]) studio.store.db.prepare('INSERT INTO ai_usage VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET day=excluded.day,requests=excluded.requests').run(scope, today, 0);
    };
    for (const scope of ['global', userScope]) {
      for (const [field, value] of [
        ['requests', -1], ['requests', 0.5], ['requests', 'corrupt-count'], ['requests', Number.MAX_SAFE_INTEGER + 1],
        ['day', -1], ['day', 0.5], ['day', 'corrupt-day'], ['day', Number.MAX_SAFE_INTEGER + 1],
      ] as const) {
        repair(); studio.store.db.prepare(`UPDATE ai_usage SET ${field}=? WHERE scope=?`).run(value, scope);
        const beforeLedger = ledger(); let failure: unknown;
        try { studio.store.reserveAI(owner.user!.id, now); } catch (error) { failure = error; }
        expect(failure, `${scope} ${field}=${value} must reject before allowance/reset logic`).toMatchObject({ status: 503, code: 'AI_USAGE_RECOVERY' });
        const denied = await owner.request(`/api/projects/${document.id}/ai/propose`, 'POST', { prompt: 'Adjust a heading', baseRevision: 0 });
        expect(denied.status).toBe(503); expect(await denied.json()).toMatchObject({ code: 'AI_USAGE_RECOVERY' }); expect(provider).not.toHaveBeenCalled();
        expect(ledger()).toEqual(beforeLedger); expect(databaseState(studio, document.id)).toEqual(beforeDesign);
        repair(); expect(() => studio.store.reserveAI(owner.user!.id, now)).not.toThrow();
        expect(studio.store.db.prepare('SELECT requests FROM ai_usage ORDER BY scope').all().map(row => row.requests)).toEqual([1, 1]);
      }
    }
    expect(await owner.read(document.id)).toEqual(document);
  });

  it.each([{ aiRequestsPerDay: 0 }, { aiRequestsPerUserPerDay: 0 }])('zero allowance disables reservations without creating counters: %j', limits => {
    const store = storeAt(directory(), limits), user = store.createUser('AI disabled');
    expect(() => store.reserveAI(user.id, Date.UTC(2026, 9, 15))).toThrow(/disabled|allowance|daily|limit|capacity/i);
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM ai_usage').get()?.count).toBe(0);
  });

  it('persists AI counters over restart, advances on UTC-day rollover, and never resets a future bucket on clock rollback', () => {
    const path = directory(), limits = { aiRequestsPerDay: 2, aiRequestsPerUserPerDay: 1 };
    let store = storeAt(path, limits); const a = store.createUser('Persistent A'), b = store.createUser('Persistent B');
    const day1 = Date.UTC(2026, 9, 15, 23, 59), day2 = Date.UTC(2026, 9, 16, 0, 1), day3 = Date.UTC(2026, 9, 17, 0, 1);
    store.reserveAI(a.id, day1); closeStore(store); store = storeAt(path, limits);
    expect(() => store.reserveAI(a.id, day1)).toThrow();
    expect(() => store.reserveAI(a.id, day2)).not.toThrow();
    const futureRows = store.db.prepare('SELECT * FROM ai_usage ORDER BY scope').all();
    expect(() => store.reserveAI(a.id, day1)).toThrow(); expect(store.db.prepare('SELECT * FROM ai_usage ORDER BY scope').all()).toEqual(futureRows);
    expect(() => store.reserveAI(b.id, day1)).not.toThrow();
    expect(store.db.prepare('SELECT day,requests FROM ai_usage WHERE scope=?').get('global')).toEqual({ day: Math.floor(day2 / 86400000), requests: 2 });
    expect(() => store.reserveAI(b.id, day2)).toThrow(); expect(() => store.reserveAI(b.id, day1)).toThrow();
    expect(() => store.reserveAI(a.id, day3)).not.toThrow();
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM ai_usage').get()?.count).toBe(3);
  });

  it('does not charge no-key, unauthorized, malformed or stale AI HTTP proposals', async () => {
    vi.stubEnv('OPENAI_API_KEY', ''); vi.stubEnv('OPENAI_MODEL', '');
    const studio = await start(undefined, { limits: { aiRequestsPerDay: 1, aiRequestsPerUserPerDay: 1 }, now: () => Date.UTC(2026, 9, 15) });
    const owner = new ApiClient(studio), document = await owner.demo('Uncharged request owner');
    const viewer = new ApiClient(studio); await viewer.join(await owner.invite(document.id, 'viewer'), 'Uncharged viewer');
    const anonymous = new ApiClient(studio), outsider = new ApiClient(studio); await outsider.demo('Other private owner');
    const path = `/api/projects/${document.id}/ai/propose`, valid = { prompt: 'Adjust the heading', baseRevision: 0 };
    for (const [client, body, status] of [[anonymous, valid, 401], [viewer, valid, 403], [outsider, valid, 403], [owner, { ...valid, prompt: '' }, 400], [owner, { ...valid, baseRevision: 99 }, 400], [owner, valid, 503]] as const) {
      const response = await client.request(path, 'POST', body); expect(response.status).toBe(status);
      expect(studio.store.db.prepare('SELECT COUNT(*) AS count FROM ai_usage').get()?.count).toBe(0);
    }
    expect(await owner.read(document.id)).toEqual(document);
  });

  it('does not charge oversized context or concurrent denials, and releases AI slots after explicit non-live failure/cancellation fixtures', async () => {
    // This internal module spy is an automated fixture, never a live provider or public adapter seam.
    vi.stubEnv('OPENAI_API_KEY', 'explicit-non-live-capacity-fixture'); vi.stubEnv('OPENAI_MODEL', 'explicit-non-live-fixture');
    const completions: ((result: AIProposal | Error) => void)[] = [];
    const signals: AbortSignal[] = [];
    const propose = vi.spyOn(aiService, 'proposeChanges').mockImplementation(({ signal }) => new Promise<AIProposal>((done, reject) => {
      const cancelFixture = () => reject(new Error('Explicit non-live test cleanup')); pendingFixtures.add(cancelFixture);
      signals.push(signal!);
      signal!.addEventListener('abort', () => { pendingFixtures.delete(cancelFixture); reject(new Error('Explicit non-live cancellation fixture')); }, { once: true });
      completions.push(result => { pendingFixtures.delete(cancelFixture); if (result instanceof Error) reject(result); else done(result); });
    }));
    const studio = await start(undefined, { limits: { aiConcurrent: 1, aiRequestsPerDay: 5, aiRequestsPerUserPerDay: 5 } });
    const owner = new ApiClient(studio), document = await owner.demo('AI concurrency fixture owner');
    const oversized = await owner.demo('Oversized context fixture');
    const operations = Array.from({ length: 35 }, (_, index) => {
      const node = createNode('Text', `context-budget-${index}`); node.props.text = 'x'.repeat(4000);
      return { type: 'insert' as const, node, parentId: oversized.rootId, index };
    });
    studio.engine.submit(owner.user!, oversized.id, { envelope: envelope(oversized, operations, 'Explicit oversized-context test fixture') });
    const contextDenied = await owner.request(`/api/projects/${oversized.id}/ai/propose`, 'POST', { prompt: 'Adjust a heading', baseRevision: 1 });
    expect(contextDenied.status).toBe(400); expect(await contextDenied.json()).toMatchObject({ error: expect.stringContaining('context budget') });
    expect(propose).not.toHaveBeenCalled(); expect(studio.store.db.prepare('SELECT COUNT(*) AS count FROM ai_usage').get()?.count).toBe(0);
    const path = `/api/projects/${document.id}/ai/propose`, body = { prompt: 'Adjust a heading', baseRevision: 0 };
    const first = owner.request(path, 'POST', body);
    await vi.waitFor(() => expect(propose).toHaveBeenCalledTimes(1));
    const busy = await owner.request(path, 'POST', body); expect(busy.status).toBe(429); expect(await busy.json()).toMatchObject({ code: 'AI_BUSY' });
    expect(studio.store.db.prepare('SELECT requests FROM ai_usage ORDER BY scope').all().map(row => row.requests)).toEqual([1, 1]);
    completions[0](new Error('Explicit non-live provider failure fixture'));
    expect((await first).status).toBe(400);
    const cancellation = new AbortController();
    const cancelled = fetch(studio.base + path, { method: 'POST', signal: cancellation.signal, headers: { Cookie: owner.cookie, Origin: studio.base, 'X-Studio-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(error => error as Error);
    await vi.waitFor(() => expect(propose).toHaveBeenCalledTimes(2));
    cancellation.abort(); expect(await cancelled).toBeInstanceOf(Error);
    await vi.waitFor(() => expect(signals[1].aborted).toBe(true));
    await Promise.resolve(propose.mock.results[1].value).catch(() => undefined);
    const final = owner.request(path, 'POST', body);
    await vi.waitFor(() => expect(propose).toHaveBeenCalledTimes(3));
    const fixture: AIProposal = { projectId: document.id, baseRevision: 0, summary: 'Explicit non-live completion fixture.', groups: [{ id: 'rename', title: 'Rename', dependsOn: [], operations: [{ type: 'update', nodeId: 'workspace-title', patch: { name: 'Proposal only' } }] }] };
    completions[2](fixture); expect((await final).status).toBe(200);
    expect(studio.store.db.prepare('SELECT requests FROM ai_usage ORDER BY scope').all().map(row => row.requests)).toEqual([3, 3]);
    expect(await owner.read(document.id)).toEqual(document);
  });

  it('caps user/global live connections, rejects unauthorized upgrades first, and releases slots on close/revocation', async () => {
    const studio = await start(undefined, { limits: { connections: 2, connectionsPerUser: 1 } });
    const owner = new ApiClient(studio), document = await owner.demo('Socket capacity owner');
    const editor = new ApiClient(studio); await editor.join(await owner.invite(document.id, 'editor'), 'Socket editor');
    const viewer = new ApiClient(studio); await viewer.join(await owner.invite(document.id, 'viewer'), 'Socket viewer');
    const ownerPeer = await connect(owner, document.id);
    expect(await deniedWebSocket(studio, document.id, { Origin: studio.base, Cookie: owner.cookie })).toBe(429);
    const editorPeer = await connect(editor, document.id);
    expect(await deniedWebSocket(studio, document.id, { Origin: studio.base, Cookie: viewer.cookie })).toBe(429);
    expect(await deniedWebSocket(studio, document.id, { Origin: studio.base })).toBe(403);
    expect(await deniedWebSocket(studio, document.id, { Origin: 'https://untrusted.example', Cookie: viewer.cookie })).toBe(403);
    const outsider = new ApiClient(studio); await outsider.demo('Socket outsider');
    expect(await deniedWebSocket(studio, document.id, { Origin: studio.base, Cookie: outsider.cookie })).toBe(403);
    await ownerPeer.disconnect(); const viewerPeer = await connect(viewer, document.id); expect(viewerPeer.current).toEqual(document);
    const closed = new Promise<number>(done => editorPeer.socket.once('close', code => done(code)));
    expect((await owner.request(`/api/projects/${document.id}/members/${editor.user!.id}`, 'PATCH', { role: null })).status).toBe(200);
    expect(await closed).toBe(4003);
    const returning = await connect(owner, document.id); expect(returning.current).toEqual(document);
    expect(await deniedWebSocket(studio, document.id, { Origin: studio.base, Cookie: editor.cookie })).toBe(403);
  });

  it('checks connection capacity before attempting initial CRDT recovery for another authorized project', async () => {
    const studio = await start(undefined, { limits: { connections: 1, connectionsPerUser: 2 } });
    const owner = new ApiClient(studio), healthy = await owner.demo('Connection recovery order'), corrupt = await owner.demo('Connection recovery order');
    studio.store.db.prepare('UPDATE projects SET ystate=? WHERE id=?').run(new Uint8Array([255, 255, 255]), corrupt.id);
    const peer = await connect(owner, healthy.id);
    expect(await deniedWebSocket(studio, corrupt.id, { Origin: studio.base, Cookie: owner.cookie })).toBe(429);
    await peer.disconnect(); expect(await deniedWebSocket(studio, corrupt.id, { Origin: studio.base, Cookie: owner.cookie })).toBe(503);
    expect(serializeDocument(await owner.read(corrupt.id))).toBe(serializeDocument(corrupt));
    expect(Array.from(studio.store.db.prepare('SELECT ystate FROM projects WHERE id=?').get(corrupt.id)?.ystate as Uint8Array)).toEqual([255, 255, 255]);
  });
});
