import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __test__ } from "../src/vaporetto";

/*
 * The vaporetto asset-root walk (TASK-178 follow-up).
 *
 * A bundle that ships nothing at `resources/vaporetto` and a bundle that ships
 * it are the same silent failure from the outside: `loadVaporettoExtension`
 * returns false, migrations freeze at unicode61, `exam-mask.ts` reports every
 * derived candidate unmaskable, and a learner's FIRST N5 real paper comes up 16
 * 小問 short blaming `contentExhausted` (measured on the AppImage: 75/91, with
 * 文脈規定 and 文の組み立て at zero). The packaged branch of this walk is where
 * that hides, and it was broken: it returned a fake repo root that the callers
 * then re-appended the repo path to, so even a staged bundle resolved nothing.
 *
 * Both layouts are proven here from scratch directories, because the live root
 * is a module-level const resolved from the real exe dir and cwd.
 */

const ROOT = mkdtempSync(join(tmpdir(), "manobu-vaporetto-layout-"));
afterAll(() => {
  rmSync(ROOT, { force: true, recursive: true });
});

/** The asset root with its `ext` marker directory and one file in it. An empty
 * dir would satisfy `existsSync` for a layout the fetch script never finished
 * provisioning, so the walk is allowed to be that literal about presence. */
const makeAssetRoot = (assetRoot: string): string => {
  mkdirSync(join(assetRoot, "ext"), { recursive: true });
  writeFileSync(join(assetRoot, "ext/libsqlite_vaporetto.so"), "stub");
  return assetRoot;
};

describe("the vaporetto asset root", () => {
  it("finds the repo layout from a directory nested inside it", () => {
    const repoRoot = join(ROOT, "repo");
    const expected = makeAssetRoot(
      join(repoRoot, "apps/desktop/src-tauri/resources/vaporetto")
    );
    // The walk goes UP from the start, so a deep start (a crate target dir,
    // the dev `bun` cwd) has to reach the marker the same way the root does.
    const deepStart = join(repoRoot, "apps/server/src/services");
    mkdirSync(deepStart, { recursive: true });
    expect(__test__.assetRootFor([deepStart])).toBe(expected);
    expect(__test__.assetRootFor([repoRoot])).toBe(expected);
  });

  it("finds the packaged layout beside the sidecar", () => {
    const resourceDir = join(ROOT, "packed/usr/lib/manobu");
    // `bundle.resources` maps the assets to <resource dir>/resources/vaporetto,
    // and lib.rs sets that resource dir as the sidecar cwd.
    const expected = makeAssetRoot(join(resourceDir, "resources/vaporetto"));
    expect(__test__.assetRootFor([resourceDir])).toBe(expected);
  });

  it("returns no root when neither layout is there", () => {
    const bare = join(ROOT, "bare");
    mkdirSync(bare, { recursive: true });
    expect(__test__.assetRootFor([bare])).toBe("");
  });
});
