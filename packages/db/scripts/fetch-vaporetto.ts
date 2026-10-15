#!/usr/bin/env bun
/**
 * TASK-23.1 (doc-2 §5.1/§3.3): provision sqlite-vaporetto assets.
 *
 * Downloads, into apps/desktop/src-tauri/resources/vaporetto/:
 *  - ext/<libsqlite_vaporetto.{so,dylib}|sqlite_vaporetto.dll>
 *      from hotchpotch/sqlite-vaporetto release v0.4.0 (MIT OR Apache-2.0),
 *      `-with-model` artifacts (extension binary + embedded model).
 *  - model/bccwj-suw+unidic_pos+kana.model.zst
 *      from daac-tools/vaporetto-models (BSD-3-Clause) — the model path used
 *      by `tokenize='vaporetto model <path> …'` (and by the Rust sidecar's
 *      in-process tokenizer).
 *  - model/bccwj-suw+unidic_pos+kana.model.zst.predictor.bin
 *      pre-built predictor cache (TASK-24.2): `Predictor::serialize_to_vec`
 *      output of the crate-pinned vaporetto (=0.6.5). Cuts the sidecar's
 *      boot warm from ~8 s (PMA automaton rebuild inside Predictor::new) to
 *      ~1.2 s (deserialize_from_slice_unchecked). MUST be regenerated in the
 *      same commit as any model or vaporetto-pin bump: deserialization is
 *      unchecked-unsafe against stale caches. `cargo run --release --features
 *      vaporetto --example gen-cache` inside crates/jlpt-mcp writes it.
 *
 * Every download is sha256-verified against the release's `.sha256` file.
 * Idempotent: re-running skips files that already match their checksum.
 *
 * Run: bun packages/db/scripts/fetch-vaporetto.ts
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Whitespace split for `.sha256` sidecars (single hex digest line). */
const WHITESPACE_SPLIT = /\s+/;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..", "..");
const OUT_DIR = join(REPO_ROOT, "apps/desktop/src-tauri/resources/vaporetto");
const EXT_DIR = join(OUT_DIR, "ext");
const MODEL_DIR = join(OUT_DIR, "model");

const VAPORETTO_RELEASE = "v0.4.0";
// hotchpotch/sqlite-vaporetto v0.4.0 `-with-model` artifacts (contain the
// extension + the embedded bccwj-suw+unidic_pos+kana model).
const EXT_ASSET_BY_PLATFORM: Record<string, string> = {
  darwin: "sqlite-vaporetto-v0.4.0-macos-aarch64-with-model.tar.gz",
  linux: "sqlite-vaporetto-v0.4.0-linux-x86_64-with-model.tar.gz",
  win32: "sqlite-vaporetto-v0.4.0-windows-x86_64-with-model.zip",
};
const EXT_MEMBER_BY_PLATFORM: Record<string, string> = {
  darwin: "libsqlite_vaporetto.dylib",
  linux: "libsqlite_vaporetto.so",
  win32: "sqlite_vaporetto.dll",
};

const MODEL_RELEASE = "v0.5.0";
// vaporetto-models ships each model as a tar.xz (model + build.sh + BSD
// notice); the bare .model.zst is not a release asset.
const MODEL_ASSET = "bccwj-suw+unidic_pos+kana.tar.xz";
const MODEL_MEMBER = "bccwj-suw+unidic_pos+kana.model.zst";
const MODEL_URL = `https://github.com/daac-tools/vaporetto-models/releases/download/${MODEL_RELEASE}/${MODEL_ASSET}`;
/**
 * sha256 of the extracted `bccwj-suw+unidic_pos+kana.model.zst` from the
 * v0.5.0 release tarball (no .sha256 sidecar exists upstream; release assets
 * are immutable so the hash is pinned here after first fetch).
 */
const MODEL_SHA256 =
  "99888ea8f7b8a5b953c135fb7f70d362c0ba6217f27f4868f7944b9224b6c7a2";

const sha256 = (data: Buffer): string =>
  createHash("sha256").update(data).digest("hex");

const download = async (url: string): Promise<Buffer> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed (${response.status}): ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

/** Fetch `<url>.sha256` (single hex digest line) and verify `data`. */
const verifySha256 = async (
  url: string,
  data: Buffer,
  label: string
): Promise<void> => {
  const response = await fetch(`${url}.sha256`);
  if (!response.ok) {
    throw new Error(
      `checksum fetch failed (${response.status}): ${url}.sha256`
    );
  }
  const [expected = ""] = (await response.text())
    .trim()
    .split(WHITESPACE_SPLIT);
  const actual = sha256(data);
  if (actual !== expected.toLowerCase()) {
    throw new Error(
      `${label}: sha256 mismatch expected=${expected} actual=${actual}`
    );
  }
};

