import { beforeAll, describe, expect, it } from "bun:test";
import {
  type CorpusGrammarEntry,
  type CorpusVocabEntry,
  examCorpus,
  grammarAnchorFor,
  vocabAnchorFor,
} from "../src/services/exam-corpus";
import { __test__ } from "../src/services/exam-service";
import {
  connectExamClient,
  type ExamClient,
  prepareContentDb,
} from "./exam-harness";

/*
 * TASK-138 AC#6: the exam mints no third anchor namespace.
 *
 * Two implementations emit anchors: `crates/jlpt-mcp/src/engine.rs:440,448` and
 * `exam-corpus.ts:143-147`. They agree character for character today, and AC#6
 * asks that the agreement be impossible to break unnoticed. The clause that
 * decides the design is "resolves through the corpus view BY STRING rather than
 * by array position": a test that only checks `corpus.vocabByAnchor.has(anchor)`
 * is already there (exam-pipeline AC#1), and it proves membership, not that the
 * validator's anchor check can fail.
 *
 * Why not lift the format into `@manobu/api-contract` and share it, the other
 * option AC#6 offers: the crate cannot import a TypeScript schema (`.fallowrc.jsonc`
 * gives `api-contract` and `lib-item-engine` `"allow": []`), so a shared
 * declaration would still leave two emitters with only one of them pinned. The
 * cross-language guard has to be a test that quotes what the other side asserts.
 * It quotes `crates/jlpt-mcp/tests/parity.rs:277`, which pins the same five N5
 * anchors the Rust tool returns for its seed; update both files together when
 * the corpus changes, which is the point.
 */

const DB_URL = prepareContentDb("exam-anchor-namespace");

/** The shape the 16-noun catalog minted: a digest, not a corpus id. */
const SYNTHETIC_ANCHOR_RE = /^[a-z]+:N5:[0-9a-f]{1,}$/;

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

/** Every anchor of one assembled mixed paper, from the client projection. */
const assembledAnchors = async (
  seed: string
): Promise<{ itemType: string; surfaceAnchor: string }[]> => {
  const requested = await client.exam.request({
    budget: { "grammar-reading": 6, listening: 4, vocabulary: 6 },
    level: "N5",
    mode: "shortened",
    sections: ["vocabulary", "grammar-reading", "listening"],
    seed,
  });
  await client.exam.assemble({ examId: requested.examId });
  const state = await client.exam.get({ examId: requested.examId });
  return state.items.map((row) => ({
    itemType: row.item.itemType,
    surfaceAnchor: row.item.anchors[0] ?? "",
  }));
};

/**
 * The `anchorLevels` the service holds at assembly time: one entry per anchor,
 * keyed by its string and valued with the level the corpus says. Rebuilt here
 * from the corpus rather than reached through a seam, because the map is a
 * registration list and this test is about what the CORPUS lookup adds to it.
 */
const levelsFor = (anchors: readonly string[]): Map<string, string> => {
  const corpus = examCorpus();
  const levels = new Map<string, string>();
  for (const anchor of anchors) {
    const level =
      corpus?.vocabByAnchor.get(anchor)?.level ??
      corpus?.grammarByAnchor.get(anchor)?.level;
    if (level) {
      levels.set(anchor, level);
    }
  }
  return levels;
};

const viewFor = (anchors: readonly string[]) =>
  __test__.candidateCatalogCorpus(
    new Map(),
    levelsFor(anchors),
    examCorpus(),
    new Map()
  );

const vocabEntryFor = (word: string, reading: string): CorpusVocabEntry => {
  const entry = [...(examCorpus()?.vocabByAnchor.values() ?? [])].find(
    (candidate) => candidate.word === word && candidate.reading === reading
  );
  if (entry === undefined) {
    throw new Error(`${word} (${reading}) is not in the shipped corpus`);
  }
  return entry;
};

const firstGrammarEntry = (): CorpusGrammarEntry => {
  const [entry] = examCorpus()?.grammarByLevel.get("N5") ?? [];
  if (entry === undefined) {
    throw new Error("the shipped corpus has no N5 grammar");
  }
  return entry;
};

type ResolvedAnchor = NonNullable<
  ReturnType<ReturnType<typeof viewFor>["resolveAnchor"]>
>;

const expectedLevelFor = (
  corpus: NonNullable<ReturnType<typeof examCorpus>>,
  anchor: string
): ResolvedAnchor["level"] | undefined =>
  corpus.vocabByAnchor.get(anchor)?.level ??
  corpus.grammarByAnchor.get(anchor)?.level;

