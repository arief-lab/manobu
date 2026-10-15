/**
 * TASK-49 regression guard: applyContentMigrations must finish on a fresh
 * db in bounded time in BOTH tokenizer modes.
 *
 * Historical failure (the bug this guards): with SQLITE_VAPORETTO_EXT
 * loaded, upstream sqlite-vaporetto v0.4.0 rebuilt the Predictor (58MB
 * model parse, ~6.5s) on every FTS5 x_create — 5 vaporetto tables meant
 * ~33s+ of synchronous blocking per fresh db, and the same again per new
 * connection. The patched extension (predictor-cache.diff) pays it once
 * per process; every later create/reopen first-touch is ~0ms.
 *
 * Bounds: unicode61 must be near-instant (<5s is generous); vaporetto
 * must be <30s (one cold predictor build ~6.5s + migration I/O). A
 * regression to per-table rebuilds blows straight past 30s.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import DatabaseLibsql from "libsql";

import { applyContentMigrations } from "../src/migrate";
import {
  resolveVaporettoExtPath,
  VAPORETTO_EXT_DIR,
  VAPORETTO_MODEL_DIR,
  VAPORETTO_MODEL_FILENAME,
} from "../src/vaporetto";

const EXT_PATH = join(VAPORETTO_EXT_DIR, "libsqlite_vaporetto.so");
const MODEL_PATH = join(VAPORETTO_MODEL_DIR, VAPORETTO_MODEL_FILENAME);
const EXT_AVAILABLE = existsSync(EXT_PATH) && existsSync(MODEL_PATH);

const freshDb = (label: string): string => {
  const path = join(tmpdir(), `manobu-t49-${label}-${Date.now()}.db`);
  return `file:${path}`;
};

const cleanupPaths: string[] = [];

afterAll(() => {
  for (const path of cleanupPaths) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(`${path}${suffix}`);
      } catch {
        // best-effort temp cleanup
      }
    }
  }
});

describe("TASK-50 SQLITE_VAPORETTO_EXT resolution", () => {
  it("empty string is an explicit disable (returns null)", () => {
    const prev = process.env.SQLITE_VAPORETTO_EXT;
    process.env.SQLITE_VAPORETTO_EXT = "";
    expect(resolveVaporettoExtPath()).toBeNull();
    if (prev === undefined) {
      delete process.env.SQLITE_VAPORETTO_EXT;
    } else {
      process.env.SQLITE_VAPORETTO_EXT = prev;
    }
  });

  it("a set path is honored verbatim", () => {
    const prev = process.env.SQLITE_VAPORETTO_EXT;
    process.env.SQLITE_VAPORETTO_EXT = "/custom/libsqlite_vaporetto.so";
    expect(resolveVaporettoExtPath()).toBe("/custom/libsqlite_vaporetto.so");
    if (prev === undefined) {
      delete process.env.SQLITE_VAPORETTO_EXT;
    } else {
      process.env.SQLITE_VAPORETTO_EXT = prev;
    }
  });

  it("unset resolves the dev-dir default", () => {
    const prev = process.env.SQLITE_VAPORETTO_EXT;
    delete process.env.SQLITE_VAPORETTO_EXT;
    const resolved = resolveVaporettoExtPath();
    if (existsSync(resolved ?? "")) {
      expect(resolved).toBe(EXT_PATH);
    }
    if (prev !== undefined) {
      process.env.SQLITE_VAPORETTO_EXT = prev;
    }
  });
});

describe("TASK-49 migration wall-clock bounds", () => {
  it("unicode61 (ext unset) migrates a fresh db in <5s", () => {
    const url = freshDb("ascii");
    cleanupPaths.push(url.slice("file:".length));
    // Force the unicode61 branch: the dev ext dir exists whenever the
    // fetch/build script has run, so the resolver would otherwise load
    // the patched .so even for this mode. The resolver treats "" as
    // unset, so point it at a path that cannot exist instead.
    const prevExt = process.env.SQLITE_VAPORETTO_EXT;
    process.env.SQLITE_VAPORETTO_EXT = "/nonexistent/libsqlite_vaporetto.so";
    const t0 = Date.now();
    const result = applyContentMigrations(url);
    if (prevExt === undefined) {
      delete process.env.SQLITE_VAPORETTO_EXT;
    } else {
      process.env.SQLITE_VAPORETTO_EXT = prevExt;
    }
    const elapsed = Date.now() - t0;
    expect(result.tokenizer).toBe("unicode61");
    expect(result.vaporettoLoaded).toBe(false);
    expect(elapsed).toBeLessThan(5000);
  }, 15_000);

  it.skipIf(!EXT_AVAILABLE)(
    "vaporetto (patched ext) migrates a fresh db in <30s",
    () => {
      const url = freshDb("vap");
      cleanupPaths.push(url.slice("file:".length));
      const t0 = Date.now();
      const result = applyContentMigrations(url);
      const elapsed = Date.now() - t0;
      expect(result.tokenizer).toBe("vaporetto");
      expect(result.vaporettoLoaded).toBe(true);
      expect(elapsed).toBeLessThan(30_000);
    },
    60_000
  );

  it.skipIf(!EXT_AVAILABLE)(
    "second connection pays ~0 for vaporetto first-touch (predictor cache)",
    () => {
      const url = freshDb("cache");
      cleanupPaths.push(url.slice("file:".length));
      applyContentMigrations(url);
      // A fresh Database handle simulates the sidecar's second connection.
      // With the patch, first touch is ~0ms; the unpatched build re-pays
      // ~6.5s per vaporetto table.
      const db = new DatabaseLibsql(url);
      db.loadExtension(EXT_PATH);
      const t0 = Date.now();
      db.prepare("SELECT rowid FROM vocab_fts LIMIT 1").all();
      const elapsed = Date.now() - t0;
      db.close();
      expect(elapsed).toBeLessThan(2000);
    },
    30_000
  );
});
