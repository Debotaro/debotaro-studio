# Collaboration and recovery contract

The maintained Yjs library synchronizes server-produced document state and causal updates. Clients submit validated typed operations, never arbitrary binary writes. SQLite and a single Node service order revisions; this is an intentional authority boundary that preserves document invariants. It is not unrestricted peer-to-peer tree editing or a horizontally distributed service.

## Concurrent changes

Each operation includes project ID, unique operation ID and base revision. Independent stale property/token/theme edits may merge only when fingerprints of every touched field still match the submitted base. Same-field disagreement, missing/deleted nodes, future revisions and stale structural edits are refused. Insert/move/delete, code imports, AI patches and version replacement require the exact inspected revision. Deleting a subtree removes descendants; stale replay cannot resurrect it. Duplicate acknowledged operations do not apply twice.

Presence contains authenticated display name, role and selected node, separate from document history. Per-browser private demos isolate visitors. Explicit expiring invitations grant editor/viewer membership; changing membership invalidates outstanding invitations. Sessions are opaque, HttpOnly, SameSite cookies; display names are pseudonymous demo identities, not verified accounts. Membership/session checks protect direct HTTP resources, WebSocket upgrade, inbound operations and outbound state/presence. Live revocation closes connections; reconnect checks access again.

## Undo and versions

Undo chooses the requesting actor's latest not-yet-undone transaction. Field inverses apply only where current touched values still equal that actor's result, preserving unrelated work. A collaborator changing the same field causes refusal. Newly added tokens are removed only if still unused; another actor's new reference prevents undo. Structural undo requires no intervening revision and never indiscriminately restores an older shared tree. UI redo uses equivalent field fingerprints or structural revision checks.

Immutable named versions record actor, label, revision, timestamp and document. Restore shows a diff and uses an exact-base replacement, producing a new revision/history entry. History stores document/operation changes, not API keys or session tokens.

## Recovery

SQLite transactions persist canonical document, causal Yjs state and history together; startup verifies causal/canonical agreement. Future/corrupt database/document/state is refused while retaining the original. Browser IndexedDB stores the authoritative snapshot, typed offline queue, code draft/base and discarded/incompatible recovery records. Reconnect catches up before replay with preconditions. Unsafe pending work stays available for download/reconciliation; explicit discard is a user action. Invalid code cannot replace the valid preview. Clean supported outside source survives reload; corrupt cached code becomes a recoverable draft.

Server restart, browser reload, independent-field convergence, disconnect/reconnect, deletion/stale conflicts, actor-safe undo and direct/live permission boundaries have local integration evidence in [VERIFICATION](VERIFICATION.md). Evidence is tied to source and fixtures; host-specific production operations and verified account identity remain separate work. Backup/restore commands and browser-recovery boundaries are in [RUNBOOK](RUNBOOK.md).
