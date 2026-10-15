/**
 * TASK-51 AC1: prove the db build/typecheck split cannot produce a
 * phantom-up-to-date dist.
 *
 * Facts established 2026-09-09:
 *  - tsconfig.typecheck.json (noEmit, composite:false) writes NO
 *    tsbuildinfo — incremental is off outside `tsc -b`, so the two
 *    configs' caches cannot interact by construction.
 *  - dist/ is a DEV-ONLY byproduct: package.json exports point at
 *    src/*.ts; no consumer imports dist. A stale/missing dist breaks
 *    nobody; `tsc -b` (turbo build via the "build" script) re-emits.
 *  - The only true phantom is partial manual deletion of dist while
 *    dist/tsconfig.tsbuildinfo survives — this script detects it and
 *    fails loudly instead of leaving a lying build state.
 *
 * Run: bun run verify:build-state (or wire into CI later).
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const PKG = new URL("..", import.meta.url).pathname;
const TSC = join(PKG, "..", "..", "node_modules", ".bin", "tsc");
const BUN = process.execPath;
// Builds go through the package "build" script so the fresh-dist guard
// runs (raw `tsc -b` here would bypass it and re-hide the phantom).
const runBuild = () =>
  Bun.spawnSync([BUN, "run", "build"], {
    cwd: PKG,
    stderr: "pipe",
    stdout: "ignore",
  });
const run = (args) =>
  Bun.spawnSync([TSC, ...args], {
    cwd: PKG,
    stderr: "pipe",
    stdout: "ignore",
  });

const emittedFiles = () => {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) {
      return;
    }
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".js") || entry.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  };
  walk(join(PKG, "dist"));
  return out;
};

// 1) typecheck must never write buildinfo (cache isolation)
rmSync(join(PKG, "dist"), { force: true, recursive: true });
const tc1 = run(["-p", "tsconfig.typecheck.json"]);
if (tc1.exitCode !== 0) {
  console.error(String(tc1.stderr));
  throw new Error("typecheck failed");
}
const buildinfoAfterTypecheck = existsSync(
  join(PKG, "dist", "tsconfig.tsbuildinfo")
);
if (buildinfoAfterTypecheck) {
  throw new Error(
    "typecheck wrote dist/tsconfig.tsbuildinfo — caches can interact; isolate tsBuildInfoFile"
  );
}

// 2) build emits; typecheck afterwards does not disturb the emit
const b1 = runBuild();
if (b1.exitCode !== 0) {
  console.error(String(b1.stderr));
  throw new Error("tsc -b failed");
}
const afterBuild = emittedFiles().length;
if (afterBuild === 0) {
  throw new Error("tsc -b emitted nothing");
}
run(["-p", "tsconfig.typecheck.json"]);
if (emittedFiles().length !== afterBuild) {
  throw new Error("typecheck run disturbed dist contents");
}

// 3) phantom guard: buildinfo claims fresh ⟺ emitted files exist
//    (simulate partial deletion; -b must re-emit)
rmSync(join(PKG, "dist", "src", "index.js"), { force: true });
const b2 = runBuild();
if (b2.exitCode !== 0) {
  console.error(String(b2.stderr));
  throw new Error("rebuild after partial delete failed");
}
if (!existsSync(join(PKG, "dist", "src", "index.js"))) {
  throw new Error(
    "PHANTOM: buildinfo said up-to-date while dist/src/index.js was missing"
  );
}

console.log(
  "[verify-tsbuild-state] OK: caches isolated, emit stable, phantom guarded"
);
