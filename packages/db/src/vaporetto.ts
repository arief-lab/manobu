/**
 * sqlite-vaporetto helpers (TASK-23.1, doc-2 §5.1).
 *
 * The vaporetto FTS5 tokenizer needs two runtime assets:
 *  - `SQLITE_VAPORETTO_EXT`  — the loadable extension. Set to "" (empty)
 *    to explicitly DISABLE vaporetto (force unicode61); unset resolves the
 *    dev-dir default (TASK-50).
 *     (`libsqlite_vaporetto.so` / `.dylib` / `.dll`, shipped via Tauri
 *     `bundle.resources` → `<resource>/vaporetto/ext/`).
 *  - `SQLITE_VAPORETTO_MODEL` — the BCCWJ+UniDic model
 *     (`bccwj-suw+unidic_pos+kana.model.zst`, shipped via
 *     `<resource>/vaporetto/model/`).
 *
 * Both are provisioned by `scripts/fetch-vaporetto.ts` (pinned release +
 * sha256). When either is missing — dev without the fetch, remote/Turso
 * clients, restricted runtimes — every helper degrades to a no-op and FTS5
 * falls back to the `unicode61` schema (see migration 0002 comments).
 *
 * Extension loading works only on a native connection: the `libsql`
 * `Database` class (better-sqlite3-compatible) exposes `loadExtension`.
 * `@libsql/client`'s file client keeps its handle in a private field, so
 * consumers that need vaporetto tokenization must open the database with the
 * `libsql` package directly and pass that handle here. Remote/http clients
 * can never load extensions.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Resolve the vaporetto asset root. TASK-49's import.meta.url walk is dead
 * inside a `bun build --compile` binary (url = /$bunfs/...), and the
 * counted ".." chains replacing it were miscounted twice (the exe FILE is
 * itself a segment: target/debug/server needs 6 ups to the repo root, not
 * 4 or 5). This walks UP from the exe dir one parent at a time checking
 * for the marker directory — no depth arithmetic to get wrong. */
const RESOURCE_REPO_MARKER = "apps/desktop/src-tauri/resources/vaporetto/ext";
const RESOURCE_PACKED_DIR = "resources/vaporetto";

const ancestorDirs = (start: string, maxDepth: number): string[] => {
  const dirs: string[] = [];
  let dir = start;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    dirs.push(dir);
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return dirs;
};

/** The two vaporetto asset directories, `ext` and `model`, live under one root:
 * in the repo it is `<repo>/apps/desktop/src-tauri/resources/vaporetto`, in a
 * bundle it is `<resource dir>/resources/vaporetto`. Finding the root by its
 * `ext` marker rather than by counted ".." chains is what keeps both layouts
 * honest: the packaged branch used to hand back a fake repo root and then
 * re-append the repo path to it, so a bundle that DID ship the assets still
 * resolved nothing and silently ran unicode61. */
const assetRootFor = (starts: readonly string[]): string => {
  for (const start of starts) {
    // 1) repo layout: ancestors until <root>/apps/desktop/src-tauri/
    //    resources/vaporetto/ext exists.
    for (const dir of ancestorDirs(start, 12)) {
      if (existsSync(join(dir, RESOURCE_REPO_MARKER))) {
        return join(dir, RESOURCE_REPO_MARKER, "..");
      }
    }
    // 2) packaged layout: <dir>/resources/vaporetto/ext, the destination
    //    `bundle.resources` maps the assets to inside the resource dir.
    for (const dir of ancestorDirs(start, 4)) {
      if (existsSync(join(dir, RESOURCE_PACKED_DIR, "ext"))) {
        return join(dir, RESOURCE_PACKED_DIR);
      }
    }
  }
  return "";
};

/** Ancestor walks from BOTH the exe dir and the cwd: under plain `bun` the exe
 * is the bun binary (nowhere near the repo), while the cwd is inside the repo;
 * in the compiled sidecar the exe is the binary itself and cwd is set by
 * lib.rs. Whichever chain finds the marker wins. */
const VAPORETTO_ASSET_ROOT = assetRootFor([
  dirname(process.execPath),
  process.cwd(),
]);

/** Where the extension and the model are read from, in whichever layout was
 * found. Empty root means neither, and every helper degrades to unicode61. */
export const VAPORETTO_EXT_DIR = join(VAPORETTO_ASSET_ROOT, "ext");
export const VAPORETTO_MODEL_DIR = join(VAPORETTO_ASSET_ROOT, "model");

export const VAPORETTO_MODEL_FILENAME = "bccwj-suw+unidic_pos+kana.model.zst";

