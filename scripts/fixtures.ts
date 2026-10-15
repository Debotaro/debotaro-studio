import { createNode, validateDocument } from '../src/core/document';
import { createDefaultTokens } from '../src/core/tokens';
import type { StudioDocument, StudioNode } from '../src/core/types';

export type BenchmarkShape = 'broad-siblings' | 'nested-balanced';
export const benchmarkShapes: readonly BenchmarkShape[] = ['broad-siblings', 'nested-balanced'];
export const benchmarkSizes = [100, 500, 1_000] as const;

/** Exact sizes, deterministic identities/data, broad root or balanced 8-way containers. */
export function createBenchmarkFixture(count: number, shape: BenchmarkShape): StudioDocument {
  if (!Number.isInteger(count) || count < 17 || count > 2_000) throw new Error('Benchmark fixtures require 17–2,000 nodes.');
  const root = createNode('Frame', 'root');
  root.name = 'Benchmark root';
  root.layout = { display: 'flex', direction: 'column', gap: 12, padding: 20, width: 'fill' };
  const nodes: Record<string, StudioNode> = { root };
  const frames: StudioNode[] = [root];
  const frameCount = shape === 'nested-balanced' ? Math.floor((count - 1) / 16) : 0;
  for (let index = 0; index < frameCount; index++) {
    const frame = createNode('Frame', `frame-${index}`);
    frame.name = `Frame ${index}`;
    frame.layout = { display: 'grid', columns: 2, gap: 8, padding: 12 };
    frames[Math.floor(index / 8)].children.push(frame.id);
    frames.push(frame);
    nodes[frame.id] = frame;
  }
  const leaves = count - frames.length;
  for (let index = 0; index < leaves; index++) {
    const node = createNode('Text', `text-${index}`);
    node.name = `Text ${index}`;
    node.props.text = `Reproducible fictional layer ${index}`;
    const parent = shape === 'broad-siblings' ? root : frames[1 + index % (frames.length - 1)];
    parent.children.push(node.id);
    nodes[node.id] = node;
  }
  return validateDocument({ schemaVersion: 1, id: `benchmark-${shape}-${count}`, name: `${count}-node ${shape} fixture`, revision: 0, rootId: root.id, nodes, tokens: createDefaultTokens(), theme: 'light', data: { tickets: [] }, initialState: { query: '', status: 'all', assignee: 'all', selectedTicketId: null, tab: 'inbox' } });
}

export function describeBenchmarkFixture(document: StudioDocument) {
  let maximumDepth = 0;
  const visit = (id: string, depth: number) => {
    maximumDepth = Math.max(maximumDepth, depth);
    document.nodes[id].children.forEach(child => visit(child, depth + 1));
  };
  visit(document.rootId, 0);
  const nodes = Object.values(document.nodes);
  return {
    nodes: nodes.length,
    frames: nodes.filter(node => node.type === 'Frame').length,
    textNodes: nodes.filter(node => node.type === 'Text').length,
    maximumDepth,
    rootChildren: document.nodes[document.rootId].children.length,
    maximumChildren: Math.max(...nodes.map(node => node.children.length)),
    fixtureDescription: 'Fictional literal Text leaves, default semantic tokens, flex root; balanced shape adds 8-way grid containers. No ticket records or network connectors.',
  };
}
