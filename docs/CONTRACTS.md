# Shared implementation contracts (2026-10-14)

Authoritative TypeScript: src/core/types.ts. v1 uses a normalized node map with stable IDs, ordered child arrays and exactly one reachable root. Every non-root has exactly one parent; no cycles, orphans, duplicate IDs or missing token references. Maximum 2,000 nodes, 100 operations/transaction, bounded strings and numeric layout values. JSON only; no functions, arbitrary HTML, URLs or scripts in properties.

## Core API

src/core/document.ts: validateDocument(input): StudioDocument throws a meaningful Error; migrateDocument(input): StudioDocument; serializeDocument(doc): string stable key ordering; applyOperations(doc, envelope): StudioDocument validates matching project ID + exact base revision, clones, applies atomically, validates whole result, increments revision once. Never mutate input. createNode(type, id?): StudioNode; getParentId(doc,nodeId): string | null; summarizeChanges(before,after): ChangeSummary[]; diagnoseDocument(doc): Diagnostic[]; export catalog permissible props/defaults/children. src/core/starter.ts: createStarterDocument(id?:string): StudioDocument. src/core/tokens.ts: resolveToken(tokens,value): string|number, cycle/missing checks, token references use $semantic.name / $primitive.name.

Update patches replace supplied props/layout/bindings/events object (callers merge explicitly). Insert one fresh node without children; dependent insert operations build a subtree transactionally. Delete removes entire subtree. Move rejects root/cycles. Replace is only for inspected code imports/version restores, never AI. Stale envelopes refused; no implicit overwrite. Root-only Frame; child-bearing components Frame/DetailPanel. Editable props enumerated by catalog. Runtime configuration in doc, ticket state isolated in runtime.

## Compiler API

compileDocument(doc, originalCode?:string): CompiledCode; importCode(code, baseDocument): ImportResult. Validate with core. Region markers delimit managed TSX declarations, not structural regex parsing. Babel AST reads literal values and catalog JSX; never execute source. Invalid/unsupported managed code returns null + diagnostic. Outside managed region kept byte-for-byte in compilation; reject ambiguous markers. Import revision must equal base doc revision; document retains that revision until explicit validated replace operation. Locations map studioId to JSX lines. See SUPPORTED_CODE.md. Code drafts/reviews editor responsibility.

Pure generation: generateDocument(doc, regions?:{before:string;after:string}) emits validated IR without AST imports. Regions must originate from explicit AST review or accepted source recovery. Raw source retains strict compileDocument/importCode validation. App may lazy-load importCode for reviews; unfinished code remains recoverable. Cached-code validation and outside-region lifetime are editor responsibilities.

src/export/project.ts: generateProject(doc, code?): Promise<Record<string,string>> or sync record; actual payload includes runnable App.tsx, shared runtime, styles, tokens/document, exact dependencies, tsconfig, Vite config, HTML, README. No Studio API dependency. Untrusted handwritten code preserved as separate text artifact, never executed by exporter.

## Runtime API

src/runtime/StudioRuntime.tsx: StudioRuntime({document, breakpoint?, selectedId?, onSelect?, designMode?}). StudioProvider({meta,children}) meta=document minus nodes. Named exports Frame/Text/Button/Field/Select/Tabs/Badge/Table/DetailPanel accept {studioId,name?,props?,layout?,responsive?,bindings?,events?,children?} matching JSX compiler output. Shared preview/export implementation. Responsive layout by width/container rules or breakpoint. src/runtime/runtime.css imported by UI/export. Fictional support data, query/status/assignee filtering, ticket selection/status/assignment, async local loading/retry, empty/error and validation. Allowlisted actions, no eval. src/runtime/connector.ts: abortable TicketConnector.load(signal) and local implementation. Runtime interactions never silently edit Studio document.

## Server / collaboration

Node server owns auth/project permissions, SQLite, revision order, op validation, immutable snapshots, CRDT state and AI. Sessions HttpOnly SameSite; origin checks on mutations/WS; permission rechecked every message; disconnect revoked peers. Per-browser private demo; invitations intentionally authorize membership. Server produces Yjs updates from validated ops; client binary writes forbidden. Offline typed queues catch up; stale structural/code/AI requires inspected resolution. Independent stale prop edits need field preconditions. Undo conditional inverses only when touched state still matches author result. No blindly reversing others.

Preview iframe sandbox scripts only, opaque origin, validated postMessage source + random channel nonce; only doc/selection enters, no auth/API secrets. Studio AST-imports source; preview renders trusted runtime/validated IR. Export custom source separately, never executes it.

## Numeric token extension

Schema shape/version1 stays backward compatible; literal numeric documents and v0 migrations retain meaning. Supported-code revision1.1 additionally permits $primitive.name / $semantic.name aliases in numeric layout fields (gap, padding, columns, width, height, grow) and numeric catalog properties (radius, size, weight). Aliases must resolve to finite numbers within the same existing field bounds; columns must resolve to integer1–12, weight to a100multiple. Color tokens cannot fill numeric fields. Missing/cyclic/nonnumeric/out-of-range references reject whole transactions. Responsive overrides validate and resolve against the same token graph. Do not execute strings or accept arbitrary CSS expressions. String/text labels remain literal (including currency beginning $); token resolution applies only to fields whose contract permits it.

Core token resolution provides resolveNumericToken(tokens,value:number|string):number. Numeric source changes require renewed core/runtime/compiler/export verification. Relevant tests live in tests/core/numeric-tokens.test.ts, tests/runtime/numeric-tokens.test.tsx and tests/compiler/numeric-tokens.test.ts.

## Recovery and redo refinement

Undo response returns {document,redoOperations} from the actual undone server history transaction, including code/restore/AI edits. UI redo uses those operations and post-undo preconditions rather than an old local visual cache. Invalid server project-list entries remain visible as unavailable without preventing intact projects from loading; raw bytes stay retained. Browser saved queues validate completely before replay; corrupt local records are archived and a healthy canonical server fetch still proceeds. See COLLABORATION/RUNBOOK and recovery regressions for exact boundaries.


Module responsibilities and trust boundaries are documented in [ARCHITECTURE](ARCHITECTURE.md).
