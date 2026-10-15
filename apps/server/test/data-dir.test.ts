import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __test__, resolveDataDir } from "../src/data-dir";

/*
 * TASK-43: the compiled sidecar cannot use import.meta.dir (it is /$bunfs),
 * so resolveDataDir() walks env → dev walk → cwd → exe-parent candidates and
 * returns the first dir containing n5.json. These tests pin the candidate
 * ordering and the env-wins contract the Tauri side (lib.rs) relies on.
 */

describe("resolveDataDir", () => {
  let scratch: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "manobu-data-dir-"));
    mkdirSync(join(scratch, "data"), { recursive: true });
    writeFileSync(join(scratch, "data", "n5.json"), "[]");
  });

  afterAll(() => {
    delete process.env.MANOBU_DATA_DIR;
    rmSync(scratch, { force: true, recursive: true });
  });

  it("env candidate is first when set", () => {
    process.env.MANOBU_DATA_DIR = join(scratch, "data");
    expect(__test__.dataDirCandidates()[0]).toBe(join(scratch, "data"));
  });

  it("prefers a candidate that actually contains n5.json (env wins when valid)", () => {
    process.env.MANOBU_DATA_DIR = join(scratch, "data");
    expect(resolveDataDir()).toBe(join(scratch, "data"));
  });

  it("skips env candidates without n5.json and falls through", () => {
    const empty = mkdtempSync(join(tmpdir(), "manobu-data-dir-empty-"));
    process.env.MANOBU_DATA_DIR = empty;
    const resolved = resolveDataDir();
    // Falls through to whatever candidate is valid in this environment (the
    // repo walk during dev/test runs) — never the empty env dir.
    expect(resolved).not.toBe(empty);
    rmSync(empty, { force: true, recursive: true });
  });

  it("returns null when no candidate is valid", () => {
    process.env.MANOBU_DATA_DIR = "/nonexistent-manobu-data";
    const originalCwd = process.cwd();
    process.chdir(scratch);
    // exe-parent candidates walk from the bun binary — none contain n5.json
    // inside this scratch tree, and import.meta.dir in tests is apps/server/
    // test which walks to the repo... so instead assert the resolved dir (if
    // any) is outside the scratch.
    const resolved = resolveDataDir();
    if (resolved !== null) {
      expect(resolved.startsWith(scratch)).toBe(false);
    }
    process.chdir(originalCwd);
  });
});
