import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * The bundle/resources guard (TASK-178).
 *
 * `tauri build` cannot see this bug: a resource entry that was never written is
 * simply absent from the artifact, `resolveDataDir()` still finds `n5.json`, and
 * `readJson` returns null for the store that is not there (`exam-corpus.ts`), so
 * the empty store reaches the paper as a hole in the 大問 instead of an error.
 * A real N5 paper printed 43 of 91 items that way while every row it needed sat
 * in the repo.
 *
 * The invariant is "what the server opens" versus "what the bundle carries", and
 * nothing in the repo held the two side by side until this file. The read list is
 * compiled from the read sites themselves, so a new store loader added to
 * `exam-corpus.ts` is covered without editing this test.
 */

const REPO_ROOT = join(import.meta.dir, "../../..");
const TAURI_DIR = join(REPO_ROOT, "apps/desktop/src-tauri");
const DATA_ROOT = "packages/japanese/data";
const LEVELS = ["n1", "n2", "n3", "n4", "n5"] as const;

/** One `bundle.resources` entry as Tauri writes it: repo-relative-ish source,
 * resource-dir-relative destination. */
interface ResourceEntry {
  readonly destination: string;
  readonly source: string;
}

const resourceEntries = (configPath: string): ResourceEntry[] => {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    bundle?: { resources?: Record<string, string> };
  };
  return Object.entries(config.bundle?.resources ?? {}).map(
    ([source, destination]) => ({ destination, source })
  );
};

/** Every config Tauri can merge: the base plus each platform override, which
 * the CLI deep-merges OVER the base and only ever adds to. A leg named by any
 * of them is shipped by the bundle that config builds. */
const CONFIGS = [
  "tauri.conf.json",
  "tauri.linux.conf.json",
  "tauri.win-x64.conf.json",
] as const;

const shippedEntries = (): ResourceEntry[] =>
  CONFIGS.flatMap((name) => resourceEntries(join(TAURI_DIR, name)));

/** Everything the server opens under `resolveDataDir()`, one entry per read
 * site, with the line that reads it in the comment above it. */
interface DataRead {
  readonly label: string;
  readonly path: string;
}

/** The store filenames `exam-corpus.ts` derives per level. Read off the source
 * so the list cannot fall behind the loaders: a suffix added there shows up
 * here on the next run, and a rewrite that the extraction misses fails the
 * count check below rather than silently shrinking the guard. */
const readingStoreSuffixes = (): string[] => {
  const corpus = readFileSync(
    join(REPO_ROOT, "apps/server/src/services/exam-corpus.ts"),
    "utf8"
  );
  const templates = [
    ...corpus.matchAll(
      /loadReadingLevel\(dir, `\$\{level\.toLowerCase\(\)\}([^`]*)`\)/g
    ),
    ...corpus.matchAll(
      /join\(dir, "reading", `\$\{level\.toLowerCase\(\)\}([^`]*)`\)/g
    ),
  ];
  const rawLoaderCalls = [...corpus.matchAll(/loadReadingLevel\(dir,/g)].length;
  expect(templates.length).toBe(rawLoaderCalls + 1);
  const suffixes: string[] = [];
  for (const [, suffix] of templates) {
    if (suffix !== undefined) {
      suffixes.push(suffix);
    }
  }
  return [...new Set(suffixes)].sort();
};

const dataReads = (): DataRead[] => {
  const stores = readingStoreSuffixes();
  return [
    // routes/jap-data.ts:54,56 · services/jap-data.ts:185,187 · services/next-cards.ts:29
    // · services/exam-corpus.ts:227 · data-dir.ts:50 (the sentinel it probes for)
    ...LEVELS.map((level) => ({
      label: `level word band ${level}.json`,
      path: `${DATA_ROOT}/${level}.json`,
    })),
    // routes/jap-data.ts:62,64 · services/jap-data.ts:193,195 · exam-corpus.ts:254
    ...LEVELS.map((level) => ({
      label: `grammar patterns ${level}.json`,
      path: `${DATA_ROOT}/grammar/${level}.json`,
    })),
    // routes/jap-data.ts:151,158 · services/jap-data.ts:217,257
    { label: "kanji table", path: `${DATA_ROOT}/kanji.json` },
    // services/jap-data.ts:142
    {
      label: "stroke-order data",
      path: `${DATA_ROOT}/kanjivg/kanjivg.jsonl`,
    },
    // services/exam-distractors.ts:86
    {
      label: "conjugation distractor deck",
      path: `${DATA_ROOT}/verbs-n5.json`,
    },
    // services/exam-corpus.ts:364,449 - every store-backed 大問 reads here.
    ...LEVELS.flatMap((level) =>
      stores.map((suffix) => ({
        label: `reading store ${level}${suffix}`,
        path: `${DATA_ROOT}/reading/${level}${suffix}`,
      }))
    ),
  ];
};

/** A destination is covered by an exact file entry or by a shipped directory
 * (`grammar` and `kanjivg` are shipped whole, which is what a store directory
 * needs too). */
const shippedCovers = (
  entries: readonly ResourceEntry[],
  path: string
): boolean =>
  entries.some(
    (entry) =>
      entry.destination === path || path.startsWith(`${entry.destination}/`)
  );

describe("bundle resources cover what the server reads", () => {
  it("ships every path the server opens under resolveDataDir()", () => {
    const entries = shippedEntries();
    const misses = dataReads()
      .filter((read) => !shippedCovers(entries, read.path))
      .map((read) => `${read.label} (${read.path})`);
    expect(misses).toEqual([]);
  });

  it("names no resource whose source has left the repo", () => {
    const gone = shippedEntries()
      .filter((entry) => !existsSync(join(TAURI_DIR, entry.source)))
      .map((entry) => `${entry.source} -> ${entry.destination}`);
    expect(gone).toEqual([]);
  });

  it("finds the reading stores the corpus loaders actually ask for", () => {
    // Non-vacuity: the extraction above is the guard's whole supply of store
    // filenames, so an `exam-corpus.ts` rewrite that it stops matching would
    // otherwise turn this file into a check of two paths per level.
    expect(readingStoreSuffixes().length).toBeGreaterThanOrEqual(19);
    expect(readingStoreSuffixes()).toContain("-chuubun.json");
    expect(readingStoreSuffixes()).toContain("-sokuji.json");
  });
});

/*
 * The vaporetto leg (TASK-178 follow-up, found on the delivered AppImage).
 *
 * This one is invisible in exactly the way `data/reading` was, and worse,
 * because the file it needs is not under `resolveDataDir()` at all.
 * `packages/db/src/vaporetto.ts` loads the tokenizer extension from
 * `<resource dir>/resources/vaporetto/ext` and the BCCWJ+UniDic model from its
 * sibling `model/`; when either is absent `loadVaporettoExtension` returns
 * false, migrations freeze the FTS tables at unicode61, and the exam path
 * degrades where a learner sees it: `exam-mask.ts` cannot tell a token boundary
 * from the middle of a word, so every derived candidate is reported unmaskable.
 * Measured on the AppImage at a clean database: an N5 real paper printed 75/91
 * through the packaged binary (76/91 in the running app), with 文脈規定 and
 * 文の組み立て at zero, while the same tree with the extension reachable printed
 * 91/91 ready. The receipt blamed the learner's history for a missing 13 MB of
 * runtime assets.
 */
const PACKED_DIR_PATTERN = /RESOURCE_PACKED_DIR = "([^"]+)"/;
const MODEL_FILENAME_PATTERN = /VAPORETTO_MODEL_FILENAME = "([^"]+)"/;

