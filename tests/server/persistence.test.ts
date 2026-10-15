import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { serializeDocument } from '../../src/core/document';
import { touchedValues } from '../../src/core/preconditions';
import type { Operation, StudioDocument, Version } from '../../src/core/types';
import { Store } from '../../server/store';
import { SyncEngine } from '../../server/sync';
import { ApiClient, deniedWebSocket, envelope, Peer, startStudio, type RunningStudio } from './helpers';

let studio: RunningStudio;
let owner: ApiClient;
let doc: StudioDocument;
let closed = false;
const peers: Peer[] = [];
beforeEach(async () => { studio = await startStudio(); owner = new ApiClient(studio); doc = await owner.demo('Persistence owner'); closed = false; });
afterEach(async () => { peers.splice(0).forEach(peer => peer.destroy()); if (!closed) await studio.close(); });
function dataDirectory() {
  const parent = resolve('artifacts', 'server-tests'); mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, 'corruption-'));
}

describe('SQLite snapshots, versions and CRDT restart recovery', () => {
  it('retains immutable snapshots and refuses stale restore before inspected restore', async () => {
    const response = await owner.request(`/api/projects/${doc.id}/versions`, 'POST', { label: 'Before title edit' });
    expect(response.status).toBe(201);
    const version = await response.json() as Version;
    const edit: Operation = { type: 'update', nodeId: 'workspace-title', patch: { props: { ...doc.nodes['workspace-title'].props, text: 'Edited after snapshot' } } };
    expect((await owner.submit(doc.id, { envelope: envelope(doc, [edit]) })).status).toBe(200);
    const stale = await owner.request(`/api/projects/${doc.id}/restore`, 'POST', { versionId: version.id, baseRevision: 0 });
    expect(stale.status).toBe(400);
    expect((await stale.json() as { error: string }).error).toContain('Conflict');
    expect((await owner.read(doc.id)).nodes['workspace-title'].props.text).toBe('Edited after snapshot');
    const storedVersions = await (await owner.request(`/api/projects/${doc.id}/versions`)).json() as Version[];
    expect(serializeDocument(storedVersions.find(snapshot => snapshot.id === version.id)!.document)).toBe(serializeDocument(doc));
    const restored = await owner.request(`/api/projects/${doc.id}/restore`, 'POST', { versionId: version.id, baseRevision: 1 });
    expect(restored.status).toBe(200);
    const result = (await restored.json() as { document: StudioDocument }).document;
    expect(result.revision).toBe(2);
    expect(result.nodes['workspace-title'].props.text).toBe(doc.nodes['workspace-title'].props.text);
    expect(studio.store.versions(doc.id).find(snapshot => snapshot.id === version.id)?.revision).toBe(0);
  });

  it('recovers documents, authentication, snapshots and existing browser Yjs causality after server restart', async () => {
    const peer = await Peer.connect(owner, doc.id); peers.push(peer);
    const ops: Operation[] = [{ type: 'update', nodeId: 'workspace-title', patch: { props: { ...doc.nodes['workspace-title'].props, text: 'Persisted title' } } }];
    peer.send('operation', { envelope: envelope(doc, ops) });
    await peer.revision(1);
    const canonical = serializeDocument(peer.current);
    const oldState = new Y.Doc(); Y.applyUpdate(oldState, Y.encodeStateAsUpdate(peer.document));
    const savedCookie = owner.cookie;
    const directory = studio.directory;
    await studio.close(); closed = true;
    studio = await startStudio(directory); closed = false;
    owner = new ApiClient(studio); owner.cookie = savedCookie;
    expect(serializeDocument(await owner.read(doc.id))).toBe(canonical);
    expect(studio.store.versions(doc.id).some(snapshot => snapshot.label === 'Starting point')).toBe(true);
    const reconnected = await Peer.connect(owner, doc.id, oldState); peers.push(reconnected); oldState.destroy();
    expect(serializeDocument(reconnected.current)).toBe(canonical);
    const next = reconnected.current;
    reconnected.send('operation', { envelope: envelope(next, [{ type: 'update', nodeId: 'workspace-title', patch: { name: 'After restart' } }]) });
    await reconnected.revision(2);
    expect(reconnected.current.nodes['workspace-title']).toMatchObject({ name: 'After restart', props: { text: 'Persisted title' } });
  });

  it('replays an offline independent edit after restart without replacing the new online fields', async () => {
    const editor = new ApiClient(studio); await editor.join(await owner.invite(doc.id, 'editor'), 'Offline actor');
    const peer = await Peer.connect(editor, doc.id); peers.push(peer);
    const offlineOps: Operation[] = [{ type: 'update', nodeId: 'workspace-title', patch: { name: 'Offline name' } }];
    const offline = { envelope: envelope(doc, offlineOps), expected: touchedValues(doc, offlineOps) };
    await peer.disconnect();
    expect((await owner.submit(doc.id, { envelope: envelope(doc, [{ type: 'update', nodeId: 'workspace-title', patch: { props: { ...doc.nodes['workspace-title'].props, text: 'Online title' } } }]) })).status).toBe(200);
    const directory = studio.directory, editorCookie = editor.cookie;
    await studio.close(); closed = true;
    studio = await startStudio(directory); closed = false;
    const returning = new ApiClient(studio); returning.cookie = editorCookie;
    const connected = await Peer.connect(returning, doc.id, peer.document); peers.push(connected);
    connected.send('operation', offline); await connected.revision(2);
    expect(connected.current.nodes['workspace-title']).toMatchObject({ name: 'Offline name', props: { text: 'Online title' } });
  });

  it('preserves corrupt/incompatible document bytes and returns an actionable HTTP error', async () => {
    const raw = '{"schemaVersion":999,"preserve":"original incompatible value"}';
    studio.store.db.prepare('UPDATE projects SET document=? WHERE id=?').run(raw, doc.id);
    expect(() => studio.store.readDocument(doc.id)).toThrow('Original data retained');
    const response = await owner.request(`/api/projects/${doc.id}`);
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain('corrupt or incompatible');
    expect(studio.store.db.prepare('SELECT document FROM projects WHERE id=?').get(doc.id)?.document).toBe(raw);
  });

  it('refuses invalid CRDT bytes or snapshot mismatch without overwriting either source', () => {
    const directory = dataDirectory(); const store = new Store(directory);
    const user = store.createUser('Corruption fixture'); store.createProject(doc, user);
    const bad = new Uint8Array([255, 255, 255, 255]);
    store.db.prepare('UPDATE projects SET ystate=? WHERE id=?').run(bad, doc.id);
    const engine = new SyncEngine(store);
    expect(() => engine.state(doc.id)).toThrow('Original data retained');
    expect(Array.from(store.db.prepare('SELECT ystate FROM projects WHERE id=?').get(doc.id)?.ystate as Uint8Array)).toEqual(Array.from(bad));
    const mismatched = new Y.Doc(); mismatched.getMap('studio').set('document', serializeDocument({ ...doc, name: 'Different snapshot' }));
    const state = Y.encodeStateAsUpdate(mismatched); mismatched.destroy();
    store.db.prepare('UPDATE projects SET ystate=? WHERE id=?').run(state, doc.id);
    expect(() => engine.state(doc.id)).toThrow('corrupt or incompatible');
    expect(store.readDocument(doc.id).name).toBe(doc.name);
    expect(Array.from(store.db.prepare('SELECT ystate FROM projects WHERE id=?').get(doc.id)?.ystate as Uint8Array)).toEqual(Array.from(state));
    engine.destroy(); store.close();
  });

  it('refuses a corrupt collaboration room before upgrade and keeps the HTTP service available', async () => {
    studio.engine.state(doc.id); studio.engine.destroy();
    const bytes = new Uint8Array([255, 255, 255, 255]);
    studio.store.db.prepare('UPDATE projects SET ystate=? WHERE id=?').run(bytes, doc.id);
    expect(await deniedWebSocket(studio, doc.id, { Origin: studio.base, Cookie: owner.cookie })).toBe(503);
    expect((await owner.request('/api/health')).status).toBe(200);
    expect(Array.from(studio.store.db.prepare('SELECT ystate FROM projects WHERE id=?').get(doc.id)?.ystate as Uint8Array)).toEqual(Array.from(bytes));
  });

  it('does not silently downgrade an incompatible future SQLite metadata version', () => {
    const directory = dataDirectory(); const store = new Store(directory);
    store.db.exec('PRAGMA user_version=99;'); store.close();
    expect(() => new Store(directory)).toThrow(/incompatible|version|unsupported/i);
    const database = new DatabaseSync(join(directory, 'studio.sqlite'));
    expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(99); database.close();
  });

  it('does not replace an invalid SQLite file with an empty demo database', () => {
    const directory = dataDirectory(), file = join(directory, 'studio.sqlite');
    const bytes = Buffer.from('This is an invalid SQLite file and must remain recoverable.'); writeFileSync(file, bytes);
    expect(() => new Store(directory)).toThrow();
    expect(readFileSync(file)).toEqual(bytes);
  });

  it('keeps SQLite snapshot, CRDT and history unchanged when a persistence transaction fails', async () => {
    const peer = await Peer.connect(owner, doc.id); peers.push(peer);
    studio.store.db.exec("CREATE TRIGGER fixture_fail_write BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'Explicit fixture transaction failure'); END;");
    const response = await owner.submit(doc.id, { envelope: envelope(doc, [{ type: 'theme', theme: 'dark' }]) });
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain('fixture transaction failure');
    expect(serializeDocument(studio.store.readDocument(doc.id))).toBe(serializeDocument(doc));
    expect(serializeDocument(peer.current)).toBe(serializeDocument(doc));
    expect(studio.store.db.prepare('SELECT COUNT(*) AS count FROM history WHERE project_id=?').get(doc.id)?.count).toBe(0);
    studio.store.db.exec('DROP TRIGGER fixture_fail_write;');
    expect((await owner.submit(doc.id, { envelope: envelope(doc, [{ type: 'theme', theme: 'dark' }]) })).status).toBe(200);
    await peer.revision(1); expect(peer.current.theme).toBe('dark');
  });
});
