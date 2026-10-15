import { Children, createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode, type KeyboardEvent, type MouseEvent } from 'react';
import type { BindingPath, Breakpoint, Interaction, JsonValue, Layout, StudioDocument, StudioNode, Ticket } from '../core/types';
import { resolveNumericToken, resolveToken } from '../core/tokens';
import { createLocalTicketConnector, validateTicketData, type TicketConnector } from './connector';
import { assigneeOptions, bindingValue, conditionSatisfied, filteredTickets, initialRuntimeState, runtimeReducer, selectedTicket, ticketStatuses, type RuntimeState } from './state';

export type RuntimeMeta = Omit<StudioDocument, 'nodes'>;
export interface CatalogProps {
  studioId: string;
  name?: string;
  props?: Record<string, JsonValue>;
  layout?: Layout;
  responsive?: StudioNode['responsive'];
  bindings?: Record<string, BindingPath>;
  events?: StudioNode['events'];
  children?: ReactNode;
}
interface EditorSettings {
  breakpoint?: Breakpoint;
  selectedId?: string;
  designMode?: boolean;
  onSelect?: (id: string) => void;
}
interface RuntimeContextValue {
  meta: RuntimeMeta;
  state: RuntimeState;
  breakpoint: Breakpoint;
  run: (interaction: Interaction | undefined, value?: string) => void;
}
const RuntimeContext = createContext<RuntimeContextValue | null>(null);
const EditorContext = createContext<EditorSettings>({});

function useRuntime(): RuntimeContextValue {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error('Catalog components must be rendered inside StudioProvider.');
  return value;
}

function breakpointAt(width: number): Breakpoint {
  return width < 600 ? 'phone' : width < 960 ? 'tablet' : 'desktop';
}

export function StudioProvider({ meta, children, connector }: { meta: RuntimeMeta; children: ReactNode; connector?: TicketConnector }) {
  const editor = useContext(EditorContext);
  const [state, dispatch] = useReducer(runtimeReducer, meta.initialState, initialRuntimeState);
  const [measuredBreakpoint, setMeasuredBreakpoint] = useState<Breakpoint>('desktop');
  const root = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const dataKey = JSON.stringify(meta.data.tickets);
  const initialKey = JSON.stringify([meta.id, meta.initialState]);
  // A visual node edit must not reload tickets or discard runtime interactions.
  const localConnector = useMemo(() => createLocalTicketConnector(JSON.parse(dataKey) as Ticket[]), [dataKey]);
  const activeConnector = connector ?? localConnector;
  const load = useCallback(() => {
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    const request = ++requestId.current;
    dispatch({ type: 'load-start', request });
    void activeConnector.load(nextController.signal).then(tickets => {
      if (!nextController.signal.aborted) dispatch({ type: 'load-success', request, tickets: validateTicketData(tickets) });
    }).catch((error: unknown) => {
      if (nextController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      dispatch({ type: 'load-failure', request, message: activeConnector.source === 'local-fictional' ? 'The fictional local data source could not load. Try again.' : 'Tickets could not load. Check the connection and try again.' });
    });
  }, [activeConnector]);
  useEffect(() => { load(); return () => controller.current?.abort(); }, [load]);
  const lastInitialKey = useRef(initialKey);
  useEffect(() => {
    if (lastInitialKey.current !== initialKey) {
      lastInitialKey.current = initialKey;
      dispatch({ type: 'reset', initial: (JSON.parse(initialKey) as [string, StudioDocument['initialState']])[1] });
      load();
    }
  }, [initialKey, load]);
  useEffect(() => {
    if (!root.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => { const width = entries[0]?.contentRect.width; if (width) setMeasuredBreakpoint(breakpointAt(width)); });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const run = useCallback((interaction: Interaction | undefined, value?: string) => {
    if (!interaction || editor.designMode) return;
    if (interaction.action === 'reloadTickets') load();
    else dispatch({ type: 'interaction', interaction, value });
  }, [editor.designMode, load]);
  const breakpoint = editor.breakpoint ?? measuredBreakpoint;
  const variables: Record<string, string | number> = {};
  for (const category of ['primitive', 'semantic'] as const) {
    for (const name of Object.keys(meta.tokens[category])) variables[`--app-${category}-${name.replace(/[^a-zA-Z0-9-]/g, '-')}`] = resolveToken(meta.tokens, `$${category}.${name}`);
  }
  const onDesignClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!editor.designMode) return;
    const id = (event.target as Element).closest<HTMLElement>('[data-studio-id]')?.dataset.studioId;
    if (id) { event.preventDefault(); event.stopPropagation(); editor.onSelect?.(id); }
  };
  const onDesignKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!editor.designMode || !['Enter', ' '].includes(event.key)) return;
    const id = (event.target as HTMLElement).dataset.studioId;
    if (id) { event.preventDefault(); event.stopPropagation(); editor.onSelect?.(id); }
  };
  return <EditorContext.Provider value={editor}><RuntimeContext.Provider value={{ meta, state, breakpoint, run }}>
    <div ref={root} className={`studio-runtime app-theme-${meta.theme}${editor.designMode ? ' studio-design-mode' : ''}`} data-breakpoint={breakpoint} style={variables as CSSProperties} onClickCapture={onDesignClick} onKeyDownCapture={onDesignKey}>
      {children}
      {state.validation && <div role="alert" className="app-validation"><span>{state.validation}</span><button type="button" aria-label="Dismiss validation message" onClick={() => dispatch({ type: 'clear-validation' })}>×</button></div>}
    </div>
  </RuntimeContext.Provider></EditorContext.Provider>;
}

