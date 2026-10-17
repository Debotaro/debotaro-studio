import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStarterDocument } from '../../src/core/starter';
import { createNode } from '../../src/core/document';
import { aiStatus, proposeChanges } from '../../server/ai';
import { ollamaConfiguration } from '../../server/ai/ollama';
import { proposalResponseSchema } from '../../server/ai/schema';
import { ApiClient, startStudio } from '../server/helpers';

const paid = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({ default: class ForbiddenPaidProvider { constructor() { paid(); throw new Error('Paid provider must not run'); } } }));
let handler: (request: IncomingMessage, response: ServerResponse, body: Record<string, unknown>) => void;
let requests: { url: string | undefined; body: Record<string, unknown>; authorization: string | undefined }[];
let server: ReturnType<typeof createServer>;
const document = () => createStarterDocument('local-ai-fixture');
const proposal = () => ({ projectId: 'local-ai-fixture', baseRevision: 0, summary: 'Fixture dark theme',
  groups: [{ id: 'theme', title: 'Review theme', dependsOn: [], operations: [{ type: 'theme', theme: 'dark' }] }] });
const complete = () => ({ done: true, done_reason: 'stop', message: { content: JSON.stringify(proposal()) } });
const run = (signal?: AbortSignal) => proposeChanges({ document: document(), prompt: 'Set dark theme', role: 'owner', signal });
async function receivedRequest() {
  const deadline = Date.now() + 5000;
  while (!requests.length) {
    if (Date.now() > deadline) throw new Error('Fixture model endpoint was not called');
    await new Promise(done => setTimeout(done, 5));
  }
}
function completeFor(body: Record<string, unknown>) {
  const messages = body.messages as { role: string; content: string }[];
  const context = JSON.parse(messages.find(message => message.role === 'user')!.content);
  return { ...complete(), message: { content: JSON.stringify({ ...proposal(), projectId: context.projectId, baseRevision: context.baseRevision }) } };
}

beforeEach(async () => {
  requests = [];
  handler = (_request, response) => response.end(JSON.stringify(complete()));
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ url: request.url, body, authorization: request.headers.authorization });
    response.setHeader('Content-Type', 'application/json');
    handler(request, response, body);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  vi.stubEnv('AI_PROVIDER', 'ollama');
  vi.stubEnv('OLLAMA_MODEL', 'qwen3.5:4b');
  vi.stubEnv('OLLAMA_BASE_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  vi.stubEnv('OLLAMA_TIMEOUT_MS', '1000');
  vi.stubEnv('OPENAI_API_KEY', 'explicit-excluded-fake-key');
  vi.stubEnv('OPENAI_MODEL', 'never-called-fixture');
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done()));
  expect(paid).not.toHaveBeenCalled();
  paid.mockReset();
  vi.unstubAllEnvs();
});

