import { describe, expect, it, vi } from 'vitest';
import type { Ai } from '@cloudflare/workers-types';
import { aiStatus, proposeChanges, WORKERS_AI_MODEL } from '../../edge/ai';
import { createStarterDocument } from '../../src/core/starter';

const document = () => createStarterDocument('edge-ai-fixture');
const proposal = () => ({ projectId: 'edge-ai-fixture', baseRevision: 0, summary: 'Use a dark theme.', groups: [{ id: 'theme', title: 'Dark theme', dependsOn: [], operations: [{ type: 'theme', theme: 'dark' }] }] });
const fixture = (response: () => Promise<Response>) => {
  const run = vi.fn(response);
  return { run, env: { AI_PROVIDER: 'workers-ai', CF_AI_MODEL: WORKERS_AI_MODEL, AI: { run } as unknown as Ai } };
};
const request = () => ({ document: document(), prompt: 'Use a dark theme', role: 'owner' as const });

describe('Workers AI transport fixtures — no live inference', () => {
  it('requires the reviewed model and explicit configuration', async () => {
    const { env, run } = fixture(async () => Response.json({ response: proposal() }));
    expect(aiStatus(env).available).toBe(true);
    expect(aiStatus({ ...env, CF_AI_MODEL: '@cf/unreviewed/model' }).available).toBe(false);
    await expect(proposeChanges(request(), { ...env, AI_PROVIDER: 'disabled' })).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(run).not.toHaveBeenCalled();
  });
  it.each([false, true])('decodes structured output (string=%s), validates, and never mutates', async stringify => {
    const { env, run } = fixture(async () => Response.json({ response: stringify ? JSON.stringify(proposal()) : proposal() }));
    const input = request(), before = structuredClone(input.document);
    expect(await proposeChanges(input, env)).toEqual(proposal());
    expect(input.document).toEqual(before);
    const [model, options] = run.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(model).toBe(WORKERS_AI_MODEL);
    expect(options).toMatchObject({ stream: false, max_tokens: 2048, response_format: { type: 'json_schema' } });
    const serialized = JSON.stringify(options);
    expect(serialized).not.toContain(input.document.data.tickets[0].email);
    expect(serialized).not.toContain('api_key');
  });
  it.each([
    ['quota', () => new Response('private provider detail', { status: 429 }), 'AI_PROVIDER_FAILURE'],
    ['unsupported request', () => new Response('private schema details', { status: 400 }), 'AI_PROVIDER_CONFIGURATION'],
    ['invalid JSON', () => new Response('{'), 'AI_MALFORMED'],
    ['truncated', () => Response.json({ response: proposal(), finish_reason: 'length' }), 'AI_INCOMPLETE'],
    ['tool call', () => Response.json({ response: proposal(), tool_calls: [{}] }), 'AI_INCOMPLETE'],
    ['missing response', () => Response.json({ usage: {} }), 'AI_INCOMPLETE'],
    ['oversized', () => new Response('x'.repeat(300001)), 'AI_OUTPUT_LIMIT'],
  ])('rejects %s without applying a design', async (_label, response, code) => {
    const { env } = fixture(async () => response());
    const input = request(), before = structuredClone(input.document);
    await expect(proposeChanges(input, env)).rejects.toMatchObject({ code });
    expect(input.document).toEqual(before);
  });
  it('rejects foreign-project and executable model output with the shared semantic validator', async () => {
    const { env } = fixture(async () => Response.json({ response: { ...proposal(), projectId: 'foreign-project' } }));
    await expect(proposeChanges(request(), env)).rejects.toThrow(/inaccessible project/);
    const unsafe = fixture(async () => Response.json({ response: { ...proposal(), groups: [{ id: 'unsafe', title: 'Unsafe', dependsOn: [], operations: [{ type: 'replace', document: document() }] }] } }));
    await expect(proposeChanges(request(), unsafe.env)).rejects.toThrow(/Replacement and executable code/);
  });
  it('denies viewers and already cancelled requests before contacting the model', async () => {
    const { env, run } = fixture(async () => Response.json({ response: proposal() }));
    await expect(proposeChanges({ ...request(), role: 'viewer' }, env)).rejects.toThrow(/permission/);
    await expect(proposeChanges({ ...request(), signal: AbortSignal.abort() }, env)).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    expect(run).not.toHaveBeenCalled();
  });
  it('sanitizes transport exceptions', async () => {
    const { env } = fixture(async () => { throw new Error('private-transport-secret'); });
    await expect(proposeChanges(request(), env)).rejects.toThrow(/^The model provider request failed/);
  });
});
