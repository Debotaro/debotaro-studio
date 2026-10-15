import { validateDocument } from '../core/document';
import type { CompiledCode, JsonValue, StudioDocument } from '../core/types';
import { BEGIN_MARKER, END_MARKER, countLines, diagnosticFromError } from './boundary';

export const GENERATED_IMPORTS = `import type { StudioDocument } from './core/types';\nimport { StudioProvider, Frame, Text, Button, Field, Select, Tabs, Badge, Table, DetailPanel } from './runtime/StudioRuntime';\n\n`;

export interface PreservedRegions { before: string; after: string }

/** Deterministic JSON, also valid as a safe TypeScript expression. */
export function jsonLiteral(value: unknown, pretty = false): string {
  function sort(input: unknown): JsonValue {
    if (Array.isArray(input)) return input.map(sort);
    if (input !== null && typeof input === 'object') {
      const output: Record<string, JsonValue> = {};
      for (const key of Object.keys(input).sort()) output[key] = sort((input as Record<string, unknown>)[key]);
      return output;
    }
    return input as JsonValue;
  }
  return JSON.stringify(sort(value), null, pretty ? 2 : undefined);
}

/**
 * Generate from validated IR without parsing, importing or executing source.
 * Outside regions must come from explicit AST review or accepted source recovery.
 * Raw drafts still require compileDocument/importCode; this API never reviews them.
 */
export function generateDocument(input: StudioDocument, regions?: PreservedRegions): CompiledCode {
  try {
    const document = validateDocument(input);
    if (regions !== undefined && (typeof regions.before !== 'string' || typeof regions.after !== 'string')) throw new Error('Reviewed outside regions must contain before and after strings.');
    const before = regions?.before ?? GENERATED_IMPORTS;
    const after = regions?.after ?? '\n';
    const { nodes, ...meta } = document;
    const lines: string[] = [BEGIN_MARKER, `export const studioMeta: Omit<StudioDocument, "nodes"> = ${jsonLiteral(meta, true)};`, '', 'export function StudioApp() {', '  return (', '    <StudioProvider meta={studioMeta}>'];
    const nodeLocations: CompiledCode['nodeLocations'] = {};
    let nextLine = countLines(before) + lines.reduce((sum, line) => sum + countLines(line) + 1, 0) + 1;
    const visit = (id: string, depth: number) => {
      const node = nodes[id];
      const indent = '  '.repeat(depth);
      nodeLocations[id] = { line: nextLine, column: indent.length + 1 };
      const attributes = [
        `studioId={${jsonLiteral(id)}}`, `name={${jsonLiteral(node.name)}}`,
        `props={${jsonLiteral(node.props)}}`, `layout={${jsonLiteral(node.layout)}}`,
        `responsive={${jsonLiteral(node.responsive)}}`, `bindings={${jsonLiteral(node.bindings)}}`,
        `events={${jsonLiteral(node.events)}}`,
      ].join(' ');
      const opening = `${indent}<${node.type} ${attributes}${node.children.length ? '>' : ' />'}`;
      lines.push(opening);
      nextLine += countLines(opening) + 1;
      for (const child of node.children) visit(child, depth + 1);
      if (node.children.length) { lines.push(`${indent}</${node.type}>`); nextLine++; }
    };
    visit(document.rootId, 3);
    lines.push('    </StudioProvider>', '  );', '}', END_MARKER);
    return { code: before + lines.join('\n') + after, nodeLocations, diagnostics: [] };
  } catch (error) {
    return { code: '', diagnostics: [diagnosticFromError(error)], nodeLocations: {} };
  }
}
