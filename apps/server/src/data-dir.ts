/*
 * Resolve the Japanese data directory (`packages/japanese/data`) for the
 * file-backed API routes (TASK-43).
 *
 * `bun build --compile` binaries run with `import.meta.dir` inside `/$bunfs`
 * — the repo-relative walk that works in `bun run src/index.ts` is dead in
 * the packaged sidecar. Resolution order mirrors `assistant-loader.ts`:
 *
 *  1. `MANOBU_DATA_DIR` env — set by the Tauri sidecar (`lib.rs`) to the
 *     resource-dir copy of `packages/japanese/data` (packaged) or the repo
 *     working tree (dev override / tests).
 *  2. `import.meta.dir` walk — dev: `apps/server/src/routes` → repo root.
 *  3. `process.cwd()` walk — running from the repo root.
 *  4. Executable-parent walk — dev sidecar (`src-tauri/binaries`) with the
 *     repo tree above it.
 *
 * Returns the FIRST candidate that contains `n5.json`; `null` when none do
 * (routes degrade to their error paths — same contract as the assistant
 * loader's embedded-persona fallback).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const dataDirCandidates = (): string[] => {
  const dirs: string[] = [];
  const envDir = process.env.MANOBU_DATA_DIR;
  if (envDir) {
    dirs.push(envDir);
  }
  const here = import.meta.dir;
  if (here) {
    dirs.push(join(here, "../../../packages/japanese/data"));
  }
  dirs.push(join(process.cwd(), "packages/japanese/data"));
  const { execPath } = process;
  if (execPath) {
    dirs.push(
      join(execPath, "..", "packages/japanese/data"),
      join(execPath, "..", "..", "packages/japanese/data"),
      join(execPath, "..", "..", "..", "packages/japanese/data"),
      join(execPath, "..", "..", "..", "..", "packages/japanese/data")
    );
  }
  return dirs;
};

export const resolveDataDir = (): string | null => {
  for (const dir of dataDirCandidates()) {
    if (existsSync(join(dir, "n5.json"))) {
      return dir;
    }
  }
  return null;
};

export const __test__ = { dataDirCandidates };
