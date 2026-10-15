import { describe, expect, it } from 'vitest';
import { compileDocument, importCode } from '../../src/compiler';
import { createStarterDocument } from '../../src/core/starter';
import { applyOperations, serializeDocument } from '../../src/core/document';
import type { StudioDocument } from '../../src/core/types';

function starter(): StudioDocument { return createStarterDocument('compiler-test'); }

describe('supported catalog TSX', () => {
  it('round trips starter identities, bindings, tokens, responsive layouts and interactions semantically', () => {
    const doc = starter();
    const compiled = compileDocument(doc);
    expect(compiled.diagnostics).toEqual([]);
    const imported = importCode(compiled.code, doc);
    expect(imported.diagnostics).toEqual([]);
    expect(imported.document).not.toBeNull();
    expect(serializeDocument(imported.document!)).toBe(serializeDocument(doc));
    expect(Object.keys(compiled.nodeLocations).sort()).toEqual(Object.keys(doc.nodes).sort());
  });

  it('maps every compiled node to the actual opening JSX line', () => {
    const doc = starter();
    const compiled = compileDocument(doc);
    const lines = compiled.code.split('\n');
    for (const [id, location] of Object.entries(compiled.nodeLocations)) {
      expect(lines[location.line - 1].slice(location.column - 1)).toContain(`<${doc.nodes[id].type} studioId={${JSON.stringify(id)}}`);
    }
  });

  it('accepts a supported literal edit without mutating the base or advancing its revision', () => {
    const doc = starter();
    const original = serializeDocument(doc);
    const edited = compileDocument(doc).code.replace(`"name": ${JSON.stringify(doc.name)}`, '"name": "Edited support workspace"');
    const imported = importCode(edited, doc);
    expect(imported.document?.name).toBe('Edited support workspace');
    expect(imported.document?.revision).toBe(doc.revision);
    expect(serializeDocument(doc)).toBe(original);
  });

  it('is deterministic regardless of map insertion order', () => {
    const doc = starter();
    const reordered = structuredClone(doc);
    reordered.nodes = Object.fromEntries(Object.entries(doc.nodes).reverse());
    reordered.tokens.primitive = Object.fromEntries(Object.entries(doc.tokens.primitive).reverse());
    expect(compileDocument(reordered).code).toBe(compileDocument(doc).code);
  });

  it('preserves handwritten outside text byte for byte even when that text is unfinished or untrusted', () => {
    const doc = starter();
    const before = '/* custom text */\r\nconst unfinished = (\r\n';
    const after = '\r\n// Draft preserved, never executed\r\nfetch("https://example.invalid");';
    const managed = compileDocument(doc).code.split('// @studio:begin')[1].split('// @studio:end')[0];
    const source = before + '// @studio:begin\n' + managed + '// @studio:end' + after;
    const imported = importCode(source, doc);
    expect(imported.document).not.toBeNull();
    expect(imported.preservedBefore).toBe(before);
    expect(imported.preservedAfter).toBe(after);
    const updated = { ...doc, revision: doc.revision + 1 };
    const regenerated = compileDocument(updated, source);
    expect(regenerated.diagnostics).toEqual([]);
    expect(regenerated.code.startsWith(before)).toBe(true);
    expect(regenerated.code.endsWith(after)).toBe(true);
    expect(importCode(regenerated.code, updated).document?.revision).toBe(updated.revision);
  });

  it('refuses stale and cross-project code while leaving the last valid document unchanged', () => {
    const doc = starter();
    const source = compileDocument(doc).code;
    expect(importCode(source, { ...doc, revision: doc.revision + 1 }).diagnostics[0].code).toBe('CODE_STALE');
    expect(importCode(source, { ...doc, id: 'different-project' }).diagnostics[0].code).toBe('CODE_PROJECT');
    expect(doc.revision).toBe(0);
  });

  it('returns the invalid draft and parse location without corrupting the document', () => {
    const doc = starter();
    const original = serializeDocument(doc);
    const source = compileDocument(doc).code.replace('export function StudioApp()', 'export function StudioApp(');
    const result = importCode(source, doc);
    expect(result.document).toBeNull();
    expect(result.diagnostics[0].code).toBe('CODE_PARSE');
    expect(result.diagnostics[0].line).toBeGreaterThan(3);
    expect(serializeDocument(doc)).toBe(original);
    expect(compileDocument(doc, source).code).toBe(source);
  });

  it.each([
    ['arbitrary calls', (source: string) => source.replace('meta={studioMeta}', 'meta={fetch("/")}')],
    ['event functions', (source: string) => source.replace('events={', 'events={() => alert(1)} custom={')],
    ['spread attributes', (source: string) => source.replace('<Frame studioId=', '<Frame {...extra} studioId=')],
    ['custom components', (source: string) => source.replace('<Frame ', '<CustomFrame ').replace('</Frame>', '</CustomFrame>')],
    ['interpolated children', (source: string) => source.replace('    </StudioProvider>', '      {document.cookie}\n    </StudioProvider>')],
    ['object spreads', (source: string) => source.replace('export const studioMeta: Omit<StudioDocument, "nodes"> = {', 'export const studioMeta: Omit<StudioDocument, "nodes"> = { ...other,')],
    ['extra declarations', (source: string) => source.replace('export function StudioApp()', 'const extra = 3;\nexport function StudioApp()')],
    ['custom comments', (source: string) => source.replace('export function StudioApp()', '// Keep my custom notes\nexport function StudioApp()')],
    ['type annotation execution disguise', (source: string) => source.replace('Omit<StudioDocument, "nodes">', 'CustomType')],
  ])('refuses %s without erasing the source', (_name, transform) => {
    const doc = starter();
    const source = transform(compileDocument(doc).code);
    expect(importCode(source, doc).document).toBeNull();
    expect(compileDocument(doc, source).code).toBe(source);
    expect(compileDocument(doc, source).diagnostics[0].severity).toBe('error');
  });

  it('reports unsupported code at the full source location', () => {
    const doc = starter();
    const source = compileDocument(doc).code.replace('meta={studioMeta}', 'meta={window.document}');
    const line = source.split('\n').findIndex(value => value.includes('meta={window.document}')) + 1;
    const result = importCode(source, doc);
    expect(result.diagnostics[0].line).toBe(line);
    expect(result.diagnostics[0].column).toBeGreaterThan(0);
  });

  it('maps schema diagnostics back to the affected visual node and JSX line', () => {
    const doc = starter();
    const compiled = compileDocument(doc);
    const source = compiled.code.replace('"disabled":false', '"disabled":"yes"');
    const result = importCode(source, doc);
    expect(result.document).toBeNull();
    expect(result.diagnostics[0].nodeId).toBe('refresh-tickets');
    expect(result.diagnostics[0].line).toBe(compiled.nodeLocations['refresh-tickets'].line);
  });

  it('rejects missing and duplicate identities, non-JSON literals and ambiguous regions', () => {
    const doc = starter();
    const source = compileDocument(doc).code;
    const ids = Object.keys(doc.nodes);
    expect(importCode(source.replace(`studioId={${JSON.stringify(ids[1])}}`, `studioId={${JSON.stringify(ids[0])}}`), doc).diagnostics[0].code).toBe('CODE_DUPLICATE_ID');
    expect(importCode(source.replace(`studioId={${JSON.stringify(doc.rootId)}}`, 'studioId={null}'), doc).document).toBeNull();
    expect(importCode(source.replace('"revision": 0', '"revision": Infinity'), doc).document).toBeNull();
    for (const ambiguous of [source + '\n// @studio:end', source.replace('// @studio:begin', '// Missing marker'), '// @studio:end\n' + source]) {
      expect(importCode(ambiguous, doc).diagnostics[0].code).toBe('REGION_AMBIGUOUS');
      expect(compileDocument(doc, ambiguous).code).toBe(ambiguous);
    }
  });

  it('retains supported inserted/moved nodes, token changes, and component events after regeneration', () => {
    const doc = starter();
    const child = structuredClone(doc.nodes[doc.rootId]);
    child.id = 'new-panel'; child.name = 'New panel'; child.children = [];
    const changed = applyOperations(doc, { id: 'test-operation', projectId: doc.id, baseRevision: doc.revision, label: 'Add panel and token', operations: [
      { type: 'insert', parentId: doc.rootId, index: 0, node: child },
      { type: 'token', category: 'primitive', name: 'violet', value: '#6e48d9' },
    ] });
    const output = compileDocument(changed, compileDocument(doc).code);
    expect(output.diagnostics).toEqual([]);
    expect(serializeDocument(importCode(output.code, changed).document!)).toBe(serializeDocument(changed));
  });
});
