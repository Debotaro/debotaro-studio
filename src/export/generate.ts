/** Pure export generator shared by Node and the persistent Worker authority. */
import { compileDocument } from '../compiler';
import { splitManagedRegion } from '../compiler/boundary';
import { validateDocument, serializeDocument } from '../core/document';
import type { StudioDocument } from '../core/types';

export interface ExportSources {
  packageJson: string;
  lockfile: string;
  coreFiles: Record<string, string>;
  runtimeFiles: Record<string, string>;
}

export function generateProjectFromSources(input: StudioDocument, sources: ExportSources, code?: string): Record<string, string> {
  const document = validateDocument(input);
  // Compile the validated IR afresh. No imported code, including surrounding text,
  // is placed into executable project files.
  const compiled = compileDocument(document);
  if (compiled.diagnostics.some(item => item.severity === 'error')) throw new Error(compiled.diagnostics[0].message);
  const studioPackage = JSON.parse(sources.packageJson) as {
    dependencies: Record<string, string>; devDependencies: Record<string, string>;
  };
  const packageJson = {
    name: 'debotaro-support-workspace', version: '1.0.0', private: true, type: 'module',
    scripts: { dev: 'vite --host 127.0.0.1', typecheck: 'tsc --noEmit', build: 'npm run typecheck && vite build', preview: 'vite preview --host 127.0.0.1' },
    dependencies: { react: studioPackage.dependencies.react, 'react-dom': studioPackage.dependencies['react-dom'] },
    devDependencies: Object.fromEntries(['@types/react', '@types/react-dom', '@vitejs/plugin-react', 'typescript', 'vite'].map(name => [name, studioPackage.devDependencies[name]])),
  };
  const files: Record<string, string> = {
    'package.json': JSON.stringify(packageJson, null, 2) + '\n',
    'package-lock.json': exportLockfile(sources.lockfile, packageJson),
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, esModuleInterop: true, resolveJsonModule: true, noEmit: true }, include: ['src', 'vite.config.ts'] }, null, 2) + '\n',
    'vite.config.ts': "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()], build: { target: 'es2022' } });\n",
    'index.html': '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Debotaro Support Workspace</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
    'src/main.tsx': "import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './runtime/runtime.css';\nimport './styles.css';\ncreateRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);\n",
    'src/App.tsx': compiled.code + '\nexport default StudioApp;\n',
    'src/styles.css': 'html,body,#root{margin:0;min-height:100%;}body{font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#f4f4f7;}*{box-sizing:border-box;}\n',
    'studio-document.json': serializeDocument(document) + '\n',
    'tokens.json': JSON.stringify(document.tokens, null, 2) + '\n',
    '.gitignore': 'node_modules/\ndist/\n.env\n',
    'README.md': exportReadme(document),
    'EXPORT_MANIFEST.json': JSON.stringify({ formatVersion: 1, projectId: document.id, revision: document.revision, schemaVersion: document.schemaVersion, runtime: 'Debotaro Studio catalog v1', fictionalData: true, customCodeExecution: false }, null, 2) + '\n',
  };
  for (const [name, text] of Object.entries(sources.coreFiles)) files[`src/core/${name}`] = text;
  for (const [name, text] of Object.entries(sources.runtimeFiles)) files[`src/runtime/${name}`] = text;
  if (!files['src/runtime/StudioRuntime.tsx'] || !files['src/runtime/runtime.css']) throw new Error('The shared runtime sources are missing; export is unavailable.');
  if (code !== undefined) {
    files['recovery/original-studio-code.tsx.txt'] = code;
    try {
      const region = splitManagedRegion(code);
      files['recovery/custom-code.txt'] = region.before + region.after;
      files['recovery/custom-code-parts.json'] = JSON.stringify({ before: region.before, after: region.after }, null, 2) + '\n';
    } catch {
      // Broken boundary drafts remain fully recoverable as text, never executable.
      files['recovery/custom-code.txt'] = code;
    }
  }
  return files;
}

interface LockPackage {
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  dev?: boolean;
  [key: string]: unknown;
}

