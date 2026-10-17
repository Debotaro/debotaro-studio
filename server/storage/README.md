# Studio persistence backends

`core.ts` owns the eight domain tables and synchronous Store methods. It accepts a small SQL driver and an outer transaction callback. Nested domain transactions participate in the same outer transaction. A failed document/history/undo write or membership/invitation update rolls back the entire change before SyncEngine publishes candidate Yjs state.

`../store.ts` remains the native Node entry point. Its public `db` is still `DatabaseSync`; existing inspection and recovery code works unchanged. Native databases retain SQLite header `user_version=2`, WAL, foreign keys, and the configured `max_page_count` physical storage ceiling.

`cloudflare.ts` exports `createCloudflareStore(storage, limits)`. It imports no `node:sqlite`, `node:fs`, or file paths. Bind one global SQLite-backed Durable Object to preserve the existing project, session, membership, invitation, history, version, and global AI allowance semantics. Its driver consumes SQL cursors synchronously, normalizes BLOB ArrayBuffers to Uint8Arrays, and uses `storage.transactionSync` instead of forbidden SQL BEGIN/COMMIT statements. SQLite `changes()` retains native row-count semantics; `cursor.rowsWritten` would include index writes and is unsuitable for undo bookkeeping.

Durable Object SQLite does not implement `PRAGMA user_version`. A ninth, backend-only `studio_schema` table records version 2 atomically with schema initialization. A future or corrupt schema version fails without overwriting stored domain data. This initializes new deployments; it does not silently import an existing native database.

The Cloudflare deployment is deliberately bounded below its 2 MB SQLite row/string/BLOB ceiling: at most **600,000 UTF-8 bytes per bound saved value** and **1,800,000 bytes across a bound write**. History stores before, after, and envelope values in one row, so three individual limits plus a combined check leave a conservative row margin. The native backend keeps its existing capacity. Oversized Cloudflare writes fail with `STORAGE_ROW_CAPACITY` / 413; they never truncate documents, erase history, or apply partial edits. The configured aggregate `databaseBytes` ceiling is checked using `storage.sql.databaseSize` inside the same write transaction, returning `STORAGE_CAPACITY` / 507 on failure. This is an application limit; it does not enable billing or increase a provider quota.

`tests/server/cloudflare-store.test.ts` is explicitly a native SQLite contract fixture. It verifies all eight domain tables, state across adapter recreation, session/role/version/AI accounting persistence, BLOB normalization, failure at undo bookkeeping, UTF-8 and combined row boundaries, aggregate capacity rollback, and incompatible-schema retention. It is **not** a substitute for executing workerd/Miniflare and public deployment acceptance.

Primary platform references:

- [SQLite-backed Durable Object storage: cursors, databaseSize, transactionSync](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Durable Object rules: PRAGMA user_version is unsupported](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Durable Object SQL limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
