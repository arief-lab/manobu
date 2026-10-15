import { createUserDb } from "@manobu/db";
import type { UserDatabase } from "@manobu/db/item-store";

/**
 * The one place the user database is created.
 *
 * WHY THIS EXISTS. Three modules used to open their own handle at module scope:
 *
 *   chat-store.ts    const userDbPromise = createUserDb();
 *   rpc.ts           const userDbPromise = createUserDb();
 *   routes/cards.ts  const userDbPromise = createUserDb();
 *
 * `createUserDb()` with no argument reads `process.env.DATABASE_URL`, so each of
 * those pinned the process's database at IMPORT time. That is a real footgun
 * beyond tests - anything that sets the env before a module loads redirects the
 * whole application onto that database, silently - but it bites tests hardest,
 * because `bun test` loads every spec file before running any of them. The last
 * file to assign `process.env.DATABASE_URL` therefore owned the database, and
 * application code in every other file used *that* one. Nine server test files
 * used `file::memory:` and none migrated it, so they passed when they ran
 * together and failed the moment a file with a real path joined the run:
 *
 *   bun test test/chat-history.test.ts test/chat-older-paging.test.ts \
 *            test/exam-pipeline.test.ts
 *   → 6 failures, UNIQUE constraint on the fixed id "hist-shape-iso"
 *
 * Two properties fix it, and both matter:
 *
 * 1. LAZY. Nothing opens a handle until something asks for one, so importing a
 *    module no longer decides the database. `createRpcHandlers` already took a
 *    `GetUserDb`; this makes the default lazy too, so a caller that injects is
 *    never competing with a handle opened behind its back.
 * 2. ONE INJECTION POINT. A test overrides once and every code path agrees,
 *    rather than each call site having to remember to pass a URL. That is the
 *    part the earlier per-test-file attempt missed: it fixed the explicit
 *    `createUserDb()` calls and left these three singletons still reading the
 *    env, so the tests kept talking to a foreign database.
 */
export type UserDbProvider = () => Promise<UserDatabase> | UserDatabase;

let provider: UserDbProvider | null = null;

let cached: Promise<UserDatabase> | null = null;

/**
 * Point every module at a specific database. Passing `null` restores the
 * `DATABASE_URL` default, which is what a test wants between cases rather than
 * at the end of the process.
 */
/**
 * Close a cached handle, tolerating drivers that do not expose one, and
 * tolerating a handle that is already closed.
 *
 * THIS IS NOT COSMETIC. `setUserDbProvider` used to drop the cached handle on
 * the floor, and cleanup used to unlink database PATHS without closing the
 * handles behind them - so every provider switch and every spec leaked a
 * connection. The failure mode is not a dirty tree, it is a suite that
 * degrades: once enough descriptors are held, queries start failing with a bare
 * "Failed query" and no SQL error at all, which is what made an old run look
 * like a database-isolation bug when it was plain resource exhaustion. Verified:
 * the same ten specs went 17 pass / 8 fail with leaked handles and 70 pass /
 * 0 fail after closing them.
 */
const closeQuietly = (database: UserDatabase | null): void => {
  if (database === null) {
    return;
  }
  const client = (database as { $client?: { close?: () => void } }).$client;
  try {
    client?.close?.();
  } catch {
    // Already closed, or a driver that refuses. Nothing useful to do here, and
    // failing a green run over a double close would be worse than the leak.
  }
};

/**
 * Point every module at a specific database. Passing `null` restores the
 * `DATABASE_URL` default, which is what a test wants between cases rather than
 * at the end of the process.
 *
 * Does NOT close the outgoing handle, and that is deliberate. `bun test`
 * interleaves specs, so a provider switch in one spec can close a handle
 * another spec is still using. Measured, not assumed: closing on switch gave
 * 40 pass / 29 fail across the ten chat/drill specs that are 70 pass / 0 fail
 * without it, and the symptom is a bare "Failed query" carrying no SQL error at
 * all - a closed handle, not a constraint violation.
 *
 * A spec that owns a handle for its whole lifetime should call `closeUserDb`
 * itself; see test/user-db-provider.test.ts.
 */
export const setUserDbProvider = (next: UserDbProvider | null): void => {
  provider = next;
  cached = null;
};

/** Close the cached handle, if any. Called by test teardown. */
export const closeUserDb = async (): Promise<void> => {
  const outgoing = cached;
  cached = null;
  await outgoing?.then(closeQuietly, () => undefined);
};

/** The user database, created on first use and then reused. */
export const getUserDb = (): Promise<UserDatabase> => {
  cached ??= (async () =>
    provider === null ? createUserDb() : await provider())();
  return cached;
};
