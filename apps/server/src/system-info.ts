/**
 * System-info report (TASK-153 AC#3).
 *
 * The packaged app must be answerable from the outside: which data, cache,
 * log, assistant and registry paths is THIS process actually serving? The
 * old way to debug a packaged misbehavior was to guess from whatever cwd
 * the launcher happened to set — which is exactly the ambiguity the explicit
 * `MANOBU_*` env contract removes. This module turns those explicit inputs
 * into one JSON shape; the route in `index.ts` hands it to the client.
 *
 * Every path here is echoed from an explicit source (env var, the
 * assistant-loader's own resolution, the db URI). None is derived from
 * `process.cwd()`, so a wrong cwd in a launcher can never masquerade as a
 * correct answer.
 */

import { dirname, resolve } from "node:path";
import type { AssistantResolution } from "./assistant-loader";

/** A `scheme://` prefix marks a URL-ish DATABASE_URL, not a local file. */
const URL_SCHEME_RE = /^[a-z]+:\/\//i;

export interface SystemInfoPaths {
  /** Resolved persona bundle: dir or null + whether the fallback is live. */
  assistantDir: string | null;
  assistantFallback: boolean;
  /** `MANOBU_CACHE_DIR` as passed by the launcher (null in plain dev). */
  cacheDir: string | null;
  /** Where the durable agent process-group registry lives, else null. */
  childRegistryPath: string | null;
  /** Absolute path of the `file:`-backed database, else null. */
  databaseFile: string | null;
  /** App data dir = the directory holding the SQLite file, else null. */
  dataDir: string | null;
  /** Directory of the Japanese corpus files (`MANOBU_DATA_DIR`). */
  japaneseDataDir: string | null;
  logDir: string | null;
}

export interface SystemInfoReport {
  paths: SystemInfoPaths;
  /** Raw env HOME/PATH presence only — never the value (it can leak names). */
  process: {
    cwd: string;
    home: string | null;
    pathEntries: number;
    pid: number;
  };
}

/** Extract the local file from a `file:`-style DATABASE_URL; null otherwise. */
function databaseFile(databaseUrl: string): string | null {
  const file = databaseUrl.startsWith("file:")
    ? databaseUrl.slice("file:".length)
    : databaseUrl;
  if (file.length === 0 || file === ":memory:" || URL_SCHEME_RE.test(file)) {
    return null;
  }
  return resolve(file);
}

/**
 * Pure builder: `env` is the source of truth (pass `process.env` in prod,
 * a fake object in tests). `assistant` comes from the loader's recorded
 * resolution, `childRegistryPath` from the same value the controller uses.
 */
export function buildSystemInfoReport(source: {
  assistant: AssistantResolution;
  childRegistryPath?: string | undefined;
  env: NodeJS.ProcessEnv;
  cwd: string;
  pid: number;
}): SystemInfoReport {
  const dbFile = databaseFile(source.env.DATABASE_URL ?? "");
  const { env } = source;
  return {
    paths: {
      assistantDir: source.assistant.dir,
      assistantFallback: source.assistant.fallback,
      cacheDir: env.MANOBU_CACHE_DIR ?? null,
      childRegistryPath: source.childRegistryPath ?? null,
      databaseFile: dbFile,
      dataDir: dbFile === null ? null : dirname(dbFile),
      japaneseDataDir: env.MANOBU_DATA_DIR ?? null,
      logDir: env.MANOBU_LOG_DIR ?? null,
    },
    process: {
      cwd: source.cwd,
      home: env.HOME ?? null,
      pathEntries: (env.PATH ?? "").split(":").filter(Boolean).length,
      pid: source.pid,
    },
  };
}