const EXT_FILENAME_BY_PLATFORM: Record<string, string> = {
  darwin: "libsqlite_vaporetto.dylib",
  linux: "libsqlite_vaporetto.so",
  win32: "sqlite_vaporetto.dll",
};

/** Loadable-extension entry point registered by sqlite-vaporetto. */
export const VAPORETTO_EXTENSION_ENTRYPOINT = "sqlite3_vaporetto_init";

export const resolveVaporettoExtPath = (): string | null => {
  // TASK-50: `SQLITE_VAPORETTO_EXT=""` (empty string) is an EXPLICIT
  // disable — returns null so callers fall back to unicode61. Without the
  // `!== undefined` check, "" is falsy and silently falls through to the
  // dev-dir default, so the intuitive way to force unicode61 does nothing.
  if (process.env.SQLITE_VAPORETTO_EXT !== undefined) {
    return process.env.SQLITE_VAPORETTO_EXT || null;
  }
  const filename = EXT_FILENAME_BY_PLATFORM[process.platform];
  if (!filename) {
    return null;
  }
  return join(VAPORETTO_EXT_DIR, filename);
};

export const resolveVaporettoModelPath = (): string | null =>
  process.env.SQLITE_VAPORETTO_MODEL ??
  join(VAPORETTO_MODEL_DIR, VAPORETTO_MODEL_FILENAME);

/**
 * Load the sqlite-vaporetto extension into a native libSQL connection.
 * Accepts a `libsql` `Database` handle (has `loadExtension`) or any wrapper
 * exposing it. Resolves `false` (no-op) when the extension file is missing,
 * the handle cannot load extensions (remote/http clients), or loading fails
 * (arch mismatch, missing deps) — callers must fall back to unicode61.
 */
export const loadVaporettoExtension = (client: unknown): boolean => {
  const extPath = resolveVaporettoExtPath();
  if (!(extPath && existsSync(extPath))) {
    return false;
  }
  const candidate = client as {
    loadExtension?: (path: string) => unknown;
    db?: { loadExtension?: (path: string) => unknown };
  };
  const loader =
    candidate.loadExtension?.bind(candidate) ??
    candidate.db?.loadExtension?.bind(candidate.db);
  if (!loader) {
    return false;
  }
  try {
    loader(extPath);
    return true;
  } catch {
    return false;
  }
};

/** POS-filter tags for search indexes (doc-2 §5.1). Upstream `main` accepts
 * comma-separated lists, but the pinned v0.4.0 release parses a single tag
 * only — the shipped schema therefore indexes ALL tokens (bare `vaporetto`,
 * full embedded model), which maximizes recall for kana/grammar queries.
 * Revisit when upstream releases multi-tag + `model <path>` support. */
export const VAPORETTO_TAGS = "名詞,動詞,形容詞,副詞,接頭辞,接尾辞";

/**
 * Build the `tokenize = '…'` DDL fragment for an FTS5 table using the
 * vaporetto tokenizer.
 *
 * Pinned v0.4.0 `-with-model` builds embed the full BCCWJ+UniDic model, so
 * the bare directive is all that is needed (and the only portable form —
 * v0.4.0 rejects comma-separated `tags` and `model <path>` arguments).
 */
export const vaporettoTokenizerDdl = (_modelPath?: string | null): string =>
  "vaporetto";

/** unicode61 fallback DDL (no diacritics folding needed for Japanese). */
export const unicode61TokenizerDdl = "unicode61";

/**
 * TASK-23.1: resolve the FTS5 tokenize fragment for migration 0002's
 * `__VAPORETTO_TOKENIZE__` placeholder — vaporetto (extension loaded, full
 * model embedded in the `-with-model` build) or unicode61 fallback.
 */
export const resolveFtsTokenizerDdl = (extLoaded: boolean): string =>
  extLoaded ? vaporettoTokenizerDdl() : unicode61TokenizerDdl;

const WHITESPACE_SPLIT = /\s+/;

/**
 * Quote one token for an FTS5 MATCH query (double the inner double quotes).
 */
const quoteFts5Token = (token: string): string =>
  `"${token.replaceAll('"', '""')}"`;

/**
 * TypeScript-side approximation of sqlite-vaporetto's `vaporetto_and_query`:
 * split the user query on whitespace and AND the quoted tokens. Used only
 * when the extension is not loaded — with the extension the SQL function is
 * authoritative (it also tokenizes Japanese input word-aware).
 */
export const vaporettoAndQueryFallback = (query: string): string =>
  query
    .split(WHITESPACE_SPLIT)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map(quoteFts5Token)
    .join(" AND ");

/** Test seam: the layout walk with the search starts injected. The live asset
 * root is a module-level const resolved from the real exe dir and cwd, so a
 * spec cannot steer it without this. */
export const __test__ = { assetRootFor };
