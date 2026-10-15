/**
 * TASK-23.1: native-connection migration applier for content.db.
 *
 * The vaporetto tokenizer must be registered on the same connection that
 * creates the FTS5 tables — and on every connection that later queries them
 * (FTS5 tokenizes MATCH strings at query time too). `@libsql/client`'s file
 * client keeps its `Database` handle private, so this path opens the native
 * `libsql` Database directly (the same library the client wraps), loads the
 * extension, applies the migration files with the `__VAPORETTO_TOKENIZE__`
 * placeholder substituted, and reports which tokenizer actually landed.
 *
 * `createContentDatabase` keeps the handle open (bundling/seed tooling and
 * tests that continue querying); `applyContentMigrations` closes it.
 */

import DatabaseLibsql from "libsql";
// TASK-44: migration SQL imported as TEXT (bundler-inlined) instead of
// fs-read from `import.meta.url`-relative paths — inside the compiled
// sidecar `import.meta.url` is `/$bunfs` and the fs walk found nothing,
// silently skipping every migration (then the post-apply verify failed with
// "no such table: vocab_fts"). Static imports work identically in source
// and compiled contexts; order is the array order below.
import migration0000 from "./migrations/0000_sour_master_chief.sql" with {
  type: "text",
};
import migration0001 from "./migrations/0001_fts5_vocab_fts.sql" with {
  type: "text",
};
import migration0002 from "./migrations/0002_fts5_vaporetto.sql" with {
  type: "text",
};
import migration0003 from "./migrations/0003_fts5_sentences_fts.sql" with {
  type: "text",
};
import migration0004 from "./migrations/0004_fts5_names_fts.sql" with {
  type: "text",
};
import migration0005 from "./migrations/0005_cards_vocab_snapshot.sql" with {
  type: "text",
};
import migration0006 from "./migrations/0006_chat_conversations.sql" with {
  type: "text",
};
import migration0007 from "./migrations/0007_items_and_sessions.sql" with {
  type: "text",
};
import migration0008 from "./migrations/0008_drill_pool_lifecycle.sql" with {
  type: "text",
};
import migration0009 from "./migrations/0009_drill_adaptation.sql" with {
  type: "text",
};
import migration0010 from "./migrations/0010_exam_state.sql" with {
  type: "text",
};
import migration0011 from "./migrations/0011_exam_clock.sql" with {
  type: "text",
};
import migration0012 from "./migrations/0012_exam_review.sql" with {
  type: "text",
};
import migration0013 from "./migrations/0013_item_stimuli.sql" with {
  type: "text",
};
import migration0014 from "./migrations/0014_exam_focus.sql" with {
  type: "text",
};
import migration0015 from "./migrations/0015_item_mask.sql" with {
  type: "text",
};
import migration0016 from "./migrations/0016_item_stem.sql" with {
  type: "text",
};
import { loadVaporettoExtension, resolveFtsTokenizerDdl } from "./vaporetto";

/** TASK-80.2: the chat tables (0006) as a standalone statement list, so
 * apps/server can ensure them on its own libsql client handle without
 * re-opening the file through the native migration path (single source:
 * the 0006 SQL text; duplicate-CREATE errors are swallowed). */
export const chatSchemaStatements: readonly string[] = migration0006
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

const MIGRATION_FILES: ReadonlyArray<{ file: string; sql: string }> = [
  { file: "0000_sour_master_chief.sql", sql: migration0000 },
  { file: "0001_fts5_vocab_fts.sql", sql: migration0001 },
  { file: "0002_fts5_vaporetto.sql", sql: migration0002 },
  { file: "0003_fts5_sentences_fts.sql", sql: migration0003 },
  { file: "0004_fts5_names_fts.sql", sql: migration0004 },
  { file: "0005_cards_vocab_snapshot.sql", sql: migration0005 },
  { file: "0006_chat_conversations.sql", sql: migration0006 },
  { file: "0007_items_and_sessions.sql", sql: migration0007 },
  { file: "0008_drill_pool_lifecycle.sql", sql: migration0008 },
  { file: "0009_drill_adaptation.sql", sql: migration0009 },
  { file: "0010_exam_state.sql", sql: migration0010 },
  { file: "0011_exam_clock.sql", sql: migration0011 },
  { file: "0012_exam_review.sql", sql: migration0012 },
  { file: "0013_item_stimuli.sql", sql: migration0013 },
  { file: "0014_exam_focus.sql", sql: migration0014 },
  { file: "0015_item_mask.sql", sql: migration0015 },
  { file: "0016_item_stem.sql", sql: migration0016 },
];

