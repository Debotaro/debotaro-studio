import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyOperations, serializeDocument } from '../../src/core/document';
import { createStarterDocument } from '../../src/core/starter';
import type { OperationEnvelope } from '../../src/core/types';
import { createCloudflareStore, CloudflareSqlDatabase, CLOUDFLARE_MAX_VALUE_BYTES, type DurableSqlStorage } from '../../server/storage/cloudflare';

/** Native SQLite contract fixture, not an assertion that workerd was executed. */
class SqliteStorageFixture implements DurableSqlStorage {
  readonly native = new DatabaseSync(':memory:');
  readonly queries: string[] = [];
  transactionCalls = 0;
  constructor() { this.native.exec('PRAGMA foreign_keys=ON'); }
  readonly sql = {
    exec: (query: string, ...bindings: (string | number | null | ArrayBuffer | ArrayBufferView)[]) => {
      this.queries.push(query);
      // Durable Objects reject these statements; fixture fails if portability regresses.
      if (/\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(query) && !/CREATE TRIGGER/i.test(query)) throw new Error('Use transactionSync, not SQL transactions');
      if (/PRAGMA\s+(?:user_version|journal_mode|max_page_count)/i.test(query)) throw new Error('Unsupported Durable Object PRAGMA');
      let rows: Record<string, unknown>[];
      if (bindings.length === 0 && (query.includes(';') || /^\s*(?:CREATE|DROP)/i.test(query))) {
        this.native.exec(query); rows = [];
      } else {
        const values = bindings.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value) as SQLInputValue[];
        rows = this.native.prepare(query).all(...values);
      }
      // Runtime SQLite cursors return ArrayBuffer BLOBs, not Node's Uint8Array.
      const copied = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? Uint8Array.from(value).buffer : value])));
      return { toArray: () => copied, rowsWritten: 999 };
    },
    get databaseSize() { return 0; },
  };
  transactionSync<T>(callback: () => T): T {
    this.transactionCalls++;
    this.native.exec('BEGIN IMMEDIATE');
    try { const value = callback(); this.native.exec('COMMIT'); return value; }
    catch (error) { this.native.exec('ROLLBACK'); throw error; }
  }
  installSizeReader() {
    Object.defineProperty(this.sql, 'databaseSize', { get: () => Number(this.native.prepare('PRAGMA page_count').get()?.page_count) * Number(this.native.prepare('PRAGMA page_size').get()?.page_size) });
  }
}
const fixtures: SqliteStorageFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(fixture => fixture.native.close()); });
function storage() { const fixture = new SqliteStorageFixture(); fixture.installSizeReader(); fixtures.push(fixture); return fixture; }
function snapshot(fixture: SqliteStorageFixture) {
  return Object.fromEntries(['users', 'sessions', 'projects', 'members', 'invitations', 'history', 'versions', 'ai_usage', 'studio_schema'].map(table => [table, fixture.native.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

describe('Durable SQL adapter contract against real native SQLite (workerd verified separately)', () => {
  it('preserves all eight domain tables, sessions, roles, versions, BLOBs and daily AI accounting across adapters', () => {
    const fixture = storage(), first = createCloudflareStore(fixture);
    const owner = first.createUser('Owner'), project = createStarterDocument('adapter-project');
    first.createProject(project, owner);
    const token = first.createSession(owner), viewer = first.createUser('Viewer');
    expect(first.join(first.invitation(project.id, 'viewer'), viewer)).toBe(project.id);
    first.reserveAI(owner.id, 86_400_000);
    first.db.prepare('UPDATE projects SET ystate=? WHERE id=?').run(new Uint8Array([1, 2, 3, 255]), project.id);
    const restarted = createCloudflareStore(fixture);
    expect(restarted.userForSession(token)).toEqual(owner);
    expect(restarted.role(project.id, viewer.id)).toBe('viewer');
    expect(restarted.readDocument(project.id)).toEqual(project);
    expect(restarted.versions(project.id)).toHaveLength(1);
    expect(restarted.db.prepare('SELECT ystate FROM projects WHERE id=?').get(project.id)?.ystate).toEqual(new Uint8Array([1, 2, 3, 255]));
    expect(restarted.db.prepare('SELECT requests FROM ai_usage ORDER BY scope').all()).toEqual([{ requests: 1 }, { requests: 1 }]);
    expect(restarted.db.prepare('SELECT version FROM studio_schema').get()?.version).toBe(2);
    expect(fixture.queries.some(query => /PRAGMA\s+user_version/i.test(query))).toBe(false);
  });

  it('rolls back document/history/inverse bookkeeping on a failed second undo marker and accepts a retry once', () => {
    const fixture = storage(), store = createCloudflareStore(fixture);
    const owner = store.createUser('Owner'), project = createStarterDocument('undo-project'); store.createProject(project, owner);
    const envelope: OperationEnvelope = { id: 'original-change', projectId: project.id, baseRevision: 0, label: 'Dark theme', operations: [{ type: 'theme', theme: 'dark' }] };
    const changed = applyOperations(project, envelope); store.writeDocument(changed, new Uint8Array([1]), owner, envelope, project);
    const inverse: OperationEnvelope = { id: 'inverse-change', projectId: project.id, baseRevision: 1, label: 'Undo theme', operations: [{ type: 'theme', theme: 'light' }] };
    const undone = applyOperations(changed, inverse), before = snapshot(fixture);
    fixture.native.exec("CREATE TRIGGER fail_marker AFTER UPDATE OF undone ON history WHEN NEW.id='inverse-change' BEGIN SELECT RAISE(ABORT, 'fixture marker failure'); END;");
    expect(() => store.writeDocument(undone, new Uint8Array([2]), owner, inverse, changed, envelope.id)).toThrow('fixture marker failure');
    expect(snapshot(fixture)).toEqual(before);
    fixture.native.exec('DROP TRIGGER fail_marker');
    store.writeDocument(undone, new Uint8Array([2]), owner, inverse, changed, envelope.id);
    expect(store.readDocument(project.id).revision).toBe(2);
    expect(store.db.prepare('SELECT undone FROM history ORDER BY revision').all()).toEqual([{ undone: 1 }, { undone: 1 }]);
  });

  it('rejects oversized UTF-8 values before writing and rolls back earlier nested work', () => {
    const fixture = storage(), store = createCloudflareStore(fixture), before = snapshot(fixture);
    const tooLarge = '🙂'.repeat(Math.floor(CLOUDFLARE_MAX_VALUE_BYTES / 4) + 1);
    expect(tooLarge.length).toBeLessThan(CLOUDFLARE_MAX_VALUE_BYTES);
    expect(() => store.transaction(() => {
      store.createUser('Must roll back');
      store.db.prepare('INSERT INTO projects(id,document) VALUES(?,?)').run('too-large', tooLarge);
    })).toThrow('UTF-8 bytes per saved value');
    expect(snapshot(fixture)).toEqual(before);
  });

  it('rejects a combined history-sized write below each individual value ceiling', () => {
    const fixture = storage(), store = createCloudflareStore(fixture);
    store.db.exec('CREATE TABLE row_fixture(a TEXT,b TEXT,c TEXT,d TEXT)');
    expect(() => store.db.prepare('INSERT INTO row_fixture VALUES(?,?,?,?)').run('a'.repeat(600_000), 'b'.repeat(600_000), 'c'.repeat(600_000), 'x')).toThrow('bytes per saved write');
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM row_fixture').get()?.count).toBe(0);
  });

  it('checks physical database growth inside the write transaction and retains previous values on capacity failure', () => {
    const fixture = storage(), store = createCloudflareStore(fixture);
    const user = store.createUser('Retained owner');
    store.db.exec('CREATE TABLE capacity_fixture(value BLOB)');
    const before = snapshot(fixture), db = new CloudflareSqlDatabase(fixture, fixture.sql.databaseSize + 8192);
    expect(() => db.prepare('INSERT INTO capacity_fixture VALUES(?)').run(new Uint8Array(131_072))).toThrow('database storage limit');
    expect(snapshot(fixture)).toEqual(before);
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM capacity_fixture').get()?.count).toBe(0);
    expect(store.db.prepare('SELECT name FROM users WHERE id=?').get(user.id)?.name).toBe('Retained owner');
  });

  it('refuses incompatible schema metadata without overwriting saved data', () => {
    const fixture = storage(), store = createCloudflareStore(fixture);
    const user = store.createUser('Retained owner'); store.createProject(createStarterDocument('future-version'), user);
    fixture.native.exec('UPDATE studio_schema SET version=99');
    const before = snapshot(fixture);
    expect(() => createCloudflareStore(fixture)).toThrow('newer incompatible schema');
    expect(snapshot(fixture)).toEqual(before);
    expect(serializeDocument(store.readDocument('future-version'))).toContain('future-version');
  });
});
