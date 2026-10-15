import { validateDocument } from '../core/document';
import type { CompiledCode, StudioDocument } from '../core/types';
import { diagnosticFromError, splitManagedRegion } from './boundary';
import { readManagedCode } from './importer';
import { generateDocument } from './generate';
export { GENERATED_IMPORTS, jsonLiteral } from './generate';

/** Raw source keeps strict AST inspection before its managed region can change. */
export function compileDocument(input: StudioDocument, originalCode?: string): CompiledCode {
  if (originalCode === undefined) return generateDocument(input);
  try {
    const document = validateDocument(input);
    const inspected = readManagedCode(originalCode, document, false);
    if (!inspected.document) return { code: originalCode, diagnostics: inspected.diagnostics, nodeLocations: {} };
    const region = splitManagedRegion(originalCode);
    const generated = generateDocument(document, region);
    return generated.diagnostics.some(diagnostic => diagnostic.severity === 'error') ? { ...generated, code: originalCode } : generated;
  } catch (error) {
    return { code: originalCode ?? '', diagnostics: [diagnosticFromError(error)], nodeLocations: {} };
  }
}