function tokenValue(meta: RuntimeMeta, value: JsonValue | undefined, fallback?: string | number): string | number | undefined {
  if (typeof value === 'string') return value.startsWith('$') ? resolveToken(meta.tokens, value) : value;
  return typeof value === 'number' ? value : fallback;
}
function tokenColor(meta: RuntimeMeta, value: JsonValue | undefined): string | undefined {
  const color = tokenValue(meta, value);
  return color === undefined ? undefined : String(color);
}
function numericValue(meta: RuntimeMeta, value: JsonValue | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('Numeric component values must be numbers or numeric token references.');
  return resolveNumericToken(meta.tokens, value);
}

function useElement(input: CatalogProps) {
  const { meta, state, breakpoint } = useRuntime();
  const editor = useContext(EditorContext);
  const props = input.props ?? {};
  const layout: Layout = { ...input.layout, ...input.responsive?.[breakpoint] };
  const columns = numericValue(meta, layout.columns);
  const align = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };
  const justify = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' };
  const style: CSSProperties = {
    display: layout.display,
    flexDirection: layout.direction,
    gap: numericValue(meta, layout.gap),
    padding: numericValue(meta, layout.padding),
    gridTemplateColumns: columns === undefined ? undefined : `repeat(${columns}, minmax(0, 1fr))`,
    width: layout.width === 'fill' ? '100%' : numericValue(meta, layout.width),
    height: layout.height === 'auto' ? 'auto' : numericValue(meta, layout.height),
    alignItems: layout.align ? align[layout.align] : undefined,
    justifyContent: layout.justify ? justify[layout.justify] : undefined,
    flexGrow: numericValue(meta, layout.grow),
  };
  const attributes = {
    'data-studio-id': input.studioId,
    'data-selected': editor.selectedId === input.studioId ? 'true' : undefined,
    tabIndex: editor.designMode ? 0 : undefined,
  };
  return { meta, state, props, style, attributes, hidden: props.hidden === true || (!editor.designMode && !conditionSatisfied(state, typeof props.visibleWhen === 'string' ? props.visibleWhen : undefined)), label: typeof props.ariaLabel === 'string' ? props.ariaLabel : typeof props.label === 'string' ? props.label : typeof props.title === 'string' ? props.title : input.name, value: (key: string, fallback = '') => input.bindings?.[key] ? bindingValue(state, input.bindings[key]) : typeof props[key] === 'string' ? props[key] as string : fallback };
}

