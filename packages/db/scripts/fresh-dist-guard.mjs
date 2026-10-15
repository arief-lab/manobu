/**
 * TASK-51 AC1: dist/tsconfig.tsbuildinfo can lie after PARTIAL deletion
 * of dist (tsc -b then reports up-to-date while emit files are missing —
 * reproduced by verify-tsbuild-state.mjs step 3). dist is a dev-only
 * byproduct (exports point at src), so the honest recovery is: when the
 * buildinfo exists but any expected top-level emit is gone, wipe dist so
 * `tsc -b` does a full rebuild. Full-delete never triggers this (buildinfo
 * goes with it).
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const TS_TO_JS = /\.ts$/;

const PKG = new URL("..", import.meta.url).pathname;
const DIST = join(PKG, "dist");
const BUILDINFO = join(DIST, "tsconfig.tsbuildinfo");

if (existsSync(BUILDINFO)) {
  const srcDir = join(DIST, "src");
  // Any tsconfig-include file with no emitted counterpart ⇒ stale state.
  const missingEmit = (() => {
    const walkSrc = (dir) => {
      let count = 0;
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          count += walkSrc(full);
        } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
          const rel = full.slice(srcDir.length + 1).replace(TS_TO_JS, ".js");
          if (!existsSync(join(srcDir, rel))) {
            count += 1;
          }
        }
      }
      return count;
    };
    return existsSync(srcDir) ? walkSrc(join(PKG, "src")) : 1;
  })();

  if (missingEmit > 0) {
    console.log(
      `[fresh-dist-guard] buildinfo present but ${missingEmit} emit file(s) missing — wiping dist for a full rebuild`
    );
    rmSync(DIST, { force: true, recursive: true });
  }
}
