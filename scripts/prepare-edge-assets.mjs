import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'dist/screenshots');
await mkdir(target, { recursive: true });
// These reviewed public captures are served by Express separately in native mode.
for (const name of ['editor-desktop.png', 'editor-phone.png', 'case-study-desktop.png', 'case-study-phone.png']) {
  await copyFile(resolve(root, 'docs/screenshots', name), resolve(target, name));
}
