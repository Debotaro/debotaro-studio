import { createHash } from 'node:crypto';
import console from 'node:console';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coreFiles = {}, runtimeFiles = {};
for (const name of ['types.ts', 'tokens.ts']) coreFiles[name] = await readFile(resolve(root, 'src/core', name), 'utf8');
async function copyRuntime(relative = '') {
  for (const entry of await readdir(resolve(root, 'src/runtime', relative), { withFileTypes: true })) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await copyRuntime(next);
    else if (entry.isFile() && ['.ts', '.tsx', '.css', '.json', '.svg'].some(extension => entry.name.endsWith(extension))) runtimeFiles[next] = await readFile(resolve(root, 'src/runtime', next), 'utf8');
  }
}
await copyRuntime();
if (!runtimeFiles['StudioRuntime.tsx'] || !runtimeFiles['runtime.css']) throw new Error('Complete export runtime is required.');
const sources = {
  packageJson: await readFile(resolve(root, 'package.json'), 'utf8'),
  lockfile: await readFile(resolve(root, 'package-lock.json'), 'utf8'),
  coreFiles,
  runtimeFiles,
};
const directory = resolve(root, 'edge/generated');
await mkdir(directory, { recursive: true });
const bytes = JSON.stringify(sources);
await writeFile(resolve(directory, 'export-sources.json'), bytes, 'utf8');
await writeFile(resolve(directory, 'source-integrity.json'), JSON.stringify({
  algorithm: 'sha256', sourceBundle: createHash('sha256').update(bytes).digest('hex'),
  coreFiles: Object.keys(coreFiles).sort(), runtimeFiles: Object.keys(runtimeFiles).sort(),
  scope: 'Exact build-time public export sources; no environment variables, runtime databases or credentials.',
}, null, 2) + '\n', 'utf8');
console.log(`Prepared ${Object.keys(coreFiles).length + Object.keys(runtimeFiles).length} export source files for the Worker.`);
