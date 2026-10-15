import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { migrateDocument, serializeDocument } from '../src/core/document';
import type { StudioDocument, User, Role, Version, OperationEnvelope } from '../src/core/types';
import { LimitError, resolveDemoLimits, type DemoLimits } from './limits';

export const secretHash = (value: string) => createHash('sha256').update(value).digest('hex');
export class Store {
  readonly db: DatabaseSync;
  readonly limits: DemoLimits;
  private transactionDepth = 0;
  constructor(directory: string, limits: Partial<DemoLimits> = {}) {
    this.limits = resolveDemoLimits(limits);
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'studio.sqlite'));
    let storedVersion:number;
    try{storedVersion=Number(this.db.prepare('PRAGMA user_version').get()?.user_version??0);}
    catch{this.db.close();throw new Error('Saved database is corrupt. Original data retained; restore a verified backup.');}
    if(storedVersion>2){this.db.close();throw new Error('Saved database uses a newer incompatible schema. Original data retained; use a compatible Studio version.');}
    const pageSize = Number(this.db.prepare('PRAGMA page_size').get()?.page_size);
    const maxPages = Math.floor(this.limits.databaseBytes / pageSize);
    const actualMax = Number(this.db.prepare(`PRAGMA max_page_count=${maxPages}`).get()?.max_page_count);
    if(actualMax !== maxPages){this.db.close();throw new LimitError('Saved database exceeds the configured storage limit. Original data retained; raise STUDIO_MAX_DATABASE_MB or restore a verified backup.', 'STORAGE_CAPACITY', 507);}
    try { this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, document TEXT NOT NULL, ystate BLOB);
      CREATE TABLE IF NOT EXISTS members(project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, PRIMARY KEY(project_id,user_id));
      CREATE TABLE IF NOT EXISTS invitations(hash TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), role TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL, label TEXT NOT NULL, revision INTEGER NOT NULL, before_doc TEXT NOT NULL, after_doc TEXT NOT NULL, envelope TEXT NOT NULL, created TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL, label TEXT NOT NULL, actor TEXT NOT NULL, created TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_usage(scope TEXT PRIMARY KEY, day INTEGER NOT NULL, requests INTEGER NOT NULL);
      PRAGMA user_version=2; COMMIT;`);
    } catch(error) { try{this.db.exec('ROLLBACK');}catch{/* SQLite may already have rolled back. */}this.db.close(); throw storageError(error); }
  }
  createUser(name: string): User {
    const user = { id: randomUUID(), name: name.trim().slice(0, 60) || 'Designer' };
    this.db.prepare('INSERT INTO users VALUES(?,?)').run(user.id, user.name); return user;
  }
  createSession(user: User) {
    const token = randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(secretHash(token), user.id, Date.now() + 30 * 86400000);
    return token;
  }
  userForSession(token: string): User | null {
    const row = this.db.prepare('SELECT u.id,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?').get(secretHash(token), Date.now());
    return row ? { id: String(row.id), name: String(row.name) } : null;
  }
  role(projectId: string, userId: string): Role | null {
    const row = this.db.prepare('SELECT role FROM members WHERE project_id=? AND user_id=?').get(projectId, userId);
    return row ? row.role as Role : null;
  }
  projects(userId: string) {
    return this.db.prepare('SELECT p.id,p.document,m.role FROM projects p JOIN members m ON p.id=m.project_id WHERE m.user_id=?').all(userId).map(row => {
      try {
        const doc = migrateDocument(JSON.parse(String(row.document)));
        return { id: row.id, name: doc.name, role: row.role, revision: doc.revision };
      } catch {
        return { id: row.id, name: `Recovery needed · ${String(row.id).slice(0,8)}`, role: row.role, revision: null, unavailable: true, error: 'Saved project is corrupt or incompatible. Original data retained.' };
      }
    });
  }
  createProject(doc: StudioDocument, user: User) {
    this.transaction(() => {
      if(Number(this.db.prepare('SELECT COUNT(*) AS count FROM projects').get()?.count) >= this.limits.projects) throw new LimitError('This demo has reached its project limit. Existing projects are retained; ask the host to increase capacity.');
      if(Number(this.db.prepare("SELECT COUNT(*) AS count FROM members WHERE user_id=? AND role='owner'").get(user.id)?.count) >= this.limits.projectsPerOwner) throw new LimitError('Your demo project limit is reached. Open an existing project or ask the host to increase capacity.');
      this.db.prepare('INSERT INTO projects(id,document) VALUES(?,?)').run(doc.id, serializeDocument(doc));
      this.db.prepare('INSERT INTO members VALUES(?,?,?)').run(doc.id, user.id, 'owner');
      this.saveVersion(doc, user.name, 'Starting point');
    });
  }
  readDocument(projectId: string): StudioDocument {
    const row = this.db.prepare('SELECT document FROM projects WHERE id=?').get(projectId);
    if (!row) throw new Error('Project not found');
    try { return migrateDocument(JSON.parse(String(row.document))); }
    catch { throw new Error('Saved project is corrupt or incompatible. Original data retained; restore a verified backup.'); }
  }
  writeDocument(doc: StudioDocument, ystate: Uint8Array, user: User, envelope: OperationEnvelope, before: StudioDocument) {
    this.transaction(() => {
      if(Number(this.db.prepare('SELECT COUNT(*) AS count FROM history WHERE project_id=?').get(doc.id)?.count) >= this.limits.historyPerProject) throw new LimitError('This project has reached its saved-change limit. Your work is retained; export it or ask the host to increase capacity.');
      this.db.prepare('UPDATE projects SET document=?,ystate=? WHERE id=?').run(serializeDocument(doc), ystate, doc.id);
      this.db.prepare('INSERT INTO history(id,project_id,user_id,label,revision,before_doc,after_doc,envelope,created) VALUES(?,?,?,?,?,?,?,?,?)').run(envelope.id, doc.id, user.id, envelope.label, doc.revision, serializeDocument(before), serializeDocument(doc), JSON.stringify(envelope), new Date().toISOString());
    });
  }
  saveVersion(doc: StudioDocument, actor: string, label: string): Version {
    if(Number(this.db.prepare('SELECT COUNT(*) AS count FROM versions WHERE project_id=?').get(doc.id)?.count) >= this.limits.versionsPerProject) throw new LimitError('This project has reached its version limit. Existing versions are retained; export your work or ask the host to increase capacity.');
    const version: Version = { id: randomUUID(), projectId: doc.id, revision: doc.revision, label: label.slice(0, 120), actor, createdAt: new Date().toISOString(), document: doc };
    this.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?,?)').run(version.id, doc.id, doc.revision, version.label, actor, version.createdAt, serializeDocument(doc)); return version;
  }
  reserveAI(userId: string, now = Date.now()): void {
    if(!Number.isFinite(now) || now < 0) throw new Error('Invalid AI allowance clock');
    const today = Math.floor(now / 86400000);
    this.transaction(() => {
      const buckets = [{scope:'global',limit:this.limits.aiRequestsPerDay},{scope:`user:${userId}`,limit:this.limits.aiRequestsPerUserPerDay}].map(bucket => {
        // Read text/type explicitly: Node can reject unsafe SQLite integers before JS validation.
        const saved = this.db.prepare('SELECT CAST(day AS TEXT) AS day,CAST(requests AS TEXT) AS requests,typeof(day) AS dayType,typeof(requests) AS requestsType FROM ai_usage WHERE scope=?').get(bucket.scope);
        const savedDay=Number(saved?.day),savedRequests=Number(saved?.requests);
        if(saved && (saved.dayType!=='integer'||saved.requestsType!=='integer'||!Number.isSafeInteger(savedDay)||savedDay<0||!Number.isSafeInteger(savedRequests)||savedRequests<0)) throw new LimitError('Saved AI allowance is corrupt. No model request was sent; ask the host to inspect the original data and restore a verified backup.', 'AI_USAGE_RECOVERY', 503);
        const day = saved ? Math.max(today, savedDay) : today;
        const requests = saved && savedDay >= today ? savedRequests : 0;
        if(requests >= bucket.limit) throw new LimitError('The demo AI request allowance is reached. Editing and export remain available; try again on the next UTC day or ask the host.', 'AI_ALLOWANCE');
        return {...bucket,day,requests:requests+1};
      });
      for(const bucket of buckets) this.db.prepare('INSERT INTO ai_usage VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET day=excluded.day,requests=excluded.requests').run(bucket.scope,bucket.day,bucket.requests);
    });
  }
  versions(projectId: string): Version[] {
    return this.db.prepare('SELECT * FROM versions WHERE project_id=? ORDER BY created DESC').all(projectId).map(row => ({ id:String(row.id),projectId:String(row.project_id),revision:Number(row.revision),label:String(row.label),actor:String(row.actor),createdAt:String(row.created),document:migrateDocument(JSON.parse(String(row.document))) }));
  }
  invitation(projectId: string, role: 'editor' | 'viewer') {
    const token = randomBytes(24).toString('hex');
    this.db.prepare('INSERT INTO invitations VALUES(?,?,?,?)').run(secretHash(token),projectId,role,Date.now()+86400000); return token;
  }
  join(token: string, user: User): string {
    const row = this.db.prepare('SELECT * FROM invitations WHERE hash=? AND expires>?').get(secretHash(token),Date.now());
    if (!row) throw new Error('Invitation is invalid or expired');
    // Existing ownership is never downgraded through an invitation.
    this.db.prepare('INSERT OR IGNORE INTO members VALUES(?,?,?)').run(row.project_id,user.id,row.role); return String(row.project_id);
  }
  members(projectId: string) { return this.db.prepare('SELECT u.id,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=?').all(projectId); }
  setRole(projectId: string,userId: string,role: 'editor'|'viewer'|null) {
    if (this.role(projectId,userId)==='owner') throw new Error('Owner permissions cannot be changed here');
    if (role) this.db.prepare('UPDATE members SET role=? WHERE project_id=? AND user_id=?').run(role,projectId,userId);
    else this.db.prepare('DELETE FROM members WHERE project_id=? AND user_id=?').run(projectId,userId);
    // Outstanding capability links must not resurrect access that an owner revoked.
    this.db.prepare('DELETE FROM invitations WHERE project_id=?').run(projectId);
  }
  transaction<T>(fn: () => T): T {
    if(this.transactionDepth>0)return fn();
    this.db.exec('BEGIN IMMEDIATE');this.transactionDepth++;
    try { const value=fn(); this.db.exec('COMMIT'); return value; } catch(error){try{this.db.exec('ROLLBACK');}catch{/* SQLITE_FULL can already have rolled the transaction back. */}throw storageError(error);}finally{this.transactionDepth--;}
  }
  close(){this.db.close();}
}

/** Keep storage failures actionable without masking SQLite's automatic rollback. */
function storageError(error: unknown): unknown {
  if(error && typeof error === 'object' && 'errcode' in error && error.errcode === 13) return new LimitError('Demo storage capacity is reached. Saved work is retained; ask the host to increase storage or restore a verified backup.', 'STORAGE_CAPACITY', 507);
  return error;
}
