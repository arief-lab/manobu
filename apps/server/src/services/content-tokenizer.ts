import { createContentDatabase } from "@manobu/db/migrate";
import { env } from "@manobu/env/server";
import type { TokenSplitter } from "./exam-mask";

/**
 * TASK-142: `vaporetto_split` for the exam path.
 *
 * WHY A SECOND CONNECTION. The tokenizer lives on the CONTENT database handle,
 * because that is where `loadVaporettoExtension` runs
 * (`packages/db/src/migrate.ts::createContentDatabase`). The exam path holds the
 * USER database, created by `createUserDb` as a drizzle handle, and there
 * `SELECT vaporetto_active()` fails with "no such function" - the libsql client
 * behind it exposes neither `loadExtension` nor `loadLibsqlExtension`, so the
 * extension cannot be loaded onto it after the fact. Japanese has no spaces, so
 * without a segmenter a substring replacement cannot tell a token boundary from
 * the middle of a word, and the masker would have to mask blind.
 *
 * So this owns a content handle for the process lifetime. The cost is one extra
 * connection to the same SQLite file, which is legal under WAL and which
 * `index.ts` already opens and closes once per boot for migrations. It is
 * deliberately NOT closed: `vaporetto_split` is a pure read, the handle is
 * process-lifetime state, and nothing in the sidecar owns a shutdown hook that
 * could close it. If a shutdown path ever appears, close it there and the
 * splitter falls back to unmaskable rather than throwing.
 *
 * `vaporettoLoaded === false` (the .so absent from a packaged resource dir)
 * returns a null splitter, and the masker degrades to reporting the item
 * unmaskable - the same honest degradation as a missing tokenizer anywhere
 * else, and never a mask nobody verified.
 */
/** The live splitter, or null when the extension is unavailable. */
let splitter: TokenSplitter | null | undefined;

const unavailable = (): TokenSplitter => async () => null;

const contentTokenSplitter = (): TokenSplitter => {
  if (splitter !== undefined) {
    return splitter ?? unavailable();
  }
  try {
    const { db, vaporettoLoaded } = createContentDatabase(env.DATABASE_URL);
    if (!vaporettoLoaded) {
      db.close();
      splitter = null;
      return unavailable();
    }
    // Not `async` on the inside: the DB layer is synchronous, so the returned
    // promise is built by the caller's await rather than by a needless
    // microtask here.
    splitter = (text) => {
      try {
        const row = db
          .prepare("SELECT vaporetto_split(?, '/') AS split")
          .get(text) as { split?: string } | undefined;
        const split: unknown = row?.split;
        return Promise.resolve(
          typeof split === "string" && split.length > 0
            ? split.split("/").filter((token) => token.length > 0)
            : null
        );
      } catch {
        return Promise.resolve(null);
      }
    };
    return splitter;
  } catch {
    // A missing corpus file or an unopenable database must not stop exam
    // assembly; it degrades to unmaskable.
    splitter = null;
    return unavailable();
  }
};

/** The exam path's token splitter. The DB layer is synchronous; the masker
 * awaits this function's RESULTS, not the function, so this returns the
 * splitter itself rather than a promise of one. */
export const examTokenSplitter = (): TokenSplitter => contentTokenSplitter();

/** Test seam, matching `data-dir.ts` and `exam-corpus.ts`. */
export const __test__ = {
  resetContentTokenizer: (): void => {
    splitter = undefined;
  },
};
