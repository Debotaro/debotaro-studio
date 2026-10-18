/** Node-only source loading; the shared generator never reads a runtime filesystem. */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateProjectFromSources, type ExportSources } from './generate';
import type { StudioDocument } from '../core/types';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
export async function readExportSources(): Promise<ExportSources> {
  const coreFiles: Record<string, string> = {};
  const runtimeFiles: Record<string, string> = {};
  for (const name of ['types.ts', 'tokens.ts']) coreFiles[name] = await readFile(join(sourceRoot, 'src/core', name), 'utf8');
  async function copyRuntime(relative = ''): Promise<void> {
    const entries = await readdir(join(sourceRoot, 'src/runtime', relative), { withFileTypes: true });
    for (const entry of entries) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await copyRuntime(next);
      else if (entry.isFile() && ['.ts', '.tsx', '.css', '.json', '.svg'].some(extension => entry.name.endsWith(extension))) runtimeFiles[next] = await readFile(join(sourceRoot, 'src/runtime', next), 'utf8');
    }
  }
  await copyRuntime();
  return {packageJson: await readFile(join(sourceRoot, 'package.json'), 'utf8'), lockfile: await readFile(join(sourceRoot, 'package-lock.json'), 'utf8'), coreFiles, runtimeFiles};
}
export async function generateProject(input: StudioDocument, code?: string): Promise<Record<string, string>> {
  return generateProjectFromSources(input, await readExportSources(), code);
}
