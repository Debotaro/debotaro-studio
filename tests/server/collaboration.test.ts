import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNode, serializeDocument } from '../../src/core/document';
import { touchedValues } from '../../src/core/preconditions';
import type { Operation, StudioDocument } from '../../src/core/types';
import { ApiClient, envelope, Peer, startStudio, type RunningStudio } from './helpers';

let studio: RunningStudio;
let owner: ApiClient;
let editor: ApiClient;
let doc: StudioDocument;
const peers: Peer[] = [];
beforeEach(async () => {
  studio = await startStudio(); owner = new ApiClient(studio); doc = await owner.demo('Actor A');
  editor = new ApiClient(studio); await editor.join(await owner.invite(doc.id, 'editor'), 'Actor B');
});
afterEach(async () => { peers.splice(0).forEach(peer => peer.destroy()); await studio.close(); });
async function pair() {
  const a = await Peer.connect(owner, doc.id), b = await Peer.connect(editor, doc.id); peers.push(a, b); return [a, b] as const;
}
const propsEdit = (document: StudioDocument, text: string): Operation => ({ type: 'update', nodeId: 'workspace-title', patch: { props: { ...document.nodes['workspace-title'].props, text } } });

describe('two actual WebSocket clients and safe typed operations', () => {
  it('shares actual presence and converges concurrent independent field edits', async () => {
    const [a, b] = await pair();
    expect((await a.wait(message => message.type === 'presence' && message.people?.length === 2)).people?.map(person => person.name).sort()).toEqual(['Actor A', 'Actor B']);
    a.send('presence', { selection: 'workspace-title' });
    expect((await b.wait(message => message.type === 'presence' && message.people?.some(person => person.selection === 'workspace-title') === true)).people?.find(person => person.id === owner.user!.id)?.selection).toBe('workspace-title');
    const opA = [propsEdit(doc, 'Text from actor A')];
    const opB: Operation[] = [{ type: 'update', nodeId: 'workspace-title', patch: { name: 'Layer from actor B' } }];
    const envA = envelope(doc, opA), envB = envelope(doc, opB);
    a.send('operation', { envelope: envA, expected: touchedValues(doc, opA) });
    b.send('operation', { envelope: envB, expected: touchedValues(doc, opB) });
    await Promise.all([a.revision(2), b.revision(2)]);
    expect(a.messages.some(message => message.type === 'error')).toBe(false);
    expect(b.messages.some(message => message.type === 'error')).toBe(false);
    expect(a.current.nodes['workspace-title']).toMatchObject({ name: 'Layer from actor B', props: { text: 'Text from actor A' } });
    expect(serializeDocument(a.current)).toBe(serializeDocument(b.current));
    expect(serializeDocument(a.current)).toBe(serializeDocument(studio.store.readDocument(doc.id)));
  });

  it('refuses stale same-field changes and preserves the accepted value', async () => {
    const [a, b] = await pair();
    const opA = [propsEdit(doc, 'Accepted title')], opB = [propsEdit(doc, 'Conflicting title')];
    a.send('operation', { envelope: envelope(doc, opA), expected: touchedValues(doc, opA) });
    await b.revision(1);
    const conflict = envelope(doc, opB);
    b.send('operation', { envelope: conflict, expected: touchedValues(doc, opB) });
    expect((await b.wait(message => message.type === 'error' && message.opId === conflict.id)).error).toContain('Conflict');
    expect(b.current.revision).toBe(1);
    expect(b.current.nodes['workspace-title'].props.text).toBe('Accepted title');
  });

  it('rejects stale structural and inspected replace operations without losing concurrent work', async () => {
    const [a, b] = await pair();
    const insertA: Operation = { type: 'insert', parentId: doc.rootId, index: 0, node: createNode('Text', 'insert-A') };
    a.send('operation', { envelope: envelope(doc, [insertA]) });
    await b.revision(1);
    const insertB = envelope(doc, [{ type: 'insert', parentId: doc.rootId, index: 0, node: createNode('Text', 'insert-B') }]);
    b.send('operation', { envelope: insertB, expected: {} });
    expect((await b.wait(message => message.opId === insertB.id && message.type === 'error')).error).toContain('Conflict');
    const replace = envelope(doc, [{ type: 'replace', document: doc }]);
    b.send('operation', { envelope: replace, strict: true });
    expect((await b.wait(message => message.opId === replace.id && message.type === 'error')).error).toContain('Conflict');
    expect(b.current.nodes['insert-A']).toBeDefined();
    expect(b.current.nodes['insert-B']).toBeUndefined();
    expect(b.current.revision).toBe(1);
  });

  it('does not resurrect a deleted node when a disconnected actor replays an edit', async () => {
    const [a, b] = await pair();
    const pendingOps = [propsEdit(doc, 'Offline title before deletion')];
    const pending = { envelope: envelope(doc, pendingOps), expected: touchedValues(doc, pendingOps) };
    await b.disconnect();
    a.send('operation', { envelope: envelope(doc, [{ type: 'delete', nodeId: 'workspace-title' }]) });
    await a.revision(1);
    const connected = await Peer.connect(editor, doc.id, b.document); peers.push(connected);
    connected.send('operation', pending);
    expect((await connected.wait(message => message.type === 'error' && message.opId === pending.envelope.id)).error).toContain('Conflict');
    expect(connected.current.nodes['workspace-title']).toBeUndefined();
    expect(connected.current.nodes['heading-copy'].children).not.toContain('workspace-title');
    expect(connected.current.revision).toBe(1);
  });

  it('undoes only actor-owned fields and preserves another actor’s independent edits', async () => {
    const opA = [propsEdit(doc, 'Actor A title')];
    expect((await owner.submit(doc.id, { envelope: envelope(doc, opA) })).status).toBe(200);
    const current = await editor.read(doc.id);
    expect((await editor.submit(doc.id, { envelope: envelope(current, [{ type: 'update', nodeId: 'workspace-title', patch: { name: 'Actor B layer' } }]) })).status).toBe(200);
    const undone = await owner.request(`/api/projects/${doc.id}/undo`, 'POST');
    expect(undone.status).toBe(200);
    const next = (await undone.json() as { document: StudioDocument }).document;
    expect(next.nodes['workspace-title'].props.text).toBe(doc.nodes['workspace-title'].props.text);
    expect(next.nodes['workspace-title'].name).toBe('Actor B layer');
    expect(next.revision).toBe(3);
    const history = await (await owner.request(`/api/projects/${doc.id}/history`)).json() as { actor: string; label: string }[];
    expect(history[0]).toMatchObject({ actor: 'Actor A', label: 'Undo: Test supported edit' });
  });

  it('refuses undo after another actor replaces the same field', async () => {
    expect((await owner.submit(doc.id, { envelope: envelope(doc, [propsEdit(doc, 'Actor A title')]) })).status).toBe(200);
    const current = await editor.read(doc.id);
    expect((await editor.submit(doc.id, { envelope: envelope(current, [propsEdit(current, 'Actor B title')]) })).status).toBe(200);
    const response = await owner.request(`/api/projects/${doc.id}/undo`, 'POST');
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain('Undo conflict');
    expect((await owner.read(doc.id)).nodes['workspace-title'].props.text).toBe('Actor B title');
  });

  it('undoes a newly introduced unused token while retaining another actor’s independent layer edit', async () => {
    expect((await owner.submit(doc.id, { envelope: envelope(doc, [{ type: 'token', category: 'primitive', name: 'newAccent', value: '#cc44aa' }]) })).status).toBe(200);
    const current = await editor.read(doc.id);
    expect((await editor.submit(doc.id, { envelope: envelope(current, [{ type: 'update', nodeId: 'workspace-title', patch: { name: 'Another actor name' } }]) })).status).toBe(200);
    const response = await owner.request(`/api/projects/${doc.id}/undo`, 'POST');
    expect(response.status).toBe(200);
    const result = (await response.json() as { document: StudioDocument }).document;
    expect(result.tokens.primitive.newAccent).toBeUndefined();
    expect(result.nodes['workspace-title'].name).toBe('Another actor name');
  });

  it('retains a newly introduced token if another actor now references it', async () => {
    expect((await owner.submit(doc.id, { envelope: envelope(doc, [{ type: 'token', category: 'primitive', name: 'newAccent', value: '#cc44aa' }]) })).status).toBe(200);
    const current = await editor.read(doc.id);
    expect((await editor.submit(doc.id, { envelope: envelope(current, [{ type: 'update', nodeId: 'workspace-title', patch: { props: { ...current.nodes['workspace-title'].props, color: '$primitive.newAccent' } } }]) })).status).toBe(200);
    const response = await owner.request(`/api/projects/${doc.id}/undo`, 'POST');
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toMatch(/undo|token|reference/i);
    const result = await editor.read(doc.id);
    expect(result.tokens.primitive.newAccent).toBe('#cc44aa');
    expect(result.nodes['workspace-title'].props.color).toBe('$primitive.newAccent');
  });

  it('recovers a disconnected typed edit after reconnect and deduplicates replays', async () => {
    const [a, b] = await pair();
    const pendingOps: Operation[] = [{ type: 'update', nodeId: 'workspace-title', patch: { name: 'Offline layer' } }];
    const pending = { envelope: envelope(doc, pendingOps), expected: touchedValues(doc, pendingOps) };
    await b.disconnect();
    a.send('operation', { envelope: envelope(doc, [propsEdit(doc, 'Concurrent online title')]) });
    await a.revision(1);
    const reconnected = await Peer.connect(editor, doc.id, b.document); peers.push(reconnected);
    expect(reconnected.current.revision).toBe(1);
    reconnected.send('operation', pending);
    await Promise.all([a.revision(2), reconnected.revision(2)]);
    expect(reconnected.current.nodes['workspace-title']).toMatchObject({ name: 'Offline layer', props: { text: 'Concurrent online title' } });
    const from = reconnected.messages.length;
    reconnected.send('operation', pending);
    await reconnected.wait(message => message.type === 'state' && message.opId === pending.envelope.id, from);
    expect(reconnected.current.revision).toBe(2);
    expect(studio.store.db.prepare('SELECT COUNT(*) AS count FROM history WHERE id=?').get(pending.envelope.id)?.count).toBe(1);
  });

  it('rejects binary/raw CRDT writes and resource identity substitution', async () => {
    const [a] = await pair();
    const from = a.messages.length;
    a.socket.send(Buffer.from([1, 2, 3]));
    expect((await a.wait(message => message.type === 'error', from)).error).toBeTruthy();
    const other = await owner.demo('Same owner second project');
    const edit = envelope(other, [{ type: 'theme', theme: 'dark' }]);
    a.send('operation', { envelope: edit });
    expect((await a.wait(message => message.opId === edit.id && message.type === 'error')).error).toContain('identity');
    expect(studio.store.readDocument(doc.id).revision).toBe(0);
    expect(studio.store.readDocument(other.id).revision).toBe(0);
  });

  it('refuses impossible future base revisions even when field preconditions match', async () => {
    const operations: Operation[] = [{ type: 'update', nodeId: 'workspace-title', patch: { name: 'Impossible future edit' } }];
    const future = { ...envelope(doc, operations), baseRevision: doc.revision + 100 };
    const response = await owner.submit(doc.id, { envelope: future, expected: touchedValues(doc, operations) });
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toMatch(/revision|conflict|future/i);
    expect(studio.store.readDocument(doc.id).revision).toBe(0);
  });
});
