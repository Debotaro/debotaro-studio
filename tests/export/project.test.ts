import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { compileDocument, importCode } from '../../src/compiler';
import { createStarterDocument } from '../../src/core/starter';
import { serializeDocument } from '../../src/core/document';
import { generateProject } from '../../src/export/project';

describe('independent export source', () => {
  it('contains the actual shared runtime, tokens, complete setup files and exact dependencies', async () => {
    const document = createStarterDocument('export-test');
    const files = await generateProject(document);
    for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'src/main.tsx', 'src/App.tsx', 'src/core/types.ts', 'src/core/tokens.ts', 'src/runtime/StudioRuntime.tsx', 'src/runtime/state.ts', 'src/runtime/connector.ts', 'src/runtime/runtime.css', 'studio-document.json', 'tokens.json', 'README.md', 'EXPORT_MANIFEST.json']) expect(files[name], name).toBeTruthy();
    for (const name of ['StudioRuntime.tsx', 'state.ts', 'connector.ts', 'runtime.css']) expect(files[`src/runtime/${name}`]).toBe(await readFile(`src/runtime/${name}`, 'utf8'));
    const exportedPackage = JSON.parse(files['package.json']);
    const studioPackage = JSON.parse(await readFile('package.json', 'utf8'));
    expect(exportedPackage.dependencies.react).toBe(studioPackage.dependencies.react);
    expect(exportedPackage.devDependencies.vite).toBe(studioPackage.devDependencies.vite);
    expect(Object.values(exportedPackage.dependencies).every(version => /^\d+\.\d+\.\d+/.test(String(version)))).toBe(true);
    const lock = JSON.parse(files['package-lock.json']);
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages[''].dependencies).toEqual(exportedPackage.dependencies);
    expect(lock.packages['node_modules/react'].version).toBe(exportedPackage.dependencies.react);
    for (const dependency of ['express', 'yjs', 'openai', 'vitest', '@codemirror/view']) expect(lock.packages[`node_modules/${dependency}`]).toBeUndefined();
    expect(JSON.parse(files['studio-document.json'])).toEqual(document);
    const managedSource = files['src/App.tsx'].replace('\nexport default StudioApp;\n', '');
    expect(serializeDocument(importCode(managedSource, document).document!)).toBe(serializeDocument(document));
  });

  it('never places outside code into an executable file and preserves it in recoverable text', async () => {
    const document = createStarterDocument('export-custom-test');
    const custom = 'globalThis.SENTINEL_UNTRUSTED = true;\n';
    const source = custom + compileDocument(document).code;
    const files = await generateProject(document, source);
    expect(files['recovery/original-studio-code.tsx.txt']).toBe(source);
    expect(files['recovery/custom-code.txt'].startsWith(custom)).toBe(true);
    for (const [name, text] of Object.entries(files)) if (!name.startsWith('recovery/')) expect(text, name).not.toContain('SENTINEL_UNTRUSTED');
    expect(JSON.parse(files['recovery/custom-code-parts.json']).before.startsWith(custom)).toBe(true);
  });

  it('exports the last valid document while preserving an invalid unfinished draft', async () => {
    const document = createStarterDocument('export-draft-test');
    const draft = 'unfinished draft with no markers';
    const files = await generateProject(document, draft);
    expect(files['recovery/custom-code.txt']).toBe(draft);
    expect(files['src/App.tsx']).toContain('export function StudioApp()');
  });

  it('refuses an invalid document instead of exporting broken executable files', async () => {
    const document = createStarterDocument('invalid-export-test');
    document.rootId = 'missing-node';
    await expect(generateProject(document)).rejects.toThrow();
  });
});
