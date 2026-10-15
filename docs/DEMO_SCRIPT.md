# Signature demo — Debotaro Studio

Aim for 5–7 minutes after setup; expand collaboration/export into a technical walkthrough when useful. This is a reproducible product script, not a record that every step has passed. Use [VERIFICATION](VERIFICATION.md) for actual execution evidence.

## Prepare

Run npm ci and npm run dev; open http://localhost:4173. Prepare a second browser profile/private window so it has separate cookies and IndexedDB. Use fictional display names. For a clean start choose **Open your private demo**, or **Project → + New private demo** in an existing session. This creates an isolated project; it does not reset anyone else’s shared workspace.

Have an empty user-chosen export directory and Node24.13+/npm ready. If demonstrating AI, configure OPENAI_API_KEY and an explicit OPENAI_MODEL privately on the server and restart. Never display the key or imply a ChatGPT subscription supplies it.

## Journey

1. **Open the demo.** “This is a customer-support workspace built from a shared application document. Its people and tickets are fictional.” Show the layer tree, canvas and inspector. Wait for Live and no pending edits.
2. **Make a visual change.** Select **Inbox heading** in Layers; change its Text value in the inspector and commit with Enter/blur. Inspect the changed canvas. Change a spacing/layout value or semantic color token and observe the preview. Save a version with a meaningful label.
3. **Inspect and edit React.** Switch to Code. Find the same stable studioId and text prop. Change a supported string literal. Choose **Review code changes**, inspect the affected node, then **Apply … changes**. Optionally type an invalid expression, review it, and show that the last valid preview survives; recover/discard the draft deliberately.
4. **Try the application.** In Preview search for “invoices”, select the ticket, update Assigned to and Status, then inspect Activity. Clear filters and try Phone preview. “These are real local runtime interactions, shared with the export.”
5. **Collaborate.** Share → Editor → **Create invitation link**. Copy it into the second browser manually. Enter the second name and choose **Join shared workspace**. Show two presence indicators. Edit different layers or different properties from each browser; watch both views converge. Invite a Viewer or change a member’s role to demonstrate permission boundaries only on this isolated project.
6. **Disconnect and recover.** Put the second browser offline using its developer-tools Network controls. Make a supported independent field edit. Show the offline/pending status, reconnect and wait for acknowledgment. For a deliberate same-field conflict, retain/download recovery and inspect the current work; never present a refused edit as a successful merge. Reload to show recovery where verified.
7. **Review AI.** If configured, request “Add an assignment panel using existing components and tokens.” Explain the displayed transmission disclosure; inspect the real provider’s returned groups and dependencies, accept/reject selected groups, then show the resulting document. Demonstrate cancellation if time allows. **Without credentials:** open AI assistant and show **Live AI is unavailable**; explain that live inference has not been run. Do not insert fixture output or pretend it came from a model.
8. **Inspect a version.** Open **Version history**, choose the saved snapshot, inspect its difference, then **Restore inspected version**. “Restore becomes a new revision; the earlier history remains available.” Avoid restoring a workspace someone else is actively editing without agreeing on this demo step.
9. **Export and leave Studio.** Wait for no pending edits; choose Export. Inspect the real ZIP’s App.tsx, shared runtime, document/tokens and recovery text. Extract into the prepared directory and run the commands below. Open the independent Vite URL and repeat search, selection and assignment. Show that Studio can be stopped while the exported application still runs.

```powershell
npm ci
npm run typecheck
npm run build
npm run dev
```

## Closing narrative

“The connecting layer is a validated document, with a clear supported code contract. The next research step is to observe designers and frontend developers complete this workflow, especially conflict recovery and export. This is a working local prototype; broader syntax, real data connections and production identity remain future work.”

Only cite checks that passed for the source being shown. Credentials/live inference, server restart, concurrent undo, revocation and larger-document measurements each require their own evidence. No adoption or research findings should be added without actual results.
