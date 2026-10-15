import { describe, expect, it } from 'vitest';
import { applyOperations, diagnoseDocument, DocumentValidationError, migrateDocument, serializeDocument, validateDocument } from '../../src/core/document';
import { createStarterDocument } from '../../src/core/starter';
import { createDefaultTokens, resolveNumericToken } from '../../src/core/tokens';
import type { Operation, OperationEnvelope, StudioDocument } from '../../src/core/types';

function fixture(): StudioDocument {
  const document = createStarterDocument('numeric-token-check');
  Object.assign(document.tokens.primitive, { spacing: 16, columns: 3, dimension: 320, panelHeight: 480, growth: 1.5, fontSize: 28, fontWeight: 700 });
  Object.assign(document.tokens.semantic, { spacing: '$primitive.spacing', gutter: '$semantic.spacing', columns: '$primitive.columns', dimension: '$primitive.dimension', height: '$primitive.panelHeight', growth: '$primitive.growth', fontSize: '$primitive.fontSize', fontWeight: '$primitive.fontWeight', radius: '$primitive.radius' });
  document.nodes.workspace.layout = { display: 'grid', gap: '$semantic.gutter', padding: '$primitive.spacing', columns: '$semantic.columns', width: '$semantic.dimension', height: '$semantic.height', grow: '$semantic.growth' };
  document.nodes.workspace.responsive = {
    desktop: { gap: '$semantic.spacing' },
    tablet: { gap: '$primitive.spacing', padding: '$semantic.gutter', columns: '$semantic.columns', width: '$semantic.dimension', height: '$semantic.height', grow: '$semantic.growth' },
    phone: { padding: '$semantic.spacing', width: 'fill', height: 'auto' },
  };
  document.nodes.workspace.props.radius = '$semantic.radius';
  document.nodes['ticket-details'].props.radius = '$primitive.radius';
  document.nodes['workspace-title'].props.size = '$semantic.fontSize';
  document.nodes['workspace-title'].props.weight = '$semantic.fontWeight';
  return document;
}

function envelope(document: StudioDocument, operations: Operation[]): OperationEnvelope {
  return { id: 'numeric-operation-check', projectId: document.id, baseRevision: document.revision, label: 'Inspect numeric token change', operations };
}

describe('numeric token resolution', () => {
  it('resolves chained aliases and finite fractional/literal numbers without changing tokens', () => {
    const document = fixture();
    const before = JSON.stringify(document.tokens);
    expect(resolveNumericToken(document.tokens, '$semantic.gutter')).toBe(16);
    expect(resolveNumericToken(document.tokens, '$semantic.growth')).toBe(1.5);
    expect(resolveNumericToken(document.tokens, 0)).toBe(0);
    expect(resolveNumericToken(document.tokens, -4)).toBe(-4); // Field bounds belong to document validation.
    expect(JSON.stringify(document.tokens)).toBe(before);
  });

  it.each([['color', '#ffffff'], ['numeric string', '16'], ['CSS length', '16px'], ['CSS expression', 'calc(8px * 2)'], ['empty string', '']])('refuses %s instead of coercing it into a numeric field', (_label, value) => {
    const tokens = createDefaultTokens(); tokens.primitive.notNumeric = value;
    expect(() => resolveNumericToken(tokens, '$primitive.notNumeric')).toThrow(/finite number/);
    expect(() => resolveNumericToken(tokens, value)).toThrow(/finite number/);
  });

  it.each([Infinity, -Infinity, NaN])('refuses nonfinite literal/token value %s', value => {
    const tokens = createDefaultTokens(); tokens.primitive.invalid = value;
    expect(() => resolveNumericToken(tokens, value)).toThrow(/finite number/);
    expect(() => resolveNumericToken(tokens, '$primitive.invalid')).toThrow(/finite number/);
  });

  it('rejects missing, cyclic and malformed references without executing strings', () => {
    const tokens = createDefaultTokens();
    expect(() => resolveNumericToken(tokens, '$semantic.missing')).toThrow(/Missing token/);
    expect(() => resolveNumericToken(tokens, '$notAReference')).toThrow(/Invalid token reference/);
    tokens.semantic.a = '$semantic.b'; tokens.semantic.b = '$semantic.a';
    expect(() => resolveNumericToken(tokens, '$semantic.a')).toThrow(/cycle/);
  });
});