export interface ContentDatabase {
  /** Native libsql handle (has `loadExtension`; keep open while querying). */
  db: DatabaseLibsql.Database;
  /** Which tokenize fragment the FTS5 tables were created with. */
  tokenizer: string;
  /** Whether the sqlite-vaporetto extension loaded on this connection. */
  vaporettoLoaded: boolean;
}

/** TASK-40: apply a migration's statements best-effort (legacy fast-forward
 * path skips intermediate files; duplicate-column errors on already-migrated
 * dbs are expected and ignored). Tokenizer placeholders are substituted like
 * the strict path — 2026-09-20: without this, every FTS-defining statement
 * (0001-0004) failed with "unknown tokenizer" and was silently swallowed,
 * so a fast-forwarded db ended up with zero FTS surfaces. */
const applyMigrationStatements = (
  db: DatabaseLibsql.Database,
  sql: string,
  tokenizer: string
): void => {
  for (const stmt of sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s
        .replaceAll("__VAPORETTO_TOKENIZE__", tokenizer)
        .replaceAll("__ASCII_TOKENIZE__", "unicode61")
    )) {
    try {
      db.exec(stmt);
    } catch {
      // statement already applied (e.g. duplicate column)
    }
  }
};

/** TASK-53 follow-up: detect a unicode61-era FTS table while the vaporetto
 * extension is NOW available; re-apply the FTS-defining migrations
 * (0002-0004) with the vaporetto tokenizer. Their DROP+CREATE+rebuild
 * statements are mode-safe; ALTER TABLE base-shape statements are skipped
 * (already applied; they were chunk-mates of leading comments so the
 * filter tests each line). Returns true when an upgrade ran. */
const upgradeFtsTokenizerToVaporetto = (
  db: DatabaseLibsql.Database,
  vaporettoLoaded: boolean
): boolean => {
  const vocabDdl = (
    db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vocab_fts'"
      )
      .get() as { sql?: string } | undefined
  )?.sql;
  if (!(vaporettoLoaded && vocabDdl?.includes("unicode61"))) {
    return false;
  }
  // 0002 only DROPs the vocab FTS pair (its own first-creation context);
  // grammar/kanji/sentences/names FTS were NEW in their migrations, so
  // re-running needs explicit drops of tables and their triggers first.
  const ftsTables = [
    "grammar_fts",
    "kanji_fts",
    "kanji_fts_en",
    "sentences_fts",
    "sentences_fts_en",
    "names_fts",
  ];
  const ftsTriggers = [
    "grammar_ai",
    "grammar_ad",
    "kanji_ai",
    "kanji_ad",
    "sentences_ai",
    "sentences_ad",
    "sentences_au",
    "sentences_adu",
    "names_ai",
    "names_ad",
    "names_au",
  ];
  for (const table of ftsTables) {
    db.exec(`DROP TABLE IF EXISTS \`${table}\`;`);
  }
  for (const trigger of ftsTriggers) {
    db.exec(`DROP TRIGGER IF EXISTS \`${trigger}\`;`);
  }
  console.log(
    "[migrate] tokenizer upgrade: unicode61 → vaporetto (re-applying FTS migrations 0002-0004)"
  );
  for (const rawSql of [migration0002, migration0003, migration0004]) {
    const statements = rawSql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0)
      // Skip ALTER TABLE base-shape changes (0003's sentences columns) —
      // already present on an existing db; re-running throws. They share a
      // chunk with leading comments, so test each line.
      .filter(
        (statement) =>
          !statement
            .split("\n")
            .some((line) => line.trim().toUpperCase().startsWith("ALTER "))
      )
      .map((statement) =>
        statement
          .replaceAll("__VAPORETTO_TOKENIZE__", "vaporetto")
          .replaceAll("__ASCII_TOKENIZE__", "unicode61")
      );
    for (const statement of statements) {
      db.exec(statement.endsWith(";") ? statement : `${statement};`);
    }
  }
  return true;
};

