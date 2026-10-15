import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@libsql/client";
// TASK-23.1: schema + seed flow through the shared native applier — the
// vaporetto tokenizer (like every SQLite loadable extension) must be
// registered on the same connection that writes/queries the FTS5 tables.
import { type ContentDatabase, createContentDatabase } from "../src/migrate";
import {
  VAPORETTO_MODEL_DIR,
  VAPORETTO_MODEL_FILENAME,
} from "../src/vaporetto";

const DB_PATH = join(tmpdir(), `manobu-fts5-perf-${Date.now()}.db`);
const URL = `file:${DB_PATH}`;

let content: ContentDatabase;
let vocabId = 0;

beforeAll(async () => {
  content = await createContentDatabase(URL);
  console.log(
    `[fts5-perf] tokenizer=${content.tokenizer} vaporettoLoaded=${content.vaporettoLoaded}`
  );
  // The model must be present for the vaporetto path; keep the test honest
  // about which tokenizer actually ran.
  if (content.vaporettoLoaded) {
    expect(
      existsSync(join(VAPORETTO_MODEL_DIR, VAPORETTO_MODEL_FILENAME)) ||
        Boolean(process.env.SQLITE_VAPORETTO_MODEL)
    ).toBe(true);
  }

  const { db } = content;
  db.exec("BEGIN");
  const insert = db.prepare(
    "INSERT INTO vocab (jp, reading, romaji, en, level) VALUES (?, ?, ?, ?, ?)"
  );
  for (let i = 0; i < 30_000; i += 1) {
    vocabId += 1;
    insert.run(
      `語${vocabId}`,
      `よみ${vocabId}`,
      `yomi${vocabId}`,
      `english gloss for vocabulary entry ${vocabId} (eat/drink/go/see/come)`,
      "N5"
    );
  }
  // grammar_fts/kanji_fts smoke rows so their triggers/DDL are exercised on
  // both tokenizer paths.
  db.prepare(
    "INSERT INTO grammar (level, point, pattern, ref) VALUES (?, ?, ?, ?)"
  ).run("N5", "〜たことがある", "have done ~; experience", "te-form");
  db.prepare(
    'INSERT INTO kanji ("char", "on", kun, meaning, level, strokes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run("食", "ショク", "たべ", "eat; food", "N5", 9);
  // TASK-23.4.2: sentences_fts (Tatoeba/Tanaka corpus) exercises the same
  // external-content trigger wiring on a second table.
  db.prepare(
    "INSERT INTO sentences (jp, en, level, linked_word, jp_len) VALUES (?, ?, ?, ?, ?)"
  ).run(
    "私は日本語を勉強しています。",
    "I am studying Japanese.",
    "N5",
    null,
    14
  );
  db.exec("COMMIT");
}, 120_000); // 30k inserts + per-row FTS tokenization on both paths

afterAll(() => {
  content.db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${DB_PATH}${suffix}`;
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
});

describe("FTS5 search @ 30k rows", () => {
  it("returns matching rows for an ASCII token query in <100ms", () => {
    const t0 = performance.now();
    const rows = content.db
      .prepare(
        "SELECT rowid FROM vocab_fts_en WHERE vocab_fts_en MATCH ? LIMIT 20"
      )
      .all("english");
    const ms = performance.now() - t0;
    expect(rows.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(100);
  });

  it("supports LIMIT 20 batch loading", () => {
    const rows = content.db
      .prepare(
        "SELECT rowid FROM vocab_fts_en WHERE vocab_fts_en MATCH ? LIMIT 20"
      )
      .all("eat");
    expect(rows.length).toBe(20);
  });

  it("returns zero rows on no match", () => {
    const rows = content.db
      .prepare(
        "SELECT rowid FROM vocab_fts_en WHERE vocab_fts_en MATCH ? LIMIT 20"
      )
      .all("zzzz_no_match_token");
    expect(rows.length).toBe(0);
  });

  it("matches on kana reading column", () => {
    const rows = content.db
      .prepare("SELECT rowid FROM vocab_fts WHERE vocab_fts MATCH ? LIMIT 20")
      .all("よみ*");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("matches Japanese word boundaries (vaporetto path)", () => {
    if (!content.vaporettoLoaded) {
      return; // unicode61 cannot tokenize 東京特許許可局 word-aware
    }
    // Seed a doc-2-style boundary case and query a mid-compound word.
    content.db
      .prepare(
        "INSERT INTO vocab (jp, reading, romaji, en, level) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        "東京特許許可局",
        "とうきょうとっきょきょかきょく",
        "tokyo-tokkyo",
        "Tokyo Patent Office",
        "N1"
      );
    const rows = content.db
      .prepare("SELECT rowid FROM vocab_fts WHERE vocab_fts MATCH ? LIMIT 20")
      .all("特許");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("searches grammar_fts", () => {
    const rows = content.db
      .prepare(
        "SELECT rowid FROM grammar_fts WHERE grammar_fts MATCH ? LIMIT 20"
      )
      .all("たこと");
    // unicode61 cannot match a kana fragment inside 〜たことがある; vaporetto
    // tokenizes こと/が word-aware. Assert only on the vaporetto path.
    if (content.vaporettoLoaded) {
      expect(rows.length).toBeGreaterThan(0);
    } else {
      expect(rows.length).toBe(0);
    }
  });

  it("searches kanji_fts by reading and meaning", () => {
    const byReading = content.db
      .prepare("SELECT rowid FROM kanji_fts WHERE kanji_fts MATCH ? LIMIT 20")
      .all("たべ");
    expect(byReading.length).toBe(1);
    const byMeaning = content.db
      .prepare(
        "SELECT rowid FROM kanji_fts_en WHERE kanji_fts_en MATCH ? LIMIT 20"
      )
      .all("food");
    expect(byMeaning.length).toBe(1);
  });

  it("searches sentences_fts in Japanese (TASK-23.4.2)", () => {
    const rows = content.db
      .prepare(
        "SELECT rowid FROM sentences_fts WHERE sentences_fts MATCH ? LIMIT 20"
      )
      .all("日本語");
    // vaporetto tokenizes 日本語 word-aware; unicode61 matches only if the
    // seed row happens to split trivially — assert only on the vaporetto path.
    if (content.vaporettoLoaded) {
      expect(rows.length).toBeGreaterThan(0);
    } else {
      expect(rows.length).toBe(0);
    }
  });

  it("searches sentences_fts_en for English text in <100ms (TASK-23.4.2)", () => {
    const t0 = performance.now();
    const rows = content.db
      .prepare(
        "SELECT rowid FROM sentences_fts_en WHERE sentences_fts_en MATCH ? LIMIT 20"
      )
      .all("studying");
    const ms = performance.now() - t0;
    expect(rows.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(100);
  });

  it("joins sentences_fts hits back to the sentences table", () => {
    const row = content.db
      .prepare(
        "SELECT s.jp, s.en FROM sentences_fts f JOIN sentences s ON s.id = f.rowid WHERE sentences_fts MATCH ? LIMIT 1"
      )
      .get("日本語") as { jp?: string; en?: string } | undefined;
    if (content.vaporettoLoaded) {
      expect(row?.jp).toContain("日本語");
      expect(row?.en).toBe("I am studying Japanese.");
    } else {
      expect(row).toBeUndefined();
    }
  });

  it("combines Japanese + ASCII halves on the same rowids", () => {
    const rows = content.db
      .prepare(
        "SELECT v.rowid FROM vocab_fts v JOIN vocab_fts_en e ON e.rowid = v.rowid WHERE v.vocab_fts MATCH ? AND e.vocab_fts_en MATCH ? LIMIT 20"
      )
      .all("よみ1", "english");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("uses bm25 ranking with vaporetto_or_query (vaporetto path)", () => {
    if (!content.vaporettoLoaded) {
      return; // unicode61 fallback has no vaporetto_* SQL helpers
    }
    // Selective compound: only this row contains 特許/許可 tokens, so the OR
    // expansion stays small and bm25 ranking is exercised cheaply.
    content.db
      .prepare(
        "INSERT INTO vocab (jp, reading, romaji, en, level) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        "大阪特許許可局",
        "おおさかとっきょきょかきょく",
        "osaka-tokkyo",
        "Osaka Patent Office",
        "N1"
      );
    const rows = content.db
      .prepare(
        "SELECT rowid FROM vocab_fts WHERE vocab_fts MATCH vaporetto_or_query('東京特許許可局') ORDER BY bm25(vocab_fts), rowid LIMIT 20"
      )
      .all();
    expect(rows.length).toBe(2); // 東京… and 大阪… rows share 特許/許可/局
  });

  it("splits Japanese input word-aware (vaporetto path)", () => {
    if (!content.vaporettoLoaded) {
      return;
    }
    const row = content.db
      .prepare("SELECT vaporetto_split(?, '/') AS split")
      .get("東京特許許可局") as { split?: string } | undefined;
    // The doc-2 example: word boundaries around 特許/許可 must appear.
    expect(row?.split).toContain("特許");
    expect(row?.split).toContain("許可");
  });
});

describe("WAL recovery", () => {
  it("reopens the same db file and reads back data", () => {
    content.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const row = content.db.prepare("SELECT COUNT(*) AS n FROM vocab").get() as {
      n: number;
    };
    expect(Number(row.n)).toBe(30_002);
  });

  it("survives a close + reopen of the same URL", async () => {
    // Reopen through @libsql/client: COUNT(*) on the content table does not
    // touch FTS5, so no extension is required on this connection (FTS
    // tokenizers are per-connection; see src/vaporetto.ts notes).
    const reopened = createClient({ url: URL });
    const result = await reopened.execute("SELECT COUNT(*) AS n FROM vocab");
    expect(Number(result.rows[0]?.n ?? 0)).toBe(30_002);
    reopened.close();
  });
});
