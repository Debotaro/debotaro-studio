import sources from './generated/export-sources.json';
import { generateProjectFromSources } from '../src/export/generate';
import type { StudioDocument } from '../src/core/types';

/** Bundled reviewed source bytes; no runtime filesystem or request-selected paths. */
export async function generateProject(document: StudioDocument, code?: string): Promise<Record<string, string>> {
  return generateProjectFromSources(document, sources, code);
}
