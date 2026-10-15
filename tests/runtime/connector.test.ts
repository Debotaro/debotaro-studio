import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ticket } from '../../src/core/types';
import { createLocalTicketConnector, validateTicketData } from '../../src/runtime/connector';

const ticket: Ticket = { id: 'T-001', subject: 'Fictional support', customer: 'Ari Stone', email: 'ari@example.test', status: 'open', priority: 'normal', assignee: 'Maya Chen', message: 'Help with fictional data.', company: 'Fictional North', updatedAt: '2026-10-01T10:00:00Z' };
afterEach(() => vi.useRealTimers());
describe('local connector boundary', () => {
  it('loads independent local data copies and never modifies caller data', async () => {
    const connector = createLocalTicketConnector([ticket], { delayMs: 0 });
    expect(connector.source).toBe('local-fictional');
    const loaded = await connector.load(new AbortController().signal);
    loaded[0].subject = 'Edited';
    expect((await connector.load(new AbortController().signal))[0].subject).toBe(ticket.subject);
    expect(ticket.subject).toBe('Fictional support');
  });
  it('supports explicit local error injection and successful retry', async () => {
    const connector = createLocalTicketConnector([ticket], { delayMs: 0, failuresBeforeSuccess: 1 });
    await expect(connector.load(new AbortController().signal)).rejects.toThrow('fictional local');
    await expect(connector.load(new AbortController().signal)).resolves.toEqual([ticket]);
  });
  it('cancels both an in-flight and an already cancelled request', async () => {
    vi.useFakeTimers();
    const connector = createLocalTicketConnector([ticket], { delayMs: 100 });
    const controller = new AbortController();
    const request = connector.load(controller.signal);
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    await expect(connector.load(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects duplicate identities and malformed data at the connector boundary', () => {
    expect(() => validateTicketData([ticket, ticket])).toThrow('duplicate');
    expect(() => validateTicketData([{ ...ticket, status: 'unknown' }])).toThrow('status');
    expect(() => validateTicketData([{ ...ticket, message: null }])).toThrow('message');
    expect(() => validateTicketData({ tickets: [ticket] })).toThrow('list');
  });
});
