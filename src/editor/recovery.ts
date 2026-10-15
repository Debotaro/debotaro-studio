import { applyOperations } from '../core/document';
import type { StudioDocument } from '../core/types';
import type { PendingEdit } from './persistence';

/** Validate cached work completely before rendering/replaying any of its queue. */
export function validateRecoveryQueue(input: unknown, snapshot: StudioDocument): PendingEdit[] {
  if (!Array.isArray(input) || input.length > 1000) throw new Error('Browser recovery queue is invalid or exceeds its limit.');
  let preview = snapshot;
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some(key => !['envelope', 'expected', 'strict'].includes(key))
      || typeof item.strict !== 'boolean' || !item.expected || typeof item.expected !== 'object' || Array.isArray(item.expected)
      || Object.values(item.expected).some(value => typeof value !== 'string')
      || !item.envelope || !Number.isSafeInteger(item.envelope.baseRevision) || item.envelope.baseRevision < 0) throw new Error('Browser recovery contains an invalid queued edit.');
    preview = applyOperations(preview, { ...item.envelope, baseRevision: preview.revision });
  }
  return input as PendingEdit[];
}
