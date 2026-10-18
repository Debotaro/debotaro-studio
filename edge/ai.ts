/** Workers AI only: no external SDK, API key, gateway billing or provider fallback. */
import type { Ai, AiModels, AiOptions } from '@cloudflare/workers-types';
import { validateDocument } from '../src/core/document';
import type { StudioDocument } from '../src/core/types';
import { decodeWorkersProposal } from './ai-wire';
import { workersProposalSchema } from './ai-schema';
import { AIError } from '../server/ai/validation';
import { proposeWithProvider } from '../server/ai/shared';
import type { AIProvider, ProposeChangesInput } from '../server/ai/shared';

export { AIError, selectedOperations } from '../server/ai/validation';
export { buildAIContext } from '../server/ai/shared';
export interface EdgeAIEnv {
  AI?: Ai;
  AI_PROVIDER?: string;
  CF_AI_MODEL?: string;
}
export const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;
const MAX_BYTES = 300000;
const disclosure = 'Sends your request, layer names, properties, layout, bindings, interactions and design tokens to Cloudflare Workers AI. Ticket datasets and source code are excluded. Server configuration is excluded. Text entered in layers or your request is sent; do not include secrets. Proposals require your review and are never applied automatically. Free-plan inference has a daily quota and may be unavailable.';

export function aiStatus(env: EdgeAIEnv) {
  const available = env.AI_PROVIDER === 'workers-ai' && env.CF_AI_MODEL === WORKERS_AI_MODEL && !!env.AI;
  return { available, model: available ? WORKERS_AI_MODEL : null,
    provider: env.AI_PROVIDER === 'workers-ai' ? 'workers-ai' : 'disabled', disclosure,
    reason: available ? null : 'No reviewed free model is enabled. Editing and export remain available.' };
}

function configuredProvider(env: EdgeAIEnv, document: StudioDocument): AIProvider {
  if (!aiStatus(env).available || !env.AI) {
    throw new AIError('No reviewed free Workers AI provider is enabled. Editing and export remain available.', 'AI_UNAVAILABLE', 503);
  }
  const binding = env.AI;
  return { async generate({ input, instructions, signal }) {
    if (new TextEncoder().encode(input).byteLength > 24000) {
      throw new AIError('The free model context budget is exceeded. Use a smaller design; content was not truncated.', 'AI_CONTEXT_LIMIT');
    }
    const inputs: AiModels[typeof WORKERS_AI_MODEL]['inputs'] = {
      messages: [{ role: 'system', content: instructions.replace('Update patches REPLACE supplied maps, so include retained map properties.', 'For this provider update patches are PARTIAL maps: omitted properties are preserved by the server. Include only changed properties. To intentionally replace or clear an entire map, add replaceMaps containing the map names (props, layout, responsive, bindings, events) and provide the complete replacement map. Do not use replaceMaps for ordinary text, style or spacing edits.').replace('Strict schema requires null for absent optional map fields; null means omitted.', 'This provider supports optional map fields: omit absent optional fields instead of filling maps with nulls. Keep the response compact.') }, { role: 'user', content: input }],
      stream: false, max_tokens: 2048, temperature: 0, seed: 17,
      response_format: { type: 'json_schema', json_schema: workersProposalSchema },
    };
    // The shared DOM/Node and Workers declarations use different Event types;
    // this is the same AbortSignal supplied by workerd at the binding boundary.
    const options: AiOptions & { returnRawResponse: true } = { returnRawResponse: true, signal: signal as unknown as AiOptions['signal'] };
    const response = await binding.run(WORKERS_AI_MODEL, inputs, options);
    if (!response.ok) {
      await response.body?.cancel();
      throw new AIError('Free model inference is unavailable or its quota is reached. No changes were applied.', 'AI_PROVIDER_FAILURE', 503);
    }
    if (!response.body || Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body?.cancel();
      throw new AIError('The model response exceeds the size limit or has no body.', 'AI_OUTPUT_LIMIT', 502);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) throw new AIError('Invalid model transport.', 'AI_MALFORMED', 502);
      length += next.value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        throw new AIError('The model response exceeds the size limit.', 'AI_OUTPUT_LIMIT', 502);
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let wire: { response?: unknown; tool_calls?: unknown[]; finish_reason?: string };
    try { wire = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); }
    catch { throw new AIError('The free model returned malformed JSON. No changes were applied.', 'AI_MALFORMED', 502); }
    if (!wire || wire.finish_reason === 'length' || wire.tool_calls?.length || wire.response === undefined) {
      throw new AIError('The free model returned an incomplete response. No changes were applied.', 'AI_INCOMPLETE', 502);
    }
    let proposal: unknown = wire.response;
    if (typeof proposal === 'string') {
      try { proposal = JSON.parse(proposal); }
      catch { throw new AIError('The free model returned malformed structured output. No changes were applied.', 'AI_MALFORMED', 502); }
    }
    return decodeWorkersProposal(proposal, document);
  } };
}

export function proposeChanges(input: Omit<ProposeChangesInput, 'provider'>, env: EdgeAIEnv) {
  // DO routes must enforce their durable request reservations, role and revision checks too.
  const { prompt, signal, role } = input;
  const document = validateDocument(input.document);
  return proposeWithProvider({ document, prompt, signal, role }, () => configuredProvider(env, document));
}
