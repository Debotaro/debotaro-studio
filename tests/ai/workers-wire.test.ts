import { describe, expect, it } from 'vitest';
import { decodeWorkersProposal } from '../../edge/ai-wire';
import { createStarterDocument } from '../../src/core/starter';
import { selectedOperations, validateProposal } from '../../server/ai/validation';
import { applyOperations, createNode } from '../../src/core/document';
import type { AIProposal, Operation } from '../../src/core/types';

const document = () => createStarterDocument('wire-regression');
const wire = (operations: unknown[]): { projectId: string; baseRevision: number; summary: string; groups: { id: string; title: string; dependsOn: string[]; operations: unknown[] }[] } => ({ projectId: 'wire-regression', baseRevision: 0, summary: 'A reviewed update.', groups: [{ id: 'edit', title: 'Review edit', dependsOn: [], operations }] });
const apply = (value: unknown) => { const doc = document(); const proposal = validateProposal(decodeWorkersProposal(value, doc), doc, 'owner'); return applyOperations(doc, { id: 'wire-accept', projectId: doc.id, baseRevision: 0, label: 'Accept', operations: selectedOperations(proposal, proposal.groups.map(group => group.id), doc, 'owner') }); };
describe('Workers partial-map wire regression', () => {
  it('retains heading variant, color, size and weight when only text changes', () => {
    const before = document(); const changed = apply(wire([{ type: 'update', nodeId: 'workspace-title', patch: { props: { text: 'A careful change.' } } }]));
    expect(changed.nodes['workspace-title'].props).toEqual({ ...before.nodes['workspace-title'].props, text: 'A careful change.' });
    expect(before).toEqual(document());
  });
  it('retains existing layout and other responsive breakpoints', () => {
    const before = document();
    const changed = apply(wire([{ type: 'update', nodeId: 'workspace', patch: { layout: { padding: 40 }, responsive: { phone: { padding: 20 } } } }]));
    expect(changed.nodes.workspace.layout).toEqual({ ...before.nodes.workspace.layout, padding: 40 });
    expect(changed.nodes.workspace.responsive).toEqual({ ...before.nodes.workspace.responsive, phone: { ...before.nodes.workspace.responsive.phone, padding: 20 } });
  });
  it('keeps intentional complete replacement and clearing explicit', () => {
    const changed = apply(wire([{ type: 'update', nodeId: 'workspace-title', replaceMaps: ['props'], patch: { props: { text: 'Intentionally plain text' } } }]));
    expect(changed.nodes['workspace-title'].props).toEqual({ text: 'Intentionally plain text' });
    const cleared = apply(wire([{ type: 'update', nodeId: 'workspace-views', replaceMaps: ['events'], patch: { events: {} } }]));
    expect(cleared.nodes['workspace-views'].events).toEqual({});
  });
  it('expands dependent groups in order without losing prerequisite properties', () => {
    const input = wire([]);
    input.groups = [
      { id: 'text', title: 'Text', dependsOn: ['color'], operations: [{ type: 'update', nodeId: 'workspace-title', patch: { props: { text: 'Preserved dependency' } } }] },
      { id: 'color', title: 'Color', dependsOn: [], operations: [{ type: 'update', nodeId: 'workspace-title', patch: { props: { color: '#123456' } } }] },
    ];
    expect(apply(input).nodes['workspace-title'].props).toEqual({ ...document().nodes['workspace-title'].props, color: '#123456', text: 'Preserved dependency' });
  });
  it('still refuses independent overlapping groups and inaccessible nodes/projects', () => {
    const input = wire([]);
    input.groups = [
      { id: 'text', title: 'Text', dependsOn: [], operations: [{ type: 'update', nodeId: 'workspace-title', patch: { props: { text: 'Needs dependency' } } }] },
      { id: 'color', title: 'Color', dependsOn: [], operations: [{ type: 'update', nodeId: 'workspace-title', patch: { props: { color: '#123456' } } }] },
    ];
    expect(() => apply(input)).toThrow(/explicit dependency/);
    expect(() => apply(wire([{ type: 'update', nodeId: 'foreign-node', patch: { name: 'Denied' } }]))).toThrow(/no longer exists/);
    expect(() => apply({ ...wire([{ type: 'theme', theme: 'dark' }]), projectId: 'foreign-project' })).toThrow(/inaccessible project/);
  });
  it('rejects unsafe/unknown keys and invalid replacement controls before stripping', () => {
    const unsafe = JSON.parse(JSON.stringify(wire([{ type: 'update', nodeId: 'workspace-title', patch: { props: {} } }])));
    unsafe.groups[0].operations[0].patch.props = JSON.parse('{"__proto__":null}');
    expect(() => apply(unsafe)).toThrow(/Unsafe proposal key/);
    expect(() => apply(wire([{ type: 'update', nodeId: 'workspace-title', replaceMaps: ['unknown'], patch: { name: 'Denied' } }]))).toThrow(/Invalid AI map/);
    expect(() => apply(wire([{ type: 'update', nodeId: 'workspace-title', replaceMaps: ['props', 'props'], patch: { name: 'Denied' } }]))).toThrow(/Invalid AI map/);
    expect(() => apply(wire([{ type: 'update', nodeId: 'workspace-title', patch: { props: { unknown: null } } }]))).toThrow(/unknown is not supported/);
  });
  it('returns complete canonical operations with no provider control metadata', () => {
    const decoded = decodeWorkersProposal(wire([{ type: 'update', nodeId: 'workspace-title', replaceMaps: [], patch: { props: { text: 'Canonical' } } }]), document()) as AIProposal;
    const op = decoded.groups[0].operations[0] as Extract<Operation, { type: 'update' }>;
    expect(op).not.toHaveProperty('replaceMaps');
    expect(op.patch.props).toHaveProperty('variant', 'title');
  });
  it('does not resolve inherited object properties as project nodes', () => {
    for (const nodeId of ['__proto__', 'constructor', 'toString']) {
      const decoded = decodeWorkersProposal(wire([{ type: 'update', nodeId, patch: { props: { text: 'Denied' } } }]), document()) as AIProposal;
      expect(decoded.groups[0].operations[0]).toEqual({ type: 'update', nodeId, patch: { props: { text: 'Denied' } } });
      expect(() => validateProposal(decoded, document(), 'owner')).toThrow();
    }
  });
  it('can insert a node and apply a partial update in the same reviewed group', () => {
    const node = createNode('Text', 'wire-new-text');
    const changed = apply(wire([{ type: 'insert', parentId: 'workspace', index: 0, node }, { type: 'update', nodeId: node.id, patch: { props: { text: 'New reviewed child' } } }]));
    expect(changed.nodes[node.id].props).toEqual({ ...node.props, text: 'New reviewed child' });
    expect(changed.nodes.workspace.children[0]).toBe(node.id);
  });
});