export function Frame(input: CatalogProps) {
  const { meta, props, style, attributes, hidden, label } = useElement(input);
  if (hidden) return null;
  return <div {...attributes} aria-label={label} className="app-frame studio-element" style={{ background: tokenValue(meta, props.background), border: props.border ? `1px solid ${tokenValue(meta, props.border)}` : undefined, borderRadius: numericValue(meta, props.radius), boxShadow: props.shadow === 'raised' ? '0 16px 40px rgb(22 20 35 / 12%)' : props.shadow === 'soft' ? '0 10px 30px rgb(22 20 35 / 6%)' : undefined, ...style }}>{input.children}</div>;
}

export function Text(input: CatalogProps) {
  const { meta, props, style, attributes, hidden, value } = useElement(input);
  if (hidden) return null;
  const Tag = props.variant === 'title' ? 'h2' : props.variant === 'eyebrow' ? 'span' : 'p';
  return <Tag {...attributes} className={`app-text app-text-${String(props.variant ?? 'body')} studio-element`} style={{ color: tokenColor(meta, props.color), fontSize: numericValue(meta, props.size), fontWeight: numericValue(meta, props.weight), ...style }}>{value('text', 'Text')}</Tag>;
}

export function Button(input: CatalogProps) {
  const { props, style, attributes, hidden, label } = useElement(input);
  const { run, state } = useRuntime();
  const editor = useContext(EditorContext);
  if (hidden) return null;
  const busy = !editor.designMode && input.events?.onClick?.action === 'reloadTickets' && state.loadStatus === 'loading';
  const disabled = props.disabled === true || busy;
  return <button {...attributes} type="button" className={`app-button app-button-${String(props.variant ?? 'primary')} studio-element`} style={style} aria-label={label} aria-disabled={editor.designMode && disabled ? 'true' : undefined} disabled={!editor.designMode && disabled} onClick={() => run(input.events?.onClick)}>{busy ? 'Loading…' : typeof props.label === 'string' ? props.label : 'Button'}</button>;
}

export function Field(input: CatalogProps) {
  const { props, style, attributes, hidden, value, label } = useElement(input);
  const { run } = useRuntime();
  if (hidden) return null;
  const id = `app-field-${input.studioId}`;
  const type = ['search', 'email', 'text', 'number'].includes(String(props.type)) ? String(props.type) : 'text';
  const bound = input.bindings?.value;
  return <form {...attributes} className="app-field studio-element" style={style} onSubmit={event => { event.preventDefault(); if (event.currentTarget.checkValidity()) run(input.events?.onSubmit); }}>
    <label htmlFor={id}>{String(props.label ?? 'Field')}</label>
    <div className={`app-input-wrap${type === 'search' ? ' app-search-wrap' : ''}`}>
      {type === 'search' && <span aria-hidden="true" className="app-search-icon">⌕</span>}
      <input id={id} type={type} value={bound ? value('value') : undefined} placeholder={typeof props.placeholder === 'string' ? props.placeholder : undefined} required={props.required === true} disabled={props.disabled === true} readOnly={!!bound && !input.events?.onChange} aria-label={label} onChange={event => run(input.events?.onChange, event.currentTarget.value)} maxLength={type === 'search' ? 200 : undefined} />
    </div>
  </form>;
}

export interface SelectOption { label: string; value: string }
function optionsFrom(value: JsonValue | undefined): SelectOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(option => option && typeof option === 'object' && !Array.isArray(option) && typeof option.label === 'string' && typeof option.value === 'string' ? [{ label: option.label, value: option.value }] : []);
}
function title(value: string): string { return value ? value[0].toUpperCase() + value.slice(1) : value; }

