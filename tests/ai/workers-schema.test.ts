import { expect, it } from 'vitest';
import { workersProposalSchema } from '../../edge/ai-schema';
import { proposalResponseSchema } from '../../server/ai/schema';

it('compacts only optional nullable maps, retaining strict operation/project boundaries', () => {
  const before = JSON.stringify(proposalResponseSchema);
  const root = workersProposalSchema as { required: string[]; additionalProperties: boolean; properties: { groups: { items: { properties: { operations: { items: { anyOf: { properties: { type: { enum: string[] }; patch?: { required: string[]; properties: Record<string, unknown>; additionalProperties: boolean } }; required: string[] }[] } } } } } } };
  expect(root.required).toEqual(['projectId', 'baseRevision', 'summary', 'groups']);
  expect(root.additionalProperties).toBe(false);
  const operations = root.properties.groups.items.properties.operations.items.anyOf;
  const update = operations.find(item => item.properties.type.enum[0] === 'update')!;
  expect(update.required).toEqual(['type', 'nodeId', 'patch']);
  expect(update.properties.patch!.required).toEqual([]);
  expect(update.properties.patch!.additionalProperties).toBe(false);
  expect(update.properties.patch!.properties.name).toEqual({ type: 'string' });
  expect(JSON.stringify(proposalResponseSchema)).toBe(before);
  expect(operations.some(item => item.properties.type.enum.includes('replace'))).toBe(false);
});