// The namespace and the segment count are what the two implementations
// share, so they are checked on real assembled output rather than on a
// builder's own input: `vocab` carries the level inside the string, and
// `grammar` carries nothing but the id.
const assertAnchorShape = (
  anchor: string,
  level: ResolvedAnchor["level"] | null
): void => {
  const parts = anchor.split(":");
  if (parts[0] === "vocab") {
    expect(parts).toHaveLength(4);
    // A builder that stamped the PAPER's level rather than the entry's would
    // still resolve (the corpus map is keyed by the same string) while
    // printing a level doc-16 §2's anchor-level check then reads.
    expect(parts[1] ?? null).toBe(level);
    return;
  }
  expect(parts[0]).toBe("grammar");
  expect(parts).toHaveLength(2);
};

const assertAnchorResolvesByString = (
  anchor: string,
  view: ReturnType<typeof viewFor>,
  corpus: NonNullable<ReturnType<typeof examCorpus>>
): void => {
  const resolved = view.resolveAnchor(anchor);
  if (resolved === null) {
    throw new Error(`${anchor} did not resolve in the corpus view`);
  }
  // The view answers with the SAME string it was handed, which is what
  // "by string" means: an implementation that resolved by array position
  // would return an entry for an anchor the corpus has never heard of.
  expect(resolved.id).toBe(anchor);
  expect(expectedLevelFor(corpus, anchor)).toBe(resolved.level);
  assertAnchorShape(anchor, resolved.level);
};

describe("anchors resolve through the corpus view by string (TASK-138 AC#6)", () => {
  it("resolves every anchor of two assembled papers, by string, at the corpus level", async () => {
    const papers = await Promise.all([
      assembledAnchors("t138-ns-a"),
      assembledAnchors("t138-ns-b"),
    ]);
    const anchors = papers.flat().map((row) => row.surfaceAnchor);
    expect(anchors.length).toBeGreaterThan(0);
    const view = viewFor(anchors);
    const corpus = examCorpus();
    if (corpus === null) {
      throw new Error("the shipped corpus is not loaded");
    }
    for (const anchor of anchors) {
      assertAnchorResolvesByString(anchor, view, corpus);
    }
  });

  it("refuses the digest shape the 16-noun catalog minted", () => {
    // Registered in `anchorLevels` but absent from the corpus: if this resolved,
    // the check would still be the pre-TASK-138 one, where any id the service
    // had seen resolved and doc-16 §2's anchor guarantee was vacuous.
    const digest = `vocab:N5:${"0f4a9c2d8b1e7365".repeat(1)}`;
    expect(digest).toMatch(SYNTHETIC_ANCHOR_RE);
    const view = __test__.candidateCatalogCorpus(
      new Map(),
      new Map([[digest, "N5"]]),
      examCorpus(),
      new Map()
    );
    expect(view.resolveAnchor(digest)).toBeNull();
  });

  it("refuses a real corpus anchor that the assembly never registered", () => {
    // The other half of the rule: the corpus alone is not enough, so an anchor
    // from another level's paper cannot ride a shared corpus into validation.
    const corpus = examCorpus();
    const anchor = [...(corpus?.vocabByAnchor.keys() ?? [])][0] ?? "";
    expect(anchor).not.toBe("");
    expect(
      __test__
        .candidateCatalogCorpus(new Map(), new Map(), corpus, new Map())
        .resolveAnchor(anchor)
    ).toBeNull();
    expect(viewFor([anchor]).resolveAnchor(anchor)?.id).toBe(anchor);
  });

  it("assembled anchors are never digest-shaped", async () => {
    const anchors = (await assembledAnchors("t138-ns-c")).map(
      (row) => row.surfaceAnchor
    );
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(anchor).not.toMatch(SYNTHETIC_ANCHOR_RE);
    }
  });

  it("builds the anchors the Rust source layer builds", () => {
    // The literals are `crates/jlpt-mcp/src/engine.rs:440`'s format string, as
    // pinned by `crates/jlpt-mcp/tests/parity.rs:277-281` for the drill
    // candidates the crate emits. Both sides read the same shipped data, so a
    // disagreement here is a namespace that has drifted, not a typo.
    const pinned: readonly [string, string, string][] = [
      ["村", "むら", "vocab:N5:村:むら"],
      ["先週", "せんしゅう", "vocab:N5:先週:せんしゅう"],
      ["テスト", "テスト", "vocab:N5:テスト:テスト"],
      ["答える", "こたえる", "vocab:N5:答える:こたえる"],
      ["それ", "それ", "vocab:N5:それ:それ"],
    ];
    for (const [word, reading, anchor] of pinned) {
      expect(vocabAnchorFor(vocabEntryFor(word, reading))).toBe(anchor);
    }
    // Grammar carries no level: the id is globally unique, so a second
    // implementation that appended one would produce an anchor the crate's
    // `grammar:{id}` lookup can never return.
    const entry = firstGrammarEntry();
    expect(grammarAnchorFor(entry)).toBe(`grammar:${entry.id}`);
  });
});