export function Select(input: CatalogProps) {
  const { props, style, attributes, hidden, value, label, state } = useElement(input);
  const { run } = useRuntime();
  if (hidden) return null;
  const binding = input.bindings?.value;
  const explicitOptions = optionsFrom(props.options);
  const options = explicitOptions.length ? explicitOptions : binding === 'status' || binding === 'selectedTicket.status'
    ? [...(binding === 'status' ? [{ label: 'All statuses', value: 'all' }] : []), ...ticketStatuses.map(status => ({ label: title(status), value: status }))]
    : [...(binding === 'assignee' ? [{ label: 'All teammates', value: 'all' }] : []), ...assigneeOptions(state.tickets).map(assignee => ({ label: assignee || 'Unassigned', value: assignee }))];
  const id = `app-select-${input.studioId}`;
  const currentValue = binding ? value('value') : undefined;
  const missingSelectedTicket = binding?.startsWith('selectedTicket.') && !selectedTicket(state);
  return <div {...attributes} className="app-field studio-element" style={style}>
    <label htmlFor={id}>{String(props.label ?? 'Select')}</label>
    <select id={id} value={currentValue} aria-label={label} disabled={props.disabled === true || !!missingSelectedTicket || (!!binding && !input.events?.onChange)} onChange={event => run(input.events?.onChange, event.currentTarget.value)}>
      {missingSelectedTicket && <option value="">Choose a ticket</option>}
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </div>;
}

export function Tabs(input: CatalogProps) {
  const { props, style, attributes, hidden, value, label } = useElement(input);
  const { run } = useRuntime();
  if (hidden) return null;
  const options = optionsFrom(props.options);
  const active = value('value', options[0]?.value);
  const activate = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : event.key === 'ArrowRight' ? (index + 1) % options.length : event.key === 'ArrowLeft' ? (index - 1 + options.length) % options.length : -1;
    if (next < 0 || !options[next]) return;
    event.preventDefault();
    run(input.events?.onChange, options[next].value);
    (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };
  return <div {...attributes} className="app-tabs studio-element" role="tablist" aria-label={label ?? String(props.label ?? 'Views')} style={style}>
    {options.map((option, index) => <button key={option.value} type="button" role="tab" aria-selected={active === option.value} tabIndex={active === option.value ? 0 : -1} onKeyDown={event => activate(index, event)} onClick={() => run(input.events?.onChange, option.value)}>{option.label}</button>)}
  </div>;
}

export function Badge(input: CatalogProps) {
  const { meta, props, style, attributes, hidden, value } = useElement(input);
  if (hidden) return null;
  const text = input.bindings?.text ? value('text') : value('label', 'Badge');
  const tone = props.tone ?? (ticketStatuses.includes(text as Ticket['status']) ? text : 'neutral');
  return <span {...attributes} className={`app-badge app-badge-${String(tone)} studio-element`} style={{ color: tokenColor(meta, props.color), ...style }}><span className="app-badge-dot" aria-hidden="true" />{title(text)}</span>;
}

