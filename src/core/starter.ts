import { createNode, validateDocument } from './document';
import { createDefaultTokens } from './tokens';
import type { ComponentType, StudioDocument, StudioNode, Ticket } from './types';

/** Every person, organization, message and address in this starter is fictional. */
export const fictionalTickets: Ticket[] = [
  { id: 'TK-1042', subject: 'Can we invite our whole team?', customer: 'Maya Chen', email: 'maya@northstar.example', status: 'open', priority: 'high', assignee: 'Alex Morgan', message: 'Hello! We are preparing our next workshop and would love to invite twelve teammates. Could you help us understand the team invitation flow?', company: 'Northstar Paper Co.', updatedAt: '2026-10-14T09:40:00Z' },
  { id: 'TK-1041', subject: 'A quick question about invoices', customer: 'Sam Rivera', email: 'sam@juniper.example', status: 'pending', priority: 'normal', assignee: 'Jordan Ellis', message: 'Our finance team needs the billing contact shown on our next invoice. Where can we update that information? Thank you for your help.', company: 'Juniper Works', updatedAt: '2026-10-14T09:12:00Z' },
  { id: 'TK-1040', subject: 'My saved view looks different', customer: 'Noor Patel', email: 'noor@plainlight.example', status: 'open', priority: 'normal', assignee: 'Alex Morgan', message: 'I saved a view for our weekly review, but one of the columns is missing when I reopen it. I am using the desktop browser.', company: 'Plainlight Studio', updatedAt: '2026-10-14T08:55:00Z' },
  { id: 'TK-1039', subject: 'Thanks for the onboarding help', customer: 'Ellis Park', email: 'ellis@fable.example', status: 'resolved', priority: 'low', assignee: 'Taylor Reed', message: 'The onboarding steps worked perfectly. Our first project is ready, and everyone can sign in. Thanks for the thoughtful guidance!', company: 'Fable Supply', updatedAt: '2026-10-14T08:30:00Z' },
  { id: 'TK-1038', subject: 'Exporting a project for review', customer: 'Ari Okafor', email: 'ari@smallhours.example', status: 'open', priority: 'high', assignee: '', message: 'We want to share a project with a teammate who does not have an account yet. Is there an export we can send for a local review?', company: 'Small Hours', updatedAt: '2026-10-14T08:05:00Z' },
  { id: 'TK-1037', subject: 'Changing our workspace name', customer: 'Robin Wells', email: 'robin@branchline.example', status: 'pending', priority: 'low', assignee: 'Jordan Ellis', message: 'Our studio has a new name. Could you point us to the workspace settings so we can update it for everyone?', company: 'Branchline Goods', updatedAt: '2026-10-14T07:45:00Z' },
];

