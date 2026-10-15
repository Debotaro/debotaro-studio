// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStarterDocument } from '../../src/core/starter';
import { Button, DetailPanel, Field, Frame, Select, StudioProvider, StudioRuntime, Table, Tabs, Text } from '../../src/runtime/StudioRuntime';
import type { TicketConnector } from '../../src/runtime/connector';
import type { StudioDocument, Ticket } from '../../src/core/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
let doc: StudioDocument;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  doc = createStarterDocument('runtime-test');
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
function meta(document: StudioDocument) {
  return { schemaVersion: document.schemaVersion, id: document.id, name: document.name, revision: document.revision, rootId: document.rootId, tokens: document.tokens, theme: document.theme, data: document.data, initialState: document.initialState };
}
function immediateConnector(): TicketConnector {
  return { source: 'local-fictional', load: async () => structuredClone(doc.data.tickets) };
}
async function renderFixture(connector: TicketConnector = immediateConnector()) {
  await act(async () => root.render(<StudioProvider meta={meta(doc)} connector={connector}><Frame studioId="frame"><Field studioId="search" props={{ label: 'Search', type: 'search' }} bindings={{ value: 'query' }} events={{ onChange: { action: 'setQuery' } }} /><Select studioId="filter-status" props={{ label: 'Filter status' }} bindings={{ value: 'status' }} events={{ onChange: { action: 'setStatus' } }} /><Select studioId="filter-assignee" props={{ label: 'Filter teammate' }} bindings={{ value: 'assignee' }} events={{ onChange: { action: 'setAssigneeFilter' } }} /><Table studioId="table" bindings={{ value: 'selectedTicketId' }} events={{ onClick: { action: 'selectTicket' } }} /><DetailPanel studioId="details" /></Frame></StudioProvider>));
}
async function fillInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function select(select: HTMLSelectElement, value: string) {
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
function ticketRows(): HTMLTableRowElement[] { return Array.from(container.querySelectorAll('tbody tr')); }
function element<T extends HTMLElement>(selector: string): T {
  const value = container.querySelector<T>(selector);
  if (!value) throw new Error(`Expected DOM control ${selector}`);
  return value;
}

describe('actual shared React application wiring', () => {
  it('shows real asynchronous loading then ticket table and built-in selected-ticket details', async () => {
    let resolve: (tickets: Ticket[]) => void = () => { throw new Error('Fixture not started'); };
    const connector: TicketConnector = { source: 'local-fictional', load: () => new Promise(done => { resolve = done; }) };
    await renderFixture(connector);
    expect(container.textContent).toContain('Loading fictional tickets');
    expect(container.querySelector('table')).toBeNull();
    await act(async () => resolve(structuredClone(doc.data.tickets)));
    expect(ticketRows()).toHaveLength(6);
    expect(element<HTMLSelectElement>('#app-status-details').value).toBe('open');
    expect(container.textContent).toContain('Can we invite our whole team?');
  });

  it('wires search, empty-state clearing, status and unassigned filters', async () => {
    await renderFixture();
    await fillInput(element<HTMLInputElement>('#app-field-search'), 'invoice');
    expect(ticketRows()).toHaveLength(1);
    expect(ticketRows()[0].dataset.ticketId).toBe('TK-1041');
    await fillInput(element<HTMLInputElement>('#app-field-search'), 'never matches a fictional ticket');
    expect(container.textContent).toContain('No matching tickets');
    const clear = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Clear filters');
    expect(clear).toBeDefined();
    await act(async () => clear?.click());
    expect(ticketRows()).toHaveLength(6);
    await select(element<HTMLSelectElement>('#app-select-filter-status'), 'resolved');
    expect(ticketRows().map(row => row.dataset.ticketId)).toEqual(['TK-1039']);
    await select(element<HTMLSelectElement>('#app-select-filter-status'), 'all');
    await select(element<HTMLSelectElement>('#app-select-filter-assignee'), '');
    expect(ticketRows().map(row => row.dataset.ticketId)).toEqual(['TK-1038']);
  });

  it('wires row selection, status and assignment edits without mutating the Studio document', async () => {
    await renderFixture();
    await act(async () => element<HTMLButtonElement>('[data-ticket-id="TK-1041"] button').click());
    expect(element<HTMLSelectElement>('#app-status-details').value).toBe('pending');
    await select(element<HTMLSelectElement>('#app-status-details'), 'resolved');
    await select(element<HTMLSelectElement>('#app-assignment-details'), 'Alex Morgan');
    expect(element<HTMLElement>('[data-ticket-id="TK-1041"]').textContent).toContain('Resolved');
    expect(element<HTMLElement>('[data-ticket-id="TK-1041"]').textContent).toContain('Alex Morgan');
    expect(container.textContent).toContain('Updated in this preview');
    expect(doc.data.tickets.find(ticket => ticket.id === 'TK-1041')).toMatchObject({ status: 'pending', assignee: 'Jordan Ellis' });
  });

  it('shows a recoverable local connector error and wires retry', async () => {
    let calls = 0;
    await renderFixture({ source: 'local-fictional', load: async () => { if (++calls === 1) throw new Error('Explicit test failure'); return doc.data.tickets; } });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Tickets couldn’t load');
    const retry = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Try again');
    await act(async () => retry?.click());
    expect(calls).toBe(2);
    expect(ticketRows()).toHaveLength(6);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('enforces required/email field validation and keeps invalid assignments recoverable', async () => {
    let calls = 0;
    const connector: TicketConnector = { source: 'local-fictional', load: async () => { calls++; return doc.data.tickets; } };
    await act(async () => root.render(<StudioProvider meta={meta(doc)} connector={connector}><Field studioId="email" props={{ label: 'Email', type: 'email', required: true }} events={{ onSubmit: { action: 'reloadTickets' } }} /><Button studioId="invalid" props={{ label: 'Invalid assignment' }} events={{ onClick: { action: 'assignTicket', value: 'Unknown agent' } }} /><Table studioId="table" /></StudioProvider>));
    const input = element<HTMLInputElement>('#app-field-email');
    expect(input.checkValidity()).toBe(false);
    await act(async () => element<HTMLFormElement>('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(calls).toBe(1);
    await fillInput(input, 'ari@example.test');
    expect(input.checkValidity()).toBe(true);
    await act(async () => element<HTMLFormElement>('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(calls).toBe(2);
    await act(async () => element<HTMLButtonElement>('[data-studio-id="invalid"]').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Choose an available teammate');
  });

  it('applies responsive layout and shared tokens while design selection prevents runtime actions', async () => {
    const selections: string[] = [];
    await act(async () => root.render(<StudioRuntime document={doc} breakpoint="phone" designMode selectedId="workspace-title" onSelect={id => selections.push(id)} />));
    expect(element<HTMLDivElement>('.studio-runtime').dataset.breakpoint).toBe('phone');
    expect(element<HTMLDivElement>('[data-studio-id="workspace"]').style.padding).toBe('16px');
    expect(element<HTMLDivElement>('[data-studio-id="inbox-filters"]').style.gridTemplateColumns).toBe('repeat(1, minmax(0, 1fr))');
    expect(element<HTMLElement>('[data-studio-id="workspace-title"]').dataset.selected).toBe('true');
    expect(element<HTMLButtonElement>('[data-studio-id="refresh-tickets"]').getAttribute('aria-label')).toBe('Refresh inbox');
    expect(element<HTMLElement>('[data-studio-id="workspace-eyebrow"]').style.color).toBe('rgb(109, 74, 255)');
    await act(async () => element<HTMLButtonElement>('[data-studio-id="refresh-tickets"]').click());
    expect(selections).toEqual(['refresh-tickets']);
  });

  it('evaluates declarative conditions and exposes their layers in design mode', async () => {
    await act(async () => root.render(<StudioProvider meta={meta(doc)} connector={immediateConnector()}><Text studioId="selected" props={{ text: 'A ticket is selected', visibleWhen: 'hasSelection' }} /><Text studioId="empty" props={{ text: 'Empty list', visibleWhen: 'empty' }} /><Text studioId="activity" props={{ text: 'Activity view', visibleWhen: 'tab:activity' }} /><Button studioId="switch" props={{ label: 'Switch view' }} events={{ onClick: { action: 'setTab', value: 'activity' } }} /></StudioProvider>));
    expect(container.textContent).toContain('A ticket is selected');
    expect(container.textContent).not.toContain('Empty list');
    expect(container.textContent).not.toContain('Activity view');
    await act(async () => element<HTMLButtonElement>('[data-studio-id="switch"]').click());
    expect(container.textContent).toContain('Activity view');
    doc.nodes['workspace-title'].props.visibleWhen = 'empty';
    await act(async () => root.render(<StudioRuntime document={doc} designMode />));
    expect(container.querySelector('[data-studio-id="workspace-title"]')).not.toBeNull();
  });

  it('uses keyboard tab navigation and shows real session edits in the activity view', async () => {
    await act(async () => root.render(<StudioProvider meta={meta(doc)} connector={immediateConnector()}><Tabs studioId="views" props={{ options: [{ label: 'Inbox', value: 'inbox' }, { label: 'Activity', value: 'activity' }] }} bindings={{ value: 'tab' }} events={{ onChange: { action: 'setTab' } }} /><Table studioId="table" bindings={{ value: 'selectedTicketId' }} events={{ onClick: { action: 'selectTicket' } }} /><DetailPanel studioId="details" /></StudioProvider>));
    const inbox = element<HTMLButtonElement>('[role="tab"]');
    await act(async () => { inbox.focus(); inbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(document.activeElement?.textContent).toBe('Activity');
    expect(document.activeElement?.getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).toContain('No local updates yet');
    await select(element<HTMLSelectElement>('#app-status-details'), 'resolved');
    expect(container.textContent).toContain('1 updated');
    expect(container.textContent).toContain('Resolved · Assigned to Alex Morgan');
    expect(container.textContent).not.toContain('No local updates yet');
    await act(async () => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(document.activeElement?.textContent).toBe('Inbox');
    expect(ticketRows()).toHaveLength(6);
  });
});
