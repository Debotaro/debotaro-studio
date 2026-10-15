import { describe, expect, it } from 'vitest';
import { compileDocument, importCode } from '../../src/compiler';
import { serializeDocument, validateDocument } from '../../src/core/document';
import { createStarterDocument } from '../../src/core/starter';
import type { StudioDocument } from '../../src/core/types';

function fixture(): StudioDocument {
  const doc = createStarterDocument('numeric-compiler');
  Object.assign(doc.tokens.primitive, { spacing: 24, columns: 3, width: 960, height: 720, grow: 1, fontSize: 28, fontWeight: 700 });
  Object.assign(doc.tokens.semantic, { spacing: '$primitive.spacing', columns: '$primitive.columns', width: '$primitive.width', height: '$primitive.height', grow: '$primitive.grow', titleSize: '$primitive.fontSize', titleWeight: '$primitive.fontWeight', corner: '$primitive.radius' });
  doc.nodes.workspace.layout = { display: 'grid', gap: '$semantic.spacing', padding: '$primitive.space', columns: '$semantic.columns', width: '$semantic.width', height: '$semantic.height', grow: '$semantic.grow' };
  doc.nodes.workspace.responsive = { phone: { gap: '$primitive.space', padding: '$primitive.space', columns: 1, width: 'fill', height: 'auto' } };
  doc.nodes.workspace.props.radius = '$semantic.corner';
  Object.assign(doc.nodes['workspace-title'].props, { text: '$49/month', size: '$semantic.titleSize', weight: '$semantic.titleWeight' });
  return validateDocument(doc);
}

describe('supported numeric token TSX', () => {
  it('retains alias references, stable identities, responsive layout and behavior semantically', () => {
    const doc = fixture();
    const compiled = compileDocument(doc);
    expect(compiled.diagnostics).toEqual([]);
    const imported = importCode(compiled.code, doc);
    expect(imported.diagnostics).toEqual([]);
    expect(imported.document).toEqual(doc);
    expect(serializeDocument(imported.document!)).toBe(serializeDocument(doc));
    expect(Object.keys(compiled.nodeLocations).sort()).toEqual(Object.keys(doc.nodes).sort());
    expect(imported.document?.nodes.workspace.layout).toEqual(doc.nodes.workspace.layout);
    expect(imported.document?.nodes['workspace-title'].props.text).toBe('$49/month');
    expect(imported.document?.nodes['ticket-search'].events).toEqual(doc.nodes['ticket-search'].events);
  });

  it('accepts and reverses a supported numeric reference edit while preserving surrounding handwritten text', () => {
    const doc = fixture();
    const original = compileDocument(doc);
    const changedLines = original.code.split('\n');
    const line = original.nodeLocations.workspace.line - 1;
    expect(changedLines[line]).toContain('"gap":"$semantic.spacing"');
    changedLines[line] = changedLines[line].replace('"gap":"$semantic.spacing"', '"gap":"$primitive.space"');
    const source = '// Handwritten helper draft, never executed.\n' + changedLines.join('\n') + '\nconst unfinished = (';
    const imported = importCode(source, doc);
    expect(imported.diagnostics).toEqual([]);
    expect(imported.document?.nodes.workspace.layout.gap).toBe('$primitive.space');
    expect(imported.document?.revision).toBe(doc.revision);
    expect(Object.keys(imported.document!.nodes).sort()).toEqual(Object.keys(doc.nodes).sort());
    const restored = compileDocument(doc, source);
    expect(restored.diagnostics).toEqual([]);
    expect(restored.code.startsWith('// Handwritten helper draft, never executed.\n')).toBe(true);
    expect(restored.code.endsWith('\nconst unfinished = (')).toBe(true);
    expect(importCode(restored.code, doc).document).toEqual(doc);
  });

  it.each([
    ['missing alias', '$primitive.missing'],
    ['color alias', '$primitive.violet'],
    ['numeric string', '24'],
    ['CSS expression', 'calc(12px + 4px)'],
  ])('refuses a %s numeric edit before changing the last valid document', (_name, value) => {
    const doc = fixture();
    const before = serializeDocument(doc);
    const compiled = compileDocument(doc);
    const lines = compiled.code.split('\n');
    const location = compiled.nodeLocations.workspace;
    lines[location.line - 1] = lines[location.line - 1].replace('"gap":"$semantic.spacing"', `"gap":${JSON.stringify(value)}`);
    const source = lines.join('\n');
    const imported = importCode(source, doc);
    expect(imported.document).toBeNull();
    expect(imported.diagnostics[0]).toMatchObject({ severity: 'error', nodeId: 'workspace', line: location.line });
    expect(serializeDocument(doc)).toBe(before);
    expect(compileDocument(doc, source).code).toBe(source);
  });

  it('refuses a nonnumeric token edit used by numeric fields and retains the invalid draft', () => {
    const doc = fixture();
    const before = serializeDocument(doc);
    const compiled = compileDocument(doc);
    expect(compiled.code).toContain('"spacing": 24');
    const source = compiled.code.replace('"spacing": 24', '"spacing": "24px"');
    const imported = importCode(source, doc);
    expect(imported.document).toBeNull();
    expect(imported.diagnostics[0].severity).toBe('error');
    expect(imported.diagnostics[0].message).toContain('finite number');
    expect(serializeDocument(doc)).toBe(before);
    expect(compileDocument(doc, source).code).toBe(source);
  });
});
