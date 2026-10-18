import OpenAI from 'openai';
import type { AIProposal } from '../../src/core/types';
import { decodeProposalWire, proposalResponseSchema } from './schema';
import { AIError } from './validation';
import { ollamaConfiguration, ollamaProvider } from './ollama';
import { AI_TIMEOUT_MS, proposeWithProvider } from './shared';
import type { AIProvider, ProposeChangesInput } from './shared';

export { AIError, validateProposal, selectedOperations } from './validation';
export { proposalResponseSchema } from './schema';
export { AI_TIMEOUT_MS, buildAIContext } from './shared';
export type { AIProvider, AIProviderRequest, ProposeChangesInput } from './shared';
export const AI_DISCLOSURE = 'Sends your request, layer names, properties, layout, bindings, interactions and design tokens to OpenAI. Ticket datasets and source code are excluded. Server configuration is excluded. Text entered in layers or your request is sent; do not include secrets. Proposals require your review and are never applied automatically.';

export function aiStatus(): { available: boolean; model: string | null; provider: 'openai' | 'ollama' | 'disabled'; disclosure: string; reason: string | null } {
  if (process.env.AI_PROVIDER === 'ollama') {
    const disclosure = AI_DISCLOSURE.replace('to OpenAI', 'to the configured private Ollama server');
    try {
      const config = ollamaConfiguration();
      return { available: true, model: config.model, provider: 'ollama', disclosure, reason: null };
    } catch {
      return { available: false, model: null, provider: 'ollama', disclosure,
        reason: 'Configure a reviewed OLLAMA_MODEL and a private OLLAMA_BASE_URL. Editing and export remain available.' };
    }
  }
  if (process.env.AI_PROVIDER && process.env.AI_PROVIDER !== 'openai') {
    return { available: false, model: null, provider: 'disabled', disclosure: 'Live model inference is disabled. Editing and export remain available.',
      reason: 'No live model provider is enabled. Editing and export remain available.' };
  }
  const model = process.env.OPENAI_MODEL?.trim() || null;
  const supported = !process.env.AI_PROVIDER || process.env.AI_PROVIDER === 'openai';
  const available = Boolean(supported && process.env.OPENAI_API_KEY?.trim() && model);
  return { available, model, provider: 'openai', disclosure: AI_DISCLOSURE, reason: available ? null : 'Live AI needs server OPENAI_API_KEY and an explicit OPENAI_MODEL. The editor and export work without them.' };
}
function configuredProvider(): AIProvider {
  if (process.env.AI_PROVIDER === 'ollama') return ollamaProvider();
  if (process.env.AI_PROVIDER && process.env.AI_PROVIDER !== 'openai') throw new AIError('No supported model provider is configured.', 'AI_UNAVAILABLE', 503);
  const key = process.env.OPENAI_API_KEY?.trim(); const model = process.env.OPENAI_MODEL?.trim();
  if (!key || !model) throw new AIError('Live AI is unavailable. Configure server OPENAI_API_KEY and OPENAI_MODEL; no application API key is supplied by your ChatGPT model selection.', 'AI_UNAVAILABLE', 503);
  const client = new OpenAI({ apiKey: key, maxRetries: 0, timeout: AI_TIMEOUT_MS });
  return { async generate({ input, instructions: system, signal }) {
    const result = await client.responses.create({ model, input, instructions: system, store: false, tools: [], tool_choice: 'none', max_output_tokens: 12000, text: { format: { type: 'json_schema', name: 'studio_operation_proposal', strict: true, schema: proposalResponseSchema } } }, { signal, maxRetries: 0, timeout: AI_TIMEOUT_MS });
    if (result.status !== 'completed' || !result.output_text) throw new AIError('The provider returned an incomplete response or refusal. No changes were applied.', 'AI_INCOMPLETE', 502);
    if (Buffer.byteLength(result.output_text, 'utf8') > 300000) throw new AIError('The model response exceeds the proposal size limit.', 'AI_OUTPUT_LIMIT', 502);
    let parsed: unknown;
    try { parsed = JSON.parse(result.output_text); } catch { throw new AIError('The provider returned malformed structured output. No changes were applied.', 'AI_MALFORMED', 502); }
    return decodeProposalWire(parsed);
  } };
}

export function proposeChanges(input: ProposeChangesInput): Promise<AIProposal> {
  return proposeWithProvider(input, configuredProvider);
}
