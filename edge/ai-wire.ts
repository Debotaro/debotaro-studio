import { decodeProposalWire } from '../server/ai/schema';
import { AIError, inspectProposalData, orderedGroups } from '../server/ai/validation';
import type { ProposalGroup, StudioDocument } from '../src/core/types';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);
const maps = ['props', 'layout', 'responsive', 'bindings', 'events'];

/** Provider wire uses partial maps. Canonical editor operations still replace
 * complete maps. Expand against the supplied snapshot in dependency order;
 * explicit replaceMaps retains intentional replacement/clearing capability.
 * The complete canonical proposal MUST then pass the shared validator.
 */
export function decodeWorkersProposal(input: unknown, document: StudioDocument): unknown {
  inspectProposalData(input); // Never normalize away unsafe keys/accessors first.
  const decoded = decodeProposalWire(input);
  if (!object(decoded) || decoded.projectId !== document.id || decoded.baseRevision !== document.revision || !Array.isArray(decoded.groups) || decoded.groups.length > 12) return decoded;
  let total = 0;
  const ids = new Set<string>();
  for (const group of decoded.groups) {
    if (!object(group) || typeof group.id !== 'string' || ids.has(group.id) || !Array.isArray(group.dependsOn) || group.dependsOn.length > 12 || !group.dependsOn.every(id => typeof id === 'string') || !Array.isArray(group.operations) || (total += group.operations.length) > 100) return decoded;
    ids.add(group.id);
  }
  const ordered = orderedGroups(decoded.groups as ProposalGroup[]);
  const nodes: Record<string, JsonObject> = Object.assign(Object.create(null), structuredClone(document.nodes));
  const groups = ordered.map(group => ({ ...group, operations: group.operations.map(raw => {
    const op = raw as unknown as JsonObject;
    if (!object(op)) return raw;
    if (op.type === 'insert' && object(op.node) && typeof op.node.id === 'string') nodes[op.node.id] = structuredClone(op.node);
    if (op.type === 'delete' && typeof op.nodeId === 'string') delete nodes[op.nodeId];
    if (op.type !== 'update') return raw;
    const replacement = op.replaceMaps;
    if (replacement !== undefined && (!Array.isArray(replacement) || replacement.length > 5 || new Set(replacement).size !== replacement.length || !replacement.every(field => typeof field === 'string' && maps.includes(field)))) throw new AIError('Invalid AI map replacement declaration.', 'INVALID_PROPOSAL');
    const canonical = { ...op };
    delete canonical.replaceMaps;
    if (typeof op.nodeId !== 'string' || !Object.hasOwn(nodes, op.nodeId) || !object(op.patch)) return canonical;
    const node = nodes[op.nodeId], patch = { ...op.patch };
    for (const field of maps) {
      const delta = patch[field];
      if (!object(delta) || (replacement as string[] | undefined)?.includes(field)) continue;
      const prior = object(node[field]) ? node[field] as JsonObject : {};
      const merged = { ...prior, ...delta };
      if (field === 'responsive') {
        for (const breakpoint of ['desktop', 'tablet', 'phone']) if (object(delta[breakpoint])) merged[breakpoint] = { ...(object(prior[breakpoint]) ? prior[breakpoint] : {}), ...delta[breakpoint] };
      }
      patch[field] = merged;
    }
    nodes[op.nodeId] = { ...node, ...patch };
    return { ...canonical, patch };
  }) }));
  return { ...decoded, groups };
}
