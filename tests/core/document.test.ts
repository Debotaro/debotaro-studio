import { describe, expect, it } from 'vitest';
import { applyOperations, catalog, createNode, diagnoseDocument, DocumentValidationError, getParentId, migrateDocument, serializeDocument, summarizeChanges, validateDocument } from '../../src/core/document';
import { createStarterDocument } from '../../src/core/starter';
import { createDefaultTokens, resolveToken } from '../../src/core/tokens';
import type { Operation, OperationEnvelope } from '../../src/core/types';

const starter = () => createStarterDocument('project-core-test');
const envelope = (operations: Operation[], baseRevision = 0): OperationEnvelope => ({ id: 'op-test', projectId: 'project-core-test', baseRevision, label: 'Test a document change', operations });

describe('document invariants and recovery', () => {
  it('validates an independent fictional support workspace with working declarative contracts', () => {
    const doc = starter();
    expect(doc.data.tickets).toHaveLength(6);
    expect(doc.data.tickets.every(ticket => ticket.email.endsWith('.example'))).toBe(true);
    expect(doc.nodes['ticket-search'].events.onChange?.action).toBe('setQuery');
    expect(doc.nodes['status-filter'].bindings.value).toBe('status');
    expect(doc.nodes['ticket-table'].events.onClick?.action).toBe('selectTicket');
    expect(doc.nodes['ticket-details'].responsive.phone?.width).toBe('fill');
    const validated = validateDocument(doc);
    validated.nodes.workspace.name = 'Different';
    expect(doc.nodes.workspace.name).toBe('Support workspace');
  });
  it('serializes deterministically and recovers semantic meaning without losing identities', () => {
    const doc = starter();
    const reversed = { ...doc, nodes: Object.fromEntries(Object.entries(doc.nodes).reverse()), tokens: { semantic: doc.tokens.semantic, primitive: doc.tokens.primitive } };
    expect(serializeDocument(reversed)).toBe(serializeDocument(doc));
    expect(validateDocument(JSON.parse(serializeDocument(doc)))).toEqual(doc);
  });
  it('requires exact schema and forbids unknown executable-looking fields', () => {
    expect(() => validateDocument({ ...starter(), schemaVersion: 2 })).toThrow(/Unsupported schema/);
    const doc = starter();
    doc.nodes['ticket-search'].props.onChange = 'alert(document.cookie)';
    expect(() => validateDocument(doc)).toThrow(/onChange is not supported/);
    expect(() => validateDocument({ ...starter(), arbitrary: true })).toThrow(/arbitrary is not supported/);
  });
  it('rejects missing children, duplicate parents and node identity mismatch', () => {
    const missing = starter(); missing.nodes.workspace.children.push('missing');
    expect(() => validateDocument(missing)).toThrow(/missing child/);
    const twoParents = starter(); twoParents.nodes['heading-copy'].children.push('ticket-search');
    expect(() => validateDocument(twoParents)).toThrow(/more than one parent/);
    const wrongId = starter(); wrongId.nodes['ticket-search'].id = 'another-id';
    expect(() => validateDocument(wrongId)).toThrow(/does not match stable identity/);
  });
  it('rejects root cycles, disconnected cycles, orphan nodes and children on leaf components', () => {
    const cycle = starter(); cycle.nodes['workspace-header'].children.push('workspace');
    expect(() => validateDocument(cycle)).toThrow(/root cannot have a parent/);
    const disconnected = starter();
    disconnected.nodes.a = { ...createNode('Frame', 'a'), children: ['b'] };
    disconnected.nodes.b = { ...createNode('Frame', 'b'), children: ['a'] };
    expect(() => validateDocument(disconnected)).toThrow(/unreachable/);
    const orphan = starter(); orphan.nodes.orphan = createNode('Text', 'orphan');
    expect(() => validateDocument(orphan)).toThrow(/unreachable/);
    const leaf = starter(); leaf.nodes['workspace-title'].children.push('ticket-table');
    expect(() => validateDocument(leaf)).toThrow(/cannot contain children/);
  });
  it('rejects unsafe keys, non-JSON input, excessive layout values and invalid bindings', () => {
    const unsafe = JSON.parse(serializeDocument(starter()));
    unsafe.nodes.workspace.props = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(() => validateDocument(unsafe)).toThrow(/forbidden key/);
    const nonJson = starter(); Object.defineProperty(nonJson.nodes.workspace.props, 'background', { enumerable: true, get: () => { throw new Error('getter executed'); } });
    expect(() => validateDocument(nonJson)).toThrow(/not an accessor/);
    const layout = starter(); layout.nodes.workspace.layout.padding = 1000;
    expect(() => validateDocument(layout)).toThrow(/padding must be a number/);
    const binding = starter(); (binding.nodes['ticket-search'].bindings as Record<string, string>).value = 'document.cookie';
    expect(() => validateDocument(binding)).toThrow(/bindings.value must be one of/);
  });
  it('rejects token cycles, missing references, unsafe colors, duplicate options and duplicate tickets', () => {
    const cycle = starter(); cycle.tokens.semantic.accent = '$semantic.accent';
    expect(() => validateDocument(cycle)).toThrow(/Token reference cycle/);
    const missing = starter(); missing.nodes['workspace-title'].props.color = '$semantic.nonexistent';
    expect(() => validateDocument(missing)).toThrow(/Missing token/);
    const css = starter(); css.nodes.workspace.props.background = 'url(https://example.com/track)';
    expect(() => validateDocument(css)).toThrow(/supported CSS color/);
    const options = starter(); options.nodes['status-filter'].props.options = [{ label: 'A', value: 'a' }, { label: 'B', value: 'a' }];
    expect(() => validateDocument(options)).toThrow(/duplicate option/);
    const tickets = starter(); tickets.data.tickets.push(structuredClone(tickets.data.tickets[0]));
    expect(() => validateDocument(tickets)).toThrow(/Duplicate ticket identity/);
  });
  it('rejects oversize documents before rendering', () => {
    const doc = starter();
    for (let index = 0; index < 2001; index++) doc.nodes[`extra-${index}`] = createNode('Text', `extra-${index}`);
    expect(() => validateDocument(doc)).toThrow(/1–2,000 nodes/);
  });
  it('rejects sparse/accessor arrays, symbol keys and malformed colors without executing them', () => {
    const sparse = starter(); sparse.nodes.workspace.children = Array(2);
    expect(() => validateDocument(sparse)).toThrow(/present JSON value/);
    const accessors = starter(); Object.defineProperty(accessors.nodes.workspace.children, '0', { enumerable: true, get: () => { throw new Error('array getter executed'); } });
    expect(() => validateDocument(accessors)).toThrow(/without accessors/);
    const symbol = starter(); Object.assign(symbol, { [Symbol('secret')]: 'not JSON' });
    expect(() => validateDocument(symbol)).toThrow(/symbol keys/);
    for (const color of ['#12345', 'rgb(999, 1, 2)', 'rgba(10, 20, 30)', 'hsl(20, 200%, 50%)']) {
      const doc = starter(); doc.nodes.workspace.props.background = color;
      expect(() => validateDocument(doc)).toThrow(/supported CSS color/);
    }
    const valid = starter(); valid.nodes.workspace.props.background = 'rgba(10, 20, 30, 0.5)';
    expect(validateDocument(valid).nodes.workspace.props.background).toBe('rgba(10, 20, 30, 0.5)');
  });
  it('requires compatible binding/event pairs rather than allowing unrelated state writes', () => {
    const doc = starter(); doc.nodes['status-filter'].events.onChange = { action: 'assignTicket' };
    expect(() => validateDocument(doc)).toThrow(/does not match its value binding/);
    const button = starter(); button.nodes['refresh-tickets'].events.onClick = { action: 'setTab' };
    expect(() => validateDocument(button)).toThrow(/requires a literal value/);
  });
  it('supports explicit allowlisted runtime conditions and refuses expression execution', () => {
    const doc = starter(); doc.nodes['inbox-panel'].props.visibleWhen = 'tab:inbox';
    expect(validateDocument(doc).nodes['inbox-panel'].props.visibleWhen).toBe('tab:inbox');
    doc.nodes['inbox-panel'].props.visibleWhen = 'fetch("/private")';
    expect(() => validateDocument(doc)).toThrow(/visibleWhen must be one of/);
  });
  it('migrates only the documented v0 fields and preserves the original recovery payload', () => {
    const legacy = JSON.parse(serializeDocument(starter()));
    legacy.schemaVersion = 0; delete legacy.revision; delete legacy.theme; delete legacy.initialState;
    for (const node of Object.values(legacy.nodes) as Record<string, unknown>[]) { delete node.responsive; delete node.bindings; delete node.events; }
    const untouched = JSON.stringify(legacy);
    const migrated = migrateDocument(legacy);
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.revision).toBe(0);
    expect(migrated.nodes['ticket-search'].events).toEqual({});
    expect(migrated.initialState.selectedTicketId).toBeNull();
    expect(JSON.stringify(legacy)).toBe(untouched);
    expect(migrateDocument(migrated)).toEqual(migrated);
    expect(() => migrateDocument({ ...legacy, schemaVersion: 77 })).toThrow(/No migration/);
    expect(() => migrateDocument({ ...legacy, mystery: 'preserve-or-refuse' })).toThrow(/mystery is not supported/);
  });
});