describe('local Ollama HTTP adapter — transport fixtures, not model inference', () => {
  it('explicitly disables inference even if a different provider has credentials configured', async () => {
    vi.stubEnv('AI_PROVIDER', 'disabled');
    expect(aiStatus()).toMatchObject({ available: false, provider: 'disabled', model: null });
    await expect(run()).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(requests).toHaveLength(0);
  });
  it('sends a bounded schema-based CPU request and validates its proposal without applying it', async () => {
    const initial = document();
    expect(await run()).toEqual(proposal());
    expect(document()).toEqual(initial);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: '/api/chat', authorization: undefined, body: {
      model: 'qwen3.5:4b', stream: false, think: false, format: proposalResponseSchema,
      options: { temperature: 0, num_ctx: 16384, num_predict: 2048, num_thread: 2, num_gpu: 0 },
    } });
    const wire = JSON.stringify(requests[0].body);
    expect(wire).not.toContain('explicit-excluded-fake-key');
    expect(wire).not.toContain(document().data.tickets[0].email);
    expect(aiStatus()).toMatchObject({ available: true, provider: 'ollama', model: 'qwen3.5:4b', disclosure: expect.stringContaining('private Ollama server') });
  });

  it.each(['https://127.0.0.1:11434', 'http://localhost:11434', 'http://example.com:11434',
    'http://169.254.169.254', 'http://127.0.0.1.evil.example', 'http://user:secret@127.0.0.1:11434',
    'http://127.0.0.1:11434/api', 'http://127.0.0.1:11434?x=1', 'http://127.0.0.1:11434#fragment',
    'http://ollama:8080'])('rejects non-private or ambiguous endpoint %s before HTTP', async endpoint => {
    vi.stubEnv('OLLAMA_BASE_URL', endpoint);
    expect(aiStatus().available).toBe(false);
    await expect(run()).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(requests).toHaveLength(0);
  });

  it('accepts only the fixed private Compose service and reviewed local model tags', () => {
    expect(ollamaConfiguration({ OLLAMA_MODEL: 'qwen3.5:2b', OLLAMA_BASE_URL: 'http://ollama:11434' })).toMatchObject({ model: 'qwen3.5:2b', timeoutMs: 120000 });
    expect(ollamaConfiguration({ OLLAMA_MODEL: 'qwen3.5:4b', OLLAMA_BASE_URL: 'http://[::1]:11434' }).origin).toBe('http://[::1]:11434');
    for (const model of ['qwen3.5:cloud', 'https://provider.example/model', 'arbitrary', '']) {
      expect(() => ollamaConfiguration({ OLLAMA_MODEL: model })).toThrow('reviewed local');
    }
    for (const timeout of ['0', '999', '180001', '1e5', 'Infinity']) {
      expect(() => ollamaConfiguration({ OLLAMA_MODEL: 'qwen3.5:4b', OLLAMA_TIMEOUT_MS: timeout })).toThrow('integer');
    }
  });

  it('refuses redirects rather than following a model-server destination', async () => {
    handler = (_request, response) => { response.writeHead(302, { Location: 'http://example.com/' }); response.end(); };
    await expect(run()).rejects.toMatchObject({ code: 'AI_PROVIDER_FAILURE' });
    expect(requests).toHaveLength(1);
  });

  it('refuses oversized local-model context before transmitting any request', async () => {
    const large = document();
    for (let index = 0; index < 8; index++) {
      const node = createNode('Text', `large-text-${index}`);
      node.props.text = 'x'.repeat(4000);
      large.nodes[node.id] = node;
      large.nodes.workspace.children.push(node.id);
    }
    await expect(proposeChanges({ document: large, prompt: 'Set dark theme', role: 'owner' })).rejects.toMatchObject({ code: 'AI_CONTEXT_LIMIT' });
    expect(requests).toHaveLength(0);
  });

  it.each([
    ['malformed transport', '{', 'AI_MALFORMED'],
    ['malformed proposal', JSON.stringify({ done: true, done_reason: 'stop', message: { content: '{' } }), 'AI_MALFORMED'],
    ['truncated generation', JSON.stringify({ ...complete(), done_reason: 'length' }), 'AI_INCOMPLETE'],
    ['unfinished generation', JSON.stringify({ ...complete(), done: false }), 'AI_INCOMPLETE'],
    ['empty output', JSON.stringify({ ...complete(), message: { content: '' } }), 'AI_INCOMPLETE'],
  ])('rejects %s without any document mutation', async (_label, content, code) => {
    handler = (_request, response) => response.end(content);
    await expect(run()).rejects.toMatchObject({ code });
  });

  it.each([true, false])('caps HTTP bytes with declared content length=%s', async declared => {
    handler = (_request, response) => {
      if (declared) response.setHeader('Content-Length', '300001');
      else response.write(' ');
      response.end('x'.repeat(300001));
    };
    await expect(run()).rejects.toMatchObject({ code: 'AI_OUTPUT_LIMIT' });
  });

  it('sanitizes server failures and never falls back to a paid provider', async () => {
    handler = (_request, response) => { response.statusCode = 500; response.end('private paths and secret transport detail'); };
    await expect(run()).rejects.toMatchObject({ code: 'AI_PROVIDER_FAILURE', message: expect.not.stringContaining('secret transport') });
    expect(requests).toHaveLength(1);
  });

  it('still rejects a schema-shaped proposal for another project', async () => {
    handler = (_request, response) => response.end(JSON.stringify({ ...complete(), message: { content: JSON.stringify({ ...proposal(), projectId: 'foreign-project' }) } }));
    await expect(run()).rejects.toMatchObject({ code: 'PROJECT_MISMATCH' });
  });

  it('enforces a real HTTP deadline and releases its concurrency slot after cancellation', async () => {
    handler = () => { /* Deliberately wait until the client's abort closes this fixture response. */ };
    const first = run();
    await receivedRequest();
    await expect(run()).rejects.toMatchObject({ code: 'AI_BUSY' });
    await expect(first).rejects.toMatchObject({ code: 'AI_TIMEOUT', status: 504 });
    handler = (_request, response) => response.end(JSON.stringify(complete()));
    // Fetch abort cleanup settles on the next event-loop turn.
    await new Promise(done => setTimeout(done, 20));
    expect(await run()).toEqual(proposal());
  });

  it('propagates caller cancellation to the actual HTTP request', async () => {
    handler = () => {};
    const controller = new AbortController();
    const pending = run(controller.signal);
    await receivedRequest();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
  });

  it('enforces real public-route roles before local HTTP inference and applies only after explicit review', async () => {
    const studio = await startStudio();
    try {
      const owner = new ApiClient(studio), anonymous = new ApiClient(studio), viewer = new ApiClient(studio);
      const original = await owner.demo('Local provider route fixture');
      await viewer.join(await owner.invite(original.id, 'viewer'), 'Read-only provider fixture');
      const path = `/api/projects/${original.id}/ai/propose`;
      const body = { prompt: 'Set dark theme', baseRevision: original.revision };
      expect((await anonymous.request(path, 'POST', body)).status).toBe(401);
      expect((await viewer.request(path, 'POST', body)).status).toBe(403);
      expect(requests).toHaveLength(0);
      handler = (_request, response, input) => response.end(JSON.stringify(completeFor(input)));
      const response = await owner.request(path, 'POST', body);
      expect(response.status).toBe(200);
      const proposed = await response.json();
      expect(requests).toHaveLength(1);
      expect(await owner.read(original.id)).toEqual(original);
      expect(studio.store.db.prepare('SELECT COUNT(*) AS count FROM history').get()?.count).toBe(0);
      expect((await owner.request(`/api/projects/${original.id}/ai/apply`, 'POST', { proposal: proposed, groups: ['theme'] })).status).toBe(200);
      expect((await owner.read(original.id)).theme).toBe('dark');
      expect(studio.store.db.prepare('SELECT COUNT(*) AS count FROM history').get()?.count).toBe(1);
    } finally { await studio.close(); }
  });

  it('cancels the public HTTP route through to local model transport while retaining the workspace', async () => {
    const studio = await startStudio();
    try {
      const owner = new ApiClient(studio);
      const original = await owner.demo('Public cancellation fixture');
      let closed!: () => void;
      const modelClosed = new Promise<void>(done => { closed = done; });
      handler = (_request, response) => { response.once('close', closed); };
      const controller = new AbortController();
      const path = `/api/projects/${original.id}/ai/propose`;
      const body = { prompt: 'Set dark theme', baseRevision: original.revision };
      const cancelled = expect(fetch(studio.base + path, { method: 'POST', signal: controller.signal,
        headers: { Cookie: owner.cookie, Origin: studio.base, 'X-Studio-Request': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify(body) })).rejects.toMatchObject({ name: 'AbortError' });
      await receivedRequest();
      controller.abort();
      await cancelled;
      await modelClosed;
      expect(await owner.read(original.id)).toEqual(original);
      expect(studio.store.db.prepare('SELECT COUNT(*) AS count FROM history').get()?.count).toBe(0);
      handler = (_request, response, input) => response.end(JSON.stringify(completeFor(input)));
      expect((await owner.request(path, 'POST', body)).status).toBe(200);
    } finally { await studio.close(); }
  });
});
