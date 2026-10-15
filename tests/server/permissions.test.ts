import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StudioDocument } from '../../src/core/types';
import { ApiClient, deniedWebSocket, envelope, Peer, startStudio, type RunningStudio } from './helpers';
import { secretHash } from '../../server/store';

let studio: RunningStudio;
let owner: ApiClient;
let doc: StudioDocument;
const peers: Peer[] = [];
beforeEach(async () => { studio = await startStudio(); owner = new ApiClient(studio); doc = await owner.demo('Fictional owner'); });
afterEach(async () => { peers.splice(0).forEach(peer => peer.destroy()); await studio.close(); });

describe('actual HTTP and WebSocket permission boundaries', () => {
  it('denies unauthenticated direct resources and keeps independently created demos isolated', async () => {
    const guest = new ApiClient(studio);
    for (const resource of ['', '/members', '/versions', '/history']) expect((await guest.request(`/api/projects/${doc.id}${resource}`)).status).toBe(401);
    expect((await guest.request(`/api/projects/${doc.id}/export`, 'POST', { baseRevision: 0 })).status).toBe(401);
    expect((await guest.submit(doc.id, { envelope: envelope(doc, [{ type: 'theme', theme: 'dark' }]) })).status).toBe(401);
    const other = await guest.demo('Independent visitor');
    expect(other.id).not.toBe(doc.id);
    expect((await guest.request(`/api/projects/${doc.id}`)).status).toBe(403);
    expect((await owner.request(`/api/projects/${other.id}`)).status).toBe(403);
    expect(await deniedWebSocket(studio, doc.id, { Origin: studio.base, Cookie: guest.cookie })).toBe(403);
    expect(await deniedWebSocket(studio, doc.id, { Origin: studio.base })).toBe(403);
  });

  it('enforces HTTP/WS origins and session cookie security flags', async () => {
    const guest = new ApiClient(studio);
    const creation = await guest.request('/api/demo', 'POST', { name: 'Cookie check' });
    const cookie = creation.headers.get('set-cookie');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect((await owner.request(`/api/projects/${doc.id}/undo`, 'POST', {}, { Origin: 'https://attacker.example' })).status).toBe(403);
    expect((await owner.request(`/api/projects/${doc.id}/undo`, 'POST', {}, { 'X-Studio-Request': '' })).status).toBe(403);
    expect((await owner.request(`/api/projects/${doc.id}/undo`, 'POST', {}, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect(await deniedWebSocket(studio, doc.id, { Origin: 'https://attacker.example', Cookie: owner.cookie })).toBe(403);
    expect(await deniedWebSocket(studio, doc.id, { Cookie: owner.cookie })).toBe(403);
    expect(studio.store.readDocument(doc.id).revision).toBe(0);
  });

  it('permits invited viewer reads but refuses edits on HTTP and live WS; editor can edit', async () => {
    const viewer = new ApiClient(studio);
    await viewer.join(await owner.invite(doc.id, 'viewer'), 'Fictional viewer');
    expect((await viewer.request(`/api/projects/${doc.id}`)).status).toBe(200);
    const edit = { envelope: envelope(doc, [{ type: 'theme', theme: 'dark' }]) };
    expect((await viewer.submit(doc.id, edit)).status).toBe(403);
    expect((await viewer.request(`/api/projects/${doc.id}/undo`, 'POST')).status).toBe(403);
    expect((await viewer.request(`/api/projects/${doc.id}/versions`, 'POST', { label: 'Forbidden' })).status).toBe(403);
    expect((await viewer.request(`/api/projects/${doc.id}/invitations`, 'POST', { role: 'editor' })).status).toBe(403);
    const peer = await Peer.connect(viewer, doc.id); peers.push(peer);
    peer.send('operation', edit);
    expect((await peer.wait(message => message.type === 'error' && message.opId === edit.envelope.id)).error).toContain('permission');
    expect(peer.current.revision).toBe(0);
    const editor = new ApiClient(studio);
    await editor.join(await owner.invite(doc.id, 'editor'), 'Fictional editor');
    expect((await editor.submit(doc.id, { envelope: envelope(doc, [{ type: 'theme', theme: 'dark' }]) })).status).toBe(200);
    await peer.revision(1);
    expect(peer.current.theme).toBe('dark');
  });

  it('closes revoked live connections and rejects later HTTP and reconnect access', async () => {
    const editor = new ApiClient(studio);
    await editor.join(await owner.invite(doc.id, 'editor'), 'Revoked editor');
    const peer = await Peer.connect(editor, doc.id); peers.push(peer);
    const closed = new Promise<number>(done => peer.socket.once('close', code => done(code)));
    expect((await owner.request(`/api/projects/${doc.id}/members/${editor.user!.id}`, 'PATCH', { role: null })).status).toBe(200);
    expect(await closed).toBe(4003);
    expect((await editor.request(`/api/projects/${doc.id}`)).status).toBe(403);
    expect((await editor.submit(doc.id, { envelope: envelope(doc, [{ type: 'theme', theme: 'dark' }]) })).status).toBe(403);
    expect(await deniedWebSocket(studio, doc.id, { Origin: studio.base, Cookie: editor.cookie })).toBe(403);
  });

  it('downgrades live editors to viewers on reconnect and protects immutable ownership', async () => {
    const editor = new ApiClient(studio);
    await editor.join(await owner.invite(doc.id, 'editor'), 'Downgraded editor');
    const old = await Peer.connect(editor, doc.id); peers.push(old);
    const closed = new Promise<number>(done => old.socket.once('close', code => done(code)));
    expect((await owner.request(`/api/projects/${doc.id}/members/${editor.user!.id}`, 'PATCH', { role: 'viewer' })).status).toBe(200);
    expect(await closed).toBe(4003);
    const current = await Peer.connect(editor, doc.id); peers.push(current);
    const edit = { envelope: envelope(doc, [{ type: 'theme', theme: 'dark' }]) };
    current.send('operation', edit);
    expect((await current.wait(message => message.opId === edit.envelope.id)).type).toBe('error');
    expect((await owner.request(`/api/projects/${doc.id}/members/${owner.user!.id}`, 'PATCH', { role: null })).status).toBe(400);
    expect(studio.store.role(doc.id, owner.user!.id)).toBe('owner');
  });

  it('rechecks expired authentication on already open sockets and HTTP requests', async () => {
    const peer = await Peer.connect(owner, doc.id); peers.push(peer);
    const token = owner.cookie.slice('studio_session='.length);
    studio.store.db.prepare('UPDATE sessions SET expires=? WHERE hash=?').run(Date.now() - 1, secretHash(token));
    const from = peer.messages.length;
    const closed = new Promise<number>(done => peer.socket.once('close', code => done(code)));
    peer.send('sync');
    expect(await closed).toBe(4003);
    expect(peer.messages.slice(from).some(message => message.type === 'state')).toBe(false);
    expect((await owner.request(`/api/projects/${doc.id}`)).status).toBe(401);
    expect(await deniedWebSocket(studio, doc.id, { Origin: studio.base, Cookie: owner.cookie })).toBe(403);
  });

  it('does not broadcast another actor’s document changes to an idle expired session', async () => {
    const viewer = new ApiClient(studio); await viewer.join(await owner.invite(doc.id, 'viewer'), 'Expiring viewer');
    const peer = await Peer.connect(viewer, doc.id); peers.push(peer);
    studio.store.db.prepare('UPDATE sessions SET expires=? WHERE hash=?').run(Date.now() - 1, secretHash(viewer.cookie.slice('studio_session='.length)));
    const from = peer.messages.length;
    const closed = new Promise<number>(done => peer.socket.once('close', code => done(code)));
    const received = peer.wait(message => message.type === 'state', from).then(() => 0);
    expect((await owner.submit(doc.id, { envelope: envelope(doc, [{ type: 'theme', theme: 'dark' }]) })).status).toBe(200);
    // A state delivery wins this race only when the server leaked protected data.
    expect(await Promise.race([closed, received])).toBe(4003);
    expect(peer.messages.slice(from).some(message => message.type === 'state')).toBe(false);
  });
});
