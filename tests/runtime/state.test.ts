import { describe, expect, it } from 'vitest';
import type { InitialState, Ticket } from '../../src/core/types';
import { bindingValue, conditionSatisfied, filteredTickets, initialRuntimeState, runtimeReducer, selectedTicket } from '../../src/runtime/state';

const tickets: Ticket[] = [
  { id: 'T-001', subject: 'Invoice receipt', customer: 'Ari Stone', email: 'ari@example.test', status: 'open', priority: 'normal', assignee: 'Maya Chen', message: 'Please send a receipt.', company: 'Fictional North', updatedAt: '2026-10-01T10:00:00Z' },
  { id: 'T-002', subject: 'Team access', customer: 'Casey Vale', email: 'casey@example.test', status: 'pending', priority: 'high', assignee: 'Owen Park', message: 'Our teammate needs access.', company: 'Fictional South', updatedAt: '2026-10-02T10:00:00Z' },
];
const initial: InitialState = { query: '', status: 'all', assignee: 'all', selectedTicketId: 'T-001', tab: 'inbox' };
function ready() {
  return runtimeReducer(runtimeReducer(initialRuntimeState(initial), { type: 'load-start', request: 1 }), { type: 'load-success', request: 1, tickets: structuredClone(tickets) });
}

describe('fictional application runtime', () => {
  it('combines search, status, and assignment filters without altering source tickets', () => {
    let state = ready();
    state = runtimeReducer(state, { type: 'interaction', interaction: { action: 'setQuery' }, value: 'FICTIONAL SOUTH' });
    expect(filteredTickets(state).map(ticket => ticket.id)).toEqual(['T-002']);
    state = runtimeReducer(state, { type: 'interaction', interaction: { action: 'setStatus' }, value: 'open' });
    expect(filteredTickets(state)).toEqual([]);
    state = runtimeReducer(state, { type: 'interaction', interaction: { action: 'setStatus' }, value: 'pending' });
    state = runtimeReducer(state, { type: 'interaction', interaction: { action: 'setAssigneeFilter' }, value: 'Owen Park' });
    expect(filteredTickets(state).map(ticket => ticket.id)).toEqual(['T-002']);
    expect(state.tickets).toEqual(tickets);
  });

  it('selects a ticket and updates only its valid status and assignment; bindings follow state', () => {
    let state = ready();
    state = runtimeReducer(state, { type: 'interaction', interaction: { action: 'selectTicket' }, value: 'T-002' });
    state = runtimeReducer(state, { type: 'interaction', interaction: { action: 'assignTicket' }, value: 'Maya Chen' });
    state = runtimeReducer(state, { type: 'interaction', interaction: { action: 'setTicketStatus', value: 'resolved' } });
    expect(selectedTicket(state)).toMatchObject({ id: 'T-002', assignee: 'Maya Chen', status: 'resolved' });
    expect(state.tickets[0]).toEqual(tickets[0]);
    expect(bindingValue(state, 'selectedTicket.subject')).toBe('Team access');
    expect(bindingValue(state, 'selectedTicket.status')).toBe('resolved');
    expect(state.changedTicketIds).toEqual(['T-002']);
    expect(tickets[1].status).toBe('pending');
  });

  it('keeps unassigned filtering distinct from all teammates and permits unassignment', () => {
    let state = ready();
    state = runtimeReducer(state, { type: 'interaction', interaction: { action: 'assignTicket' }, value: '' });
    state = runtimeReducer(state, { type: 'interaction', interaction: { action: 'setAssigneeFilter' }, value: '' });
    expect(filteredTickets(state).map(ticket => ticket.id)).toEqual(['T-001']);
    state = runtimeReducer(state, { type: 'interaction', interaction: { action: 'setAssigneeFilter' }, value: 'all' });
    expect(filteredTickets(state)).toHaveLength(2);
  });

  it('rejects invalid selection/assignment/status and has usable validation with no selected ticket', () => {
    const state = ready();
    for (const [action, value] of [['selectTicket', 'missing'], ['assignTicket', 'unknown teammate'], ['setTicketStatus', 'destroyed'], ['setStatus', 'secret']] as const) {
      const rejected = runtimeReducer(state, { type: 'interaction', interaction: { action }, value });
      expect(rejected.validation).toBeTruthy();
      expect(rejected.tickets).toEqual(state.tickets);
      expect(rejected.selectedTicketId).toBe(state.selectedTicketId);
    }
    const rejected = runtimeReducer({ ...state, selectedTicketId: null }, { type: 'interaction', interaction: { action: 'setTicketStatus', value: 'resolved' } });
    expect(rejected.validation).toContain('Choose a ticket');
    expect(runtimeReducer(rejected, { type: 'clear-validation' }).validation).toBeNull();
  });

  it('ignores stale asynchronous results and preserves locally changed ticket fields across reload', () => {
    let state = ready();
    state = runtimeReducer(state, { type: 'interaction', interaction: { action: 'setTicketStatus', value: 'resolved' } });
    state = runtimeReducer(state, { type: 'load-start', request: 3 });
    expect(runtimeReducer(state, { type: 'load-failure', request: 2, message: 'Old failure' })).toBe(state);
    expect(runtimeReducer(state, { type: 'load-success', request: 2, tickets: [] })).toBe(state);
    state = runtimeReducer(state, { type: 'load-success', request: 3, tickets: structuredClone(tickets) });
    expect(state.loadStatus).toBe('ready');
    expect(selectedTicket(state)?.status).toBe('resolved');
  });

  it('represents error/retry and removal of selected tickets honestly', () => {
    let state = runtimeReducer(ready(), { type: 'load-start', request: 2 });
    state = runtimeReducer(state, { type: 'load-failure', request: 2, message: 'Could not load.' });
    expect(state.loadStatus).toBe('error');
    expect(state.error).toBe('Could not load.');
    state = runtimeReducer(state, { type: 'load-start', request: 3 });
    expect(state.error).toBeNull();
    state = runtimeReducer(state, { type: 'load-success', request: 3, tickets: [] });
    expect(state.selectedTicketId).toBeNull();
    expect(bindingValue(state, 'selectedTicket.subject')).toBe('Choose a ticket');
  });

  it('evaluates only the documented condition vocabulary against runtime state', () => {
    const state = ready();
    expect(conditionSatisfied(state, 'hasSelection')).toBe(true);
    expect(conditionSatisfied(state, 'hasResults')).toBe(true);
    expect(conditionSatisfied(state, 'empty')).toBe(false);
    expect(conditionSatisfied(state, 'tab:inbox')).toBe(true);
    expect(conditionSatisfied(state, 'tab:activity')).toBe(false);
    expect(conditionSatisfied({ ...state, query: 'unmatched' }, 'empty')).toBe(true);
    expect(conditionSatisfied(initialRuntimeState(initial), 'loading')).toBe(true);
    expect(conditionSatisfied({ ...state, loadStatus: 'error' }, 'error')).toBe(true);
    expect(conditionSatisfied(state, 'globalThis.secret()')).toBe(false);
  });
});
