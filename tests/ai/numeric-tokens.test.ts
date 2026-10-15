/** Explicit local validation fixtures; no model provider/inference is used by these tests. */
import { describe, expect, it } from 'vitest';
import { applyOperations, createNode, serializeDocument, validateDocument } from '../../src/core/document';
import { createStarterDocument } from '../../src/core/starter';
import { resolveNumericToken } from '../../src/core/tokens';
import type { AIProposal, Operation, ProposalGroup, StudioDocument } from '../../src/core/types';
import { decodeProposalWire, proposalResponseSchema } from '../../server/ai/schema';
import { selectedOperations, validateProposal } from '../../server/ai/validation';

function document(): StudioDocument {
  const doc = createStarterDocument('numeric-ai-validation-fixture');
  Object.assign(doc.tokens.primitive, { fontSize: 28, fontWeight: 700, growth: 1.5 });
  doc.tokens.semantic.spacing = '$primitive.space';
  doc.nodes.workspace.layout.gap = '$semantic.spacing';
  doc.nodes.workspace.responsive.phone = { padding: '$primitive.space', width: 'fill' };
  doc.nodes['workspace-title'].props.size = '$primitive.fontSize';
  doc.nodes['workspace-title'].props.weight = '$primitive.fontWeight';
  return validateDocument(doc);
}
const group = (id: string, operations: Operation[], dependsOn: string[] = []): ProposalGroup => ({ id, title: `Inspect fixture ${id}`, operations, dependsOn });
function proposal(doc: StudioDocument, groups: ProposalGroup[]): AIProposal {
  return { projectId: doc.id, baseRevision: doc.revision, summary: 'Local numeric proposal validation fixture; no inference occurred.', groups };
}
function apply(doc: StudioDocument, operations: Operation[]): StudioDocument {
  return applyOperations(doc, { id: 'numeric-ai-inspected-apply', projectId: doc.id, baseRevision: doc.revision, label: 'Apply explicitly reviewed fixture operations', operations });
}
function numericEdit(doc: StudioDocument, value: unknown): Operation {
  return { type: 'update', nodeId: 'workspace', patch: { layout: { ...doc.nodes.workspace.layout, gap: value } } } as unknown as Operation;
}

type Schema = Record<string, unknown>;
const properties = (schema: Schema) => schema.properties as Record<string, Schema>;
function operationSchema(type: string): Schema {
  const groups = properties(proposalResponseSchema).groups.items as Schema;
  const choices = (properties(groups).operations.items as Schema).anyOf as Schema[];
  return choices.find(schema => (properties(schema).type.enum as string[]).includes(type))!;
}
function nullableWireLayout(overrides: Record<string, unknown>): Record<string, unknown> {
  return { display: null, direction: null, gap: null, padding: null, columns: null, width: null, height: null, align: null, justify: null, grow: null, ...overrides };
}

