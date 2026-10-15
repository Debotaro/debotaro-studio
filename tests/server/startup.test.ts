import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production entry configuration boundaries', () => {
  it.each([
    [{ STUDIO_HOST: '0.0.0.0', STUDIO_ORIGIN: '' }, 'Set STUDIO_ORIGIN'],
    [{ STUDIO_ORIGIN: 'https://studio.example/app' }, 'exact HTTP(S) origin'],
    [{ STUDIO_MAX_PROJECTS: 'Infinity' }, 'STUDIO_MAX_PROJECTS'],
  ])('refuses invalid configuration before opening persistence: %j', (overrides, expected) => {
    const parent = resolve('artifacts/host-ready-08/startup-tests');
    mkdirSync(parent, { recursive: true });
    const directory = join(mkdtempSync(join(parent, 'case-')), 'data');
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
      cwd: resolve('.'), encoding: 'utf8', timeout: 8000,
      env: { ...process.env, PORT: '0', STUDIO_HOST: '127.0.0.1', STUDIO_ORIGIN: 'http://localhost:4173', STUDIO_MAX_PROJECTS: '1000', ...overrides, STUDIO_DATA_DIR: directory },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(expected);
    expect(existsSync(directory)).toBe(false);
  });
});
