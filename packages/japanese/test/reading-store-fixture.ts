/**
 * The temp store dir every file-level 読解 gate fixture needs: an empty
 * `data/` with the four cumulative-level stores blanked, the calling file's
 * own N5 vocabulary, and the `data/reading/` dir the store under test is
 * written into. Only the mkdtemp prefix, the vocab and what the caller writes
 * afterwards differ per gate.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const vocabFixtureDir = ({
  prefix,
  vocab,
}: {
  readonly prefix: string;
  readonly vocab: readonly unknown[];
}): { readonly dataDir: string; readonly storeDir: string } => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const dataDir = join(dir, "data");
  const storeDir = join(dataDir, "reading");
  mkdirSync(storeDir, { recursive: true });
  for (const level of ["n1", "n2", "n3", "n4"]) {
    writeFileSync(join(dataDir, `${level}.json`), "[]", "utf8");
  }
  writeFileSync(join(dataDir, "n5.json"), JSON.stringify(vocab), "utf8");
  return { dataDir, storeDir };
};