export function createStarterDocument(projectId = `project-${globalThis.crypto.randomUUID()}`): StudioDocument {
  const nodes: Record<string, StudioNode> = {};
  function add(type: ComponentType, id: string, name: string, patch: Partial<StudioNode> = {}): StudioNode {
    const node = { ...createNode(type, id), name, ...patch };
    nodes[id] = node;
    return node;
  }
  add('Frame', 'workspace', 'Support workspace', {
    props: { background: '$semantic.background', radius: 0 },
    layout: { display: 'flex', direction: 'column', gap: 24, padding: 32, width: 'fill', height: 'auto' },
    responsive: { tablet: { padding: 24, gap: 20 }, phone: { padding: 16, gap: 16 } },
    children: ['workspace-header', 'workspace-views', 'workspace-content', 'fictional-notice'],
  });
  add('Frame', 'workspace-header', 'Workspace heading', {
    props: { background: 'transparent' }, layout: { display: 'flex', direction: 'row', justify: 'between', align: 'center', gap: 16 },
    responsive: { phone: { direction: 'column', align: 'stretch', gap: 12 } }, children: ['heading-copy', 'refresh-tickets'],
  });
  add('Frame', 'heading-copy', 'Heading copy', { props: { background: 'transparent' }, layout: { display: 'flex', direction: 'column', gap: 6 }, children: ['workspace-eyebrow', 'workspace-title', 'workspace-description'] });
  add('Text', 'workspace-eyebrow', 'Workspace label', { props: { text: 'NORTHSTAR · CUSTOMER CARE', variant: 'eyebrow', color: '$semantic.accent', size: 12, weight: 700 } });
  add('Text', 'workspace-title', 'Inbox heading', { props: { text: 'A little care goes a long way.', variant: 'title', color: '$semantic.text', size: 28, weight: 700 }, responsive: { phone: { width: 'fill' } } });
  add('Text', 'workspace-description', 'Inbox description', { props: { text: 'A thoughtful place to help your customers move forward.', variant: 'body', color: '$semantic.muted', size: 14, weight: 400 } });
  add('Button', 'refresh-tickets', 'Refresh tickets', { props: { label: 'Refresh inbox', variant: 'secondary', disabled: false }, events: { onClick: { action: 'reloadTickets' } } });
  add('Tabs', 'workspace-views', 'Workspace views', { props: { label: 'Workspace views', options: [{ label: 'Inbox', value: 'inbox' }, { label: 'Activity', value: 'activity' }] }, bindings: { value: 'tab' }, events: { onChange: { action: 'setTab' } } });
  add('Frame', 'workspace-content', 'Inbox and ticket details', { props: { background: 'transparent' }, layout: { display: 'flex', direction: 'row', gap: 20, align: 'start', width: 'fill' }, responsive: { tablet: { direction: 'column', align: 'stretch' }, phone: { direction: 'column', gap: 16, align: 'stretch' } }, children: ['inbox-panel', 'ticket-details'] });
  add('Frame', 'inbox-panel', 'Inbox panel', { props: { background: '$semantic.surface', border: '$semantic.border', radius: 14, shadow: 'soft' }, layout: { display: 'flex', direction: 'column', gap: 18, padding: 20, grow: 1, width: 'fill' }, responsive: { phone: { padding: 14, gap: 14 } }, children: ['inbox-header', 'inbox-filters', 'ticket-table'] });
  add('Frame', 'inbox-header', 'Inbox panel heading', { props: { background: 'transparent' }, layout: { display: 'flex', direction: 'row', justify: 'between', align: 'center', gap: 8 }, children: ['inbox-title', 'demo-badge'] });
  add('Text', 'inbox-title', 'Ticket list heading', { props: { text: 'Your team inbox', variant: 'title', color: '$semantic.text', size: 18, weight: 600 } });
  add('Badge', 'demo-badge', 'Fictional data badge', { props: { label: 'Demo workspace', tone: 'accent' } });
  add('Frame', 'inbox-filters', 'Search and filters', { props: { background: 'transparent' }, layout: { display: 'grid', columns: 3, gap: 12, align: 'end', width: 'fill' }, responsive: { tablet: { columns: 3 }, phone: { columns: 1, gap: 10 } }, children: ['ticket-search', 'status-filter', 'assignee-filter'] });
  add('Field', 'ticket-search', 'Search tickets', { props: { label: 'Search tickets', placeholder: 'Subject, name or email…', type: 'search', required: false, disabled: false }, bindings: { value: 'query' }, events: { onChange: { action: 'setQuery' } } });
  add('Select', 'status-filter', 'Filter by status', { props: { label: 'Status', options: [{ label: 'All statuses', value: 'all' }, { label: 'Open', value: 'open' }, { label: 'Pending', value: 'pending' }, { label: 'Resolved', value: 'resolved' }], disabled: false }, bindings: { value: 'status' }, events: { onChange: { action: 'setStatus' } } });
  add('Select', 'assignee-filter', 'Filter by teammate', { props: { label: 'Assignee', options: [{ label: 'Anyone', value: 'all' }, { label: 'Unassigned', value: '' }, { label: 'Alex Morgan', value: 'Alex Morgan' }, { label: 'Jordan Ellis', value: 'Jordan Ellis' }, { label: 'Taylor Reed', value: 'Taylor Reed' }], disabled: false }, bindings: { value: 'assignee' }, events: { onChange: { action: 'setAssigneeFilter' } } });
  add('Table', 'ticket-table', 'Fictional ticket table', { props: { label: 'Customer support tickets', columns: ['subject', 'customer', 'status', 'assignee'], emptyMessage: 'No tickets match. Try another search or clear your filters.' }, bindings: { value: 'selectedTicketId' }, events: { onClick: { action: 'selectTicket' } }, layout: { width: 'fill' } });
  add('DetailPanel', 'ticket-details', 'Ticket details', { props: { title: 'Ticket details', subtitle: 'Give every conversation a little attention.', background: '$semantic.surface', radius: 14 }, layout: { width: 336 }, responsive: { tablet: { width: 'fill' }, phone: { width: 'fill' } } });
  add('Text', 'fictional-notice', 'Fictional data disclosure', { props: { text: 'Fictional people and tickets · Changes stay in this local preview.', variant: 'caption', color: '$semantic.muted', size: 12, weight: 400 } });
  return validateDocument({ schemaVersion: 1, id: projectId, name: 'Northstar Support', revision: 0, rootId: 'workspace', nodes, tokens: createDefaultTokens(), theme: 'light', data: { tickets: structuredClone(fictionalTickets) }, initialState: { query: '', status: 'all', assignee: 'all', selectedTicketId: 'TK-1042', tab: 'inbox' } });
}
