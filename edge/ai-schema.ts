import { proposalResponseSchema } from '../server/ai/schema';

type Schema = Record<string, unknown>;
const object = (value: unknown): value is Schema => !!value && typeof value === 'object' && !Array.isArray(value);
const nullable = (value: unknown): boolean => object(value) && Array.isArray(value.anyOf) && value.anyOf.some(item => object(item) && item.type === 'null');

/** Workers JSON mode supports actual optional map properties. OpenAI strict
 * required-null maps unnecessarily inflate small edits and can exhaust output.
 * Keep every operation/top-level requirement and additionalProperties:false.
 * Semantic validation remains identical and mandatory after decoding.
 */
function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact);
  if (!object(value)) return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compact(item)]));
  if (value.type === 'object' && object(value.properties) && Object.values(value.properties).every(nullable)) {
    result.required = [];
    result.properties = Object.fromEntries(Object.entries(value.properties).map(([key, item]) => {
      const choices = (item as Schema).anyOf as Schema[];
      const present = choices.filter(choice => choice.type !== 'null');
      return [key, compact(present.length === 1 ? present[0] : { anyOf: present })];
    }));
  }
  return result;
}
export const workersProposalSchema = compact(proposalResponseSchema) as Schema;
const root = workersProposalSchema.properties as Record<string, Schema>;
const group = root.groups.items as Schema;
const operations = ((group.properties as Record<string, Schema>).operations.items as Schema).anyOf as Schema[];
const update = operations.find(item => (item.properties as Record<string, Schema>).type.enum instanceof Array && ((item.properties as Record<string, Schema>).type.enum as string[])[0] === 'update')!;
// xgrammar rejects uniqueItems; the decoder enforces uniqueness and size itself.
(update.properties as Record<string, Schema>).replaceMaps = { type: 'array', items: { type: 'string', enum: ['props', 'layout', 'responsive', 'bindings', 'events'] }, maxItems: 5 };
