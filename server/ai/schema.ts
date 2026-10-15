import { catalog } from '../../src/core/document';
import { componentTypes } from '../../src/core/types';
import type { PropRule } from '../../src/core/document';

type Schema = Record<string, unknown>;
const str: Schema = { type: 'string' };
const num: Schema = { type: 'number' };
const numeric: Schema = { anyOf: [num, { type: 'string', pattern: '^\\$(primitive|semantic)\\.[A-Za-z][A-Za-z0-9_-]{0,63}$' }] };
const bool: Schema = { type: 'boolean' };
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const choice = (values: readonly string[]): Schema => ({ type: 'string', enum: [...values] });
const sparse = (properties: Record<string, Schema>): Schema => object(Object.fromEntries(Object.entries(properties).map(([key, schema]) => [key, nullable(schema)])));
function propSchema(rule: PropRule): Schema {
  if (rule.kind === 'boolean') return bool;
  if (rule.kind === 'number') return numeric;
  if (rule.kind === 'enum') return choice(rule.values ?? []);
  if (rule.kind === 'options') return { type: 'array', items: object({ label: str, value: str }) };
  if (rule.kind === 'columns') return { type: 'array', items: choice(rule.values ?? []) };
  return str;
}
const props: Record<string, Schema> = {};
for (const entry of Object.values(catalog)) for (const [name, rule] of Object.entries(entry.props)) {
  const existing = props[name]; const next = propSchema(rule);
  if (existing && rule.kind === 'enum') next.enum = [...new Set([...(existing.enum as string[] ?? []), ...(next.enum as string[])])];
  props[name] = next;
}
const layout = sparse({ display: choice(['flex', 'grid']), direction: choice(['row', 'column']), gap: numeric, padding: numeric, columns: numeric, width: { anyOf: [numeric, choice(['fill'])] }, height: { anyOf: [numeric, choice(['auto'])] }, align: choice(['start', 'center', 'end', 'stretch']), justify: choice(['start', 'center', 'end', 'between']), grow: numeric });
const responsive = sparse({ desktop: layout, tablet: layout, phone: layout });
const bindingPaths = choice(['query', 'status', 'assignee', 'selectedTicketId', 'selectedTicket.subject', 'selectedTicket.customer', 'selectedTicket.email', 'selectedTicket.status', 'selectedTicket.assignee', 'tab']);
const bindings = sparse({ text: bindingPaths, value: bindingPaths, label: bindingPaths });
const interaction = object({ action: choice(['setQuery', 'setStatus', 'setAssigneeFilter', 'selectTicket', 'assignTicket', 'setTicketStatus', 'setTab', 'reloadTickets']), value: nullable(str) });
const events = sparse({ onClick: interaction, onChange: interaction, onSubmit: interaction });
const node = object({ id: str, type: choice(componentTypes), name: str, children: { type: 'array', items: str }, props: sparse(props), layout, responsive, bindings, events });
const patch = sparse({ name: str, props: sparse(props), layout, responsive, bindings, events });
const operation: Schema = { anyOf: [
  object({ type: choice(['insert']), parentId: str, index: num, node }),
  object({ type: choice(['update']), nodeId: str, patch }),
  object({ type: choice(['move']), nodeId: str, parentId: str, index: num }),
  object({ type: choice(['delete']), nodeId: str }),
  object({ type: choice(['token']), category: choice(['primitive', 'semantic']), name: str, value: { anyOf: [str, num] } }),
  object({ type: choice(['theme']), theme: choice(['light', 'dark']) }),
] };

/** OpenAI strict schema: all object properties are required; optional wire fields use null. */
export const proposalResponseSchema: Schema = object({ projectId: str, baseRevision: num, summary: str, groups: { type: 'array', items: object({ id: str, title: str, dependsOn: { type: 'array', items: str }, operations: { type: 'array', items: operation } }) } });

/** Null is omitted only inside known optional maps; unknown keys remain for refusal. */
export function decodeProposalWire(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const doc = input as Record<string, unknown>;
  if (!Array.isArray(doc.groups)) return input;
  return { ...doc, groups: doc.groups.map(group => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) return group;
    const item = group as Record<string, unknown>;
    return { ...item, operations: Array.isArray(item.operations) ? item.operations.map(operation => {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return operation;
      const op = operation as Record<string, unknown>;
      if (op.type === 'insert' && op.node && typeof op.node === 'object') return { ...op, node: normalizeNode(op.node, false) };
      if (op.type === 'update' && op.patch && typeof op.patch === 'object') return { ...op, patch: normalizeNode(op.patch, true) };
      return op;
    }) : item.operations };
  }) };
}
function omitKnownNulls(input: unknown, names: string[]): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== null || !names.includes(key)));
}
function normalizeNode(input: object, isPatch: boolean): unknown {
  const value = { ...(isPatch ? omitKnownNulls(input, ['name', 'props', 'layout', 'responsive', 'bindings', 'events']) : input) as Record<string, unknown> };
  if (value.props && typeof value.props === 'object' && !Array.isArray(value.props)) value.props = omitKnownNulls(value.props, Object.keys(props));
  if (value.layout && typeof value.layout === 'object' && !Array.isArray(value.layout)) value.layout = omitKnownNulls(value.layout, Object.keys(layout.properties as object));
  if (value.bindings && typeof value.bindings === 'object' && !Array.isArray(value.bindings)) value.bindings = omitKnownNulls(value.bindings, ['text', 'value', 'label']);
  if (value.responsive && typeof value.responsive === 'object' && !Array.isArray(value.responsive)) {
    const map = omitKnownNulls(value.responsive, ['desktop', 'tablet', 'phone']) as Record<string, unknown>;
    value.responsive = Object.fromEntries(Object.entries(map).map(([key, val]) => [key, ['desktop', 'tablet', 'phone'].includes(key) ? omitKnownNulls(val, Object.keys(layout.properties as object)) : val]));
  }
  if (value.events && typeof value.events === 'object' && !Array.isArray(value.events)) {
    const map = omitKnownNulls(value.events, ['onClick', 'onChange', 'onSubmit']) as Record<string, unknown>;
    value.events = Object.fromEntries(Object.entries(map).map(([key, val]) => [key, ['onClick', 'onChange', 'onSubmit'].includes(key) ? omitKnownNulls(val, ['value']) : val]));
  }
  return value;
}