describe('transactional operations', () => {
  it('builds nested inserts atomically and increments revision once', () => {
    const doc = starter();
    const next = applyOperations(doc, envelope([
      { type: 'insert', parentId: 'workspace', index: 0, node: createNode('Frame', 'assignment') },
      { type: 'insert', parentId: 'assignment', index: 0, node: createNode('Text', 'assignment-label') },
      { type: 'update', nodeId: 'assignment-label', patch: { props: { text: 'New assignment', color: '$semantic.text', size: 16, weight: 600 } } },
    ]));
    expect(next.revision).toBe(1);
    expect(getParentId(next, 'assignment-label')).toBe('assignment');
    expect(doc.nodes.assignment).toBeUndefined();
  });
  it('keeps original document unchanged when a late operation invalidates the transaction', () => {
    const doc = starter(); const original = serializeDocument(doc);
    expect(() => applyOperations(doc, envelope([
      { type: 'update', nodeId: 'workspace-title', patch: { name: 'Changed first' } },
      { type: 'token', category: 'semantic', name: 'accent', value: '$semantic.missing' },
    ]))).toThrow(/Missing token/);
    expect(serializeDocument(doc)).toBe(original);
    expect(doc.revision).toBe(0);
  });
  it('rejects stale imports, mismatched projects, operation limits and unknown envelope fields', () => {
    const doc = starter(); const change: Operation = { type: 'theme', theme: 'dark' };
    expect(() => applyOperations(doc, envelope([change], 1))).toThrow(/Stale revision/);
    expect(() => applyOperations(doc, { ...envelope([change]), projectId: 'someone-else' })).toThrow(/different project/);
    expect(() => applyOperations(doc, envelope(Array.from({ length: 101 }, () => change)))).toThrow(/1–100/);
    expect(() => applyOperations(doc, envelope([]))).toThrow(/1–100/);
    expect(() => applyOperations(doc, { ...envelope([change]), trusted: true } as OperationEnvelope)).toThrow(/trusted is not supported/);
  });
  it('rejects root deletion, cycle moves, duplicate inserts and insertion into a leaf', () => {
    const doc = starter();
    expect(() => applyOperations(doc, envelope([{ type: 'delete', nodeId: 'workspace' }]))).toThrow(/root cannot be deleted/);
    expect(() => applyOperations(doc, envelope([{ type: 'move', nodeId: 'workspace-header', parentId: 'heading-copy', index: 0 }]))).toThrow(/own subtree/);
    expect(() => applyOperations(doc, envelope([{ type: 'insert', parentId: 'workspace', index: 0, node: createNode('Text', 'workspace-title') }]))).toThrow(/already exists/);
    expect(() => applyOperations(doc, envelope([{ type: 'insert', parentId: 'workspace-title', index: 0, node: createNode('Text', 'new-label') }]))).toThrow(/cannot contain children/);
  });
  it('reorders using the post-removal index and removes whole subtrees', () => {
    const doc = starter();
    const next = applyOperations(doc, envelope([{ type: 'move', nodeId: 'workspace-header', parentId: 'workspace', index: 3 }]));
    expect(next.nodes.workspace.children).toEqual(['workspace-views', 'workspace-content', 'fictional-notice', 'workspace-header']);
    const removed = applyOperations(next, envelope([{ type: 'delete', nodeId: 'workspace-header' }], 1));
    expect(removed.nodes['workspace-header']).toBeUndefined();
    expect(removed.nodes['workspace-title']).toBeUndefined();
    expect(removed.nodes['workspace-content']).toBeDefined();
  });
  it('replaces supplied object fields instead of secretly deep-merging them', () => {
    const next = applyOperations(starter(), envelope([{ type: 'update', nodeId: 'workspace-title', patch: { props: { text: 'Edited via TSX' } } }]));
    expect(next.nodes['workspace-title'].props).toEqual({ text: 'Edited via TSX' });
  });
  it('applies inspected replacements under current envelope revision without changing project identity', () => {
    const doc = starter(); const replacement = starter(); replacement.nodes['workspace-title'].props.text = 'Imported';
    const result = applyOperations(doc, envelope([{ type: 'replace', document: replacement }]));
    expect(result.revision).toBe(1);
    expect(result.nodes['workspace-title'].props.text).toBe('Imported');
    expect(() => applyOperations(doc, envelope([{ type: 'replace', document: { ...replacement, id: 'foreign-project' } }]))).toThrow(/different project/);
  });
  it('summarizes structural, property and shared-token changes for inspected review', () => {
    const doc = starter();
    const next = applyOperations(doc, envelope([{ type: 'update', nodeId: 'workspace-title', patch: { name: 'New heading' } }, { type: 'token', category: 'primitive', name: 'violet', value: '#5e3ce0' }]));
    expect(summarizeChanges(doc, next)).toContainEqual({ nodeId: 'workspace-title', description: 'Update New heading: name' });
    expect(summarizeChanges(doc, next)).toContainEqual({ description: 'Update shared design tokens' });
  });
});

