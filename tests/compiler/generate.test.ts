import { describe, expect, it } from 'vitest';
import { compileDocument, GENERATED_IMPORTS as wrapperImports, jsonLiteral as wrapperLiteral } from '../../src/compiler/compiler';
import { generateDocument, GENERATED_IMPORTS, jsonLiteral, type PreservedRegions } from '../../src/compiler/generate';
import { importCode } from '../../src/compiler/importer';
import { applyOperations, serializeDocument } from '../../src/core/document';
import { createStarterDocument } from '../../src/core/starter';

describe('validated IR generation independent of AST loading', () => {
  it('retains identities, metadata, responsive layouts, bindings and behavior through semantic import', () => {
    const document = createStarterDocument('pure-generator');
    const before = serializeDocument(document);
    const generated = generateDocument(document);
    expect(generated.diagnostics).toEqual([]);
    const imported = importCode(generated.code, document);
    expect(imported.diagnostics).toEqual([]);
    expect(serializeDocument(imported.document!)).toBe(before);
    expect(serializeDocument(document)).toBe(before);
    expect(Object.keys(generated.nodeLocations).sort()).toEqual(Object.keys(document.nodes).sort());
    for (const [id, location] of Object.entries(generated.nodeLocations)) {
      expect(generated.code.split('\n')[location.line - 1].slice(location.column - 1)).toContain(`<${document.nodes[id].type} studioId={${JSON.stringify(id)}}`);
    }
  });

  it('remains deterministic with reordered document maps', () => {
    const document = createStarterDocument('pure-deterministic');
    const reordered = structuredClone(document);
    reordered.nodes = Object.fromEntries(Object.entries(reordered.nodes).reverse());
    reordered.tokens.primitive = Object.fromEntries(Object.entries(reordered.tokens.primitive).reverse());
    reordered.tokens.semantic = Object.fromEntries(Object.entries(reordered.tokens.semantic).reverse());
    expect(generateDocument(reordered)).toEqual(generateDocument(document));
  });

  it('preserves previously reviewed outside bytes and accurate locations across visual edits without execution', () => {
    const document = createStarterDocument('pure-preservation');
    const before = GENERATED_IMPORTS + '/* reviewed outside source */\r\nthrow new Error("Outside source must not execute");\r\n';
    const after = '\r\n// Recoverable unfinished helper\r\nconst helper = (';
    const reviewed = importCode(generateDocument(document, { before, after }).code, document);
    expect(reviewed.document).not.toBeNull();
    const node = Object.values(document.nodes).find(node => node.type === 'Text')!;
    const changed = applyOperations(document, { id: 'pure-visual-edit', projectId: document.id, baseRevision: document.revision, label: 'Change reviewed text visually', operations: [{ type: 'update', nodeId: node.id, patch: { props: { ...node.props, text: 'A visual edit retains its identity.' } } }] });
    const regions = { before: reviewed.preservedBefore, after: reviewed.preservedAfter };
    const regenerated = generateDocument(changed, regions);
    expect(regenerated.diagnostics).toEqual([]);
    expect(regenerated.code.startsWith(before)).toBe(true);
    expect(regenerated.code.endsWith(after)).toBe(true);
    const result = importCode(regenerated.code, changed);
    expect(serializeDocument(result.document!)).toBe(serializeDocument(changed));
    expect(result.preservedBefore).toBe(before);
    expect(result.preservedAfter).toBe(after);
    const location = regenerated.nodeLocations[node.id];
    expect(regenerated.code.split('\n')[location.line - 1].slice(location.column - 1)).toContain(`<Text studioId={${JSON.stringify(node.id)}}`);
    expect(compileDocument(changed, generateDocument(document, regions).code)).toEqual(regenerated);
  });

  it('rejects invalid IR without returning partial executable source or mutating input', () => {
    const document = createStarterDocument('pure-invalid');
    document.nodes[document.rootId].children.push('missing-node');
    const original = JSON.stringify(document);
    const generated = generateDocument(document);
    expect(generated.code).toBe('');
    expect(generated.nodeLocations).toEqual({});
    expect(generated.diagnostics[0].severity).toBe('error');
    expect(generated.diagnostics[0].message).toMatch(/missing-node|does not exist/i);
    expect(JSON.stringify(document)).toBe(original);
  });

  it('requires reviewed outside regions to be literal strings without coercing objects', () => {
    const document = createStarterDocument('pure-region-types');
    let coercions = 0;
    const regions = { before: { toString() { coercions++; return 'untrusted'; } }, after: '\n' } as unknown as PreservedRegions;
    const generated = generateDocument(document, regions);
    expect(generated.code).toBe('');
    expect(generated.diagnostics[0].message).toContain('before and after strings');
    expect(coercions).toBe(0);
  });

  it('keeps strict AST refusal and source-location diagnostics for raw compiler drafts', () => {
    const document = createStarterDocument('pure-ast-wrapper');
    const source = generateDocument(document).code.replace('meta={studioMeta}', 'meta={fetch("/protected")}');
    const result = compileDocument(document, source);
    expect(result.code).toBe(source);
    expect(result.nodeLocations).toEqual({});
    expect(result.diagnostics[0].code).toBe('CODE_UNSUPPORTED');
    expect(result.diagnostics[0].line).toBe(source.split('\n').findIndex(line => line.includes('fetch("/protected")')) + 1);
    expect(importCode(source, document).document).toBeNull();
  });

  it('preserves the compiler entry point and helper exports for existing callers', () => {
    const document = createStarterDocument('pure-compatibility');
    expect(compileDocument(document)).toEqual(generateDocument(document));
    expect(wrapperImports).toBe(GENERATED_IMPORTS);
    expect(wrapperLiteral).toBe(jsonLiteral);
    expect(jsonLiteral({ z: 2, a: { two: 2, one: 1 } })).toBe('{"a":{"one":1,"two":2},"z":2}');
  });
});
