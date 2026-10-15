/** Shared contracts. Main-agent owned; propose changes before editing. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const componentTypes = ['Frame', 'Text', 'Button', 'Field', 'Select', 'Tabs', 'Badge', 'Table', 'DetailPanel'] as const;
export type ComponentType = typeof componentTypes[number];
export type Breakpoint = 'desktop' | 'tablet' | 'phone';
export type TokenReference = `$primitive.${string}` | `$semantic.${string}`;
export type NumericValue = number | TokenReference;
export interface Layout {
  display?: 'flex' | 'grid'; direction?: 'row' | 'column'; gap?: NumericValue;
  padding?: NumericValue; columns?: NumericValue; width?: NumericValue | 'fill'; height?: NumericValue | 'auto';
  align?: 'start' | 'center' | 'end' | 'stretch'; justify?: 'start' | 'center' | 'end' | 'between';
  grow?: NumericValue;
}
export type BindingPath = 'query' | 'status' | 'assignee' | 'selectedTicketId' | 'selectedTicket.subject' | 'selectedTicket.customer' | 'selectedTicket.email' | 'selectedTicket.status' | 'selectedTicket.assignee' | 'tab';
export type RuntimeAction = 'setQuery' | 'setStatus' | 'setAssigneeFilter' | 'selectTicket' | 'assignTicket' | 'setTicketStatus' | 'setTab' | 'reloadTickets';
export interface Interaction { action: RuntimeAction; value?: string }
export interface StudioNode {
  id: string; type: ComponentType; name: string; children: string[];
  props: Record<string, JsonValue>; layout: Layout;
  responsive: Partial<Record<Breakpoint, Layout>>;
  bindings: Record<string, BindingPath>;
  events: Partial<Record<'onClick' | 'onChange' | 'onSubmit', Interaction>>;
}
export interface Ticket {
  id: string; subject: string; customer: string; email: string;
  status: 'open' | 'pending' | 'resolved'; priority: 'low' | 'normal' | 'high';
  assignee: string; message: string; company: string; updatedAt: string;
}
export interface InitialState { query: string; status: string; assignee: string; selectedTicketId: string | null; tab: string }
export interface DesignTokens { primitive: Record<string, string | number>; semantic: Record<string, string | number> }
export interface StudioDocument {
  schemaVersion: 1; id: string; name: string; revision: number; rootId: string;
  nodes: Record<string, StudioNode>; tokens: DesignTokens;
  theme: 'light' | 'dark'; data: { tickets: Ticket[] }; initialState: InitialState;
}
export type NodePatch = Partial<Pick<StudioNode, 'name' | 'props' | 'layout' | 'responsive' | 'bindings' | 'events'>>;
export type Operation =
  | { type: 'insert'; parentId: string; index: number; node: StudioNode }
  | { type: 'update'; nodeId: string; patch: NodePatch }
  | { type: 'move'; nodeId: string; parentId: string; index: number }
  | { type: 'delete'; nodeId: string }
  | { type: 'token'; category: 'primitive' | 'semantic'; name: string; value: string | number }
  | { type: 'theme'; theme: 'light' | 'dark' }
  | { type: 'replace'; document: StudioDocument };
export interface OperationEnvelope { id: string; projectId: string; baseRevision: number; label: string; operations: Operation[] }
export interface Diagnostic { code: string; severity: 'error' | 'warning'; message: string; nodeId?: string; line?: number; column?: number }
export interface CompiledCode { code: string; diagnostics: Diagnostic[]; nodeLocations: Record<string, {line: number; column: number}> }
export interface ImportResult { document: StudioDocument | null; diagnostics: Diagnostic[]; preservedBefore: string; preservedAfter: string }
export interface ChangeSummary { nodeId?: string; description: string }
export interface ProposalGroup { id: string; title: string; operations: Operation[]; dependsOn: string[] }
export interface AIProposal { projectId: string; baseRevision: number; summary: string; groups: ProposalGroup[] }
export interface User { id: string; name: string }
export type Role = 'owner' | 'editor' | 'viewer';
export interface Version { id: string; projectId: string; revision: number; label: string; actor: string; createdAt: string; document: StudioDocument }
