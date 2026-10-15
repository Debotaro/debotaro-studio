import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNode } from '../../src/core/document';
import type { AIProposal, Operation, ProposalGroup, StudioDocument } from '../../src/core/types';
import { ApiClient, envelope, startStudio } from '../server/helpers';
import type { RunningStudio } from '../server/helpers';

let studio: RunningStudio;
let owner: ApiClient;
let document: StudioDocument;
beforeEach(async () => {
  // No provider substitution: actual propose route must report no configured live inference.
  vi.stubEnv('OPENAI_API_KEY', ''); vi.stubEnv('OPENAI_MODEL', '');
  studio = await startStudio(); owner = new ApiClient(studio);
  document = await owner.demo('AI route owner');
});
afterEach(async () => { await studio?.close(); vi.unstubAllEnvs(); });

function changeHeading(doc = document): Operation {
  return { type: 'update', nodeId: 'workspace-title', patch: { props: { ...doc.nodes['workspace-title'].props, text: 'A reviewed support heading' } } };
}
const group = (id: string, operations: Operation[], dependsOn: string[] = []): ProposalGroup => ({ id, title: `Review ${id}`, operations, dependsOn });
function fixtureProposal(groups = [group('heading', [changeHeading()])], doc = document): AIProposal {
  return { projectId: doc.id, baseRevision: doc.revision, summary: 'Explicit local validation fixture; no model inference occurred.', groups };
}
const proposePath = () => `/api/projects/${document.id}/ai/propose`;
const applyPath = () => `/api/projects/${document.id}/ai/apply`;
async function editor(name = 'AI route editor', role: 'editor' | 'viewer' = 'editor') {
  const client = new ApiClient(studio);
  await client.join(await owner.invite(document.id, role), name);
  return client;
}
async function assertNoChange() {
  expect(await owner.read(document.id)).toEqual(document);
  const history = await owner.request(`/api/projects/${document.id}/history`);
  expect(history.status).toBe(200); expect(await history.json()).toEqual([]);
}

