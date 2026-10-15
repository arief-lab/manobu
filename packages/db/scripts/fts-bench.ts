import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";

const dir = mkdtempSync(join(tmpdir(), "manobu-fts-"));
const dbPath = join(dir, "content.db");
const url = `file:${dbPath}`;

const client = createClient({ url });

const setup = async (): Promise<void> => {
  await client.execute("PRAGMA journal_mode = WAL;");
  await client.execute("PRAGMA foreign_keys = ON;");
  // Apply 0000 + 0001 migrations manually for test
  const { readFile } = await import("node:fs/promises");
  const m1 = await readFile(
    join(import.meta.dir, "../src/migrations/0000_sour_master_chief.sql"),
    "utf-8"
  );
  const m2 = await readFile(
    join(import.meta.dir, "../src/migrations/0001_fts5_vocab_fts.sql"),
    "utf-8"
  );
  for (const sql of [m1, m2]) {
    const stmts = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of stmts) {
      const toExec = stmt.endsWith(";") ? stmt : `${stmt};`;
      // biome-ignore lint/performance/noAwaitInLoops: DDL statements must execute sequentially in dependency order
      await client.execute(toExec);
    }
  }
};

const seed = async (): Promise<void> => {
  // Insert themes for polyhierarchy
  await client.execute(
    "INSERT INTO themes (name) VALUES ('Travel'), ('Daily')"
  );
  // Insert 30k vocab rows
  const start = performance.now();
  const batchSize = 1000;
  const total = 30_000;
  for (let i = 0; i < total; i += batchSize) {
    const batch: Promise<unknown>[] = [];
    for (let j = 0; j < batchSize && i + j < total; j += 1) {
      const id = i + j + 1;
      batch.push(
        client.execute({
          args: [
            id,
            `単語${id}`,
            `よみ${id}`,
            `yomi${id}`,
            `english ${id}`,
            "N5",
          ],
          sql: "INSERT INTO vocab (id, jp, reading, romaji, en, level) VALUES (?, ?, ?, ?, ?, ?)",
        })
      );
    }
    // biome-ignore lint/performance/noAwaitInLoops: batches must run sequentially to bound memory; inserts inside batch are parallel via Promise.all
    await Promise.all(batch);
  }
  // Polyhierarchy: one vocab maps to many themes
  await client.execute(
    "INSERT INTO vocab_themes (vocab_id, theme_id) VALUES (1, 1), (1, 2)"
  );
  const end = performance.now();
  console.log(`seed 30k rows + polyhierarchy: ${(end - start).toFixed(0)}ms`);
};

const bench = async (): Promise<void> => {
  const queries = ["english", "word100", "yomi*"];
  for (const q of queries) {
    const t0 = performance.now();
    // biome-ignore lint/performance/noAwaitInLoops: sequential timing measurement per query is intentional
    const res = await client.execute({
      args: [q],
      sql: "SELECT rowid FROM vocab_fts WHERE vocab_fts MATCH ? LIMIT 20",
    });
    const t1 = performance.now();
    const ms = t1 - t0;
    console.log(
      `FTS query "${q}" -> ${res.rows.length} rows in ${ms.toFixed(2)}ms ${ms < 100 ? "OK" : "FAIL (>100ms)"}`
    );
    if (ms >= 100) {
      console.error(`FAIL: FTS query ${q} exceeded 100ms`);
      process.exit(1);
    }
  }
  // Verify polyhierarchy
  const poly = await client.execute(
    "SELECT theme_id FROM vocab_themes WHERE vocab_id = 1"
  );
  console.log(
    `polyhierarchy vocab 1 themes: ${poly.rows.map((r) => r.theme_id).join(",")} (expected 1,2)`
  );
  if (poly.rows.length !== 2) {
    console.error("FAIL: polyhierarchy");
    process.exit(1);
  }
  console.log("All checks passed");
};

await setup();
await seed();
await bench();
rmSync(dir, { force: true, recursive: true });
