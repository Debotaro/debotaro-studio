# Current verification — 16 October 2026

This local review patch builds on public source `09a632b45e533eed86b291dd08506d85c4d8a04f`. The published source was freshly installed and exercised before review; the final consolidated checks below then ran after the observed failures were corrected. Node 24.13.0 and npm 11.6.2 were used on Windows. The lockfile and application dependencies were unchanged.

## Final consolidated gate

| Executed command | Actual result |
| --- | --- |
| `npm run lint` | Passed |
| `npm test` | 309 tests across 22 files passed; 2.97 seconds |
| `npm run build` | TypeScript and production build passed; 2,088 modules |
| Production `npm run test:browser` | All 23 Chromium tests passed; 55.7 seconds |
| `npm run verify:export` | New independent frozen install, typecheck, build, preview and real Chromium interactions passed |

The browser suite uses isolated local HTTP/WebSocket and SQLite state. It exercises actual visual/code/ZIP behavior, concurrent browser sessions, offline recovery, inspected version restoration, permission revocation, actor-safe undo/redo, numeric tokens, keyboard dialogs and the phone layout. Two real case-study screenshots were refreshed and visually inspected. The previous captures remain retained in ignored local review artifacts; original published versions remain in Git history.

The 309-test total includes 302 existing tests, five new atomicity regressions and two new export-environment regressions. These are executable fixtures rather than claims of customer outcomes, production scale or independently assessed individual proficiency. Provider calls remain non-live fixtures.

## Observed failures and corrections

- **Undo persistence:** an inverse document/history write could previously commit before its undo bookkeeping failed. The inverse state and both history markers now commit in the same SQLite transaction. Candidate Yjs state is published only after that transaction succeeds. Actual `BEFORE` and `AFTER` SQLite trigger failures verify retained canonical data, all eight data tables, live Yjs bytes and peer state; successful retry and redo deduplication are also checked.
- **Permission changes:** membership mutation and invitation invalidation previously used separate writes. They now share one transaction. Actual invitation-deletion trigger failures verify that removal or downgrade rolls back; a successful retry invalidates outstanding invitations and closes the collaborator connection. These checks retain the application's existing pseudonymous owner/editor/viewer identity model.
- **Independent export on Windows:** the verifier filtered out an explicitly selected npm script shell. In this workspace, the `&` character then broke nested npm command shims despite a successful export install. The environment allowlist now preserves only `NPM_CONFIG_SCRIPT_SHELL`, case insensitively, alongside its existing operational entries. Tests prove that OpenAI keys, Studio paths, npm auth/configuration tokens, arbitrary registry configuration and `NODE_OPTIONS` are not forwarded. No global npm or Windows setting was changed.
- **AI disclosure:** the dialog now accurately states that instructions and layer text/property values are sent to the configured provider, and asks users to keep secrets out. Ticket records and code drafts remain excluded by the implemented context builder. This is an accurate disclosure, not automatic secret detection or data-loss prevention.

## Fresh independent export

The corrected verifier generated a fictional starter, materialized a new 22-file project, checked exact ZIP filenames/UTF-8 bytes, ran `npm ci`, typecheck and production build, started its own loopback preview and executed twelve real Chromium interaction groups. Additional numeric-token assertions verified desktop spacing/title styles and phone padding. The browser checked search, selection, assignment, status, activity, empty states, filters, refresh persistence, phone focus/overflow, absence of browser errors and absence of Studio API requests. A throw sentinel in handwritten recovery text would have failed the browser run if that text had been executed.

The 20 relevant package/compiler/core/runtime/export/verifier source hashes were unchanged throughout and were compared again after the consolidated gate. These hashes identify exact bytes from this Windows worktree; cross-platform Git line endings can differ. Each fresh verification compares its own start/end source bytes. Captured verification JSON is excluded from newline conversion. Server/editor changes are outside this independent-export dependency scope and were exercised by the separate consolidated suite.

- Verified [example ZIP](export-example.zip) SHA256: `e798dd7766bdf99972a0665e543a8f69a88f9a5eeea46965879cd20574daf41d`.
- [Sanitized export report](export-verification-2026-10-16.json) retains actual timestamps, exit statuses, hashes and browser scope. Raw reports/logs with local paths remain in ignored artifacts.
- The verifier stopped its owned preview process after success. The fixture demonstrates this generated application; it does not prove every possible exported application works.

## CI and remaining limits

The new pinned GitHub Actions workflow prepares Linux and Windows verification: lint, typecheck, all unit tests, production build/browser checks and a fresh independent export. Both jobs check out into a directory containing spaces and `&`; the Windows job explicitly selects its own PowerShell script shell. The workflow has been parsed locally, but it has **not run on GitHub**. This reviewed local Studio patch still requires targeted publication approval.

No live provider inference, provider schema acceptance, model-quality evaluation, public Studio backend deployment, production load/SLO test, verified-account recovery or customer research is claimed. The API/worker hosting evidence from the separate EvidenceDesk/FlowLedger projects does not establish Studio deployment. Current benchmark figures remain historical; they were not rerun for this correction. Node's experimental SQLite warning and the deferred AST importer bundle-size warning remain visible.

The current machine-readable [verification summary](verification-2026-10-16.json) identifies the checked source files and measured scope. [Historical verification](VERIFICATION.md), [runbook](RUNBOOK.md), [hosting](HOSTING.md) and [attribution](ATTRIBUTION.md) provide the earlier record and operational boundaries.