describe('numeric AI proposals — local fixtures, no live inference', () => {
  it('validates prerequisite token creation and alias consumers, requiring meaningful dependent review groups', () => {
    const doc = document(); const original = serializeDocument(doc);
    const tokens = group('tokens', [
      { type: 'token', category: 'primitive', name: 'reviewedSpacing', value: 24 },
      { type: 'token', category: 'semantic', name: 'reviewedGap', value: '$primitive.reviewedSpacing' },
      { type: 'token', category: 'semantic', name: 'reviewedFontSize', value: '$primitive.fontSize' },
    ]);
    const consumers = group('consumers', [
      { type: 'update', nodeId: 'workspace', patch: { layout: { ...doc.nodes.workspace.layout, gap: '$semantic.reviewedGap', padding: '$semantic.reviewedGap' }, props: { ...doc.nodes.workspace.props, radius: '$primitive.radius' } } },
      { type: 'update', nodeId: 'workspace-title', patch: { props: { ...doc.nodes['workspace-title'].props, size: '$semantic.reviewedFontSize' } } },
    ], ['tokens']);
    const accepted = validateProposal(proposal(doc, [consumers, tokens]), doc, 'editor');
    expect(accepted.groups.map(item => item.id)).toEqual(['tokens', 'consumers']);
    expect(() => selectedOperations(accepted, ['consumers'], doc, 'owner')).toThrow(/Keep dependency group tokens/);
    const tokenOnly = apply(doc, selectedOperations(accepted, ['tokens'], doc, 'owner'));
    expect(tokenOnly.tokens.primitive.reviewedSpacing).toBe(24);
    expect(tokenOnly.nodes.workspace.layout.gap).toBe('$semantic.spacing');
    const applied = apply(doc, selectedOperations(accepted, ['consumers', 'tokens'], doc, 'editor'));
    expect(applied.revision).toBe(1);
    expect(applied.nodes.workspace.layout.gap).toBe('$semantic.reviewedGap');
    expect(resolveNumericToken(applied.tokens, applied.nodes.workspace.layout.gap!)).toBe(24);
    expect(applied.nodes['workspace-title'].props.size).toBe('$semantic.reviewedFontSize');
    expect(serializeDocument(doc)).toBe(original); // Proposals/review never apply themselves.
  });

  it('accepts numeric aliases in inserted catalog props and responsive fields while preserving stable identities', () => {
    const doc = document();
    const panel = createNode('Frame', 'numeric-reviewed-panel'); panel.props.radius = '$primitive.radius'; panel.layout = { display: 'grid', columns: 2, gap: '$semantic.spacing' }; panel.responsive.phone = { columns: 1, padding: '$primitive.space', width: 'fill', height: 'auto', grow: '$primitive.growth' };
    const label = createNode('Text', 'numeric-reviewed-label'); label.props.text = '$25 · Fictional plan'; label.props.size = '$primitive.fontSize'; label.props.weight = '$primitive.fontWeight';
    const fixture = proposal(doc, [group('panel', [{ type: 'insert', parentId: 'workspace', index: 0, node: panel }, { type: 'insert', parentId: panel.id, index: 0, node: label }])]);
    const accepted = validateProposal(fixture, doc, 'owner');
    const next = apply(doc, selectedOperations(accepted, ['panel'], doc, 'owner'));
    expect(next.nodes[panel.id].children).toEqual([label.id]);
    expect(next.nodes[label.id].props.text).toBe('$25 · Fictional plan');
    expect(next.nodes[panel.id].responsive.phone?.grow).toBe('$primitive.growth');
  });

  it('normalizes nullable strict wire maps without converting numeric references or textual currency', () => {
    const doc = document();
    const wire = proposal(doc, [group('layout', [{ type: 'update', nodeId: 'workspace', patch: {
      name: null, props: null, layout: nullableWireLayout({ gap: '$semantic.spacing', grow: '$primitive.growth', width: 'fill', height: 'auto' }),
      responsive: { desktop: null, tablet: nullableWireLayout({ padding: '$primitive.space', columns: 3 }), phone: nullableWireLayout({ width: 'fill', columns: 1 }) },
      bindings: null, events: null,
    } } as unknown as Operation]), group('typography', [{ type: 'update', nodeId: 'workspace-title', patch: {
      name: null, layout: null, responsive: null, bindings: null, events: null,
      props: { text: '$20 per month', size: '$primitive.fontSize', weight: '$primitive.fontWeight', color: '$semantic.text', hidden: null, ariaLabel: null, visibleWhen: null, variant: null },
    } } as unknown as Operation])]);
    const untouched = JSON.stringify(wire);
    const decoded = decodeProposalWire(wire) as AIProposal;
    expect(decoded.groups[0].operations[0]).toEqual({ type: 'update', nodeId: 'workspace', patch: { layout: { gap: '$semantic.spacing', grow: '$primitive.growth', width: 'fill', height: 'auto' }, responsive: { tablet: { padding: '$primitive.space', columns: 3 }, phone: { width: 'fill', columns: 1 } } } });
    expect(decoded.groups[1].operations[0]).toMatchObject({ patch: { props: { text: '$20 per month', size: '$primitive.fontSize', weight: '$primitive.fontWeight' } } });
    const accepted = validateProposal(decoded, doc, 'owner');
    const next = apply(doc, selectedOperations(accepted, ['layout', 'typography'], doc, 'owner'));
    expect(next.nodes.workspace.layout.grow).toBe('$primitive.growth');
    expect(next.nodes['workspace-title'].props.text).toBe('$20 per month');
    expect(JSON.stringify(wire)).toBe(untouched);
  });

  it.each(['$semantic.missing', '$primitive.violet', '$spacing', '24', '24px', 'calc(8px * 3)', -1, 513, Infinity, NaN, false, null])('rejects invalid numeric proposal field %j without partial mutation', value => {
    const doc = document(); const original = serializeDocument(doc);
    const fixture = proposal(doc, [group('invalid', [{ type: 'update', nodeId: 'workspace-title', patch: { name: 'Must not apply' } }, numericEdit(doc, value)])]);
    expect(() => validateProposal(fixture, doc, 'owner')).toThrow();
    expect(serializeDocument(doc)).toBe(original);
  });

  it.each([513, -1, '8', '#ffffff', '$semantic.spacing', Infinity])('rejects shared-token proposal change %j that invalidates existing numeric consumers atomically', value => {
    const doc = document(); const original = serializeDocument(doc);
    const fixture = proposal(doc, [group('token', [{ type: 'update', nodeId: 'workspace-title', patch: { name: 'No partial name' } }, { type: 'token', category: 'primitive', name: 'space', value }])]);
    expect(() => selectedOperations(fixture, ['token'], doc, 'owner')).toThrow();
    expect(serializeDocument(doc)).toBe(original);
  });

  it('rejects noninteger grid and nonmultiple weight aliases supplied through otherwise wellformed proposal tokens', () => {
    const doc = document(); const original = serializeDocument(doc);
    const grid = proposal(doc, [group('grid', [{ type: 'token', category: 'primitive', name: 'gridColumns', value: 2.5 }, { type: 'update', nodeId: 'workspace', patch: { layout: { columns: '$primitive.gridColumns' } } }])]);
    expect(() => validateProposal(grid, doc, 'owner')).toThrow(/columns must be an integer/);
    const weight = proposal(doc, [group('weight', [{ type: 'token', category: 'primitive', name: 'fontWeight', value: 650 }])]);
    expect(() => validateProposal(weight, doc, 'owner')).toThrow(/multiple of 100/);
    expect(serializeDocument(doc)).toBe(original);
  });

  it('retains unknown nullable keys and refuses managed executable properties instead of silently dropping them', () => {
    const doc = document();
    const unknown = proposal(doc, [group('unknown', [{ type: 'update', nodeId: 'workspace', patch: { layout: { gap: '$semantic.spacing', unauthorizedDimension: null } } } as unknown as Operation])]);
    expect(() => validateProposal(decodeProposalWire(unknown), doc, 'owner')).toThrow(/unauthorizedDimension is not supported/);
    const unsafe = proposal(doc, [group('unsafe', [{ type: 'update', nodeId: 'workspace-title', patch: { props: { size: '$primitive.fontSize', dangerouslySetInnerHTML: '<script>steal()</script>' } } }])]);
    expect(() => validateProposal(decodeProposalWire(unsafe), doc, 'owner')).toThrow(/not supported/);
  });

  it('requires explicit dependencies for shared token writes and rejects contradictory numeric changes', () => {
    const doc = document();
    const first: Operation = { type: 'token', category: 'primitive', name: 'space', value: 12 };
    const second: Operation = { type: 'token', category: 'primitive', name: 'space', value: 16 };
    expect(() => validateProposal(proposal(doc, [group('first', [first]), group('second', [second])]), doc, 'owner')).toThrow(/explicit dependency/);
    expect(() => validateProposal(proposal(doc, [group('contradictory', [first, second])]), doc, 'owner')).toThrow(/contradictory writes/);
    expect(validateProposal(proposal(doc, [group('first', [first]), group('second', [second], ['first'])]), doc, 'owner').groups).toHaveLength(2);
  });

  it('rejects stale token proposal review after a concurrent token edit and denies viewer/foreign resource operations', () => {
    const doc = document(); const fixture = proposal(doc, [group('spacing', [{ type: 'token', category: 'primitive', name: 'space', value: 16 }])]);
    const current = apply(doc, [{ type: 'token', category: 'primitive', name: 'space', value: 12 }]);
    expect(() => validateProposal(fixture, current, 'owner')).toThrow(/stale/);
    expect(() => selectedOperations(fixture, ['spacing'], current, 'owner')).toThrow(/stale/);
    expect(() => validateProposal(fixture, doc, 'viewer')).toThrow(/permission/);
    expect(() => selectedOperations(fixture, ['spacing'], doc, 'viewer')).toThrow(/permission/);
    expect(() => validateProposal({ ...fixture, projectId: 'inaccessible-project' }, doc, 'owner')).toThrow(/inaccessible project/);
    expect(() => validateProposal(proposal(doc, [group('outside', [{ type: 'update', nodeId: 'foreign-layer', patch: { layout: { gap: '$semantic.spacing' } } }])]), doc, 'owner')).toThrow(/no longer exists/);
    expect(doc.revision).toBe(0); expect(current.tokens.primitive.space).toBe(12);
  });
});

