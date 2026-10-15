import type { Diagnostic } from '../core/types';

export const BEGIN_MARKER = '// @studio:begin';
export const END_MARKER = '// @studio:end';
export const MAX_CODE_LENGTH = 2_000_000;

export interface ManagedRegion {
  before: string;
  managed: string;
  after: string;
  firstLine: number;
}

export class CodeDiagnosticError extends Error {
  diagnostic: Diagnostic;

  constructor(code: string, message: string, location?: { line: number; column: number }, nodeId?: string) {
    super(message);
    this.diagnostic = { code, severity: 'error', message, ...location, ...(nodeId ? { nodeId } : {}) };
  }
}

/** Boundary detection only: managed structure is always read through Babel's AST. */
export function splitManagedRegion(code: string): ManagedRegion {
  if (code.length > MAX_CODE_LENGTH) throw new CodeDiagnosticError('CODE_LIMIT', 'The code draft exceeds the 2 MB limit.');
  const markers: { kind: 'begin' | 'end'; start: number; end: number; markerEnd: number; line: number }[] = [];
  let offset = 0;
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === BEGIN_MARKER || trimmed === END_MARKER) {
      markers.push({ kind: trimmed === BEGIN_MARKER ? 'begin' : 'end', start: offset, end: offset + line.length, markerEnd: offset + line.length - (line.endsWith('\r') ? 1 : 0), line: i + 1 });
    }
    offset += line.length + 1;
  }
  if (markers.length !== 2 || markers[0].kind !== 'begin' || markers[1].kind !== 'end') {
    throw new CodeDiagnosticError('REGION_AMBIGUOUS', 'Keep exactly one ordered pair of standalone // @studio:begin and // @studio:end markers.');
  }
  const [begin, end] = markers;
  return {
    before: code.slice(0, begin.start),
    managed: code.slice(begin.end + 1, end.start),
    after: code.slice(end.markerEnd),
    firstLine: begin.line + 1,
  };
}

export function diagnosticFromError(error: unknown, lineOffset = 0): Diagnostic {
  if (error instanceof CodeDiagnosticError) return error.diagnostic;
  const validation = error as { diagnostics?: Diagnostic[] };
  if (validation.diagnostics?.[0]) return { ...validation.diagnostics[0] };
  const parseError = error as { message?: string; loc?: { line: number; column: number } };
  return {
    code: parseError.loc ? 'CODE_PARSE' : 'DOCUMENT_INVALID',
    severity: 'error',
    message: parseError.message ?? 'The source could not be imported.',
    ...(parseError.loc ? { line: parseError.loc.line + lineOffset, column: parseError.loc.column + 1 } : {}),
  };
}

export function countLines(value: string): number {
  return value.split('\n').length - 1;
}