describe('AI HTTP routes — actual server, explicit validation fixtures, no live inference', () => {
  it('reports honest no-key status and returns 503 without modifying the document or audit', async () => {
    const status = await new ApiClient(studio).request('/api/ai/status');
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ available: false, model: null, provider: 'openai', disclosure: expect.stringContaining('never applied automatically'), reason: expect.stringContaining('OPENAI_API_KEY') });
    const response = await owner.request(proposePath(), 'POST', { prompt: 'Add an assignment panel', baseRevision: document.revision });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Live AI is unavailable') });
    await assertNoChange();
  });

  it('denies unauthenticated and viewer direct propose/apply requests before provider access', async () => {
    const anonymous = new ApiClient(studio);
    const viewer = await editor('AI route viewer', 'viewer');
    for (const [client, status] of [[anonymous, 401], [viewer, 403]] as const) {
      const propose = await client.request(proposePath(), 'POST', { prompt: 'Change the heading', baseRevision: 0 });
      expect(propose.status).toBe(status);
      const apply = await client.request(applyPath(), 'POST', { proposal: fixtureProposal(), groups: ['heading'] });
      expect(apply.status).toBe(status);
    }
    await assertNoChange();
  });

  it('rejects inaccessible route resources and proposal project/node tampering without partial changes', async () => {
    const outsider = new ApiClient(studio); const foreign = await outsider.demo('Unrelated private owner');
    const directPropose = await owner.request(`/api/projects/${foreign.id}/ai/propose`, 'POST', { prompt: 'Change a foreign project', baseRevision: 0 });
    expect(directPropose.status).toBe(403);
    const directApply = await owner.request(`/api/projects/${foreign.id}/ai/apply`, 'POST', { proposal: fixtureProposal(undefined, foreign), groups: ['heading'] });
    expect(directApply.status).toBe(403);
    const wrongProject = await owner.request(applyPath(), 'POST', { proposal: { ...fixtureProposal(), projectId: foreign.id }, groups: ['heading'] });
    expect(wrongProject.status).toBe(403);
    const wrongNode = await owner.request(applyPath(), 'POST', { proposal: fixtureProposal([group('outside', [changeHeading(), { type: 'delete', nodeId: 'foreign-node' }])]), groups: ['outside'] });
    expect(wrongNode.status).toBe(400);
    expect(await wrongNode.json()).toMatchObject({ error: expect.stringContaining('no longer exists') });
    await assertNoChange(); expect(await outsider.read(foreign.id)).toEqual(foreign);
  });

  it('rejects stale proposal generation and acceptance after a concurrent supported edit', async () => {
    const stale = fixtureProposal();
    const submitted = await owner.submit(document.id, { envelope: envelope(document, [{ type: 'update', nodeId: 'workspace-title', patch: { name: 'Concurrent layer name' } }]), strict: true });
    expect(submitted.status).toBe(200);
    const current = await owner.read(document.id); expect(current.revision).toBe(1);
    const propose = await owner.request(proposePath(), 'POST', { prompt: 'Change the heading', baseRevision: stale.baseRevision });
    expect(propose.status).toBe(400); expect(await propose.json()).toMatchObject({ error: expect.stringContaining('Project changed') });
    const apply = await owner.request(applyPath(), 'POST', { proposal: stale, groups: ['heading'] });
    expect(apply.status).toBe(409); expect(await apply.json()).toMatchObject({ error: expect.stringContaining('stale') });
    expect(await owner.read(document.id)).toEqual(current);
    const history = await (await owner.request(`/api/projects/${document.id}/history`)).json() as unknown[];
    expect(history).toHaveLength(1);
  });

  it('accepts a validated editor group through HTTP, records its actor, and supports that actor undo', async () => {
    const editingClient = await editor();
    const applied = await editingClient.request(applyPath(), 'POST', { proposal: fixtureProposal(), groups: ['heading'] });
    expect(applied.status).toBe(200);
    const result = await applied.json() as { document: StudioDocument };
    expect(result.document.revision).toBe(1); expect(result.document.nodes['workspace-title'].props.text).toBe('A reviewed support heading');
    expect(await owner.read(document.id)).toEqual(result.document);
    const history = await (await owner.request(`/api/projects/${document.id}/history`)).json() as { actor: string; label: string; revision: number }[];
    expect(history).toHaveLength(1); expect(history[0]).toMatchObject({ actor: 'AI route editor', label: 'Reviewed AI proposal', revision: 1 });
    const undone = await editingClient.request(`/api/projects/${document.id}/undo`, 'POST', {});
    expect(undone.status).toBe(200);
    const restored = (await undone.json() as { document: StudioDocument }).document;
    expect(restored.revision).toBe(2); expect({ ...restored, revision: 0 }).toEqual(document);
    const undoHistory = await (await owner.request(`/api/projects/${document.id}/history`)).json() as { actor: string; label: string }[];
    expect(undoHistory[0]).toMatchObject({ actor: 'AI route editor', label: 'Undo: Reviewed AI proposal' });
  });

  it('requires selected dependencies and accepts a closed subset while preserving rejected independent groups', async () => {
    const parent = group('panel', [{ type: 'insert', parentId: 'workspace', index: 0, node: createNode('Frame', 'ai-panel') }]);
    const child = group('panel-title', [{ type: 'insert', parentId: 'ai-panel', index: 0, node: createNode('Text', 'ai-panel-title') }], ['panel']);
    const fixture = fixtureProposal([child, group('heading', [changeHeading()]), parent]);
    const missing = await owner.request(applyPath(), 'POST', { proposal: fixture, groups: ['panel-title'] });
    expect(missing.status).toBe(400); expect(await missing.json()).toMatchObject({ error: expect.stringContaining('Keep dependency group panel') });
    await assertNoChange();
    const accepted = await owner.request(applyPath(), 'POST', { proposal: fixture, groups: ['panel', 'panel-title'] });
    expect(accepted.status).toBe(200);
    const result = (await accepted.json() as { document: StudioDocument }).document;
    expect(result.revision).toBe(1); expect(result.nodes['ai-panel'].children).toEqual(['ai-panel-title']);
    expect(result.nodes['ai-panel-title'].type).toBe('Text');
    expect(result.nodes['workspace-title']).toEqual(document.nodes['workspace-title']);
    expect(result.data).toEqual(document.data); expect(result.tokens).toEqual(document.tokens);
    const staleRemainder = await owner.request(applyPath(), 'POST', { proposal: fixture, groups: ['heading'] });
    expect(staleRemainder.status).toBe(409);
    expect(await owner.read(document.id)).toEqual(result);
  });

  it('refuses replacement, unsupported components, conflicting groups and forged provider settings', async () => {
    const replacement = await owner.request(applyPath(), 'POST', { proposal: fixtureProposal([group('replace', [{ type: 'replace', document }])]), groups: ['replace'] });
    expect(replacement.status).toBe(400);
    const unsupported = { ...createNode('Text', 'unsafe-node'), type: 'Script' };
    const unsafe = await owner.request(applyPath(), 'POST', { proposal: fixtureProposal([group('script', [{ type: 'insert', parentId: document.rootId, index: 0, node: unsupported } as Operation])]), groups: ['script'] });
    expect(unsafe.status).toBe(400);
    const conflict = await owner.request(applyPath(), 'POST', { proposal: fixtureProposal([group('first', [changeHeading()]), group('second', [{ type: 'update', nodeId: 'workspace-title', patch: { props: { text: 'Different meaning' } } }])]), groups: ['first', 'second'] });
    expect(conflict.status).toBe(400); expect(await conflict.json()).toMatchObject({ error: expect.stringContaining('explicit dependency') });
    const forgedProvider = await owner.request(proposePath(), 'POST', { prompt: 'Change the heading', baseRevision: 0, provider: 'fixture', model: 'client-chosen', role: 'owner' });
    expect(forgedProvider.status).toBe(400);
    await assertNoChange();
  });

  it('enforces permission revocation at both proposal and acceptance endpoints', async () => {
    const editingClient = await editor('Revoked proposal editor'); const proposedBeforeRevocation = fixtureProposal();
    const downgraded = await owner.request(`/api/projects/${document.id}/members/${editingClient.user!.id}`, 'PATCH', { role: 'viewer' });
    expect(downgraded.status).toBe(200);
    const propose = await editingClient.request(proposePath(), 'POST', { prompt: 'Change the heading', baseRevision: 0 });
    expect(propose.status).toBe(403);
    const apply = await editingClient.request(applyPath(), 'POST', { proposal: proposedBeforeRevocation, groups: ['heading'] });
    expect(apply.status).toBe(403);
    const revoked = await owner.request(`/api/projects/${document.id}/members/${editingClient.user!.id}`, 'PATCH', { role: null });
    expect(revoked.status).toBe(200);
    const inaccessible = await editingClient.request(applyPath(), 'POST', { proposal: proposedBeforeRevocation, groups: ['heading'] });
    expect(inaccessible.status).toBe(403);
    await assertNoChange();
  });
});
