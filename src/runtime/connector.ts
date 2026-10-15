import type { Ticket } from '../core/types';

/** Future connectors implement this boundary; the bundled connector only uses fictional local data. */
export interface TicketConnector {
  readonly source: 'local-fictional' | 'external';
  load(signal: AbortSignal): Promise<Ticket[]>;
}

export interface LocalConnectorOptions {
  delayMs?: number;
  /** Explicit test/demo fault injection, never a simulated remote service. */
  failuresBeforeSuccess?: number;
}

export function validateTicketData(value: unknown): Ticket[] {
  if (!Array.isArray(value) || value.length > 2_000) throw new Error('The connector returned an invalid ticket list.');
  const ids = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') throw new Error('The connector returned an invalid ticket.');
    const ticket = entry as Record<string, unknown>;
    for (const key of ['id', 'subject', 'customer', 'email', 'assignee', 'message', 'company', 'updatedAt']) {
      if (typeof ticket[key] !== 'string' || (ticket[key] as string).length > 10_000) throw new Error(`The connector returned an invalid ${key}.`);
    }
    if (!ticket.id || ids.has(ticket.id as string)) throw new Error('The connector returned duplicate or empty ticket identities.');
    if (!['open', 'pending', 'resolved'].includes(ticket.status as string) || !['low', 'normal', 'high'].includes(ticket.priority as string)) throw new Error('The connector returned an invalid status or priority.');
    ids.add(ticket.id as string);
  }
  return structuredClone(value) as Ticket[];
}

/** Each runtime gets its own connector instance and independent data copy. */
export function createLocalTicketConnector(tickets: Ticket[], options: LocalConnectorOptions = {}): TicketConnector {
  const source = validateTicketData(tickets);
  let failuresRemaining = Math.max(0, options.failuresBeforeSuccess ?? 0);
  const delayMs = Math.max(0, Math.min(5_000, options.delayMs ?? 140));
  return {
    source: 'local-fictional',
    load(signal) {
      return new Promise<Ticket[]>((resolve, reject) => {
        if (signal.aborted) { reject(new DOMException('Ticket loading cancelled.', 'AbortError')); return; }
        const onAbort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          reject(new DOMException('Ticket loading cancelled.', 'AbortError'));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          if (failuresRemaining > 0) {
            failuresRemaining -= 1;
            reject(new Error('The fictional local data source could not load. Try again.'));
          } else resolve(structuredClone(source));
        }, delayMs);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
}
