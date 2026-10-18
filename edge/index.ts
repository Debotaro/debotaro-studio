import { DurableObject } from 'cloudflare:workers';
import { zipSync, strToU8 } from 'fflate';
import { z } from 'zod';
import { createStarterDocument } from '../src/core/starter';
import type { OperationEnvelope, User } from '../src/core/types';
import { SyncEngine, type Submission } from '../server/sync';
import { LimitError, limitsFromEnv, type DemoLimits } from '../server/limits';
import { createCloudflareStore } from '../server/storage/cloudflare';
import { aiStatus, AIError, buildAIContext, proposeChanges, selectedOperations, type EdgeAIEnv } from './ai';
import { generateProject } from './export';

export interface StudioEnv extends EdgeAIEnv {
  STUDIO: DurableObjectNamespace<StudioAuthority>;
  ASSETS: Fetcher;
  STUDIO_ORIGIN?: string;
  [key: string]: unknown;
}

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const GLOBAL_AUTHORITY = 'studio-global-v1';
const identity = z.object({ name: z.string().trim().min(1).max(60) }).strict();
const invitation = z.object({ token: z.string().regex(/^[a-f0-9]{48}$/), name: z.string().trim().min(1).max(60) }).strict();
const submissionSchema = z.object({
  envelope: z.object({ id: z.string().uuid(), projectId: z.string().min(1).max(100), baseRevision: z.number().int().min(0), label: z.string().min(1).max(160), operations: z.array(z.unknown()).min(1).max(100) }).strict(),
  expected: z.record(z.string().max(200), z.string().max(100000)).optional(), strict: z.boolean().optional(),
}).strict();
const peerSchema = z.object({
  user: z.object({ id: z.string().uuid(), name: z.string().min(1).max(60) }).strict(),
  projectId: z.string().min(1).max(100), sessionToken: z.string().regex(/^[a-f0-9]{64}$/), selection: z.string().max(100).nullable(),
}).strict();
type Peer = z.infer<typeof peerSchema>;

function tokenFrom(request: Request): string {
  return (request.headers.get('Cookie') ?? '').split(';').map(value => value.trim()).find(value => value.startsWith('studio_session='))?.slice(15) ?? '';
}

function checkedOrigin(configured: string): string {
  const url = new URL(configured);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== configured) throw new Error('STUDIO_ORIGIN must be an exact HTTP(S) origin without credentials, path, query or trailing slash.');
  return configured;
}

function originFor(request: Request, env: StudioEnv): string {
  if (env.STUDIO_ORIGIN !== undefined && env.STUDIO_ORIGIN !== '') return checkedOrigin(env.STUDIO_ORIGIN);
  // Cloudflare supplies the actual request URL; never infer it from Host/XFP.
  return new URL(request.url).origin;
}

function json(request: Request, body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  responseHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers: responseHeaders });
}

function sessionCookie(request: Request, env: StudioEnv, token: string): string {
  return `studio_session=${token}; Max-Age=${30 * 86400}; Path=/; HttpOnly; SameSite=Strict${originFor(request, env).startsWith('https://') ? '; Secure' : ''}`;
}

async function readJson(request: Request): Promise<unknown> {
  const declared = request.headers.get('Content-Length');
  if (declared && Number(declared) > MAX_REQUEST_BYTES) throw Object.assign(new Error('Request body is too large'), { status: 413 });
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); throw Object.assign(new Error('Request body is too large'), { status: 413 }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) return undefined;
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return undefined;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('Request body must contain valid JSON'); }
}

function errorOpId(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || !('payload' in input)) return;
  const payload = input.payload;
  if (!payload || typeof payload !== 'object' || !('envelope' in payload)) return;
  const envelope = payload.envelope;
  if (envelope && typeof envelope === 'object' && 'id' in envelope && typeof envelope.id === 'string') return envelope.id;
}

/** One authority preserves global capacity, all identity tables and room state. */
export class StudioAuthority extends DurableObject<StudioEnv> {
  private readonly store;
  private readonly engine: SyncEngine;
  private readonly limits: DemoLimits;
  private readonly peers = new Map<WebSocket, Peer>();
  private activeAI = 0;

  constructor(ctx: DurableObjectState, env: StudioEnv) {
    super(ctx, env);
    // Refuse invalid cookie/origin configuration before any identity write.
    if (env.STUDIO_ORIGIN !== undefined && env.STUDIO_ORIGIN !== '') checkedOrigin(env.STUDIO_ORIGIN);
    const strings = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    this.limits = limitsFromEnv(strings);
    this.store = createCloudflareStore(ctx.storage, this.limits);
    this.engine = new SyncEngine(this.store);
    // Attachments survive hibernation; sessions and current roles stay canonical.
    for (const socket of ctx.getWebSockets()) {
      const attachment = peerSchema.safeParse(socket.deserializeAttachment());
      if (!attachment.success) { this.closeSocket(socket, 1008, 'Invalid collaboration session'); continue; }
      if (!this.authorized(attachment.data)) { this.closeSocket(socket, 4003, 'Access revoked or session expired'); continue; }
      this.peers.set(socket, attachment.data);
    }
  }

