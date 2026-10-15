import type { InitialState, Interaction, Ticket } from '../core/types';

export const ticketStatuses = ['open', 'pending', 'resolved'] as const;
export interface RuntimeState extends InitialState {
  tickets: Ticket[];
  loadStatus: 'loading' | 'ready' | 'error';
  error: string | null;
  validation: string | null;
  changedTicketIds: string[];
  activeRequest: number;
}
export type RuntimeEvent =
  | { type: 'reset'; initial: InitialState }
  | { type: 'load-start'; request: number }
  | { type: 'load-success'; request: number; tickets: Ticket[] }
  | { type: 'load-failure'; request: number; message: string }
  | { type: 'interaction'; interaction: Interaction; value?: string }
  | { type: 'clear-validation' };

export function initialRuntimeState(initial: InitialState): RuntimeState {
  return { ...initial, tickets: [], loadStatus: 'loading', error: null, validation: null, changedTicketIds: [], activeRequest: 0 };
}

export function selectedTicket(state: RuntimeState): Ticket | undefined {
  return state.tickets.find(ticket => ticket.id === state.selectedTicketId);
}

export function assigneeOptions(tickets: Ticket[]): string[] {
  return Array.from(new Set(['', ...tickets.map(ticket => ticket.assignee)])).sort();
}

export function filteredTickets(state: RuntimeState): Ticket[] {
  const query = state.query.trim().toLocaleLowerCase();
  return state.tickets.filter(ticket =>
    (!query || [ticket.id, ticket.subject, ticket.customer, ticket.email, ticket.company].some(value => value.toLocaleLowerCase().includes(query))) &&
    (state.status === 'all' || !state.status || ticket.status === state.status) &&
    (state.assignee === 'all' || ticket.assignee === state.assignee),
  );
}

/** Explicit condition vocabulary; never interpret uploaded expressions or JavaScript. */
export function conditionSatisfied(state: RuntimeState, condition: string | undefined): boolean {
  switch (condition) {
    case undefined: case 'always': return true;
    case 'hasSelection': return !!selectedTicket(state);
    case 'hasResults': return state.loadStatus === 'ready' && filteredTickets(state).length > 0;
    case 'empty': return state.loadStatus === 'ready' && filteredTickets(state).length === 0;
    case 'loading': return state.loadStatus === 'loading';
    case 'error': return state.loadStatus === 'error';
    case 'ready': return state.loadStatus === 'ready';
    case 'tab:inbox': return state.tab === 'inbox';
    case 'tab:activity': return state.tab === 'activity';
    case 'tab:customer': return state.tab === 'customer';
    default: return false;
  }
}

function updateTicket(state: RuntimeState, patch: Partial<Pick<Ticket, 'status' | 'assignee'>>): RuntimeState {
  const ticket = selectedTicket(state);
  if (!ticket) return { ...state, validation: 'Choose a ticket before changing its details.' };
  const changed = state.changedTicketIds.includes(ticket.id) ? state.changedTicketIds : [...state.changedTicketIds, ticket.id];
  return { ...state, validation: null, changedTicketIds: changed, tickets: state.tickets.map(item => item.id === ticket.id ? { ...item, ...patch } : item) };
}

export function runtimeReducer(state: RuntimeState, event: RuntimeEvent): RuntimeState {
  if (event.type === 'reset') return initialRuntimeState(event.initial);
  if (event.type === 'load-start') return { ...state, activeRequest: event.request, loadStatus: 'loading', error: null };
  if (event.type === 'load-success') {
    if (event.request !== state.activeRequest) return state;
    const tickets = event.tickets.map(ticket => state.changedTicketIds.includes(ticket.id) ? (state.tickets.find(item => item.id === ticket.id) ?? ticket) : ticket);
    return { ...state, tickets, loadStatus: 'ready', error: null, selectedTicketId: tickets.some(ticket => ticket.id === state.selectedTicketId) ? state.selectedTicketId : null };
  }
  if (event.type === 'load-failure') return event.request === state.activeRequest ? { ...state, loadStatus: 'error', error: event.message } : state;
  if (event.type === 'clear-validation') return { ...state, validation: null };
  const { action } = event.interaction;
  const value = event.interaction.value ?? event.value ?? '';
  switch (action) {
    case 'setQuery': return value.length <= 200 ? { ...state, query: value, validation: null } : { ...state, validation: 'Keep your search below 201 characters.' };
    case 'setStatus': return value === 'all' || ticketStatuses.includes(value as Ticket['status']) ? { ...state, status: value, validation: null } : { ...state, validation: 'Choose an available ticket status.' };
    case 'setAssigneeFilter': return value === 'all' || assigneeOptions(state.tickets).includes(value) ? { ...state, assignee: value, validation: null } : { ...state, validation: 'Choose an available teammate.' };
    case 'selectTicket': return state.tickets.some(ticket => ticket.id === value) ? { ...state, selectedTicketId: value, validation: null } : { ...state, validation: 'This ticket is no longer available.' };
    case 'assignTicket': return assigneeOptions(state.tickets).includes(value) ? updateTicket(state, { assignee: value }) : { ...state, validation: 'Choose an available teammate before assigning this ticket.' };
    case 'setTicketStatus': return ticketStatuses.includes(value as Ticket['status']) ? updateTicket(state, { status: value as Ticket['status'] }) : { ...state, validation: 'Choose open, pending, or resolved.' };
    case 'setTab': return value.length > 0 && value.length <= 80 ? { ...state, tab: value, validation: null } : { ...state, validation: 'Choose an available view.' };
    // Loading is side-effectful and handled by the provider, not this pure reducer.
    case 'reloadTickets': return state;
  }
}

export function bindingValue(state: RuntimeState, path: string): string {
  switch (path) {
    case 'query': return state.query;
    case 'status': return state.status;
    case 'assignee': return state.assignee;
    case 'tab': return state.tab;
    case 'selectedTicketId': return state.selectedTicketId ?? '';
    case 'selectedTicket.subject': return selectedTicket(state)?.subject ?? 'Choose a ticket';
    case 'selectedTicket.customer': return selectedTicket(state)?.customer ?? '';
    case 'selectedTicket.email': return selectedTicket(state)?.email ?? '';
    case 'selectedTicket.status': return selectedTicket(state)?.status ?? '';
    case 'selectedTicket.assignee': return selectedTicket(state)?.assignee ?? '';
    default: return '';
  }
}