const tableColumns = ['subject', 'customer', 'status', 'assignee'] as const;
export function Table(input: CatalogProps) {
  const { props, style, attributes, hidden, state, label } = useElement(input);
  const { run } = useRuntime();
  if (hidden) return null;
  const tickets = filteredTickets(state);
  const columns = Array.isArray(props.columns) && props.columns.length ? props.columns.filter((column): column is string => typeof column === 'string') : [...tableColumns];
  const onSelect = (id: string) => run(input.events?.onClick, id);
  const selected = input.bindings?.value ? bindingValue(state, input.bindings.value) : state.selectedTicketId;
  if (state.tab === 'activity' && state.loadStatus === 'ready') {
    const changed = state.tickets.filter(ticket => state.changedTicketIds.includes(ticket.id));
    return <section {...attributes} className="app-ticket-table studio-element" style={style} aria-label="Local preview activity">
      <div className="app-table-toolbar"><span>Preview activity</span><span className="app-result-count">{changed.length} updated</span></div>
      {changed.length ? <ul className="app-activity-list">{changed.map(ticket => <li key={ticket.id}><span className="app-activity-mark" aria-hidden="true">✓</span><div><button type="button" className="app-ticket-link" onClick={() => onSelect(ticket.id)}>{ticket.subject}</button><p>{title(ticket.status)} · Assigned to {ticket.assignee || 'Unassigned'}</p><span>Current changes in this preview · {ticket.id}</span></div></li>)}</ul> : <div className="app-empty"><span className="app-empty-symbol" aria-hidden="true">✓</span><h3>No local updates yet</h3><p>Change a ticket’s status or assignment to see your preview activity here.</p></div>}
      <div className="app-table-footer">This view lists current local changes, not a persistent audit history.</div>
    </section>;
  }
  return <section {...attributes} className="app-ticket-table studio-element" style={style} aria-label={label ?? String(props.label ?? 'Tickets')} aria-busy={state.loadStatus === 'loading'}>
    <div className="app-table-toolbar"><span>{String(props.label ?? 'All tickets')}</span><span className="app-result-count" aria-live="polite">{state.loadStatus === 'loading' ? 'Loading' : `${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'}`}</span></div>
    {state.loadStatus === 'error' ? <div role="alert" className="app-empty app-error"><span className="app-empty-symbol" aria-hidden="true">!</span><h3>Tickets couldn’t load</h3><p>{state.error}</p><button type="button" className="app-button app-button-secondary" onClick={() => run({ action: 'reloadTickets' })}>Try again</button></div> : state.loadStatus === 'loading' && !state.tickets.length ? <div role="status" className="app-loading"><span className="app-spinner" aria-hidden="true" />Loading fictional tickets…</div> : tickets.length === 0 ? <div className="app-empty"><span className="app-empty-symbol" aria-hidden="true">⌕</span><h3>No matching tickets</h3><p>{String(props.emptyMessage ?? 'Try another search or clear your filters.')}</p><button type="button" className="app-button app-button-secondary" onClick={() => { run({ action: 'setQuery' }, ''); run({ action: 'setStatus' }, 'all'); run({ action: 'setAssigneeFilter' }, 'all'); }}>Clear filters</button></div> : <div className="app-table-scroll"><table>
      <caption className="app-sr-only">{String(props.label ?? 'Tickets')}. Choose a ticket to inspect and edit its details.</caption>
      <thead><tr>{columns.map(column => <th key={column} data-column={column} scope="col">{title(column === 'updatedAt' ? 'Updated' : column)}</th>)}</tr></thead>
      <tbody>{tickets.map(ticket => <tr key={ticket.id} data-ticket-id={ticket.id} data-selected-ticket={selected === ticket.id ? 'true' : undefined} onClick={() => onSelect(ticket.id)}>
        {columns.map((column, index) => <td key={column} data-column={column}>{index === 0 ? <button type="button" className="app-ticket-link" aria-label={`Open ticket ${ticket.id}: ${ticket.subject}`} aria-pressed={selected === ticket.id} onClick={event => { event.stopPropagation(); onSelect(ticket.id); }}>{renderTicketCell(ticket, column)}</button> : renderTicketCell(ticket, column)}</td>)}
      </tr>)}</tbody>
    </table></div>}
    <div className="app-table-footer"><span className="app-live-dot" aria-hidden="true" />Fictional data · changes stay in this preview</div>
  </section>;
}

function renderTicketCell(ticket: Ticket, column: string): ReactNode {
  if (column === 'subject') return <span className="app-ticket-subject"><span className="app-ticket-id">{ticket.id}</span><span>{ticket.subject}</span>{ticket.priority === 'high' && <span className="app-priority-mark" aria-label="High priority">!</span>}</span>;
  if (column === 'status') return <span className={`app-badge app-badge-${ticket.status}`}><span className="app-badge-dot" aria-hidden="true" />{title(ticket.status)}</span>;
  if (column === 'assignee') return <span className="app-person"><span className="app-avatar app-avatar-small" aria-hidden="true">{ticket.assignee ? initials(ticket.assignee) : '—'}</span><span>{ticket.assignee || 'Unassigned'}</span></span>;
  if (column === 'customer') return <span className="app-customer-cell"><span>{ticket.customer}</span><small>{ticket.company}</small></span>;
  if (column === 'priority') return <span className={`app-priority app-priority-${ticket.priority}`}>{title(ticket.priority)}</span>;
  if (column === 'updatedAt') return <time dateTime={ticket.updatedAt}>{ticket.updatedAt.slice(0, 10)}</time>;
  return ticket[column as keyof Ticket] ?? '';
}
function initials(name: string): string { return name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase(); }

