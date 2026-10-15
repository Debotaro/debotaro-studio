/** Trusted starter fixture only; helper for manual clean-directory export verification. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { createStarterDocument } from '../../src/core/starter';
import { generateProject } from '../../src/export/project';

const target = resolve(process.argv[2] ?? 'artifacts/code-01-export');
const files = await generateProject(createStarterDocument('clean-export-check'));
await mkdir(target, { recursive: true });
for (const [name, text] of Object.entries(files)) {
  const path = resolve(target, name);
  if (!path.startsWith(target + sep)) throw new Error(`Unsafe export path ${name}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
}
console.log(`Materialized ${Object.keys(files).length} files at ${target}`);
