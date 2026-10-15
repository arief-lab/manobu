/**
 * TASK-49: build the sqlite-vaporetto loadable extension from upstream
 * v0.4.0 + the local predictor-cache patch.
 *
 * WHY: upstream v0.4.0 rebuilds the Predictor (58MB model parse,
 * ~6.5s) on EVERY FTS5 x_create — once per CREATE VIRTUAL TABLE and
 * once per connection first-use per table. 5 vaporetto tables =
 * ~33s synchronously blocked per fresh db AND per new connection.
 * The patch (third_party/sqlite-vaporetto-v0.4.0-predictor-cache.diff)
 * adds a process-global Arc<Predictor> cache keyed by tokenizer config:
 * cold create pays 6.5s once per process, every later create/reopen
 * first-touch is ~0ms.
 *
 * Usage: bun run scripts/build-vaporetto-ext.ts
 *   clones v0.4.0 into a temp dir, applies the patch, cargo build
 *   --release, writes the .so + .sha256 into
 *   apps/desktop/src-tauri/resources/vaporetto/ext/.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..", "..");
const UPSTREAM_TAG = "v0.4.0";
const PATCH = join(
  REPO_ROOT,
  "packages/db/third_party/sqlite-vaporetto-v0.4.0-predictor-cache.diff"
);
const DEST_DIR = join(
  REPO_ROOT,
  "apps/desktop/src-tauri/resources/vaporetto/ext"
);
const MODEL = join(
  REPO_ROOT,
  "apps/desktop/src-tauri/resources/vaporetto/model/bccwj-suw+unidic_pos+kana.model.zst"
);

const tmp = join("/tmp", `sqlite-vaporetto-build-${Date.now()}`);
execSync(
  `git clone -q --depth 1 --branch ${UPSTREAM_TAG} https://github.com/hotchpotch/sqlite-vaporetto.git ${tmp}`,
  { stdio: "inherit" }
);
execSync(`git apply ${JSON.stringify(PATCH)}`, { cwd: tmp, stdio: "inherit" });
// Embed the default model — this makes the artifact equivalent to
// upstream's `-with-model` release (no SQLITE_VAPORETTO_MODEL env needed).
execSync("cargo build --release", {
  cwd: tmp,
  env: {
    ...process.env,
    SQLITE_VAPORETTO_EMBED_MODEL: MODEL,
  },
  stdio: "inherit",
});

const so = join(tmp, "target/release/libsqlite_vaporetto.so");
mkdirSync(DEST_DIR, { recursive: true });
copyFileSync(so, join(DEST_DIR, "libsqlite_vaporetto.so"));
const sha = createHash("sha256").update(readFileSync(so)).digest("hex");
execSync("sha256sum libsqlite_vaporetto.so > libsqlite_vaporetto.so.sha256", {
  cwd: DEST_DIR,
});
rmSync(tmp, { force: true, recursive: true });
console.log(`[build-vaporetto-ext] installed sha256=${sha}`);