/** Preserve installed transitive versions/integrities while pruning Studio-only dependencies. */
function exportLockfile(sourceLockfile: string, packageJson: { name: string; version: string; dependencies: Record<string, string>; devDependencies: Record<string, string> }): string {
  const lock = JSON.parse(sourceLockfile) as { lockfileVersion: number; packages: Record<string, LockPackage> };
  if (lock.lockfileVersion !== 3) throw new Error('Export requires the installed npm v3 lockfile.');
  const included = new Map<string, boolean>();
  const resolve = (owner: string, name: string): string | null => {
    let current = owner;
    while (true) {
      const candidate = `${current ? `${current}/` : ''}node_modules/${name}`;
      if (Object.hasOwn(lock.packages, candidate)) return candidate;
      if (!current) return null;
      const nested = current.lastIndexOf('/node_modules/');
      current = nested === -1 ? '' : current.slice(0, nested);
    }
  };
  const include = (owner: string, name: string, dev: boolean, required: boolean): void => {
    const key = resolve(owner, name);
    if (!key) { if (required) throw new Error(`The installed lockfile is missing ${name}.`); return; }
    const prior = included.get(key);
    if (prior !== undefined && (!prior || dev)) return;
    included.set(key, dev);
    const pkg = lock.packages[key];
    for (const dependency of Object.keys(pkg.dependencies ?? {})) include(key, dependency, dev, !Object.hasOwn(pkg.optionalDependencies ?? {}, dependency));
    for (const dependency of Object.keys(pkg.optionalDependencies ?? {})) include(key, dependency, dev, false);
    for (const dependency of Object.keys(pkg.peerDependencies ?? {})) include(key, dependency, dev, false);
  };
  for (const name of Object.keys(packageJson.dependencies)) include('', name, false, true);
  for (const name of Object.keys(packageJson.devDependencies)) include('', name, true, true);
  const packages: Record<string, LockPackage> = { '': { name: packageJson.name, version: packageJson.version, dependencies: packageJson.dependencies, devDependencies: packageJson.devDependencies } };
  for (const [key, dev] of [...included].sort(([a], [b]) => a.localeCompare(b))) {
    const pkg = { ...lock.packages[key] };
    if (dev) pkg.dev = true;
    else delete pkg.dev;
    packages[key] = pkg;
  }
  return JSON.stringify({ name: packageJson.name, version: packageJson.version, lockfileVersion: 3, requires: true, packages }, null, 2) + '\n';
}

function exportReadme(document: StudioDocument): string {
  return `# ${document.name.replaceAll('\n', ' ')}\n\nIndependent React/TypeScript application exported from Debotaro Studio, revision ${document.revision}. All tickets and customers are fictional. The application uses its own local runtime state and does not connect to Studio or a live support system.\n\n## Run\n\nUse Node.js 24.13 or newer and npm.\n\n\`\`\`sh\nnpm ci\nnpm run typecheck\nnpm run build\nnpm run dev\n\`\`\`\n\nOpen the Vite URL printed by the terminal. For the built application, run \`npm run preview\`. Direct and transitive dependency versions/integrities are pinned in package.json and package-lock.json.\n\n## Verify behavior\n\nSearch for a fictional subject or customer, filter status and assignee, select a ticket, change its assignment/status, and clear filters to recover the full list. Resize to desktop, tablet and phone widths. Loading/retry/empty/error behavior is supplied by the same catalog runtime used by Studio. Refresh resets local ticket interactions to the exported initial document.\n\n## Source and boundaries\n\n- src/App.tsx contains runnable catalog TSX generated from the validated document.\n- src/runtime is the shared component implementation and fictional connector.\n- src/core/types.ts and tokens.ts contain the runtime contract and token resolver.\n- studio-document.json and tokens.json preserve the intermediate representation and theme references.\n- recovery files, when present, preserve the original Studio code and outside managed source as plain text. They are intentionally excluded from executable files. Review and integrate handwritten code yourself in a trusted development workflow.\n\nThis export requires no account, API key, Studio server or paid service. Live customer connections can implement the TicketConnector contract in src/runtime/connector.ts.\n\n## Attribution\n\nDebotaro Studio is an independent product by Debotaro, inspired by professional creation-tool workflows. React, TypeScript and Vite are third-party dependencies with their own licenses. No third-party image/font assets are required.\n`;
}
