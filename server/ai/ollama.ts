import type { AIProvider } from './index';
import { decodeProposalWire, proposalResponseSchema } from './schema';
import { AIError } from './validation';

const MAX_RESPONSE_BYTES = 300000;
let active = false;

/** Trusted server configuration only: request bodies never select a model or destination. */
export function ollamaConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const model = environment.OLLAMA_MODEL?.trim() ?? '';
  if (!/^qwen3\.5:(2b|4b)$/.test(model)) {
    throw new AIError('Set OLLAMA_MODEL to a reviewed local qwen3.5:2b or qwen3.5:4b tag.', 'AI_UNAVAILABLE', 503);
  }
  let url: URL;
  try { url = new URL(environment.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'); }
  catch { throw new AIError('Invalid local model server configuration.', 'AI_UNAVAILABLE', 503); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'ollama'].includes(url.hostname)
    || url.hostname === 'ollama' && url.port !== '11434'
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new AIError('The model endpoint must be loopback HTTP or the private ollama:11434 Compose service.', 'AI_UNAVAILABLE', 503);
  }
  const rawTimeout = environment.OLLAMA_TIMEOUT_MS || '120000';
  const timeoutMs = Number(rawTimeout);
  if (!/^\d+$/.test(rawTimeout) || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 180000) {
    throw new AIError('OLLAMA_TIMEOUT_MS must be an integer from 1000 to 180000.', 'AI_UNAVAILABLE', 503);
  }
  return { model, origin: url.origin, timeoutMs };
}

async function boundedJSON(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new AIError('The local model server refused the request. Check its private configuration.', 'AI_PROVIDER_FAILURE', 502);
  }
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body) {
    await response.body?.cancel();
    throw new AIError('The model response exceeds the size limit or has no body.', 'AI_OUTPUT_LIMIT', 502);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AIError('The model response exceeds the size limit.', 'AI_OUTPUT_LIMIT', 502);
    }
    chunks.push(next.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AIError('The local model returned malformed JSON. No changes were applied.', 'AI_MALFORMED', 502); }
}

export function ollamaProvider(observe?: (response: unknown) => void): AIProvider {
  const config = ollamaConfiguration();
  return { timeoutMs: config.timeoutMs, async generate({ input, instructions, signal }) {
    if (Buffer.byteLength(input, 'utf8') > 24000) {
      throw new AIError('The local model context budget is exceeded. Use a smaller design.', 'AI_CONTEXT_LIMIT');
    }
    if (active) throw new AIError('The local model is busy. Retry after the current proposal finishes.', 'AI_BUSY', 503);
    active = true;
    try {
      const response = await fetch(`${config.origin}/api/chat`, {
        method: 'POST', redirect: 'error', credentials: 'omit', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, stream: false, think: false, keep_alive: '5m',
          messages: [{ role: 'system', content: instructions }, { role: 'user', content: input }],
          format: proposalResponseSchema,
          options: { temperature: 0, seed: 17, num_ctx: 16384, num_predict: 2048, num_thread: 2, num_gpu: 0 },
        }),
      });
      const wire = await boundedJSON(response) as { done?: boolean; done_reason?: string; message?: { content?: string } };
      // Explicit evaluation observer only; application requests do not retain model text.
      observe?.(wire);
      if (!wire || wire.done !== true || wire.done_reason !== 'stop' || typeof wire.message?.content !== 'string' || !wire.message.content.trim()) {
        throw new AIError('The local model response was incomplete or refused. No changes were applied.', 'AI_INCOMPLETE', 502);
      }
      let proposal: unknown;
      try { proposal = JSON.parse(wire.message.content); }
      catch { throw new AIError('The local model returned malformed structured output. No changes were applied.', 'AI_MALFORMED', 502); }
      return decodeProposalWire(proposal);
    } finally { active = false; }
  } };
}
