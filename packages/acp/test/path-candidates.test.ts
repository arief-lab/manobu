import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pathCandidates } from "../src/index";

/**
 * `$PATH` discovery is the agent picker's only input: if the walk misses the
 * binary, `GET /agents` reports nothing installed and the learner cannot start
 * a chat at all. Windows changes the walk in three independent ways, so each
 * one gets its own case, faked from this Linux checkout (TASK-177).
 */

const LINUX: NodeJS.Platform = "linux";
const WIN: NodeJS.Platform = "win32";

test("posix probes the bare name and splits on `:`", () => {
  expect(
    pathCandidates("opencode", "/usr/local/bin:/home/u/.bun/bin", LINUX)
  ).toEqual(["/usr/local/bin/opencode", "/home/u/.bun/bin/opencode"]);
});

test("win32 splits on `;` so a drive letter is one entry, not two", () => {
  const candidates = pathCandidates(
    "opencode",
    "C:\\bin;C:\\Users\\u\\.bun\\bin",
    WIN,
    ".EXE"
  );
  expect(candidates).toEqual([
    "C:\\bin\\opencode",
    "C:\\bin\\opencode.exe",
    "C:\\Users\\u\\.bun\\bin\\opencode",
    "C:\\Users\\u\\.bun\\bin\\opencode.exe",
  ]);
  // A `:` split would have made `C` and `\bin;C` the directories instead.
  expect(candidates.some((path) => path.endsWith("C\\opencode"))).toBe(false);
});

test("win32 tries the bare name first, then every PATHEXT entry in order", () => {
  expect(pathCandidates("agy", "C:\\bin", WIN, ".EXE;.CMD;.LST")).toEqual([
    "C:\\bin\\agy",
    "C:\\bin\\agy.exe",
    "C:\\bin\\agy.cmd",
    "C:\\bin\\agy.lst",
  ]);
});

test("win32 without PATHEXT falls back to the shell's own default set", () => {
  expect(pathCandidates("agy", "C:\\bin", WIN, undefined)).toEqual([
    "C:\\bin\\agy",
    "C:\\bin\\agy.exe",
    "C:\\bin\\agy.cmd",
    "C:\\bin\\agy.bat",
    "C:\\bin\\agy.com",
  ]);
});

test("an empty PATH entry is dropped on both platforms", () => {
  expect(pathCandidates("agy", "/usr/bin::", LINUX)).toEqual(["/usr/bin/agy"]);
  expect(pathCandidates("agy", "C:\\bin;;", WIN, ".EXE")).toEqual([
    "C:\\bin\\agy",
    "C:\\bin\\agy.exe",
  ]);
});

test("the probe resolves a real file on this host and skips a directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "manobu-which-"));
  try {
    writeFileSync(join(dir, "opencode"), "#!/bin/sh\n");
    expect(pathCandidates("opencode", dir, LINUX)).toEqual([
      join(dir, "opencode"),
    ]);
    expect(pathCandidates("opencode", join(dir, "nope"), LINUX)).toEqual([
      join(dir, "nope/opencode"),
    ]);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