/** Extract one member from a .tar.gz archive into a Buffer via the `tar` CLI. */
const extractViaTar = async (
  archiveUrl: string,
  member: string
): Promise<Buffer> => {
  const response = await fetch(archiveUrl);
  if (!response.ok) {
    throw new Error(`download failed (${response.status}): ${archiveUrl}`);
  }
  const archive = Buffer.from(await response.arrayBuffer());
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "vaporetto-"));
  try {
    const gzPath = join(dir, "archive.tar");
    writeFileSync(gzPath, archive);
    // .tar.gz / .tar.xz depending on the release asset suffix.
    const decompressFlag = archiveUrl.endsWith(".tar.xz") ? "-xJf" : "-xzf";
    const result = spawnSync("tar", [decompressFlag, gzPath, "-C", dir], {
      stdio: "pipe",
    });
    if (result.status !== 0) {
      throw new Error(
        `tar extraction failed: ${result.stderr?.toString() ?? "unknown"}`
      );
    }
    // Locate the member anywhere in the extracted tree (release layouts vary).
    const { readdirSync, statSync } = await import("node:fs");
    const find = (current: string): string | null => {
      for (const entry of readdirSync(current)) {
        const full = join(current, entry);
        if (statSync(full).isFile() && entry === member) {
          return full;
        }
        if (statSync(full).isDirectory()) {
          const found = find(full);
          if (found) {
            return found;
          }
        }
      }
      return null;
    };
    const found = find(dir);
    if (!found) {
      throw new Error(`member ${member} not found in ${archiveUrl}`);
    }
    return readFileSync(found);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
};

const writeIfChanged = (path: string, data: Buffer): boolean => {
  if (existsSync(path) && sha256(readFileSync(path)) === sha256(data)) {
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  return true;
};

const main = async (): Promise<void> => {
  const { platform } = process;
  const extAsset = EXT_ASSET_BY_PLATFORM[platform];
  const extMember = EXT_MEMBER_BY_PLATFORM[platform];
  if (!(extAsset && extMember)) {
    throw new Error(`unsupported platform: ${platform}`);
  }

  const extUrl = `https://github.com/hotchpotch/sqlite-vaporetto/releases/download/${VAPORETTO_RELEASE}/${extAsset}`;
  console.log(`[fetch-vaporetto] downloading ${extAsset} …`);
  const extArchive = await download(extUrl);
  await verifySha256(extUrl, extArchive, "extension archive");
  const extBinary = await extractViaTar(extUrl, extMember);
  const extOut = join(EXT_DIR, extMember);
  const extChanged = writeIfChanged(extOut, extBinary);
  console.log(
    `[fetch-vaporetto] ${extOut} (${extBinary.length} bytes)${extChanged ? " written" : " unchanged"}`
  );

  const modelOut = join(MODEL_DIR, MODEL_MEMBER);
  if (existsSync(modelOut)) {
    console.log(
      `[fetch-vaporetto] ${MODEL_MEMBER} already present — skipping (delete to re-download)`
    );
  } else {
    console.log(`[fetch-vaporetto] downloading ${MODEL_ASSET} …`);
    const model = await extractViaTar(MODEL_URL, MODEL_MEMBER);
    const actual = sha256(model);
    if (actual !== MODEL_SHA256) {
      throw new Error(
        `vaporetto model: sha256 mismatch expected=${MODEL_SHA256} actual=${actual}`
      );
    }
    mkdirSync(MODEL_DIR, { recursive: true });
    writeFileSync(modelOut, model);
    // Ship the model's BSD-3-Clause notice next to it.
    try {
      const bsd = await extractViaTar(MODEL_URL, "BSD");
      writeFileSync(join(MODEL_DIR, "BSD"), bsd);
    } catch {
      console.warn("[fetch-vaporetto] BSD notice not found in model tarball");
    }
    console.log(
      `[fetch-vaporetto] ${modelOut} (${model.length} bytes) written`
    );
  }

  // TASK-24.2: pre-built predictor cache (see header note). Built from THIS
  // repo's pinned vaporetto crate — never shipped upstream. Kept when already
  // present (idempotent like the model); a model change requires deleting it
  // (or bumping via gen-cache).
  const predictorOut = `${modelOut}.predictor.bin`;
  if (existsSync(predictorOut)) {
    console.log(
      "[fetch-vaporetto] predictor cache already present — skipping (delete to regenerate after a model/pin bump)"
    );
  } else {
    const { execSync } = await import("node:child_process");
    console.log("[fetch-vaporetto] building predictor cache (cargo, ~1 min) …");
    execSync("cargo run --release --features vaporetto --example gen-cache", {
      cwd: join(REPO_ROOT, "crates", "jlpt-mcp"),
      stdio: "inherit",
    });
  }

  console.log("[fetch-vaporetto] done.");
};

main().catch((error: unknown) => {
  console.error("[fetch-vaporetto] failed:", error);
  process.exit(1);
});
