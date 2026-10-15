import { componentTypes } from './types';
import type { BindingPath, ChangeSummary, ComponentType, DesignTokens, Diagnostic, JsonValue, OperationEnvelope, RuntimeAction, StudioDocument, StudioNode } from './types';
import { resolveNumericToken, resolveToken } from './tokens';

type EventName = 'onClick' | 'onChange' | 'onSubmit';
export interface PropRule {
  kind: 'string' | 'color' | 'number' | 'boolean' | 'enum' | 'options' | 'columns';
  values?: readonly string[];
  min?: number;
  max?: number;
}
export interface CatalogEntry {
  props: Record<string, PropRule>;
  defaults: Record<string, JsonValue>;
  children: boolean;
  bindings: Record<string, readonly BindingPath[]>;
  events: Partial<Record<EventName, readonly RuntimeAction[]>>;
}
const string: PropRule = { kind: 'string' };
const color: PropRule = { kind: 'color' };
const boolean: PropRule = { kind: 'boolean' };
const options: PropRule = { kind: 'options' };
const common = { ariaLabel: string, hidden: boolean, visibleWhen: { kind: 'enum', values: ['always', 'hasSelection', 'hasResults', 'empty', 'loading', 'error', 'ready', 'tab:inbox', 'tab:activity', 'tab:customer'] } satisfies PropRule };
const textualBindings: readonly BindingPath[] = ['query', 'status', 'assignee', 'selectedTicketId', 'selectedTicket.subject', 'selectedTicket.customer', 'selectedTicket.email', 'selectedTicket.status', 'selectedTicket.assignee', 'tab'];

export const catalog: Record<ComponentType, CatalogEntry> = {
  Frame: { props: { ...common, background: color, border: color, radius: { kind: 'number', min: 0, max: 200 }, shadow: { kind: 'enum', values: ['none', 'soft', 'raised'] } }, defaults: { background: '$semantic.surface', radius: 0, shadow: 'none' }, children: true, bindings: {}, events: {} },
  Text: { props: { ...common, text: string, color, size: { kind: 'number', min: 8, max: 96 }, weight: { kind: 'number', min: 100, max: 900 }, variant: { kind: 'enum', values: ['title', 'body', 'caption', 'eyebrow'] } }, defaults: { text: 'Text', color: '$semantic.text', size: 14, weight: 400, variant: 'body' }, children: false, bindings: { text: textualBindings }, events: {} },
  Button: { props: { ...common, label: string, variant: { kind: 'enum', values: ['primary', 'secondary', 'ghost', 'danger'] }, disabled: boolean }, defaults: { label: 'Button', variant: 'primary', disabled: false }, children: false, bindings: {}, events: { onClick: ['reloadTickets', 'setTab', 'setTicketStatus', 'assignTicket'] } },
  Field: { props: { ...common, label: string, placeholder: string, type: { kind: 'enum', values: ['text', 'search', 'email'] }, required: boolean, disabled: boolean }, defaults: { label: 'Field', placeholder: '', type: 'text', required: false, disabled: false }, children: false, bindings: { value: ['query', 'selectedTicket.subject', 'selectedTicket.customer', 'selectedTicket.email'] }, events: { onChange: ['setQuery'], onSubmit: ['reloadTickets'] } },
  Select: { props: { ...common, label: string, options, disabled: boolean }, defaults: { label: 'Select', options: [], disabled: false }, children: false, bindings: { value: ['status', 'assignee', 'selectedTicket.status', 'selectedTicket.assignee'] }, events: { onChange: ['setStatus', 'setAssigneeFilter', 'assignTicket', 'setTicketStatus'] } },
  Tabs: { props: { ...common, label: string, options }, defaults: { label: 'Views', options: [{ label: 'Inbox', value: 'inbox' }, { label: 'Activity', value: 'activity' }] }, children: false, bindings: { value: ['tab'] }, events: { onChange: ['setTab'] } },
  Badge: { props: { ...common, label: string, color, tone: { kind: 'enum', values: ['neutral', 'accent', 'success', 'warning', 'danger'] } }, defaults: { label: 'Badge', tone: 'neutral' }, children: false, bindings: { text: textualBindings, label: textualBindings }, events: {} },
  Table: { props: { ...common, label: string, columns: { kind: 'columns', values: ['id', 'subject', 'customer', 'status', 'priority', 'assignee', 'updatedAt'] }, emptyMessage: string }, defaults: { label: 'Tickets', columns: ['subject', 'customer', 'status', 'assignee'], emptyMessage: 'No tickets match your filters.' }, children: false, bindings: { value: ['selectedTicketId'] }, events: { onClick: ['selectTicket'] } },
  DetailPanel: { props: { ...common, title: string, subtitle: string, background: color, radius: { kind: 'number', min: 0, max: 200 } }, defaults: { title: 'Ticket details', subtitle: 'Select a ticket to inspect its details.', background: '$semantic.surface', radius: 12 }, children: true, bindings: {}, events: {} },
};
export const componentCatalog = catalog;