describe('tokens and useful diagnostics', () => {
  it('resolves numeric and chained references; rejects missing and cyclic aliases', () => {
    const tokens = createDefaultTokens();
    tokens.semantic.spacing = '$primitive.space';
    expect(resolveToken(tokens, '$semantic.spacing')).toBe(8);
    expect(resolveToken(tokens, '$semantic.accent')).toBe('#6d4aff');
    expect(resolveToken(tokens, '#ffffff')).toBe('#ffffff');
    expect(() => resolveToken(tokens, '$semantic.missing')).toThrow(/Missing token/);
    tokens.semantic.a = '$semantic.b'; tokens.semantic.b = '$semantic.a';
    expect(() => resolveToken(tokens, '$semantic.a')).toThrow(/cycle/);
  });
  it('provides theme tokens and catalog defaults without mutable shared instances', () => {
    expect(resolveToken(createDefaultTokens('dark'), '$semantic.background')).toBe('#171a24');
    const first = createNode('Text', 'first'); first.props.text = 'Changed';
    expect(createNode('Text', 'second').props.text).toBe('Text');
    expect(catalog.Frame.children).toBe(true);
    expect(catalog.Button.children).toBe(false);
  });
  it('maps validation errors to node identities and diagnoses contrast, labels and phone layout', () => {
    const invalid = starter(); invalid.nodes['workspace-title'].props.size = -4;
    const diagnostics = diagnoseDocument(invalid);
    expect(diagnostics[0].nodeId).toBe('workspace-title');
    expect(diagnostics[0].severity).toBe('error');
    expect(() => validateDocument(invalid)).toThrow(DocumentValidationError);
    const doc = starter(); doc.nodes['ticket-search'].props.label = '';
    doc.nodes['workspace-title'].props.color = '#f5f6fa';
    doc.nodes['workspace-title'].responsive.phone = { width: 500 };
    const warnings = diagnoseDocument(doc);
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'MISSING_LABEL', nodeId: 'ticket-search' }));
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'LOW_CONTRAST', nodeId: 'workspace-title' }));
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'PHONE_OVERFLOW', nodeId: 'workspace-title' }));
  });
});