/** Split a drizzle migration file into executable statements with the
 * resolved tokenizer placeholders substituted. */
const migrationStatements = (rawSql: string, tokenizer: string): string[] =>
  rawSql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map((statement) =>
      statement
        .replaceAll("__VAPORETTO_TOKENIZE__", tokenizer)
        .replaceAll("__ASCII_TOKENIZE__", "unicode61")
    );

const applyIdempotentMigrationStatements = (
  db: DatabaseLibsql.Database,
  rawSql: string,
  tokenizer: string
): void => {
  for (const statement of migrationStatements(rawSql, tokenizer)) {
    try {
      db.exec(statement.endsWith(";") ? statement : `${statement};`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("duplicate column name")) {
        throw error;
      }
    }
  }
};

/** TASK-44: legacy dbs (created via drizzle-kit push before the
 * user_version counter existed) have the tables but user_version 0 —
 * detect them by probing the `cards` table and fast-forward instead of
 * crashing boot. */
const isLegacyUnversionedDb = (
  db: DatabaseLibsql.Database,
  applied: number
): boolean =>
  applied === 0 &&
  MIGRATION_FILES.length > 0 &&
  Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cards'"
      )
      .get()
  );

/** TASK-122: an ALTER-only migration can be half-applied when a boot died
 * between its statements, and a db already past it fails on the duplicate
 * column. Those ride the idempotent applier; the CREATE-based files must stay
 * strict so a real failure is loud. Membership is a set so each new ALTER
 * migration costs no branch in `createContentDatabase`. */
const IDEMPOTENT_MIGRATION_FILES = new Set([
  "0010_exam_state.sql",
  "0011_exam_clock.sql",
  "0012_exam_review.sql",
  "0013_item_stimuli.sql",
  "0014_exam_focus.sql",
  "0015_item_mask.sql",
  "0016_item_stem.sql",
]);

/** Every FTS surface the app queries must exist and respond before the
 * database is handed back; warm the vaporetto model cache off the hot
 * path (first call lazily decompresses the ~6 MB embedded model). */
const verifyFtsSurfaces = (
  db: DatabaseLibsql.Database,
  vaporettoLoaded: boolean
): void => {
  db.exec("SELECT 1 FROM vocab_fts LIMIT 1;");
  db.exec("SELECT 1 FROM grammar_fts LIMIT 1;");
  db.exec("SELECT 1 FROM kanji_fts LIMIT 1;");
  db.exec("SELECT 1 FROM sentences_fts LIMIT 1;");
  if (vaporettoLoaded) {
    db.exec("SELECT vaporetto_split(' ', ' ');");
  }
};

/** TASK-44: a legacy db (tables present, version 0) fast-forwards to latest
 * in one pass and stamps `user_version` so the incremental path is skipped.
 *
 * Extracted from `createContentDatabase` because it was the larger half of
 * that function's complexity, and because enumerating the migrations here
 * cost a line and a branch per migration - the fourteenth call pushed the
 * caller over the fallow threshold. A loop over the array removes the debt
 * permanently: a new migration now needs an entry in `MIGRATION_FILES` and
 * nothing here. That is the same intent the `IDEMPOTENT_MIGRATION_FILES`
 * comment already states for the ALTER migrations.
 *
 * 0000 is skipped deliberately. It is the obsolete `grammar`/`kanji` schema
 * and a legacy db already has the content tables, yet it stays accounted for
 * by the `user_version` stamp below, which asserts the array length.
 *
 * 2026-09-20: the FTS migrations (0001-0004) MUST ride the fast-forward too.
 * A db created by drizzle-kit push (or any pre-FTS path) has the content
 * tables but NO FTS surfaces; the old fast-forward applied only 0005+0006 and
 * stamped user_version = 7, so the FTS migrations never ran and every boot
 * failed verifyFtsSurfaces with "no such table: vocab_fts" (search surfaces
 * dead, boot degraded). Best-effort application makes this safe: 0001's plain
 * CREATEs land on FTS-less dbs, and on any db that already has them the
 * duplicate errors are swallowed per-statement (0002-0004 are DROP+CREATE).
 * TASK-80.2 rides the same pass: 0006's chat tables, which a legacy db also
 * predates.
 *
 * Returns whether it fast-forwarded, so the caller can return early.
 */
