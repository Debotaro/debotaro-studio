import { applyOperations, summarizeChanges, validateDocument } from '../../src/core/document';
import type { AIProposal, Operation, ProposalGroup, Role, StudioDocument } from '../../src/core/types';

export const MAX_PROPOSAL_GROUPS = 12;
export class AIError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); this.name = 'AIError'; }
}
function reject(message: string, code = 'INVALID_PROPOSAL', status = 400): never { throw new AIError(message, code, status); }
export function requireEditor(role: Role): void {
  if (role !== 'owner' && role !== 'editor') reject('An editor or owner permission is required for AI changes.', 'AI_PERMISSION_DENIED', 403);
}
export function inspectProposalData(value: unknown, depth = 0, ancestors = new Set<object>(), budget = { count: 0 }): void {
  if (++budget.count > 40000 || depth > 32) reject('The proposal exceeds its complexity limit.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { if (value.length > 10000) reject('Proposal strings exceed the length limit.'); return; }
  if (typeof value === 'number') { if (!Number.isFinite(value)) reject('Proposal numbers must be finite.'); return; }
  if (!value || typeof value !== 'object') reject('Proposals must contain JSON values only.');
  if (ancestors.has(value)) reject('A proposal cannot contain circular data.');
  if (Object.getOwnPropertySymbols(value).length) reject('Symbol keys are not supported.');
  if (Array.isArray(value) ? Object.getPrototypeOf(value) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject('Proposals must contain plain JSON objects and arrays.');
  ancestors.add(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (['__proto__', 'prototype', 'constructor'].includes(key)) reject('Unsafe proposal key.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) reject('Proposal accessors and hidden properties are forbidden.');
    inspectProposalData(descriptor.value, depth + 1, ancestors, budget);
  }
  if (Array.isArray(value) && (value.length > 5000 || Object.keys(value).length !== value.length)) reject('Proposal arrays must be bounded and contain present values.');
  ancestors.delete(value);
}
function object(value: unknown, fields: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject(`${path} must be an object.`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(result, key))) reject(`${path} must contain exactly ${fields.join(', ')}.`);
  return result;
}
function shortString(value: unknown, path: string, max: number, identifier = false): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || identifier && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)) reject(`${path} is invalid or exceeds its length limit.`);
}
export function orderedGroups(groups: ProposalGroup[]): ProposalGroup[] {
  const map = new Map(groups.map(group => [group.id, group]));
  const active = new Set<string>(); const visited = new Set<string>(); const result: ProposalGroup[] = [];
  function visit(group: ProposalGroup): void {
    if (visited.has(group.id)) return;
    if (active.has(group.id)) reject(`Dependency cycle at group ${group.id}.`, 'INVALID_DEPENDENCIES');
    active.add(group.id);
    for (const dependency of group.dependsOn) {
      const prior = map.get(dependency);
      if (!prior) reject(`Group ${group.id} depends on missing group ${dependency}.`, 'INVALID_DEPENDENCIES');
      visit(prior);
    }
    active.delete(group.id); visited.add(group.id); result.push(group);
  }
  groups.forEach(visit);
  return result;
}
function dependencies(groupId: string, groups: ProposalGroup[], result = new Set<string>()): Set<string> {
  const group = groups.find(item => item.id === groupId)!;
  for (const prior of group.dependsOn) if (!result.has(prior)) { result.add(prior); dependencies(prior, groups, result); }
  return result;
}
function checkedOperations(operations: Operation[], document: StudioDocument): StudioDocument {
  try { return applyOperations(document, { id: 'ai-validation', projectId: document.id, baseRevision: document.revision, label: 'Validate AI proposal', operations }); }
  catch (error) { reject(`Proposal rejected: ${error instanceof Error ? error.message : 'invalid document operation'}`); }
}
function footprints(operations: Operation[], doc: StudioDocument): Set<string> {
  const result = new Set<string>();
  for (const op of operations) {
    if (op.type === 'update') Object.keys(op.patch).forEach(field => result.add(`node:${op.nodeId}:${field}`));
    if (op.type === 'insert') { result.add(`node:${op.node.id}:*`); result.add(`node:${op.parentId}:children`); }
    if (op.type === 'move') {
      result.add(`node:${op.nodeId}:placement`); result.add(`node:${op.parentId}:children`);
      const parent = Object.values(doc.nodes).find(node => node.children.includes(op.nodeId));
      if (parent) result.add(`node:${parent.id}:children`);
    }
    if (op.type === 'delete') {
      const visit = (nodeId: string): void => { result.add(`node:${nodeId}:*`); for (const child of doc.nodes[nodeId]?.children ?? []) visit(child); };
      visit(op.nodeId);
      const parent = Object.values(doc.nodes).find(node => node.children.includes(op.nodeId));
      if (parent) result.add(`node:${parent.id}:children`);
    }
    if (op.type === 'token') result.add(`token:${op.category}:${op.name}`);
    if (op.type === 'theme') result.add('theme');
  }
  return result;
}
function overlap(a: string, b: string): boolean { return a === b || a.endsWith(':*') && b.startsWith(a.slice(0, -1)) || b.endsWith(':*') && a.startsWith(b.slice(0, -1)); }
function rejectContradictions(group: ProposalGroup): void {
  const writes = new Map<string, string>();
  for (const op of group.operations) {
    const pairs: [string, unknown][] = op.type === 'update' ? Object.entries(op.patch).map(([field, value]) => [`node:${op.nodeId}:${field}`, value]) : op.type === 'token' ? [[`token:${op.category}:${op.name}`, op.value]] : op.type === 'theme' ? [['theme', op.theme]] : [];
    for (const [key, value] of pairs) {
      const serialized = JSON.stringify(value);
      if (writes.has(key) && writes.get(key) !== serialized) reject(`Group ${group.id} contains contradictory writes to ${key}.`, 'CONTRADICTORY_PROPOSAL');
      writes.set(key, serialized);
    }
  }
}

