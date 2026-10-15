import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { exportFilePath, verifyArchive } from '../../scripts/verify-export';

describe('export verification integrity boundaries', () => {
  it.each(['../escape.ts', 'src/../../escape.ts', '/root.ts', 'C:/escape.ts', 'C:\\escape.ts', 'src\\file.ts', 'src//file.ts', 'src/./file.ts', 'src/file.ts\u0000', 'src/file.ts:stream'])('refuses unsafe generated path %j before writing files', name => {
    expect(() => exportFilePath('artifacts/export-verification/fresh-project', name)).toThrow(/Unsafe export path/);
  });

  it('requires the exact archive filenames and UTF-8 contents, including recovery files', () => {
    const files = { 'src/App.tsx': 'export const title = "Care — made visible";\n', 'recovery/custom-code.txt': 'throw new Error("never execute");\r\n' };
    const zip = (entries: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(entries).map(([name, text]) => [name, strToU8(text)])));
    expect(() => verifyArchive(zip(files), files)).not.toThrow();
    expect(() => verifyArchive(zip({ ...files, '.env': 'unexpected' }), files)).toThrow(/filenames differ/);
    expect(() => verifyArchive(zip({ 'src/App.tsx': files['src/App.tsx'] }), files)).toThrow(/filenames differ/);
    expect(() => verifyArchive(zip({ ...files, 'src/App.tsx': 'altered' }), files)).toThrow(/bytes differ/);
  });
});
