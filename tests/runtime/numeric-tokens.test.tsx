// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyOperations, validateDocument } from '../../src/core/document';
import { createStarterDocument } from '../../src/core/starter';
import type { Breakpoint, NumericValue, StudioDocument } from '../../src/core/types';
import { Frame, StudioProvider, StudioRuntime, Text } from '../../src/runtime/StudioRuntime';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

function fixture(): StudioDocument {
  const doc = createStarterDocument('numeric-runtime');
  Object.assign(doc.tokens.primitive, { spacing: 24, padding: 20, columns: 3, width: 840, height: 700, grow: 1, fontSize: 26, fontWeight: 700, radius: 18, phoneSpacing: 10, phonePadding: 12, phoneColumns: 1, phoneWidth: 360, phoneHeight: 900, zero: 0, tabletPadding: 18 });
  Object.assign(doc.tokens.semantic, { spacing: '$primitive.spacing', contentGap: '$semantic.spacing', padding: '$primitive.padding', columns: '$primitive.columns', width: '$primitive.width', height: '$primitive.height', grow: '$primitive.grow', titleSize: '$primitive.fontSize', titleWeight: '$primitive.fontWeight', radius: '$primitive.radius' });
  doc.nodes.workspace.layout = { display: 'grid', gap: '$semantic.contentGap', padding: '$semantic.padding', columns: '$semantic.columns', width: '$semantic.width', height: '$semantic.height', grow: '$semantic.grow' };
  doc.nodes.workspace.responsive = { tablet: { padding: '$primitive.tabletPadding' }, phone: { gap: '$primitive.phoneSpacing', padding: '$primitive.phonePadding', columns: '$primitive.phoneColumns', width: '$primitive.phoneWidth', height: '$primitive.phoneHeight', grow: '$primitive.zero' } };
  doc.nodes.workspace.props.radius = '$semantic.radius';
  doc.nodes['ticket-details'].props.radius = '$semantic.radius';
  Object.assign(doc.nodes['workspace-title'].props, { text: '$49/month', size: '$semantic.titleSize', weight: '$semantic.titleWeight' });
  return validateDocument(doc);
}
function node(id: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-studio-id="${id}"]`);
  if (!found) throw new Error(`Expected rendered node ${id}`);
  return found;
}
async function render(doc: StudioDocument, breakpoint: Breakpoint = 'desktop'): Promise<void> {
  await act(async () => root.render(<StudioRuntime document={doc} breakpoint={breakpoint} />));
}

describe('shared runtime numeric token values', () => {
  it('renders all numeric layout/typography/radius references as exact numeric styles', async () => {
    const doc = fixture();
    await render(doc);
    const frame = node('workspace');
    expect(frame.style.gap).toBe('24px');
    expect(frame.style.padding).toBe('20px');
    expect(frame.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    expect(frame.style.width).toBe('840px');
    expect(frame.style.height).toBe('700px');
    expect(frame.style.flexGrow).toBe('1');
    expect(frame.style.borderRadius).toBe('18px');
    expect(node('ticket-details').style.borderRadius).toBe('18px');
    expect(node('workspace-title').style.fontSize).toBe('26px');
    expect(node('workspace-title').style.fontWeight).toBe('700');
    expect(node('workspace-title').textContent).toBe('$49/month');
    expect(doc.nodes.workspace.layout.gap).toBe('$semantic.contentGap');
  });

  it('resolves responsive references over base values and keeps fill/auto and valid zero values', async () => {
    const doc = fixture();
    await render(doc, 'tablet');
    expect(node('workspace').style.padding).toBe('18px');
    expect(node('workspace').style.gap).toBe('24px');
    expect(node('workspace').style.width).toBe('840px');
    await render(doc, 'phone');
    const frame = node('workspace');
    expect(frame.style.gap).toBe('10px');
    expect(frame.style.padding).toBe('12px');
    expect(frame.style.gridTemplateColumns).toBe('repeat(1, minmax(0, 1fr))');
    expect(frame.style.width).toBe('360px');
    expect(frame.style.height).toBe('900px');
    expect(frame.style.flexGrow).toBe('0');
    const keywords = structuredClone(doc);
    keywords.nodes.workspace.responsive.phone = { width: 'fill', height: 'auto', gap: '$primitive.zero', padding: '$primitive.zero', grow: '$primitive.zero' };
    keywords.nodes.workspace.props.radius = '$primitive.zero';
    await render(validateDocument(keywords), 'phone');
    expect(node('workspace').style.width).toBe('100%');
    expect(node('workspace').style.height).toBe('auto');
    expect(node('workspace').style.gap).toBe('0px');
    expect(node('workspace').style.padding).toBe('0px');
    expect(node('workspace').style.flexGrow).toBe('0');
    expect(node('workspace').style.borderRadius).toBe('0px');
  });

  it('updates alias-dependent styles without resetting loaded ticket interaction state', async () => {
    const doc = fixture();
    await render(doc);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 170)); });
    expect(container.querySelectorAll('tbody tr')).toHaveLength(6);
    const search = container.querySelector<HTMLInputElement>('#app-field-ticket-search')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'invoice');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    const next = applyOperations(doc, { id: 'numeric-token-change', projectId: doc.id, baseRevision: doc.revision, label: 'Update numeric design tokens', operations: [
      { type: 'token', category: 'primitive', name: 'spacing', value: 32 },
      { type: 'token', category: 'primitive', name: 'radius', value: 24 },
      { type: 'token', category: 'primitive', name: 'fontSize', value: 30 },
      { type: 'token', category: 'primitive', name: 'fontWeight', value: 900 },
    ] });
    await render(next);
    expect(node('workspace').style.gap).toBe('32px');
    expect(node('workspace').style.borderRadius).toBe('24px');
    expect(node('ticket-details').style.borderRadius).toBe('24px');
    expect(node('workspace-title').style.fontSize).toBe('30px');
    expect(node('workspace-title').style.fontWeight).toBe('900');
    expect(container.querySelector<HTMLInputElement>('#app-field-ticket-search')?.value).toBe('invoice');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.querySelector('tbody tr')?.getAttribute('data-ticket-id')).toBe('TK-1041');
    expect(next.nodes.workspace.layout.gap).toBe('$semantic.contentGap');
    expect(doc.tokens.primitive.spacing).toBe(24);
  });

  it.each(['$primitive.violet', '$primitive.missing', '24', 'calc(12px + 4px)'])('refuses numeric CSS passthrough at runtime for %s', value => {
    const doc = fixture();
    const meta = { schemaVersion: doc.schemaVersion, id: doc.id, name: doc.name, revision: doc.revision, rootId: doc.rootId, tokens: doc.tokens, theme: doc.theme, data: doc.data, initialState: doc.initialState };
    expect(() => renderToStaticMarkup(<StudioProvider meta={meta}><Frame studioId="unsafe-gap" layout={{ gap: value as NumericValue }} /></StudioProvider>)).toThrow();
    expect(() => renderToStaticMarkup(<StudioProvider meta={meta}><Text studioId="unsafe-size" props={{ size: value, text: 'Safe text' }} /></StudioProvider>)).toThrow();
  });
});
