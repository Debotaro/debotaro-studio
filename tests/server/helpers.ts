import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createStudioServer } from '../../server/app';
import type { Operation, OperationEnvelope, StudioDocument, User } from '../../src/core/types';
import type { Submission } from '../../server/sync';

export type RunningStudio = Awaited<ReturnType<typeof startStudio>>;
export async function startStudio(directory?: string) {
  const parent = resolve('artifacts', 'server-tests');
  mkdirSync(parent, { recursive: true });
  const target = directory ?? mkdtempSync(join(parent, 'test-'));
  const studio = createStudioServer({ directory: target });
  await new Promise<void>(done => studio.server.listen(0, '127.0.0.1', done));
  const port = (studio.server.address() as AddressInfo).port;
  return { ...studio, directory: target, base: `http://127.0.0.1:${port}`, wsBase: `ws://127.0.0.1:${port}` };
}
export function envelope(document: StudioDocument, operations: Operation[], label = 'Test supported edit'): OperationEnvelope {
  return { id: randomUUID(), projectId: document.id, baseRevision: document.revision, label, operations };
}

export class ApiClient {
  cookie = '';
  user: User | null = null;
  constructor(readonly studio: RunningStudio) {}
  async request(path: string, method = 'GET', body?: unknown, overrideHeaders: Record<string, string> = {}) {
    const headers = { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), Origin: this.studio.base, 'X-Studio-Request': '1', ...overrideHeaders };
    const response = await fetch(this.studio.base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    return response;
  }
  async demo(name: string) {
    const response = await this.request('/api/demo', 'POST', { name });
    if (response.status !== 201) throw new Error(`Demo creation failed ${response.status}: ${await response.text()}`);
    const value = await response.json() as { user: User; document: StudioDocument; role: string };
    this.user = value.user;
    return value.document;
  }
  async invite(projectId: string, role: 'editor' | 'viewer') {
    const response = await this.request(`/api/projects/${projectId}/invitations`, 'POST', { role });
    if (!response.ok) throw new Error(`Invitation failed ${response.status}`);
    return (await response.json() as { token: string }).token;
  }
  async join(token: string, name: string) {
    const response = await this.request('/api/join', 'POST', { token, name });
    if (!response.ok) throw new Error(`Join failed ${response.status}: ${await response.text()}`);
    const value = await response.json() as { user: User; document: StudioDocument; role: string };
    this.user = value.user;
    return value.document;
  }
  async read(projectId: string) {
    const response = await this.request(`/api/projects/${projectId}`);
    if (!response.ok) throw new Error(`Read failed ${response.status}: ${await response.text()}`);
    return (await response.json() as { document: StudioDocument }).document;
  }
  submit(projectId: string, submission: Submission) {
    return this.request(`/api/projects/${projectId}/operations`, 'POST', submission);
  }
}

export interface PeerMessage {
  type: string;
  state?: string;
  opId?: string;
  error?: string;
  people?: { id: string; name: string; selection: string | null; role: string }[];
}
export class Peer {
  readonly messages: PeerMessage[] = [];
  readonly document = new Y.Doc();
  private listeners = new Set<() => void>();
  constructor(readonly socket: WebSocket) {
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString()) as PeerMessage;
      if (message.type === 'state' && message.state) Y.applyUpdate(this.document, Buffer.from(message.state, 'base64'));
      this.messages.push(message);
      for (const listener of this.listeners) listener();
    });
  }
  static async connect(client: ApiClient, projectId: string, existingDocument?: Y.Doc) {
    const socket = new WebSocket(`${client.studio.wsBase}/collaborate?projectId=${encodeURIComponent(projectId)}`, { headers: { Cookie: client.cookie, Origin: client.studio.base } });
    const peer = new Peer(socket);
    if (existingDocument) Y.applyUpdate(peer.document, Y.encodeStateAsUpdate(existingDocument));
    await new Promise<void>((done, reject) => { socket.once('open', done); socket.once('error', reject); });
    await peer.wait(message => message.type === 'state');
    return peer;
  }
  get current(): StudioDocument {
    return JSON.parse(this.document.getMap('studio').get('document') as string) as StudioDocument;
  }
  send(type: 'operation' | 'presence' | 'sync', payload?: unknown) { this.socket.send(JSON.stringify({ type, ...(payload !== undefined ? { payload } : {}) })); }
  async wait(predicate: (message: PeerMessage) => boolean, from = 0, timeoutMs = 2_000): Promise<PeerMessage> {
    const match = this.messages.slice(from).find(predicate);
    if (match) return match;
    return new Promise((done, reject) => {
      const listener = () => {
        const result = this.messages.slice(from).find(predicate);
        if (result) { clearTimeout(timer); this.listeners.delete(listener); done(result); }
      };
      const timer = setTimeout(() => { this.listeners.delete(listener); reject(new Error(`No matching WebSocket message: ${JSON.stringify(this.messages.slice(from).map(({ type, opId, error }) => ({ type, opId, error })))}`)); }, timeoutMs);
      this.listeners.add(listener);
    });
  }
  async revision(revision: number) {
    if (this.current.revision === revision) return;
    await this.wait(message => message.type === 'state' && !!message.state && this.current.revision === revision);
  }
  async disconnect() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(done => { this.socket.once('close', () => done()); this.socket.close(); });
  }
  destroy() { this.socket.terminate(); this.document.destroy(); }
}

export async function deniedWebSocket(studio: RunningStudio, projectId: string, headers: Record<string, string>) {
  const ws = new WebSocket(`${studio.wsBase}/collaborate?projectId=${encodeURIComponent(projectId)}`, { headers });
  return new Promise<number>((done, reject) => {
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('Denied connection did not settle')); }, 2_000);
    ws.on('error', () => { /* expected after a denied upgrade; status is observed below */ });
    ws.on('unexpected-response', (_request, response) => { clearTimeout(timer); response.resume(); ws.terminate(); done(response.statusCode ?? 0); });
    ws.on('open', () => { clearTimeout(timer); ws.terminate(); reject(new Error('Forbidden WebSocket was accepted')); });
  });
}