  private authorized(peer: Peer): boolean {
    return this.store.userForSession(peer.sessionToken)?.id === peer.user.id && Boolean(this.store.role(peer.projectId, peer.user.id));
  }

  private closeSocket(socket: WebSocket, code: number, reason: string): void {
    this.peers.delete(socket);
    try { socket.close(code, reason); } catch { /* already closed; never undo a committed write */ }
  }

  private send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try { socket.send(JSON.stringify(payload)); }
    catch { this.closeSocket(socket, 1011, 'Collaboration connection failed'); }
  }

  private prunePeers(): void {
    for (const [socket, peer] of this.peers) {
      if (socket.readyState !== WebSocket.OPEN) this.peers.delete(socket);
      else if (!this.authorized(peer)) this.closeSocket(socket, 4003, 'Access revoked or session expired');
    }
  }

  private presence(projectId: string): void {
    this.prunePeers();
    const live = [...this.peers].filter(([, peer]) => peer.projectId === projectId);
    const people = live.map(([, peer]) => ({ id: peer.user.id, name: peer.user.name, selection: peer.selection, role: this.store.role(projectId, peer.user.id) }));
    for (const [socket] of live) this.send(socket, { type: 'presence', people });
  }

  private broadcast(projectId: string, opId?: string): void {
    const state = this.engine.state(projectId);
    this.prunePeers();
    for (const [socket, peer] of this.peers) if (peer.projectId === projectId && this.authorized(peer)) this.send(socket, { type: 'state', state, opId });
  }

  private auth(request: Request): User {
    const user = this.store.userForSession(tokenFrom(request));
    if (!user) throw Object.assign(new Error('Sign in to access this project'), { status: 401 });
    return user;
  }

  private access(request: Request, id: string, edit = false, owner = false): User {
    const user = this.auth(request), role = this.store.role(id, user.id);
    if (!role || (edit && role === 'viewer') || (owner && role !== 'owner')) throw Object.assign(new Error('Project permission denied'), { status: 403 });
    return user;
  }

  private upgrade(request: Request): Response {
    const url = new URL(request.url), projectId = url.searchParams.get('projectId') ?? '';
    const sessionToken = tokenFrom(request), user = this.store.userForSession(sessionToken);
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json(request, { error: 'WebSocket upgrade required' }, 426);
    if (request.headers.get('Origin') !== originFor(request, this.env) || !user || !this.store.role(projectId, user.id)) return json(request, { error: 'Project permission denied' }, 403);
    this.prunePeers();
    if (this.peers.size >= this.limits.connections || [...this.peers.values()].filter(peer => peer.user.id === user.id).length >= this.limits.connectionsPerUser) return json(request, { error: 'Demo connection capacity is reached' }, 429);
    let state: string;
    try { state = this.engine.state(projectId); }
    catch { return json(request, { error: 'Saved collaboration state is unavailable. Original data retained.' }, 503); }
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    const peer: Peer = { user, projectId, sessionToken, selection: null };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(peer);
    this.peers.set(server, peer);
    this.send(server, { type: 'state', state });
    this.presence(projectId);
    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '') || '/', method = request.method;
      if (path === '/collaborate') return this.upgrade(request);
      if (path !== '/api' && !path.startsWith('/api/')) return json(request, { error: 'API resource not found' }, 404);
      const read = method === 'GET' || method === 'HEAD';
      if (!read && ((request.headers.get('Origin') && request.headers.get('Origin') !== originFor(request, this.env)) || request.headers.get('Sec-Fetch-Site') === 'cross-site' || request.headers.get('X-Studio-Request') !== '1')) return json(request, { error: 'Request origin denied' }, 403);
      const body = read ? undefined : await readJson(request);
      if (read && path === '/api/health') return json(request, { ok: true });
      if (read && path === '/api/session') { const user = this.store.userForSession(tokenFrom(request)); return json(request, { user, projects: user ? this.store.projects(user.id) : [] }); }
      if (read && path === '/api/ai/status') return json(request, aiStatus(this.env));
      if (method === 'POST' && path === '/api/demo') {
        const input = identity.parse(body), existing = this.store.userForSession(tokenFrom(request));
        const result = this.store.transaction(() => {
          const user = existing ?? this.store.createUser(input.name), document = createStarterDocument(crypto.randomUUID());
          this.store.createProject(document, user);
          return { user, document, token: existing ? null : this.store.createSession(user) };
        });
        return json(request, { user: result.user, document: result.document, role: 'owner' }, 201, result.token ? { 'Set-Cookie': sessionCookie(request, this.env, result.token) } : undefined);
      }
      if (method === 'POST' && path === '/api/join') {
        const input = invitation.parse(body), existing = this.store.userForSession(tokenFrom(request));
        const result = this.store.transaction(() => {
          const user = existing ?? this.store.createUser(input.name), projectId = this.store.join(input.token, user);
          return { user, projectId, document: this.store.readDocument(projectId), token: existing ? null : this.store.createSession(user) };
        });
        return json(request, { user: result.user, document: result.document, role: this.store.role(result.projectId, result.user.id) }, 200, result.token ? { 'Set-Cookie': sessionCookie(request, this.env, result.token) } : undefined);
      }
      const route = /^\/api\/projects\/([^/]+)(?:\/(operations|undo|invitations|members|versions|restore|history|export|ai\/propose|ai\/apply)(?:\/([^/]+))?)?$/.exec(path);
      if (!route) return json(request, { error: 'API resource not found' }, 404);
      const id = decodeURIComponent(route[1]), action = route[2], memberId = route[3] === undefined ? undefined : decodeURIComponent(route[3]);
      if (memberId !== undefined && action !== 'members') return json(request, { error: 'API resource not found' }, 404);
      if (read && action === undefined) { const user = this.access(request, id); return json(request, { document: this.store.readDocument(id), role: this.store.role(id, user.id) }); }
      if (method === 'POST' && action === 'operations') {
        const user = this.access(request, id, true), input = submissionSchema.parse(body) as Submission;
        const doc = this.engine.submit(user, id, input); this.broadcast(id, input.envelope.id);
        return json(request, { document: doc });
      }
      if (method === 'POST' && action === 'undo') { const result = this.engine.undo(this.access(request, id, true), id); this.broadcast(id); return json(request, result); }
      if (method === 'POST' && action === 'invitations') {
        this.access(request, id, false, true); const { role } = z.object({ role: z.enum(['editor', 'viewer']) }).strict().parse(body);
        return json(request, { token: this.store.invitation(id, role) });
      }
      if (read && action === 'members' && memberId === undefined) { this.access(request, id); return json(request, this.store.members(id)); }
      if (method === 'PATCH' && action === 'members' && memberId !== undefined) {
        this.access(request, id, false, true); const { role } = z.object({ role: z.enum(['editor', 'viewer']).nullable() }).strict().parse(body);
        this.store.setRole(id, memberId, role);
        for (const [socket, peer] of this.peers) if (peer.projectId === id && peer.user.id === memberId) this.closeSocket(socket, 4003, 'Permissions changed; reconnect to refresh access');
        this.presence(id); return json(request, { ok: true });
      }
      if (read && action === 'versions') { this.access(request, id); return json(request, this.store.versions(id)); }
      if (method === 'POST' && action === 'versions') { const user = this.access(request, id, true), { label } = z.object({ label: z.string().trim().min(1).max(120) }).strict().parse(body); return json(request, this.store.saveVersion(this.store.readDocument(id), user.name, label), 201); }
      if (method === 'POST' && action === 'restore') {
        const user = this.access(request, id, true), { versionId, baseRevision } = z.object({ versionId: z.string().uuid(), baseRevision: z.number().int().min(0) }).strict().parse(body);
        const version = this.store.versions(id).find(item => item.id === versionId);
        if (!version) throw new Error('Version not found');
        const envelope: OperationEnvelope = { id: crypto.randomUUID(), projectId: id, baseRevision, label: `Restore: ${version.label}`, operations: [{ type: 'replace', document: { ...version.document, revision: baseRevision } }] };
        const doc = this.engine.submit(user, id, { envelope, strict: true }); this.broadcast(id); return json(request, { document: doc });
      }
      if (read && action === 'history') { this.access(request, id); return json(request, this.store.db.prepare('SELECT h.id,h.label,h.revision,h.created,u.name AS actor FROM history h JOIN users u ON h.user_id=u.id WHERE project_id=? ORDER BY revision DESC LIMIT 100').all(id)); }
      if (method === 'POST' && action === 'export') {
        this.access(request, id); const { code, baseRevision } = z.object({ code: z.string().max(2000000).optional(), baseRevision: z.number().int().min(0) }).strict().parse(body);
        const doc = this.store.readDocument(id); if (doc.revision !== baseRevision) throw new Error('Export revision changed; refresh before exporting');
        const files = await generateProject(doc, code);
        // Async generation must not bypass a role/session change while suspended.
        this.access(request, id);
        if (this.store.readDocument(id).revision !== baseRevision) throw new Error('Export revision changed; refresh before exporting');
        const zip = zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
        return new Response(zip, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="debotaro-workspace.zip"', 'Cache-Control': 'no-store' } });
      }
      if (method === 'POST' && action === 'ai/propose') {
        const user = this.access(request, id, true), { prompt, baseRevision } = z.object({ prompt: z.string().trim().min(1).max(4000), baseRevision: z.number().int().min(0) }).strict().parse(body);
        const doc = this.store.readDocument(id); if (doc.revision !== baseRevision) throw new Error('Project changed. Request a proposal using the current design.');
        const status = aiStatus(this.env); if (!status.available) throw new AIError(`Live AI is unavailable. ${status.reason ?? 'Editing and export remain available on this host.'}`, 'AI_UNAVAILABLE', 503);
        buildAIContext(doc, prompt);
        if (this.activeAI >= this.limits.aiConcurrent) throw new LimitError('The demo AI assistant is busy. Try again when the current proposal finishes; editing and export remain available.', 'AI_BUSY');
        this.store.reserveAI(user.id, Date.now()); this.activeAI++;
        try {
          const proposal = await proposeChanges({ document: doc, prompt, signal: request.signal, role: this.store.role(id, user.id)! }, this.env);
          this.access(request, id, true);
          if (this.store.readDocument(id).revision !== baseRevision) throw new Error('Project changed while the model was responding. Request a new proposal.');
          return json(request, proposal);
        } finally { this.activeAI--; }
      }
      if (method === 'POST' && action === 'ai/apply') {
        const user = this.access(request, id, true), { proposal, groups } = z.object({ proposal: z.unknown(), groups: z.array(z.string().max(80)).min(1).max(12) }).strict().parse(body);
        const doc = this.store.readDocument(id), operations = selectedOperations(proposal as Parameters<typeof selectedOperations>[0], groups, doc, this.store.role(id, user.id)!);
        const result = this.engine.submit(user, id, { envelope: { id: crypto.randomUUID(), projectId: id, baseRevision: doc.revision, label: 'Reviewed AI proposal', operations }, strict: true });
        this.broadcast(id); return json(request, { document: result });
      }
      return json(request, { error: 'API resource not found' }, 404);
    } catch (error) {
      const original = error as Error & { errcode?: number; status?: number };
      const mapped = original?.errcode === 13 ? new LimitError('Demo storage capacity is reached. Saved work is retained; ask the host to increase storage or restore a verified backup.', 'STORAGE_CAPACITY', 507) : original;
      return json(request, { error: mapped instanceof z.ZodError ? 'Request does not match the allowed schema' : mapped?.message || 'Request failed', ...(mapped instanceof LimitError ? { code: mapped.code } : {}) }, mapped?.status ?? 400);
    }
  }

  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): void {
    const peer = this.peers.get(socket);
    if (!peer || !this.authorized(peer)) { this.closeSocket(socket, 4003, 'Access revoked or session expired'); return; }
    const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw);
    if (bytes.byteLength > MAX_REQUEST_BYTES) { this.closeSocket(socket, 1009, 'Collaboration message is too large'); this.presence(peer.projectId); return; }
    let input: unknown;
    try {
      input = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(bytes));
      const message = z.object({ type: z.enum(['operation', 'presence', 'sync']), payload: z.unknown().optional() }).strict().parse(input);
      if (message.type === 'operation') { const submission = submissionSchema.parse(message.payload) as Submission; this.engine.submit(peer.user, peer.projectId, submission); this.broadcast(peer.projectId, submission.envelope.id); }
      if (message.type === 'sync') this.send(socket, { type: 'state', state: this.engine.state(peer.projectId) });
      if (message.type === 'presence') {
        const { selection } = z.object({ selection: z.string().max(100).nullable() }).strict().parse(message.payload);
        peer.selection = selection; socket.serializeAttachment(peer); this.presence(peer.projectId);
      }
    } catch (error) { this.send(socket, { type: 'error', opId: errorOpId(input), error: error instanceof Error ? error.message : 'Invalid message' }); }
  }

  webSocketClose(socket: WebSocket, code: number): void {
    const peer = this.peers.get(socket);
    this.closeSocket(socket, [1005, 1006, 1015].includes(code) ? 1000 : code, 'Collaboration connection closed');
    if (peer) this.presence(peer.projectId);
  }

  webSocketError(socket: WebSocket): void {
    const peer = this.peers.get(socket);
    this.closeSocket(socket, 1011, 'Collaboration connection failed');
    if (peer) this.presence(peer.projectId);
  }
}

export default {
  async fetch(request: Request, env: StudioEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/api' || path.startsWith('/api/') || path === '/collaborate' || path === '/collaborate/') return env.STUDIO.get(env.STUDIO.idFromName(GLOBAL_AUTHORITY)).fetch(request);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<StudioEnv>;
