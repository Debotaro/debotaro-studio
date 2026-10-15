/** Actual HTTP/SQLite regressions; reviewed AI proposals below are explicit local fixtures. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNode } from '../../src/core/document';
import type { AIProposal, Operation, OperationEnvelope, StudioDocument, Version } from '../../src/core/types';
import { ApiClient, deniedWebSocket, envelope, Peer, startStudio, type RunningStudio } from './helpers';

let studio: RunningStudio;
let owner: ApiClient;
let document: StudioDocument;
let closed = false;
const peers: Peer[] = [];
beforeEach(async () => {
  vi.stubEnv('OPENAI_API_KEY', ''); vi.stubEnv('OPENAI_MODEL', '');
  studio = await startStudio(); closed = false;
  owner = new ApiClient(studio); document = await owner.demo('Recovery regression owner');
});
afterEach(async () => {
  peers.splice(0).forEach(peer => peer.destroy());
  if (!closed) await studio?.close();
  vi.unstubAllEnvs();
});

interface UndoResult { document: StudioDocument; redoOperations: Operation[] }
interface ProjectSummary { id: string; name: string; role: string; revision: number | null; unavailable?: boolean; error?: string }
async function undo(client: ApiClient, projectId = document.id): Promise<UndoResult> {
  const response = await client.request(`/api/projects/${projectId}/undo`, 'POST', {});
  expect(response.status).toBe(200);
  const result = await response.json() as UndoResult;
  expect(result.redoOperations.length).toBeGreaterThan(0);
  return result;
}
async function submit(client: ApiClient, base: StudioDocument, operations: Operation[], label: string): Promise<StudioDocument> {
  const response = await client.submit(base.id, { envelope: envelope(base, operations, label), strict: true });
  expect(response.status).toBe(200);
  return (await response.json() as { document: StudioDocument }).document;
}
async function collaborator(role: 'editor' | 'viewer', name: string): Promise<ApiClient> {
  const client = new ApiClient(studio); await client.join(await owner.invite(document.id, role), name); return client;
}
const semantic = (doc: StudioDocument) => ({ ...doc, revision: 0 });
function storedOperations(projectId: string, label: string): Operation[] {
  const row = studio.store.db.prepare('SELECT envelope FROM history WHERE project_id=? AND label=? ORDER BY revision DESC LIMIT 1').get(projectId, label);
  expect(row).toBeDefined();
  return (JSON.parse(String(row!.envelope)) as OperationEnvelope).operations;
}

describe('project corruption isolation — actual server and retained SQLite data', () => {
  it.each(['malformed JSON', 'future document schema'] as const)('keeps a healthy owned project available when another has %s, including after restart', async mode => {
    const corrupt = document;
    const initialUser = owner.user!;
    const healthy = await owner.demo('Same owner creates second isolated project');
    expect(owner.user?.id).toBe(initialUser.id);
    const raw = mode === 'malformed JSON'
      ? ' \r\n{"schemaVersion":1,"recovery":"UNTRUSTED_RECOVERY_SENTINEL — preserve exact bytes"\n'
      : ` \r\n${JSON.stringify({ ...corrupt, schemaVersion: 999, name: 'UNTRUSTED_RECOVERY_SENTINEL' })}\r\n `;
    studio.store.db.prepare('UPDATE projects SET document=? WHERE id=?').run(raw, corrupt.id);
    const assertRawRetained = () => {
      const stored = studio.store.db.prepare('SELECT document,hex(CAST(document AS BLOB)) AS bytes FROM projects WHERE id=?').get(corrupt.id);
      expect(stored?.document).toBe(raw);
      expect(stored?.bytes).toBe(Buffer.from(raw, 'utf8').toString('hex').toUpperCase());
    };
    async function checkAvailableSession() {
      const response = await owner.request('/api/session'); expect(response.status).toBe(200);
      const session = await response.json() as { user: { id: string }; projects: ProjectSummary[] };
      expect(session.user.id).toBe(initialUser.id); expect(session.projects).toHaveLength(2);
      expect(session.projects.find(project => project.id === healthy.id)).toMatchObject({ id: healthy.id, name: healthy.name, role: 'owner', revision: expect.any(Number) });
      expect(session.projects.find(project => project.id === healthy.id)?.unavailable).toBeUndefined();
      const unavailable = session.projects.find(project => project.id === corrupt.id)!;
      expect(unavailable).toMatchObject({ id: corrupt.id, role: 'owner', revision: null, unavailable: true, error: expect.stringContaining('Original data retained') });
      expect(unavailable.name).toContain('Recovery needed');
      expect(JSON.stringify(session)).not.toContain('UNTRUSTED_RECOVERY_SENTINEL');
      assertRawRetained();
    }
    await checkAvailableSession();
    const direct = await owner.request(`/api/projects/${corrupt.id}`); expect(direct.status).toBe(400);
    expect(await direct.json()).toMatchObject({ error: expect.stringContaining('corrupt or incompatible') });
    expect(await owner.read(healthy.id)).toEqual(healthy);
    const unauthorized = new ApiClient(studio);
    expect((await unauthorized.request(`/api/projects/${corrupt.id}`)).status).toBe(401);
    expect(await (await unauthorized.request('/api/session')).json()).toMatchObject({ user: null, projects: [] });
    const outsider = new ApiClient(studio); const unrelated = await outsider.demo('Independent outsider');
    expect((await outsider.request(`/api/projects/${corrupt.id}`)).status).toBe(403);
    const outsiderSession = await (await outsider.request('/api/session')).json() as { projects: ProjectSummary[] };
    expect(outsiderSession.projects.map(project => project.id)).toEqual([unrelated.id]);
    expect(await deniedWebSocket(studio, corrupt.id, { Cookie: owner.cookie, Origin: studio.base })).toBe(503);
    const healthyPeer = await Peer.connect(owner, healthy.id); peers.push(healthyPeer);
    const edited = await submit(owner, healthy, [{ type: 'update', nodeId: 'workspace-title', patch: { name: 'Healthy project remains editable' } }], 'Healthy project edit after corruption');
    await healthyPeer.revision(edited.revision);
    expect(healthyPeer.current.nodes['workspace-title'].name).toBe('Healthy project remains editable');
    assertRawRetained();
    const directory = studio.directory, savedCookie = owner.cookie;
    await studio.close(); closed = true;
    studio = await startStudio(directory); closed = false;
    owner = new ApiClient(studio); owner.cookie = savedCookie;
    await checkAvailableSession();
    expect(await owner.read(healthy.id)).toEqual(edited);
    expect((await owner.request(`/api/projects/${corrupt.id}`)).status).toBe(400);
    const afterRestart = await submit(owner, edited, [{ type: 'theme', theme: 'dark' }], 'Healthy project edit after restart');
    expect(afterRestart.revision).toBe(2); assertRawRetained();
  });
});

describe('actual actor undo returns the precise transaction for redo', () => {
  it('returns a version-restore replacement rather than an older visual edit, then replays it under the current revision', async () => {
    const versionResponse = await owner.request(`/api/projects/${document.id}/versions`, 'POST', { label: 'Exact inspected recovery version' });
    expect(versionResponse.status).toBe(201); const version = await versionResponse.json() as Version;
    const olderVisual: Operation[] = [{ type: 'update', nodeId: 'workspace-title', patch: { props: { ...document.nodes['workspace-title'].props, text: 'Older visual edit must not become restore redo' } } }];
    const edited = await submit(owner, document, olderVisual, 'Older owner visual operation');
    const restoreResponse = await owner.request(`/api/projects/${document.id}/restore`, 'POST', { versionId: version.id, baseRevision: edited.revision });
    expect(restoreResponse.status).toBe(200); const restored = (await restoreResponse.json() as { document: StudioDocument }).document;
    expect(semantic(restored)).toEqual(semantic(document));
    const actualRestore = storedOperations(document.id, `Restore: ${version.label}`);
    const undone = await undo(owner);
    expect(undone.document.revision).toBe(3); expect(semantic(undone.document)).toEqual(semantic(edited));
    expect(undone.redoOperations).toEqual(actualRestore);
    expect(undone.redoOperations).not.toEqual(olderVisual);
    expect(undone.redoOperations).toEqual([{ type: 'replace', document: { ...version.document, revision: edited.revision } }]);
    const redone = await submit(owner, undone.document, undone.redoOperations, 'Redo inspected version restore');
    expect(redone.revision).toBe(4); expect(semantic(redone)).toEqual(semantic(restored));
    expect(studio.store.versions(document.id).find(item => item.id === version.id)?.document).toEqual(version.document);
  });

  it('returns the reviewed AI subset operations in dependency order, preserving older owner/editor visual changes through undo and redo', async () => {
    const editor = await collaborator('editor', 'Reviewed fixture editor');
    const first = await submit(owner, document, [{ type: 'update', nodeId: 'workspace-title', patch: { props: { ...document.nodes['workspace-title'].props, text: 'Independent owner visual content' } } }], 'Earlier owner visual edit');
    const olderEditorVisual: Operation[] = [{ type: 'update', nodeId: 'workspace-title', patch: { name: 'Earlier editor visual layer name' } }];
    const beforeAI = await submit(editor, first, olderEditorVisual, 'Earlier editor visual edit');
    const panel = createNode('Frame', 'reviewed-server-panel'); panel.layout.gap = '$primitive.space';
    const label = createNode('Text', 'reviewed-server-label'); label.props.text = 'Reviewed local fixture assignment';
    const panelOperation: Operation = { type: 'insert', parentId: document.rootId, index: 0, node: panel };
    const labelOperation: Operation = { type: 'insert', parentId: panel.id, index: 0, node: label };
    const proposal: AIProposal = { projectId: document.id, baseRevision: beforeAI.revision, summary: 'Explicit HTTP review fixture; no model inference.', groups: [
      { id: 'label', title: 'Add reviewed label', operations: [labelOperation], dependsOn: ['panel'] },
      { id: 'rejected-heading', title: 'Independent rejected heading', operations: [{ type: 'update', nodeId: 'workspace-title', patch: { props: { text: 'Do not accept this unrelated group' } } }], dependsOn: [] },
      { id: 'panel', title: 'Add reviewed panel', operations: [panelOperation], dependsOn: [] },
    ] };
    const applyResponse = await editor.request(`/api/projects/${document.id}/ai/apply`, 'POST', { proposal, groups: ['label', 'panel'] });
    expect(applyResponse.status).toBe(200); const applied = (await applyResponse.json() as { document: StudioDocument }).document;
    expect(applied.nodes[panel.id].children).toEqual([label.id]);
    expect(applied.nodes['workspace-title']).toEqual(beforeAI.nodes['workspace-title']);
    const actualAI = storedOperations(document.id, 'Reviewed AI proposal');
    expect(actualAI).toEqual([panelOperation, labelOperation]);
    const undone = await undo(editor);
    expect(semantic(undone.document)).toEqual(semantic(beforeAI));
    expect(undone.redoOperations).toEqual(actualAI); expect(undone.redoOperations).not.toEqual(olderEditorVisual);
    const redone = await submit(editor, undone.document, undone.redoOperations, 'Redo reviewed local AI subset');
    expect(semantic(redone)).toEqual(semantic(applied));
    const history = await (await owner.request(`/api/projects/${document.id}/history`)).json() as { actor: string; label: string }[];
    expect(history[0]).toMatchObject({ actor: 'Reviewed fixture editor', label: 'Redo reviewed local AI subset' });
  });

  it('enforces viewer, anonymous, foreign and revoked-role boundaries for undo and returned redo operations', async () => {
    const editor = await collaborator('editor', 'Editor with later revoked write access');
    const viewer = await collaborator('viewer', 'Read-only recovery viewer');
    const operations: Operation[] = [{ type: 'update', nodeId: 'workspace-title', patch: { name: 'Actor-owned transaction' } }];
    await submit(editor, document, operations, 'Latest editor transaction');
    const undone = await undo(editor); expect(undone.redoOperations).toEqual(operations);
    const anonymous = new ApiClient(studio);
    const outsider = new ApiClient(studio); await outsider.demo('Foreign private actor');
    for (const [client, status] of [[viewer, 403], [anonymous, 401], [outsider, 403]] as const) {
      expect((await client.request(`/api/projects/${document.id}/undo`, 'POST', {})).status).toBe(status);
      expect((await client.submit(document.id, { envelope: envelope(undone.document, undone.redoOperations, 'Forbidden redo'), strict: true })).status).toBe(status);
      expect(await owner.read(document.id)).toEqual(undone.document);
    }
    const revoke = await owner.request(`/api/projects/${document.id}/members/${editor.user!.id}`, 'PATCH', { role: 'viewer' });
    expect(revoke.status).toBe(200);
    expect((await editor.request(`/api/projects/${document.id}/undo`, 'POST', {})).status).toBe(403);
    expect((await editor.submit(document.id, { envelope: envelope(undone.document, undone.redoOperations, 'Revoked actor redo'), strict: true })).status).toBe(403);
    expect(await owner.read(document.id)).toEqual(undone.document);
    const ownerRedo = await submit(owner, undone.document, undone.redoOperations, 'Owner explicitly reviews returned redo operations');
    expect(ownerRedo.nodes['workspace-title'].name).toBe('Actor-owned transaction');
  });
});
