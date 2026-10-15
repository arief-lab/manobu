/**
 * `gen-reading-cli.ts` — the CLI moves every reading generator repeats: parse
 * `--level`/`--count`, and hand the written store to disk in the repo's
 * canonical format.
 * NO generation logic lives here, and nothing about a specific 大問 lives here:
 * each generator keeps its own level guard, because the guard is where the
 * block's doctrine is written down (doc-27 §10 refusals, the COVERAGE_FLOOR
 * membership the gate reads, the authored-band check that cannot drift from
 * the proof). What is identical across generators is only the flag walking.
 *
 * Run context: these helpers exist for the `gen:reading-*` scripts, several of
 * which deliberately exit 1 before writing anything (authored levels are
 * written and blind-judged, never generated). Nothing here changes that.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The flags one generator accepts. `levelGuard` runs before `--count` is
 * parsed and throws with the generator's own message. */
export interface GenArgsConfig {
  readonly defaultCount: number;
  readonly defaultLevel: string;
  readonly levelGuard: (level: string) => void;
}

export const parseArgsWithLevel = (
  argv: readonly string[],
  { defaultCount, defaultLevel, levelGuard }: GenArgsConfig
): { count: number; level: string } => {
  const levelIndex = argv.indexOf("--level");
  const level =
    levelIndex >= 0 ? (argv[levelIndex + 1] ?? defaultLevel) : defaultLevel;
  levelGuard(level);
  const countIndex = argv.indexOf("--count");
  const count =
    countIndex >= 0
      ? Number.parseInt(argv[countIndex + 1] ?? "", 10)
      : defaultCount;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("--count needs a positive integer");
  }
  return { count, level };
};

/**
 * Hand the written store to the repo's formatter. `data/*.json` is inside
 * biome's scope, and its canonical JSON collapses arrays of short strings while
 * `JSON.stringify(_, null, 2)` expands them. Without this pass, regenerating
 * leaves a file that `bun run check` then rewrites, so every regeneration shows
 * a cosmetic diff that reads like a content change and the "diff is the review
 * surface" note in AGENTS.md is worthless. One subprocess beats copying the
 * formatter's rules into each script. A missing/failing biome is a warning, not
 * a crash: the file is still correct, only its formatting is not canonical, and
 * `bun x ultracite fix` settles it. `scriptName` names the calling generator in
 * the warning so a stray message still says where it came from.
 */
export const formatWithBiome = (path: string, scriptName: string): void => {
  const result = Bun.spawnSync({
    cmd: ["bun", "x", "biome", "format", "--write", path],
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode !== 0) {
    console.warn(
      `${scriptName}: biome format did not run (exit ${result.exitCode}); run \`bun x ultracite fix\``
    );
  }
};

/**
 * Hand the built batch to its store file: create the directory, write the
 * canonical JSON, then reformat it. Every generator's tail is these three
 * moves; what differs, the file name and the row type, stays at the call
 * site. A rejection that happens here (a write error) must stop the script,
 * so nothing is caught.
 */
export const writeFormattedStore = (
  outPath: string,
  value: unknown,
  scriptName: string
): void => {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  formatWithBiome(outPath, scriptName);
};
