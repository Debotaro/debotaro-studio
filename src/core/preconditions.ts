import type { StudioDocument, Operation } from './types';
export const fingerprint = (value: unknown) => JSON.stringify(value) ?? 'undefined';
export function touchedValues(doc: StudioDocument, operations: Operation[]): Record<string,string> {
  const result: Record<string,string>={};
  for(const op of operations){
    if(op.type==='update') for(const field of Object.keys(op.patch)) result[`node:${op.nodeId}:${field}`]=fingerprint(doc.nodes[op.nodeId]?.[field as keyof typeof op.patch]);
    else if(op.type==='token')result[`token:${op.category}:${op.name}`]=fingerprint(doc.tokens[op.category][op.name]);
    else if(op.type==='theme')result.theme=fingerprint(doc.theme);
  }return result;
}
