import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LimitError, resolveDemoLimits, type DemoLimits } from './limits';
import { StoreCore } from './storage/core';
export { secretHash } from './storage/core';

/** Native SQLite entry point. Workers import storage/core or storage/cloudflare instead. */
export class Store extends StoreCore<DatabaseSync> {
  constructor(directory: string, limits: Partial<DemoLimits> = {}) {
    const policy = resolveDemoLimits(limits);
    mkdirSync(directory, { recursive: true });
    const db = new DatabaseSync(join(directory, 'studio.sqlite'));
    try {
      let storedVersion: number;
      try { storedVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0); }
      catch { throw new Error('Saved database is corrupt. Original data retained; restore a verified backup.'); }
      if (storedVersion > 2) throw new Error('Saved database uses a newer incompatible schema. Original data retained; use a compatible Studio version.');
      const pageSize = Number(db.prepare('PRAGMA page_size').get()?.page_size);
      const maxPages = Math.floor(policy.databaseBytes / pageSize);
      const actualMax = Number(db.prepare(`PRAGMA max_page_count=${maxPages}`).get()?.max_page_count);
      if (actualMax !== maxPages) throw new LimitError('Saved database exceeds the configured storage limit. Original data retained; raise STUDIO_MAX_DATABASE_MB or restore a verified backup.', 'STORAGE_CAPACITY', 507);
      db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
      super(db, policy, callback => {
        db.exec('BEGIN IMMEDIATE');
        try { const result = callback(); db.exec('COMMIT'); return result; }
        catch (error) { try { db.exec('ROLLBACK'); } catch { /* SQLITE_FULL can already have rolled the transaction back. */ } throw error; }
      }, () => { db.exec('PRAGMA user_version=2;'); });
    } catch (error) { db.close(); throw error; }
  }
}