describe("bundle resources carry the tokenizer assets", () => {
  /** The packaged layout the resolver looks for, read off its source so a
   * rename on either side fails here rather than silently disabling vaporetto. */
  const packedDirFromSource = (): string => {
    const source = readFileSync(
      join(REPO_ROOT, "packages/db/src/vaporetto.ts"),
      "utf8"
    );
    const packed = source.match(PACKED_DIR_PATTERN)?.[1];
    const model = source.match(MODEL_FILENAME_PATTERN)?.[1];
    expect(packed).toBeDefined();
    expect(model).toBeDefined();
    return `${packed as string}|${model as string}`;
  };

  it("ships the directory the resolver walks to", () => {
    const [packedDir, modelFilename] = packedDirFromSource().split("|");
    const entries = shippedEntries();
    expect(shippedCovers(entries, `${packedDir as string}/ext`)).toBe(true);
    expect(
      shippedCovers(entries, `${packedDir as string}/model/${modelFilename}`)
    ).toBe(true);
  });

  it("keeps the leg on the platform whose loader can open it", () => {
    // The extension is `libsqlite_vaporetto.so`. Tauri merges a platform
    // override OVER the base and never subtracts, so declaring this in
    // `tauri.conf.json` would push 39 MB of Linux-only bytes into the NSIS
    // installer, where no `.dll` exists to load and the paper stays short
    // anyway. The base must stay clean and the linux config must carry it.
    const [packedDir] = packedDirFromSource().split("|");
    const inBase = resourceEntries(join(TAURI_DIR, "tauri.conf.json")).some(
      (entry) => entry.destination === packedDir
    );
    const inLinux = resourceEntries(
      join(TAURI_DIR, "tauri.linux.conf.json")
    ).some((entry) => entry.destination === packedDir);
    expect(inLinux).toBe(true);
    expect(inBase).toBe(false);
  });

  it("keeps the assets it ships present on the build host", () => {
    // `scripts/fetch-vaporetto.ts` provisions them; a bundling that names a
    // directory whose files were never fetched ships an empty leg and boots
    // unicode61 anyway, so presence is asserted separately from the mapping.
    const [, modelFilename] = packedDirFromSource().split("|");
    const srcTauri = (relative: string): string =>
      join(TAURI_DIR, "resources/vaporetto", relative);
    expect(existsSync(srcTauri("ext"))).toBe(true);
    expect(existsSync(srcTauri(`model/${modelFilename as string}`))).toBe(true);
  });
});