describe('numeric document contracts', () => {
  it('retains aliases/identities in every numeric layout field, responsive override and numeric catalog property', () => {
    const document = fixture(); const original = JSON.stringify(document);
    const validated = validateDocument(document);
    expect(validated).toEqual(document);
    expect(validated.nodes.workspace.layout).toEqual(document.nodes.workspace.layout);
    expect(validated.nodes.workspace.responsive).toEqual(document.nodes.workspace.responsive);
    expect(validated.nodes['workspace-title'].props).toEqual(document.nodes['workspace-title'].props);
    expect(validated.nodes['ticket-details'].props.radius).toBe('$primitive.radius');
    expect(JSON.stringify(document)).toBe(original);
    expect(validateDocument(JSON.parse(serializeDocument(validated)))).toEqual(validated);
  });

  it.each([
    ['gap', -1], ['gap', 513], ['padding', -1], ['padding', 513],
    ['columns', 0], ['columns', 13], ['columns', 2.5],
    ['width', 0], ['width', 10001], ['height', 0], ['height', 10001], ['grow', -1], ['grow', 21],
  ] as const)('keeps existing %s bounds/integer checks for resolved token %s', (field, value) => {
    const document = fixture(); document.tokens.primitive.invalidNumber = value;
    document.nodes.workspace.layout[field] = '$primitive.invalidNumber';
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
  });

  it.each([['radius', -1], ['radius', 201], ['size', 7], ['size', 97], ['weight', 99], ['weight', 901], ['weight', 650], ['weight', 700.5]] as const)('keeps existing catalog %s bound/multiple checks for token %s', (field, value) => {
    const document = fixture(); document.tokens.primitive.invalidNumber = value;
    const node = field === 'radius' ? document.nodes.workspace : document.nodes['workspace-title'];
    node.props[field] = '$primitive.invalidNumber';
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
    if (field === 'weight' && (value === 650 || value === 700.5)) expect(() => validateDocument(document)).toThrow(/multiple of 100/);
  });

  it.each(['#ffffff', '16', '16px', 'calc(8px * 2)', '$semantic.missing'])('rejects nonnumeric/missing responsive token target %s with node diagnostic', value => {
    const document = fixture(); document.tokens.primitive.invalidNumber = value;
    document.nodes.workspace.responsive.phone = { padding: '$primitive.invalidNumber' };
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
    if (!value.startsWith('$')) expect(diagnoseDocument(document)).toContainEqual(expect.objectContaining({ code: 'INVALID_TOKEN', nodeId: 'workspace', message: expect.stringContaining('responsive.phone.padding') }));
  });

  it('validates resolved values in all breakpoints and rejects color tokens in numeric props', () => {
    for (const breakpoint of ['desktop', 'tablet', 'phone'] as const) {
      const document = fixture(); document.nodes.workspace.responsive[breakpoint] = { columns: '$primitive.spacing' };
      expect(() => validateDocument(document)).toThrow(new RegExp(`responsive\\.${breakpoint}\\.columns must be an integer`));
    }
    const document = fixture(); document.nodes['workspace-title'].props.size = '$semantic.accent';
    expect(() => validateDocument(document)).toThrow(/must resolve to a finite number/);
  });

  it('leaves literal text, labels, options and interaction values beginning $ untouched', () => {
    const document = fixture();
    document.nodes['workspace-title'].props.text = '$20 per month';
    document.nodes['refresh-tickets'].props.label = '$semantic.unknown is literal label text';
    document.nodes['refresh-tickets'].events.onClick = { action: 'setTab', value: '$5' };
    document.nodes['ticket-search'].props.placeholder = '$50';
    document.nodes['status-filter'].props.options = [{ label: '$40', value: '$semantic.missing' }];
    expect(validateDocument(document)).toEqual(document);
  });

  it('does not extend enum/color contracts to arbitrary token syntax', () => {
    const document = fixture(); document.nodes['workspace-title'].props.variant = '$semantic.fontSize';
    expect(() => validateDocument(document)).toThrow(/variant must be one of/);
    const color = fixture(); color.nodes['workspace-title'].props.color = '$primitive.spacing';
    expect(() => validateDocument(color)).toThrow(/supported CSS color/);
  });

  it('keeps old numeric literal snapshots, fill/auto keywords and v0 migration compatible', () => {
    const document = createStarterDocument('literal-compatibility'); const before = serializeDocument(document);
    expect(serializeDocument(migrateDocument(JSON.parse(before)))).toBe(before);
    const legacy = JSON.parse(before); legacy.schemaVersion = 0;
    const untouched = JSON.stringify(legacy);
    expect(migrateDocument(legacy)).toEqual(document);
    expect(JSON.stringify(legacy)).toBe(untouched);
    expect(validateDocument(document).nodes.workspace.layout).toMatchObject({ gap: 24, padding: 32, width: 'fill', height: 'auto' });
  });
});