export function DetailPanel(input: CatalogProps) {
  const { meta, props, style, attributes, hidden, state, label } = useElement(input);
  const { run } = useRuntime();
  if (hidden) return null;
  const ticket = selectedTicket(state);
  const titleId = `app-detail-title-${input.studioId}`;
  return <section {...attributes} className="app-detail-panel studio-element" style={{ background: tokenValue(meta, props.background), borderRadius: numericValue(meta, props.radius), ...style }} aria-label={label ?? String(props.title ?? 'Ticket details')}>
    <header className="app-detail-heading"><span className="app-detail-icon" aria-hidden="true">▤</span><div><h2 id={titleId}>{String(props.title ?? 'Ticket details')}</h2>{props.subtitle && <p>{String(props.subtitle)}</p>}</div>{ticket && <span className="app-ticket-id">{ticket.id}</span>}</header>
    {state.loadStatus === 'loading' && !ticket ? <div className="app-empty" role="status"><p>Loading ticket details…</p></div> : !ticket ? <div className="app-empty"><span className="app-empty-symbol" aria-hidden="true">▤</span><h3>Choose a ticket</h3><p>Select a row to see the conversation and update its assignment.</p></div> : <div className="app-detail-content">
      {Children.count(input.children) > 0 ? <div className="app-detail-custom">{input.children}</div> : <>
        <div className="app-detail-summary"><span className={`app-badge app-badge-${ticket.status}`}><span className="app-badge-dot" aria-hidden="true" />{title(ticket.status)}</span><span className={`app-priority app-priority-${ticket.priority}`}>{title(ticket.priority)} priority</span></div>
        <h3 className="app-detail-subject">{ticket.subject}</h3>
        <div className="app-detail-form"><label htmlFor={`app-status-${input.studioId}`}>Status<select id={`app-status-${input.studioId}`} value={ticket.status} onChange={event => run({ action: 'setTicketStatus' }, event.currentTarget.value)}>{ticketStatuses.map(status => <option key={status} value={status}>{title(status)}</option>)}</select></label><label htmlFor={`app-assignment-${input.studioId}`}>Assigned to<select id={`app-assignment-${input.studioId}`} value={ticket.assignee} onChange={event => run({ action: 'assignTicket' }, event.currentTarget.value)}>{assigneeOptions(state.tickets).map(assignee => <option key={assignee} value={assignee}>{assignee || 'Unassigned'}</option>)}</select></label></div>
      </>}
      <div className="app-conversation"><div className="app-conversation-person"><span className="app-avatar" aria-hidden="true">{initials(ticket.customer)}</span><div><strong>{ticket.customer}</strong><span>Customer · {ticket.company}</span></div></div><p>{ticket.message}</p><span className="app-message-caption">Fictional conversation for this demo</span></div>
      <div className="app-customer-card"><h3>Customer information</h3><dl><div><dt>Email</dt><dd>{ticket.email}</dd></div><div><dt>Company</dt><dd>{ticket.company}</dd></div><div><dt>Ticket</dt><dd>{ticket.id}</dd></div></dl></div>
      <p role="status" className="app-edit-notice">{state.changedTicketIds.includes(ticket.id) ? 'Updated in this preview. Reloading tickets keeps these changes; reopening the app resets them.' : 'Assignment and status changes use local fictional data.'}</p>
    </div>}
  </section>;
}

const components = { Frame, Text, Button, Field, Select, Tabs, Badge, Table, DetailPanel };
export function StudioRuntime({ document, ...settings }: { document: StudioDocument } & EditorSettings) {
  const renderNode = (id: string): ReactNode => {
    const node = document.nodes[id];
    if (!node) return null;
    const Component = components[node.type];
    return <Component key={node.id} studioId={node.id} name={node.name} props={node.props} layout={node.layout} responsive={node.responsive} bindings={node.bindings} events={node.events}>{node.children.map(renderNode)}</Component>;
  };
  const meta: RuntimeMeta = { schemaVersion: document.schemaVersion, id: document.id, name: document.name, revision: document.revision, rootId: document.rootId, tokens: document.tokens, theme: document.theme, data: document.data, initialState: document.initialState };
  return <EditorContext.Provider value={settings}><StudioProvider meta={meta}>{renderNode(document.rootId)}</StudioProvider></EditorContext.Provider>;
}
