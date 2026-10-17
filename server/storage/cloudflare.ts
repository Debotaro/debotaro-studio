import { LimitError, resolveDemoLimits, type DemoLimits } from '../limits';
import { StoreCore, type SqlBinding, type SqlDatabase, type SqlRow, type SqlStatement } from './core';

/** Structural runtime contract: avoids importing Worker globals into native test builds. */
export interface DurableSqlStorage {
  readonly sql: {
    exec(query: string, ...bindings: (string | number | null | ArrayBuffer | ArrayBufferView)[]): { toArray(): Record<string, unknown>[] };
    readonly databaseSize: number;
  };
  transactionSync<T>(callback: () => T): T;
}

// Cloudflare limits any SQLite row/string/BLOB to 2 MB. A history row contains
// three serialized values plus metadata; keep a conservative margin for both.
export const CLOUDFLARE_MAX_VALUE_BYTES = 600_000;
export const CLOUDFLARE_MAX_WRITE_BYTES = 1_800_000;
const encoder = new TextEncoder();

/** Synchronous adapter; every write and capacity check commits or rolls back together. */
export class CloudflareSqlDatabase implements SqlDatabase {
  private transactionDepth = 0;
  constructor(private readonly storage: DurableSqlStorage, private readonly capacityBytes: number) {}

  transaction<T>(callback: () => T): T {
    if (this.transactionDepth > 0) return callback();
    return this.storage.transactionSync(() => {
      this.transactionDepth++;
      try {
        const result = callback();
        if (this.storage.sql.databaseSize > this.capacityBytes) {
          throw new LimitError('This deployment has reached its database storage limit. Saved work is retained; export existing projects or ask the host to increase capacity.', 'STORAGE_CAPACITY', 507);
        }
        return result;
      } finally { this.transactionDepth--; }
    });
  }

  prepare(query: string): SqlStatement {
    const read = (bindings: SqlBinding[]) => this.storage.sql.exec(query, ...bindings.map(toDurableBinding)).toArray().map(normalizeRow);
    return {
      get: (...bindings) => read(bindings)[0],
      all: (...bindings) => read(bindings),
      run: (...bindings) => this.transaction(() => {
        let totalBytes = 0;
        for (const binding of bindings) {
          const bytes = typeof binding === 'string' ? encoder.encode(binding).byteLength : binding instanceof Uint8Array ? binding.byteLength : 8;
          if (bytes > CLOUDFLARE_MAX_VALUE_BYTES) throw rowCapacityError();
          totalBytes += bytes;
        }
        if (totalBytes > CLOUDFLARE_MAX_WRITE_BYTES) throw rowCapacityError();
        this.storage.sql.exec(query, ...bindings.map(toDurableBinding)).toArray();
        // rowsWritten also includes index writes. SQLite changes() preserves the
        // native Store contract used to require exactly two undo markers.
        const changes = this.storage.sql.exec('SELECT changes() AS changes').toArray()[0]?.changes;
        if (typeof changes !== 'number' || !Number.isSafeInteger(changes) || changes < 0) throw new Error('Storage returned an invalid change count. No changes were applied.');
        return { changes };
      }),
    };
  }

  exec(query: string): void {
    this.transaction(() => { this.storage.sql.exec(query).toArray(); });
  }
}

export function createCloudflareStore(storage: DurableSqlStorage, limits: Partial<DemoLimits> = {}): StoreCore<CloudflareSqlDatabase> {
  const policy = resolveDemoLimits(limits);
  const db = new CloudflareSqlDatabase(storage, policy.databaseBytes);
  return new StoreCore(db, policy, callback => db.transaction(callback), () => {
    // PRAGMA user_version is not supported by Durable Objects. Native databases
    // keep their existing v2 header; only this backend uses a metadata table.
    db.exec('CREATE TABLE IF NOT EXISTS studio_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);');
    const saved = db.prepare('SELECT version FROM studio_schema WHERE singleton=1').get();
    if (saved && (typeof saved.version !== 'number' || !Number.isSafeInteger(saved.version) || saved.version < 0)) throw new Error('Saved database schema metadata is corrupt. Original data retained; restore a verified backup.');
    if (saved && Number(saved.version) > 2) throw new Error('Saved database uses a newer incompatible schema. Original data retained; use a compatible Studio version.');
    db.prepare('INSERT INTO studio_schema(singleton,version) VALUES(1,2) ON CONFLICT(singleton) DO UPDATE SET version=excluded.version').run();
  });
}

function rowCapacityError(): LimitError {
  return new LimitError(`This deployment accepts at most ${CLOUDFLARE_MAX_VALUE_BYTES.toLocaleString('en-US')} UTF-8 bytes per saved value and ${CLOUDFLARE_MAX_WRITE_BYTES.toLocaleString('en-US')} bytes per saved write. No changes were applied; reduce the project/change size or use the native deployment.`, 'STORAGE_ROW_CAPACITY', 413);
}

function toDurableBinding(value: SqlBinding): string | number | null | Uint8Array {
  if (typeof value !== 'bigint') return value;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('SQLite binding exceeds the safe integer range. No changes were applied.');
  return number;
}

function normalizeRow(row: Record<string, unknown>): SqlRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value instanceof ArrayBuffer) return [key, new Uint8Array(value)];
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || value instanceof Uint8Array) return [key, value];
    throw new Error('Storage returned an unsupported value. Original data retained.');
  }));
}