describe('atomic numeric token operations and diagnostics', () => {
  it('updates shared references transactionally without replacing aliases or literal dimensions', () => {
    const document = fixture(); const before = serializeDocument(document);
    const next = applyOperations(document, envelope(document, [{ type: 'token', category: 'primitive', name: 'spacing', value: 24 }]));
    expect(next.revision).toBe(1);
    expect(next.nodes.workspace.layout.gap).toBe('$semantic.gutter');
    expect(resolveNumericToken(next.tokens, next.nodes.workspace.layout.gap!)).toBe(24);
    expect(resolveNumericToken(next.tokens, next.nodes.workspace.responsive.tablet!.padding!)).toBe(24);
    expect(next.nodes['ticket-details'].layout.width).toBe(336);
    expect(serializeDocument(document)).toBe(before);
  });

  it.each([513, -1, '#ffffff', '16', '$semantic.missing', '$semantic.gutter', Infinity])('rejects incompatible shared token update %s atomically after an earlier edit', value => {
    const document = fixture(); const before = serializeDocument(document);
    expect(() => applyOperations(document, envelope(document, [
      { type: 'update', nodeId: 'workspace-title', patch: { name: 'Must not persist' } },
      { type: 'token', category: 'primitive', name: 'spacing', value },
    ]))).toThrow(DocumentValidationError);
    expect(document.revision).toBe(0);
    expect(serializeDocument(document)).toBe(before);
  });

  it('rejects structural/schema edits that introduce invalid references without partial mutation', () => {
    const document = fixture(); const before = serializeDocument(document);
    expect(() => applyOperations(document, envelope(document, [{ type: 'update', nodeId: 'workspace', patch: { layout: { gap: '$semantic.missing' } } }]))).toThrow(/Missing token/);
    expect(serializeDocument(document)).toBe(before);
    const replacement = fixture(); replacement.nodes.workspace.layout.width = '$semantic.accent';
    expect(() => applyOperations(document, envelope(document, [{ type: 'replace', document: replacement }]))).toThrow(/finite number/);
    expect(serializeDocument(document)).toBe(before);
  });

  it('retains readability/phone diagnostics and contrast thresholds for resolved typography', () => {
    const document = fixture();
    document.tokens.primitive.fontSize = 10;
    document.tokens.primitive.dimension = 500;
    document.nodes['workspace-title'].responsive.phone = { width: '$semantic.dimension' };
    let warnings = diagnoseDocument(document);
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'SMALL_TEXT', nodeId: 'workspace-title' }));
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'PHONE_OVERFLOW', nodeId: 'workspace-title' }));
    document.nodes.workspace.props.background = '#ffffff'; document.nodes['workspace-title'].props.color = '#777777';
    document.tokens.primitive.fontSize = 24;
    warnings = diagnoseDocument(document);
    expect(warnings.some(item => item.nodeId === 'workspace-title' && item.code === 'LOW_CONTRAST')).toBe(false);
    document.tokens.primitive.fontSize = 16;
    expect(diagnoseDocument(document)).toContainEqual(expect.objectContaining({ code: 'LOW_CONTRAST', nodeId: 'workspace-title' }));
  });

  it('enforces every numeric field after a batch instead of validating only the token being edited', () => {
    const document = fixture();
    document.nodes.workspace.layout.columns = '$primitive.columns';
    const before = serializeDocument(document);
    expect(() => applyOperations(document, envelope(document, [{ type: 'token', category: 'primitive', name: 'columns', value: 3.5 }]))).toThrow(/columns must be an integer/);
    expect(serializeDocument(document)).toBe(before);
    // A dependency-aware batch can explicitly update a token and every restrictive consumer together.
    const next = applyOperations(document, envelope(document, [
      { type: 'token', category: 'primitive', name: 'columns', value: 3.5 },
      { type: 'update', nodeId: 'workspace', patch: { layout: { ...document.nodes.workspace.layout, columns: 3 }, responsive: { phone: document.nodes.workspace.responsive.phone! } } },
    ]));
    expect(next.revision).toBe(1);
    expect(next.nodes.workspace.layout.columns).toBe(3);
  });
});