export class DocumentValidationError extends Error {
  readonly diagnostics: Diagnostic[];
  constructor(message: string, code = 'INVALID_DOCUMENT', nodeId?: string) {
    super(message);
    this.name = 'DocumentValidationError';
    this.diagnostics = [{ code, severity: 'error', message, ...(nodeId ? { nodeId } : {}) }];
  }
}
function fail(message: string, code = 'INVALID_DOCUMENT', nodeId?: string): never { throw new DocumentValidationError(message, code, nodeId); }
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object.`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], path: string, required: readonly string[] = []): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key} is not supported.`, 'UNKNOWN_PROPERTY');
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key} is required.`);
}
function text(value: unknown, path: string, maximum = 10000, minimum = 0): asserts value is string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) fail(`${path} must be a string of ${minimum}–${maximum} characters.`);
}
function number(value: unknown, path: string, min: number, max: number, integer = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(`${path} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}.`);
}
function numericValue(value: unknown, path: string, tokens: DesignTokens, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' && typeof value !== 'string') fail(`${path} must be a number or numeric token reference.`);
  let resolved: number;
  try { resolved = resolveNumericToken(tokens, value); } catch (error) { fail(`${path}: ${(error as Error).message}`, 'INVALID_TOKEN'); }
  number(resolved, path, min, max, integer);
  return resolved;
}
function id(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)) fail(`${path} must be a stable identifier with 1–80 letters, numbers, underscores or hyphens.`, 'INVALID_ID');
}
function oneOf(value: unknown, allowed: readonly unknown[], path: string): void { if (!allowed.includes(value)) fail(`${path} must be one of ${allowed.join(', ')}.`); }

/** Bound and inspect unknown input before reading schema fields, including own accessors. */
function inspectJson(input: unknown): void {
  const ancestors = new Set<object>();
  let count = 0;
  function visit(value: unknown, path: string, depth: number): void {
    if (++count > 160000 || depth > 32) fail(`${path} exceeds the document complexity limit.`, 'LIMIT_EXCEEDED');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') { text(value, path); return; }
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail(`${path} must contain finite JSON numbers.`); return; }
    if (!value || typeof value !== 'object') fail(`${path} contains a non-JSON value.`);
    if (ancestors.has(value)) fail(`${path} contains a cyclic object.`, 'INVALID_JSON');
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) fail(`${path} must contain plain JSON objects.`, 'INVALID_JSON');
    if (Object.getOwnPropertySymbols(value).length) fail(`${path} must not contain symbol keys.`, 'INVALID_JSON');
    ancestors.add(value);
    if (Array.isArray(value)) {
      if (value.length > 5000) fail(`${path} exceeds the 5,000-item array limit.`, 'LIMIT_EXCEEDED');
      if (Object.getOwnPropertyNames(value).some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))) fail(`${path} contains unsupported array properties.`, 'INVALID_JSON');
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor)) fail(`${path}[${index}] must be a present JSON value without accessors.`, 'INVALID_JSON');
        visit(descriptor.value, `${path}[${index}]`, depth + 1);
      }
    } else {
      for (const key of Object.getOwnPropertyNames(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(`${path}.${key} is a forbidden key.`, 'UNSAFE_KEY');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail(`${path}.${key} must be an enumerable JSON value, not an accessor.`, 'INVALID_JSON');
        visit(descriptor.value, `${path}.${key}`, depth + 1);
      }
    }
    ancestors.delete(value);
  }
  visit(input, 'input', 0);
}
function validColor(value: unknown, path: string, tokens: DesignTokens): void {
  if (typeof value !== 'string') fail(`${path} must be a color or color token.`, 'INVALID_TOKEN');
  let resolved: string | number;
  try { resolved = resolveToken(tokens, value); } catch (error) { fail(`${path}: ${(error as Error).message}`, 'INVALID_TOKEN'); }
  if (typeof resolved !== 'string' || !isSupportedColor(resolved)) fail(`${path} must resolve to a supported CSS color.`, 'INVALID_COLOR');
}
function isSupportedColor(value: string): boolean {
  if (/^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|transparent|currentColor|black|white)$/i.test(value)) return true;
  const rgb = /^(rgb|rgba)\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?))?\s*\)$/i.exec(value);
  if (rgb) return [rgb[2], rgb[3], rgb[4]].every(channel => Number(channel) <= 255) && (rgb[1].toLowerCase() === 'rgba') === (rgb[5] !== undefined);
  const hsl = /^(hsl|hsla)\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(\d{1,3}(?:\.\d+)?)%\s*,\s*(\d{1,3}(?:\.\d+)?)%(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?))?\s*\)$/i.exec(value);
  return !!hsl && Number(hsl[3]) <= 100 && Number(hsl[4]) <= 100 && (hsl[1].toLowerCase() === 'hsla') === (hsl[5] !== undefined);
}
function validateTokens(input: unknown): DesignTokens {
  const value = record(input, 'tokens');
  keys(value, ['primitive', 'semantic'], 'tokens', ['primitive', 'semantic']);
  for (const category of ['primitive', 'semantic'] as const) {
    const map = record(value[category], `tokens.${category}`);
    if (Object.keys(map).length > 256) fail(`tokens.${category} exceeds 256 tokens.`, 'LIMIT_EXCEEDED');
    for (const [name, token] of Object.entries(map)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) fail(`Invalid token name ${category}.${name}.`, 'INVALID_TOKEN');
      if (typeof token === 'number') number(token, `tokens.${category}.${name}`, -10000, 10000);
      else text(token, `tokens.${category}.${name}`, 256, 1);
    }
  }
  const tokens = value as unknown as DesignTokens;
  for (const category of ['primitive', 'semantic'] as const) for (const [name, token] of Object.entries(tokens[category])) {
    try { resolveToken(tokens, token); } catch (error) { fail(`tokens.${category}.${name}: ${(error as Error).message}`, 'INVALID_TOKEN'); }
  }
  return tokens;
}
function validateLayout(input: unknown, path: string, tokens: DesignTokens): void {
  const layout = record(input, path);
  keys(layout, ['display', 'direction', 'gap', 'padding', 'columns', 'width', 'height', 'align', 'justify', 'grow'], path);
  if ('display' in layout) oneOf(layout.display, ['flex', 'grid'], `${path}.display`);
  if ('direction' in layout) oneOf(layout.direction, ['row', 'column'], `${path}.direction`);
  if ('gap' in layout) numericValue(layout.gap, `${path}.gap`, tokens, 0, 512);
  if ('padding' in layout) numericValue(layout.padding, `${path}.padding`, tokens, 0, 512);
  if ('columns' in layout) numericValue(layout.columns, `${path}.columns`, tokens, 1, 12, true);
  if ('width' in layout && layout.width !== 'fill') numericValue(layout.width, `${path}.width`, tokens, 1, 10000);
  if ('height' in layout && layout.height !== 'auto') numericValue(layout.height, `${path}.height`, tokens, 1, 10000);
  if ('align' in layout) oneOf(layout.align, ['start', 'center', 'end', 'stretch'], `${path}.align`);
  if ('justify' in layout) oneOf(layout.justify, ['start', 'center', 'end', 'between'], `${path}.justify`);
  if ('grow' in layout) numericValue(layout.grow, `${path}.grow`, tokens, 0, 20);
}
function validateNode(input: unknown, tokens: DesignTokens): StudioNode {
  const node = record(input, 'node');
  keys(node, ['id', 'type', 'name', 'children', 'props', 'layout', 'responsive', 'bindings', 'events'], 'node', ['id', 'type', 'name', 'children', 'props', 'layout', 'responsive', 'bindings', 'events']);
  id(node.id, 'node.id');
  try {
    oneOf(node.type, componentTypes, `node ${node.id}.type`);
    text(node.name, `node ${node.id}.name`, 120, 1);
    const entry = catalog[node.type as ComponentType];
    if (!Array.isArray(node.children)) fail(`Node ${node.id}.children must be an ordered ID array.`);
    if (!entry.children && node.children.length) fail(`${node.type} node ${node.id} cannot contain children.`, 'INVALID_PARENT');
    for (const child of node.children) id(child, `node ${node.id}.children`);
    if (new Set(node.children).size !== node.children.length) fail(`Node ${node.id} contains duplicate child identities.`, 'DUPLICATE_CHILD');
    const props = record(node.props, `node ${node.id}.props`);
    keys(props, Object.keys(entry.props), `node ${node.id}.props`);
    for (const [key, value] of Object.entries(props)) {
      const rule = entry.props[key];
      const path = `node ${node.id}.props.${key}`;
      if (rule.kind === 'string') text(value, path, 4000);
      if (rule.kind === 'boolean' && typeof value !== 'boolean') fail(`${path} must be a boolean.`);
      if (rule.kind === 'color') validColor(value, path, tokens);
      if (rule.kind === 'enum') oneOf(value, rule.values ?? [], path);
      if (rule.kind === 'number') {
        const resolved = numericValue(value, path, tokens, rule.min ?? 0, rule.max ?? 10000);
        if (key === 'weight' && resolved % 100 !== 0) fail(`${path} must be a multiple of 100.`);
      }
      if (rule.kind === 'options') {
        if (!Array.isArray(value) || value.length > 100) fail(`${path} must be an array of at most 100 options.`);
        const values = new Set<string>();
        for (const option of value) {
          const item = record(option, path);
          keys(item, ['label', 'value'], path, ['label', 'value']);
          text(item.label, `${path}.label`, 120, 1); text(item.value, `${path}.value`, 120);
          if (values.has(item.value)) fail(`${path} contains duplicate option value "${item.value}".`);
          values.add(item.value);
        }
      }
      if (rule.kind === 'columns') {
        if (!Array.isArray(value) || !value.length || value.length > 7) fail(`${path} must contain 1–7 table column names.`);
        for (const column of value) oneOf(column, rule.values ?? [], path);
        if (new Set(value).size !== value.length) fail(`${path} contains duplicate columns.`);
      }
    }
    validateLayout(node.layout, `node ${node.id}.layout`, tokens);
    const responsive = record(node.responsive, `node ${node.id}.responsive`);
    keys(responsive, ['desktop', 'tablet', 'phone'], `node ${node.id}.responsive`);
    for (const [breakpoint, layout] of Object.entries(responsive)) validateLayout(layout, `node ${node.id}.responsive.${breakpoint}`, tokens);
    const bindings = record(node.bindings, `node ${node.id}.bindings`);
    keys(bindings, Object.keys(entry.bindings), `node ${node.id}.bindings`);
    for (const [key, value] of Object.entries(bindings)) oneOf(value, entry.bindings[key], `node ${node.id}.bindings.${key}`);
    const events = record(node.events, `node ${node.id}.events`);
    keys(events, Object.keys(entry.events), `node ${node.id}.events`);
    for (const [event, input] of Object.entries(events)) {
      const interaction = record(input, `node ${node.id}.events.${event}`);
      keys(interaction, ['action', 'value'], `node ${node.id}.events.${event}`, ['action']);
      oneOf(interaction.action, entry.events[event as EventName] ?? [], `node ${node.id}.events.${event}.action`);
      if ('value' in interaction) text(interaction.value, `node ${node.id}.events.${event}.value`, 120);
      if (node.type === 'Button' && interaction.action !== 'reloadTickets' && !Object.hasOwn(interaction, 'value')) fail(`Button ${node.id} action ${interaction.action} requires a literal value.`, 'INVALID_INTERACTION');
    }
    const action = (events.onChange as Record<string, unknown> | undefined)?.action;
    const expected = node.type === 'Field' ? { query: 'setQuery' } : node.type === 'Select' ? { status: 'setStatus', assignee: 'setAssigneeFilter', 'selectedTicket.status': 'setTicketStatus', 'selectedTicket.assignee': 'assignTicket' } : node.type === 'Tabs' ? { tab: 'setTab' } : null;
    if (action && expected && expected[bindings.value as keyof typeof expected] !== action) fail(`Node ${node.id} onChange action ${action} does not match its value binding ${String(bindings.value)}.`, 'INVALID_INTERACTION');
    return node as unknown as StudioNode;
  } catch (error) {
    if (error instanceof DocumentValidationError && !error.diagnostics[0]?.nodeId) error.diagnostics[0].nodeId = node.id;
    throw error;
  }
}

export function validateDocument(input: unknown): StudioDocument {
  inspectJson(input);
  const doc = record(input, 'document');
  const fields = ['schemaVersion', 'id', 'name', 'revision', 'rootId', 'nodes', 'tokens', 'theme', 'data', 'initialState'];
  keys(doc, fields, 'document', fields);
  if (doc.schemaVersion !== 1) fail(`Unsupported schema version ${String(doc.schemaVersion)}. Use an explicit supported migration.`, 'INCOMPATIBLE_SCHEMA');
  id(doc.id, 'document.id'); text(doc.name, 'document.name', 120, 1);
  number(doc.revision, 'document.revision', 0, Number.MAX_SAFE_INTEGER - 1, true);
  id(doc.rootId, 'document.rootId'); oneOf(doc.theme, ['light', 'dark'], 'document.theme');
  const tokens = validateTokens(doc.tokens);
  const nodes = record(doc.nodes, 'document.nodes');
  if (!Object.keys(nodes).length || Object.keys(nodes).length > 2000) fail('A document must have 1–2,000 nodes.', 'LIMIT_EXCEEDED');
  for (const [key, inputNode] of Object.entries(nodes)) {
    const node = validateNode(inputNode, tokens);
    if (key !== node.id) fail(`Node key ${key} does not match stable identity ${node.id}.`, 'IDENTITY_MISMATCH', node.id);
  }
  const typedNodes = nodes as unknown as Record<string, StudioNode>;
  if (!Object.hasOwn(nodes, doc.rootId)) fail(`Root node ${doc.rootId} does not exist.`, 'MISSING_ROOT');
  if (typedNodes[doc.rootId].type !== 'Frame') fail('The document root must be a Frame.', 'INVALID_ROOT', doc.rootId);
  const parents = new Map<string, string>();
  for (const node of Object.values(typedNodes)) for (const child of node.children) {
    if (!Object.hasOwn(nodes, child)) fail(`Node ${node.id} references missing child ${child}.`, 'MISSING_CHILD', node.id);
    if (child === doc.rootId) fail('The root cannot have a parent.', 'TREE_CYCLE', node.id);
    if (parents.has(child)) fail(`Node ${child} has more than one parent.`, 'MULTIPLE_PARENTS', child);
    parents.set(child, node.id);
  }
  const reached = new Set<string>();
  const active = new Set<string>();
  function walk(nodeId: string, depth: number): void {
    if (active.has(nodeId)) fail(`Tree cycle at ${nodeId}.`, 'TREE_CYCLE', nodeId);
    if (depth > 64) fail('The tree exceeds 64 levels of nesting.', 'LIMIT_EXCEEDED', nodeId);
    active.add(nodeId); reached.add(nodeId);
    for (const child of typedNodes[nodeId].children) walk(child, depth + 1);
    active.delete(nodeId);
  }
  walk(doc.rootId, 0);
  for (const nodeId of Object.keys(nodes)) if (!reached.has(nodeId)) fail(`Node ${nodeId} is unreachable from the root (or part of a disconnected cycle).`, 'ORPHAN_NODE', nodeId);
  const data = record(doc.data, 'document.data'); keys(data, ['tickets'], 'document.data', ['tickets']);
  if (!Array.isArray(data.tickets) || data.tickets.length > 1000) fail('document.data.tickets must be an array of at most 1,000 fictional tickets.', 'LIMIT_EXCEEDED');
  const ticketIds = new Set<string>();
  for (const [index, inputTicket] of data.tickets.entries()) {
    const ticket = record(inputTicket, `ticket ${index}`);
    const fields = ['id', 'subject', 'customer', 'email', 'status', 'priority', 'assignee', 'message', 'company', 'updatedAt'];
    keys(ticket, fields, `ticket ${index}`, fields);
    id(ticket.id, `ticket ${index}.id`);
    if (ticketIds.has(ticket.id)) fail(`Duplicate ticket identity ${ticket.id}.`, 'DUPLICATE_TICKET');
    ticketIds.add(ticket.id);
    for (const field of ['subject', 'customer', 'email', 'assignee', 'company']) text(ticket[field], `ticket ${index}.${field}`, 240, field === 'assignee' ? 0 : 1);
    text(ticket.message, `ticket ${index}.message`, 4000, 1);
    text(ticket.updatedAt, `ticket ${index}.updatedAt`, 64, 1);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(ticket.updatedAt) || !Number.isFinite(Date.parse(ticket.updatedAt))) fail(`ticket ${index}.updatedAt must be an ISO UTC timestamp.`);
    oneOf(ticket.status, ['open', 'pending', 'resolved'], `ticket ${index}.status`);
    oneOf(ticket.priority, ['low', 'normal', 'high'], `ticket ${index}.priority`);
  }
  const initial = record(doc.initialState, 'document.initialState');
  keys(initial, ['query', 'status', 'assignee', 'selectedTicketId', 'tab'], 'document.initialState', ['query', 'status', 'assignee', 'selectedTicketId', 'tab']);
  text(initial.query, 'initialState.query', 240); oneOf(initial.status, ['', 'all', 'open', 'pending', 'resolved'], 'initialState.status');
  text(initial.assignee, 'initialState.assignee', 240); text(initial.tab, 'initialState.tab', 120, 1);
  if (initial.selectedTicketId !== null) {
    id(initial.selectedTicketId, 'initialState.selectedTicketId');
    if (!ticketIds.has(initial.selectedTicketId)) fail(`Initial ticket ${initial.selectedTicketId} does not exist.`, 'INVALID_BINDING');
  }
  return structuredClone(doc) as unknown as StudioDocument;
}

/** Explicit legacy v0 migration; unknown versions are never silently coerced. */
export function migrateDocument(input: unknown): StudioDocument {
  inspectJson(input);
  const source = record(input, 'document');
  if (source.schemaVersion === 1) return validateDocument(source);
  if (source.schemaVersion !== 0) fail(`No migration exists for schema version ${String(source.schemaVersion)}.`, 'INCOMPATIBLE_SCHEMA');
  const migrated = structuredClone(source);
  migrated.schemaVersion = 1;
  migrated.revision ??= 0; migrated.theme ??= 'light';
  migrated.initialState ??= { query: '', status: 'all', assignee: 'all', selectedTicketId: null, tab: 'inbox' };
  const nodes = record(migrated.nodes, 'document.nodes');
  for (const [nodeId, inputNode] of Object.entries(nodes)) {
    const node = record(inputNode, `node ${nodeId}`);
    node.responsive ??= {}; node.bindings ??= {}; node.events ??= {};
  }
  return validateDocument(migrated);
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sorted(item)]));
  return value;
}
export function serializeDocument(doc: StudioDocument): string { return JSON.stringify(sorted(validateDocument(doc)), null, 2); }
export function createNode(type: ComponentType, nodeId = `node-${globalThis.crypto.randomUUID()}`): StudioNode {
  oneOf(type, componentTypes, 'component type'); id(nodeId, 'node.id');
  return { id: nodeId, type, name: type, children: [], props: structuredClone(catalog[type].defaults), layout: {}, responsive: {}, bindings: {}, events: {} };
}
export function getParentId(doc: StudioDocument, nodeId: string): string | null {
  return Object.values(doc.nodes).find(node => node.children.includes(nodeId))?.id ?? null;
}
function requiredNode(doc: StudioDocument, nodeId: unknown): StudioNode {
  id(nodeId, 'operation.nodeId');
  if (!Object.hasOwn(doc.nodes, nodeId)) fail(`Node ${nodeId} no longer exists.`, 'MISSING_NODE', nodeId);
  return doc.nodes[nodeId];
}
function parentNode(doc: StudioDocument, parentId: unknown): StudioNode {
  const parent = requiredNode(doc, parentId);
  if (!catalog[parent.type].children) fail(`${parent.type} node ${parent.id} cannot contain children.`, 'INVALID_PARENT', parent.id);
  return parent;
}

export function applyOperations(document: StudioDocument, input: OperationEnvelope): StudioDocument {
  const before = validateDocument(document);
  inspectJson(input);
  const envelope = record(input, 'operation envelope');
  keys(envelope, ['id', 'projectId', 'baseRevision', 'label', 'operations'], 'operation envelope', ['id', 'projectId', 'baseRevision', 'label', 'operations']);
  id(envelope.id, 'envelope.id'); id(envelope.projectId, 'envelope.projectId'); text(envelope.label, 'envelope.label', 240, 1);
  number(envelope.baseRevision, 'envelope.baseRevision', 0, Number.MAX_SAFE_INTEGER - 1, true);
  if (envelope.projectId !== before.id) fail('The operation targets a different project.', 'PROJECT_MISMATCH');
  if (envelope.baseRevision !== before.revision) fail(`Stale revision ${envelope.baseRevision}; current revision is ${before.revision}. Review concurrent changes before applying.`, 'STALE_REVISION');
  if (!Array.isArray(envelope.operations) || envelope.operations.length < 1 || envelope.operations.length > 100) fail('Transactions require 1–100 operations.', 'LIMIT_EXCEEDED');
  let doc = structuredClone(before);
  for (const [index, inputOperation] of envelope.operations.entries()) {
    const op = record(inputOperation, `operation ${index}`);
    switch (op.type) {
      case 'insert': {
        keys(op, ['type', 'parentId', 'index', 'node'], `operation ${index}`, ['type', 'parentId', 'index', 'node']);
        const parent = parentNode(doc, op.parentId);
        const node = validateNode(op.node, doc.tokens);
        if (Object.hasOwn(doc.nodes, node.id)) fail(`Node ${node.id} already exists.`, 'DUPLICATE_ID', node.id);
        if (node.children.length) fail('Insert one fresh node without children; insert its descendants in the same transaction.', 'INVALID_INSERT', node.id);
        number(op.index, 'insert.index', 0, parent.children.length, true);
        doc.nodes[node.id] = structuredClone(node); parent.children.splice(op.index, 0, node.id);
        break;
      }
      case 'update': {
        keys(op, ['type', 'nodeId', 'patch'], `operation ${index}`, ['type', 'nodeId', 'patch']);
        const node = requiredNode(doc, op.nodeId);
        const patch = record(op.patch, 'update.patch');
        keys(patch, ['name', 'props', 'layout', 'responsive', 'bindings', 'events'], 'update.patch');
        if (!Object.keys(patch).length) fail('An update patch cannot be empty.', 'EMPTY_PATCH', node.id);
        Object.assign(node, structuredClone(patch));
        break;
      }
      case 'move': {
        keys(op, ['type', 'nodeId', 'parentId', 'index'], `operation ${index}`, ['type', 'nodeId', 'parentId', 'index']);
        const node = requiredNode(doc, op.nodeId); const parent = parentNode(doc, op.parentId);
        if (node.id === doc.rootId) fail('The root cannot be moved.', 'INVALID_ROOT', node.id);
        let ancestor: string | null = parent.id;
        while (ancestor) { if (ancestor === node.id) fail('A node cannot be moved into its own subtree.', 'TREE_CYCLE', node.id); ancestor = getParentId(doc, ancestor); }
        const oldParentId = getParentId(doc, node.id);
        if (!oldParentId) fail(`Node ${node.id} has no parent.`, 'ORPHAN_NODE', node.id);
        const oldParent = doc.nodes[oldParentId]; oldParent.children.splice(oldParent.children.indexOf(node.id), 1);
        number(op.index, 'move.index', 0, parent.children.length, true); parent.children.splice(op.index, 0, node.id);
        break;
      }
      case 'delete': {
        keys(op, ['type', 'nodeId'], `operation ${index}`, ['type', 'nodeId']);
        const node = requiredNode(doc, op.nodeId);
        if (node.id === doc.rootId) fail('The root cannot be deleted.', 'INVALID_ROOT', node.id);
        const parentId = getParentId(doc, node.id);
        if (!parentId) fail(`Node ${node.id} has no parent.`, 'ORPHAN_NODE', node.id);
        doc.nodes[parentId].children = doc.nodes[parentId].children.filter(child => child !== node.id);
        const remove = (nodeId: string): void => { for (const child of doc.nodes[nodeId].children) remove(child); delete doc.nodes[nodeId]; };
        remove(node.id); break;
      }
      case 'token': {
        keys(op, ['type', 'category', 'name', 'value'], `operation ${index}`, ['type', 'category', 'name', 'value']);
        oneOf(op.category, ['primitive', 'semantic'], 'token.category');
        if (typeof op.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(op.name)) fail('Invalid token name.', 'INVALID_TOKEN');
        if (typeof op.value !== 'string' && typeof op.value !== 'number') fail('Token values must be strings or numbers.', 'INVALID_TOKEN');
        doc.tokens[op.category as keyof DesignTokens][op.name] = op.value; break;
      }
      case 'theme': keys(op, ['type', 'theme'], `operation ${index}`, ['type', 'theme']); oneOf(op.theme, ['light', 'dark'], 'theme'); doc.theme = op.theme as 'light' | 'dark'; break;
      case 'replace': {
        keys(op, ['type', 'document'], `operation ${index}`, ['type', 'document']);
        const replacement = validateDocument(op.document);
        if (replacement.id !== before.id) fail('Replacement targets a different project.', 'PROJECT_MISMATCH');
        doc = replacement; break;
      }
      default: fail(`Unsupported operation type ${String(op.type)}.`, 'UNKNOWN_OPERATION');
    }
  }
  doc.revision = before.revision + 1;
  return validateDocument(doc);
}

export function summarizeChanges(before: StudioDocument, after: StudioDocument): ChangeSummary[] {
  const changes: ChangeSummary[] = [];
  for (const [nodeId, node] of Object.entries(before.nodes)) {
    const next = after.nodes[nodeId];
    if (!next) changes.push({ nodeId, description: `Delete ${node.name}` });
    else {
      const fields = ['name', 'type', 'props', 'layout', 'responsive', 'bindings', 'events', 'children'] as const;
      const touched = fields.filter(field => JSON.stringify(sorted(node[field])) !== JSON.stringify(sorted(next[field])));
      if (touched.length) changes.push({ nodeId, description: `Update ${next.name}: ${touched.join(', ')}` });
      if (getParentId(before, nodeId) !== getParentId(after, nodeId)) changes.push({ nodeId, description: `Move ${next.name}` });
    }
  }
  for (const [nodeId, node] of Object.entries(after.nodes)) if (!before.nodes[nodeId]) changes.push({ nodeId, description: `Add ${node.name}` });
  if (JSON.stringify(sorted(before.tokens)) !== JSON.stringify(sorted(after.tokens))) changes.push({ description: 'Update shared design tokens' });
  if (before.theme !== after.theme) changes.push({ description: `Change application theme to ${after.theme}` });
  if (before.name !== after.name) changes.push({ description: `Rename project to ${after.name}` });
  if (JSON.stringify(before.data) !== JSON.stringify(after.data)) changes.push({ description: 'Update fictional ticket data' });
  if (JSON.stringify(before.initialState) !== JSON.stringify(after.initialState)) changes.push({ description: 'Update initial runtime state' });
  return changes;
}

function luminance(value: string | number): number | null {
  if (typeof value !== 'string' || !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)) return null;
  const hex = value.length === 4 ? value.slice(1).split('').map(char => char + char).join('') : value.slice(1);
  const rgb = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
export function diagnoseDocument(input: StudioDocument): Diagnostic[] {
  let doc: StudioDocument;
  try { doc = validateDocument(input); } catch (error) { return error instanceof DocumentValidationError ? error.diagnostics : [{ code: 'INVALID_DOCUMENT', severity: 'error', message: (error as Error).message }]; }
  const result: Diagnostic[] = [];
  for (const node of Object.values(doc.nodes)) {
    if (['Field', 'Select', 'Button'].includes(node.type) && !String(node.props.label ?? '').trim() && !String(node.props.ariaLabel ?? '').trim()) result.push({ code: 'MISSING_LABEL', severity: 'warning', message: `${node.name} needs a visible label or accessible name.`, nodeId: node.id });
    if (node.type === 'Text') {
      const size = resolveNumericToken(doc.tokens, (node.props.size ?? 14) as number | string);
      const weight = resolveNumericToken(doc.tokens, (node.props.weight ?? 400) as number | string);
      if (size < 12) result.push({ code: 'SMALL_TEXT', severity: 'warning', message: `${node.name} is smaller than 12px; check readability at the target size.`, nodeId: node.id });
      let background = '$semantic.background'; let ancestor: string | null = node.id;
      while (ancestor) {
        const value = doc.nodes[ancestor].props.background;
        if (typeof value === 'string' && value !== 'transparent') { background = value; break; }
        ancestor = getParentId(doc, ancestor);
      }
      try {
        const foreground = luminance(resolveToken(doc.tokens, typeof node.props.color === 'string' ? node.props.color : '$semantic.text'));
        const back = luminance(resolveToken(doc.tokens, background));
        const large = size >= 24 || size >= 18.66 && weight >= 700;
        if (foreground !== null && back !== null) {
          const ratio = (Math.max(foreground, back) + 0.05) / (Math.min(foreground, back) + 0.05);
          if (ratio < (large ? 3 : 4.5)) result.push({ code: 'LOW_CONTRAST', severity: 'warning', message: `${node.name} has estimated ${ratio.toFixed(2)}:1 text contrast; inspect its rendered states. This is not an accessibility certification.`, nodeId: node.id });
        }
      } catch { /* Optional semantic colors may be absent when explicit colors suffice. */ }
    }
    const phone = node.responsive.phone;
    if (phone?.width !== undefined && phone.width !== 'fill' && resolveNumericToken(doc.tokens, phone.width) > 375) result.push({ code: 'PHONE_OVERFLOW', severity: 'warning', message: `${node.name} has a fixed phone width above 375px; inspect smaller screens.`, nodeId: node.id });
  }
  return result;
}
