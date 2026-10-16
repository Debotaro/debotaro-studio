import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Operation, StudioDocument } from '../../src/core/types';
import { ApiClient, envelope, Peer, startStudio, type RunningStudio } from './helpers';

let studio: RunningStudio;
let owner: ApiClient;
let doc: StudioDocument;
const peers: Peer[] = [];
beforeEach(async () => {
  studio = await startStudio();
  owner = new ApiClient(studio);
  doc = await owner.demo('Atomicity fixture owner');
});
afterEach(async () => {
  peers.splice(0).forEach(peer => peer.destroy());
  await studio.close();
});

function storedState() {
  return Object.fromEntries([
    'users', 'sessions', 'projects', 'members', 'invitations', 'history', 'versions', 'ai_usage',
  ].map(table => [table, studio.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

function history() {
  return studio.store.db.prepare('SELECT id,label,revision,undone FROM history ORDER BY revision').all();
}

describe('actual SQLite second-write failure boundaries', () => {
  it.each(['BEFORE', 'AFTER'])('rolls back an undo when %s bookkeeping fails, then retries exactly once', async timing => {
    const peer = await Peer.connect(owner, doc.id); peers.push(peer);
    const original = envelope(doc, [{ type: 'theme', theme: 'dark' }]);
    expect((await owner.submit(doc.id, { envelope: original })).status).toBe(200);
    await peer.revision(1);
    const before = storedState(), causal = studio.engine.state(doc.id);
    const canonical = await owner.read(doc.id);
    studio.store.db.exec(`CREATE TRIGGER fixture_fail_undo ${timing} UPDATE OF undone ON history
      BEGIN SELECT RAISE(ABORT, 'Explicit undo bookkeeping failure'); END;`);

    const failed = await owner.request(`/api/projects/${doc.id}/undo`, 'POST', {});
    expect(failed.status).toBe(400);
    expect((await failed.json() as { error: string }).error).toContain('undo bookkeeping failure');
    expect(storedState()).toEqual(before);
    expect(studio.engine.state(doc.id)).toBe(causal);
    expect(await owner.read(doc.id)).toEqual(canonical);
    expect(peer.current).toEqual(canonical);

    studio.store.db.exec('DROP TRIGGER fixture_fail_undo;');
    const retried = await owner.request(`/api/projects/${doc.id}/undo`, 'POST', {});
    expect(retried.status).toBe(200);
    const result = await retried.json() as { document: StudioDocument; redoOperations: Operation[] };
    expect(result.document.revision).toBe(2);
    expect(result.document.theme).toBe(doc.theme);
    expect(result.redoOperations).toEqual(original.operations);
    await peer.revision(2);
    expect(peer.current).toEqual(result.document);
    expect(history()).toEqual([
      expect.objectContaining({ id: original.id, revision: 1, undone: 1 }),
      expect.objectContaining({ revision: 2, undone: 1 }),
    ]);
    const after = storedState();
    const noMore = await owner.request(`/api/projects/${doc.id}/undo`, 'POST', {});
    expect(noMore.status).toBe(400);
    expect((await noMore.json() as { error: string }).error).toContain('No change to undo');
    expect(storedState()).toEqual(after);
  });

  it('preserves the completed undo on failed redo persistence and deduplicates a successful retry', async () => {
    const peer = await Peer.connect(owner, doc.id); peers.push(peer);
    expect((await owner.submit(doc.id, { envelope: envelope(doc, [{ type: 'theme', theme: 'dark' }]) })).status).toBe(200);
    const undone = await owner.request(`/api/projects/${doc.id}/undo`, 'POST', {});
    expect(undone.status).toBe(200);
    const result = await undone.json() as { document: StudioDocument; redoOperations: Operation[] };
    await peer.revision(2);
    const redo = envelope(result.document, result.redoOperations, 'Redo change');
    const before = storedState(), causal = studio.engine.state(doc.id);
    studio.store.db.exec(`CREATE TRIGGER fixture_fail_redo BEFORE INSERT ON history
      WHEN NEW.label='Redo change' BEGIN SELECT RAISE(ABORT, 'Explicit redo history failure'); END;`);
    const failed = await owner.submit(doc.id, { envelope: redo });
    expect(failed.status).toBe(400);
    expect((await failed.json() as { error: string }).error).toContain('redo history failure');
    expect(storedState()).toEqual(before);
    expect(studio.engine.state(doc.id)).toBe(causal);
    expect(peer.current).toEqual(result.document);

    studio.store.db.exec('DROP TRIGGER fixture_fail_redo;');
    expect((await owner.submit(doc.id, { envelope: redo })).status).toBe(200);
    await peer.revision(3);
    expect(peer.current.theme).toBe('dark');
    const after = storedState();
    expect((await owner.submit(doc.id, { envelope: redo })).status).toBe(200);
    expect(storedState()).toEqual(after);
    expect(history()).toHaveLength(3);
    expect((await owner.request(`/api/projects/${doc.id}/undo`, 'POST', {})).status).toBe(200);
    await peer.revision(4);
    expect(peer.current.theme).toBe(doc.theme);
    expect(history().every(row => row.undone === 1)).toBe(true);
  });

  it.each([null, 'viewer'] as const)('rolls back membership change to %s if invitation invalidation fails', async role => {
    const invitation = await owner.invite(doc.id, 'editor');
    const editor = new ApiClient(studio);
    await editor.join(invitation, 'Atomicity fixture editor');
    await owner.invite(doc.id, 'viewer');
    const peer = await Peer.connect(editor, doc.id); peers.push(peer);
    const before = storedState(), causal = studio.engine.state(doc.id);
    studio.store.db.exec(`CREATE TRIGGER fixture_fail_revocation AFTER DELETE ON invitations
      BEGIN SELECT RAISE(ABORT, 'Explicit invitation invalidation failure'); END;`);

    const failed = await owner.request(`/api/projects/${doc.id}/members/${editor.user!.id}`, 'PATCH', { role });
    expect(failed.status).toBe(400);
    expect((await failed.json() as { error: string }).error).toContain('invitation invalidation failure');
    expect(storedState()).toEqual(before);
    expect(studio.store.role(doc.id, editor.user!.id)).toBe('editor');
    expect(studio.engine.state(doc.id)).toBe(causal);
    expect((await editor.request(`/api/projects/${doc.id}`)).status).toBe(200);
    const from = peer.messages.length;
    peer.send('sync');
    await peer.wait(message => message.type === 'state', from);

    studio.store.db.exec('DROP TRIGGER fixture_fail_revocation;');
    const closed = new Promise<number>(done => peer.socket.once('close', code => done(code)));
    expect((await owner.request(`/api/projects/${doc.id}/members/${editor.user!.id}`, 'PATCH', { role })).status).toBe(200);
    expect(await closed).toBe(4003);
    expect(studio.store.role(doc.id, editor.user!.id)).toBe(role);
    expect(studio.store.db.prepare('SELECT COUNT(*) AS count FROM invitations').get()?.count).toBe(0);
    expect((await editor.request(`/api/projects/${doc.id}`)).status).toBe(role === null ? 403 : 200);
    expect((await editor.submit(doc.id, { envelope: envelope(doc, [{ type: 'theme', theme: 'dark' }]) })).status).toBe(403);
    const after = storedState();
    const returning = new ApiClient(studio);
    expect((await returning.request('/api/join', 'POST', { token: invitation, name: 'Invalidated invite fixture' })).status).toBe(400);
    expect(storedState()).toEqual(after);
  });
});
