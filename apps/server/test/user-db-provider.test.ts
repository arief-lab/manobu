import { afterAll, describe, expect, it } from "bun:test";
import { createUserDb } from "@manobu/db";
import { applyContentMigrations } from "@manobu/db/migrate";
import { closeUserDb, getUserDb, setUserDbProvider } from "../src/user-db";
import { isolatedDbUrl, removeTestDatabases } from "./harness";

/*
 * The user-database injection point (src/user-db.ts).
 *
 * It exists because three modules opened their own handle at module scope from
 * `process.env.DATABASE_URL`, so importing a module decided the process's
 * database. `bun test` loads every spec before running any of them, which made
 * that an import-order accident: nine specs passed together and failed the
 * moment a spec with a real path joined the run, with a UNIQUE violation on a
 * fixed conversation id.
 *
 * The properties worth pinning are the ones that fix it: nothing opens until
 * something asks, an override is honoured by EVERY caller including the
 * module-scope singletons (the part a per-call-site fix missed), and `null`
 * restores the env default.
 */

const DB_URL = isolatedDbUrl("user-db-provider");
// Before ANY getUserDb call. The default path reads DATABASE_URL, so a test
// that exercises the default without setting it would open whatever ambient
// database the machine happens to have - which is a hazard, not a test.
process.env.DATABASE_URL = DB_URL;
applyContentMigrations(DB_URL);

afterAll(async () => {
  // This is the ONE spec that switches providers mid-process, so it is also the
  // one that owns the handles it creates. `setUserDbProvider` deliberately does
  // not close on switch - `bun test` interleaves specs, and a switch in one
  // spec would close a handle another spec is still using (measured: 40 pass /
  // 29 fail that way). So the handle is closed here, where its lifetime is
  // unambiguous, instead of being leaked at process exit.
  await closeUserDb();
  setUserDbProvider(null);
  removeTestDatabases();
});

describe("user-db injection point", () => {
  it("is lazy and caches: one handle, not one per call", async () => {
    setUserDbProvider(null);
    const db = await getUserDb();
    expect(db).toBeDefined();
    // A module-scope handle would already exist before this line; laziness is
    // also what lets a spec set a provider AFTER importing these modules.
    expect(await getUserDb()).toBe(db);
  });

  it("an override is what every caller gets, not just the caller that set it", async () => {
    const injected = await createUserDb(DB_URL);
    setUserDbProvider(async () => injected);

    // The env points at DB_URL too, so comparing "a db came back" would pass
    // even with the override ignored. The claim is that the SAME handle returns
    // through the accessor the application singletons use, which is what makes
    // one injection point enough for chat-store, rpc and routes/cards.
    expect(await getUserDb()).toBe(injected);
  });

  it("setUserDbProvider(null) restores the DATABASE_URL default", async () => {
    setUserDbProvider(null);
    const fromEnv = await getUserDb();
    expect(fromEnv).toBeDefined();

    // And a later override still wins, proving the reset dropped the cache
    // rather than leaving the previous handle pinned.
    const other = await createUserDb(DB_URL);
    setUserDbProvider(async () => other);
    expect(await getUserDb()).toBe(other);
  });
});