describe('numeric response-schema contract — static inspection, provider acceptance not tested', () => {
  it('offers numeric literals and strictly named aliases for every numeric layout/property field, retaining fill/auto', () => {
    const sparsePatch = properties(operationSchema('update')).patch;
    const layout = (properties(sparsePatch).layout.anyOf as Schema[]).find(schema => schema.type === 'object')!;
    const props = (properties(sparsePatch).props.anyOf as Schema[]).find(schema => schema.type === 'object')!;
    const numericSchemas = [...['gap', 'padding', 'columns', 'width', 'height', 'grow'].map(field => properties(layout)[field]), ...['radius', 'size', 'weight'].map(field => properties(props)[field])];
    function branches(schema: Schema): Schema[] { return [schema, ...(schema.anyOf as Schema[] ?? []).flatMap(branches)]; }
    for (const schema of numericSchemas) {
      const choices = branches(schema);
      expect(choices.some(branch => branch.type === 'number')).toBe(true);
      const alias = choices.find(branch => branch.type === 'string' && typeof branch.pattern === 'string');
      expect(alias).toBeDefined();
      const pattern = new RegExp(alias!.pattern as string);
      for (const value of ['$primitive.space', '$semantic.font-size', '$semantic.columns_3']) expect(pattern.test(value), value).toBe(true);
      for (const value of ['$5', '$primitive.', '$other.space', '$semantic.size.bad', '24', '24px', 'calc(8px * 3)']) expect(pattern.test(value), value).toBe(false);
      expect(choices.some(branch => branch.type === 'null')).toBe(true);
    }
    expect(branches(properties(layout).width).some(schema => (schema.enum as string[] ?? []).includes('fill'))).toBe(true);
    expect(branches(properties(layout).height).some(schema => (schema.enum as string[] ?? []).includes('auto'))).toBe(true);
    expect(layout.additionalProperties).toBe(false); expect(layout.required).toEqual(Object.keys(properties(layout)));
    expect(props.additionalProperties).toBe(false); expect(props.required).toEqual(Object.keys(properties(props)));
  });

  it('retains strict required/extra-key protection throughout numeric insert/update/response objects', () => {
    const objects: Schema[] = [];
    function visit(value: unknown): void {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      const schema = value as Schema;
      if (schema.type === 'object') objects.push(schema);
      Object.values(schema).forEach(visit);
    }
    visit(proposalResponseSchema);
    expect(objects.length).toBeGreaterThan(10);
    for (const schema of objects) {
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(Object.keys(properties(schema)));
    }
    // JSON cannot represent Infinity/NaN. Local proposal validation separately rejects them.
    const doc = document(); expect(() => validateProposal(proposal(doc, [group('nonfinite', [numericEdit(doc, Infinity)])]), doc, 'owner')).toThrow(/finite/);
  });
});
