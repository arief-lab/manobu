import { createClient } from "@libsql/client";

const DEFAULT_SETTINGS: Record<string, string> = {
  ask_first: "true",
  desired_retention: "0.90",
  furigana_default: "true",
  goal: '"travel"',
  max_interval_days: "365",
  nudge_last_shown: "null",
  romaji: "false",
  voice: '"varied"',
};

const DEFAULT_THEMES = ["Travel", "Daily", "Work", "Anime", "Numbers"];

export const seedDefaults = async (url: string): Promise<void> => {
  const client = createClient({ url });
  await client.execute("PRAGMA journal_mode = WAL;");
  await client.execute("PRAGMA foreign_keys = ON;");

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    // biome-ignore lint/performance/noAwaitInLoops: sequential seed inserts for determinism (12 rows)
    await client.execute({
      args: [key, value],
      sql: "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
    });
  }

  for (const name of DEFAULT_THEMES) {
    // biome-ignore lint/performance/noAwaitInLoops: sequential inserts for determinism (5 rows)
    await client.execute({
      args: [name],
      sql: "INSERT OR IGNORE INTO themes (name) VALUES (?)",
    });
  }
};

export const applySchemaSql = async (
  url: string,
  schemaPath: string
): Promise<void> => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(schemaPath, "utf-8");
  const client = createClient({ url });

  // Split on statement boundaries; drizzle uses breakpoint markers, but raw sql uses ;
  // Execute each statement individually to handle triggers and virtual tables
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (trimmed.length === 0) {
      continue;
    }
    // Skip PRAGMA that will be set per-connection
    if (trimmed.toUpperCase().startsWith("PRAGMA")) {
      // biome-ignore lint/performance/noAwaitInLoops: DDL statements must execute sequentially
      await client.execute(`${trimmed};`);
      continue;
    }
    await client.execute(`${trimmed};`);
  }
};