const fastForwardLegacyDb = (
  db: DatabaseLibsql.Database,
  applied: number,
  tokenizer: string
): boolean => {
  if (!isLegacyUnversionedDb(db, applied)) {
    return false;
  }
  console.log(
    "[migrate] legacy db without user_version — fast-forwarding to latest"
  );
  for (const { sql } of MIGRATION_FILES.slice(1)) {
    applyMigrationStatements(db, sql, tokenizer);
  }
  db.exec(`PRAGMA user_version = ${MIGRATION_FILES.length};`);
  return true;
};

/** The incremental path: apply everything the `user_version` stamp has not
 * seen, idempotent entries through the tolerant applier. Extracted from
 * `createContentDatabase` for the same reason as `fastForwardLegacyDb`, and
 * the trailing re-stamp is preserved: a db below the array length that was
 * not legacy-unversioned still gets one best-effort 0005 pass so the
 * cards-vocab snapshot lands before the version is written. */
const applyPendingMigrations = (
  db: DatabaseLibsql.Database,
  applied: number,
  tokenizer: string
): void => {
  for (const { file, sql: rawSql } of MIGRATION_FILES.slice(applied)) {
    if (IDEMPOTENT_MIGRATION_FILES.has(file)) {
      applyIdempotentMigrationStatements(db, rawSql, tokenizer);
      continue;
    }
    for (const statement of migrationStatements(rawSql, tokenizer)) {
      db.exec(statement.endsWith(";") ? statement : `${statement};`);
    }
  }

  if (applied < MIGRATION_FILES.length) {
    applyMigrationStatements(db, migration0005, tokenizer);
    db.exec(`PRAGMA user_version = ${MIGRATION_FILES.length};`);
  }
};

export const createContentDatabase = (url: string): ContentDatabase => {
  const db = new DatabaseLibsql(url);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    const vaporettoLoaded = loadVaporettoExtension(db);
    const tokenizer = resolveFtsTokenizerDdl(vaporettoLoaded);

    // TASK-44: boot-time idempotency. The DDL is plain CREATE TABLE (no
    // IF NOT EXISTS), so re-running migrations on an already-migrated db
    // throws "table already exists". Track progress in PRAGMA user_version
    // (= count of applied entries).
    const appliedRow = db.prepare("PRAGMA user_version").get() as
      | { user_version?: number }
      | undefined;
    const applied = appliedRow?.user_version ?? 0;
    if (fastForwardLegacyDb(db, applied, tokenizer)) {
      return { db, tokenizer, vaporettoLoaded };
    }
    applyPendingMigrations(db, applied, tokenizer);

    // TASK-53 follow-up: tokenizer-mode upgrade. A db migrated while the
    // vaporetto extension was UNAVAILABLE (every pre-TASK-49 compiled
    // boot) has vocab_fts/grammar_fts/kanji_fts/sentences_fts frozen at
    // unicode61 forever — user_version says "applied", so 0002-0004 never
    // re-run. When the extension is NOW loaded but the live FTS tables
    // are still unicode61, re-apply the FTS-defining migrations (their
    // DROP+CREATE+rebuild statements are mode-safe) so word-aware search
    // actually activates on existing dbs.
    upgradeFtsTokenizerToVaporetto(db, vaporettoLoaded);

    verifyFtsSurfaces(db, vaporettoLoaded);

    return { db, tokenizer, vaporettoLoaded };
  } catch (error: unknown) {
    db.close();
    throw error;
  }
};

export const applyContentMigrations = (
  url: string
): Omit<ContentDatabase, "db"> => {
  const { db, tokenizer, vaporettoLoaded } = createContentDatabase(url);
  db.close();
  return { tokenizer, vaporettoLoaded };
};