export function validateProposal(input: unknown, baseDocument: StudioDocument, role: Role): AIProposal {
  requireEditor(role);
  const doc = validateDocument(baseDocument);
  inspectProposalData(input);
  const proposal = object(input, ['projectId', 'baseRevision', 'summary', 'groups'], 'proposal');
  if (proposal.projectId !== doc.id) reject('The proposal targets an inaccessible project.', 'PROJECT_MISMATCH', 403);
  if (proposal.baseRevision !== doc.revision) reject('The proposal is stale. Request a new proposal against the current design.', 'STALE_PROPOSAL', 409);
  shortString(proposal.summary, 'proposal.summary', 800);
  if (!Array.isArray(proposal.groups) || proposal.groups.length < 1 || proposal.groups.length > MAX_PROPOSAL_GROUPS) reject(`Proposals require 1–${MAX_PROPOSAL_GROUPS} meaningful groups.`);
  const ids = new Set<string>(); let total = 0;
  for (const inputGroup of proposal.groups) {
    const group = object(inputGroup, ['id', 'title', 'operations', 'dependsOn'], 'proposal group');
    shortString(group.id, 'group.id', 80, true); shortString(group.title, 'group.title', 160);
    if (ids.has(group.id)) reject(`Duplicate group identity ${group.id}.`); ids.add(group.id);
    if (!Array.isArray(group.dependsOn) || group.dependsOn.length > MAX_PROPOSAL_GROUPS) reject('Invalid dependency list.');
    for (const dependency of group.dependsOn) shortString(dependency, 'dependency', 80, true);
    if (new Set(group.dependsOn).size !== group.dependsOn.length) reject('Duplicate group dependencies.');
    if (!Array.isArray(group.operations) || !group.operations.length || (total += group.operations.length) > 100) reject('AI proposals require 1–100 operations in total.');
    for (const operation of group.operations) {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation) || !['insert', 'update', 'move', 'delete', 'token', 'theme'].includes(operation.type)) reject('AI operation is outside the supported allowlist. Replacement and executable code are forbidden.', 'FORBIDDEN_OPERATION');
    }
  }
  const canonical = structuredClone(proposal) as unknown as AIProposal;
  canonical.groups = orderedGroups(canonical.groups);
  for (const group of canonical.groups) {
    // Validate exact operation schema before computing footprints or summaries.
    const closure = dependencies(group.id, canonical.groups); closure.add(group.id);
    const after = checkedOperations(canonical.groups.filter(item => closure.has(item.id)).flatMap(item => item.operations), doc);
    const prerequisiteOps = canonical.groups.filter(item => item.id !== group.id && closure.has(item.id)).flatMap(item => item.operations);
    const before = prerequisiteOps.length ? checkedOperations(prerequisiteOps, doc) : doc;
    if (!summarizeChanges(before, after).length) reject(`Group ${group.id} does not change the design.`, 'EMPTY_PROPOSAL');
    rejectContradictions(group);
  }
  for (let left = 0; left < canonical.groups.length; left++) for (let right = left + 1; right < canonical.groups.length; right++) {
    const a = canonical.groups[left]; const b = canonical.groups[right];
    const related = dependencies(a.id, canonical.groups).has(b.id) || dependencies(b.id, canonical.groups).has(a.id);
    if (!related && [...footprints(a.operations, doc)].some(key => [...footprints(b.operations, doc)].some(other => overlap(key, other)))) reject(`Groups ${a.id} and ${b.id} affect shared elements; declare an explicit dependency or combine them.`, 'CONFLICTING_GROUPS');
  }
  const operations = canonical.groups.flatMap(group => group.operations);
  const after = checkedOperations(operations, doc);
  if (!summarizeChanges(doc, after).length) reject('The proposal does not change the design.', 'EMPTY_PROPOSAL');
  return canonical;
}

export function selectedOperations(input: AIProposal, groupIds: string[], doc: StudioDocument, role: Role): Operation[] {
  const proposal = validateProposal(input, doc, role);
  if (!Array.isArray(groupIds) || !groupIds.length || groupIds.length > MAX_PROPOSAL_GROUPS || new Set(groupIds).size !== groupIds.length) reject('Choose at least one unique proposal group.', 'INVALID_SELECTION');
  const selected = new Set(groupIds);
  for (const groupId of selected) if (!proposal.groups.some(group => group.id === groupId)) reject(`Unknown proposal group ${String(groupId)}.`, 'INVALID_SELECTION');
  for (const group of proposal.groups) if (selected.has(group.id)) for (const dependency of group.dependsOn) if (!selected.has(dependency)) reject(`Keep dependency group ${dependency} selected for ${group.id}.`, 'MISSING_SELECTED_DEPENDENCY');
  const operations = proposal.groups.filter(group => selected.has(group.id)).flatMap(group => group.operations);
  checkedOperations(operations, doc);
  return structuredClone(operations);
}
