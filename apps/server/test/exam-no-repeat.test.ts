import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createItemStore,
  type ItemStore,
  type UserDatabase,
} from "@manobu/db/item-store";
import { isDefinedError, safe } from "@orpc/client";
import { type ExamClient, makeExamClient } from "./exam-harness";
import { closeAndRemoveSqliteDb, manualContentDb } from "./harness";

/*
 * TASK-148: a retry never re-serves a question the learner has already seen.
 *
 * Before this, the only dedupe lived inside one build (`usedVocabWords` and
 * `usedGrammarIds` on the per-exam candidate catalog), so a second paper at the
 * same level re-sampled the same fixed pool. Three consecutive N5 papers
 * produced 89 distinct items out of 90, which is random sampling, not dealing.
 * The exclusion is now derived from the exams table itself, so no second ledger
 * can drift out of sync with the papers that were actually served.
 *
 * "Served" means the learner REACHED the paper: `in_progress`, `submitted`, or
 * `abandoned`. A `ready` paper that was assembled and never opened served
 * nothing, and counting drafts would let an unopened request quietly spend a
 * level's content. The control in AC#1 is what makes that distinction
 * observable: with nothing started, the same seed rebuilds the SAME paper, so
 * every difference the exclusion produces is attributable to it and to nothing
 * else.
 *
 * These tests share one database on purpose, because the property under test IS
 * history. They therefore run in file order, and only the first one starts a
 * paper at its level.
 */

const { DB_PATH, DB_URL } = manualContentDb("no-repeat");

const { createUserDb } = await import("@manobu/db");
// The service's OWN corpus view for an exam, so AC#7 re-validates with the
// `resolveAnchor`, `satisfies` and `isOptionSourceValid` the assembler used, not
// a hand-rolled stand-in.
const { __test__ } = await import("../src/services/exam-service");
const { validateQuestionItem } = await import("@manobu/item-engine/validation");

type Client = ExamClient;
type RequestInput = NonNullable<Parameters<Client["exam"]["request"]>[0]>;

let db: UserDatabase;
let client: Client;
let store: ItemStore;

/** A built paper: its receipt, and every anchor its items are served from.
 * `anchors` is on the CLIENT projection (`exam.ts:298`), so the seen set is
 * read through the same boundary a learner's paper crosses. */
interface BuiltPaper {
  anchors: readonly string[];
  assembled: Awaited<ReturnType<Client["exam"]["assemble"]>>;
  examId: string;
  itemIds: readonly string[];
}

const buildPaper = async (input: RequestInput): Promise<BuiltPaper> => {
  const requested = await client.exam.request(input);
  const assembled = await client.exam.assemble({ examId: requested.examId });
  const state = await client.exam.get({ examId: requested.examId });
  return {
    anchors: state.items.flatMap((entry) => [...entry.item.anchors]),
    assembled,
    examId: requested.examId,
    itemIds: state.items.map((entry) => entry.item.id),
  };
};

/** Three sections so a served paper leaves anchors in BOTH families behind, and
 * the disjointness AC#1 asserts is not a vocabulary-only accident. */
const n4Paper = (seed: string): RequestInput => ({
  budget: { "grammar-reading": 4, listening: 2, vocabulary: 4 },
  level: "N4",
  mode: "shortened",
  sections: ["vocabulary", "grammar-reading", "listening"],
  seed,
});

/** One section, all of it grammar-backed: N5 has 77 grammar points, so this is
 * the cheapest paper that can actually run a level's family dry. */
const n5GrammarPaper = (seed: string): RequestInput => ({
  budget: { "grammar-reading": 10 },
  level: "N5",
  mode: "shortened",
  sections: ["grammar-reading"],
  seed,
});

/** One valid source per option, in the shape the assembler itself builds
 * (`exam-service.ts:1333`): the answer's own anchor, and the same anchor for
 * every corpus distractor. `answerIndex` comes from the STORED item, because
 * the shuffle that moves it is part of what is being re-validated. */
const sourcesFor = (item: {
  anchors: readonly string[];
  answerIndex: number;
  options: readonly string[];
}) => {
  const anchorId = item.anchors[0] as string;
  return item.options.map((_, index) =>
    index === item.answerIndex
      ? { anchorId, kind: "answer" as const }
      : { anchorId, kind: "corpus" as const, relation: "same-pos" as const }
  );
};

beforeAll(async () => {
  db = await createUserDb(DB_URL);
  client = makeExamClient(db);
  store = createItemStore(db);
}, 120_000);

afterAll(() => {
  closeAndRemoveSqliteDb(db, DB_PATH);
});

describe("TASK-148 a retry never re-serves a seen question", () => {
  it("AC#1: a paper at a level the learner has sat excludes every anchor the earlier paper served", async () => {
    const first = await buildPaper(n4Paper("t148-disjoint"));
    expect(first.assembled.ready).toBe(true);
    expect(first.assembled.contentExhausted).toBe(false);
    expect(first.anchors.length).toBeGreaterThan(0);

    // The control. Nothing has been started at this level, so the seen set is
    // identical for both builds and the same seed must rebuild the same walk:
    // the draw seed is `request.seed` alone, deliberately not `examId`. Without
    // this, "the second paper shares nothing" would be evidence of nothing,
    // because two fresh papers at one level already differ by chance.
    const control = await buildPaper(n4Paper("t148-disjoint"));
    expect(control.assembled.ready).toBe(true);
    expect(control.anchors).toEqual(first.anchors);

    // The learner reached the first paper and gave up on it. An abandoned paper
    // still counts, because the questions were on the screen.
    await client.exam.start({ examId: first.examId });
    await client.exam.abandon({ examId: first.examId });

    const retry = await buildPaper(n4Paper("t148-disjoint"));
    expect(retry.assembled.ready).toBe(true);
    expect(retry.assembled.contentExhausted).toBe(false);
    const overlap = retry.anchors.filter((anchor) =>
      first.anchors.includes(anchor)
    );
    expect(overlap).toEqual([]);
    // A retry is a full paper, not a paper with the seen questions removed:
    // the exclusion happens before the pool slice, so the walk widens into the
    // level's tail rather than coming up short.
    expect(retry.itemIds.length).toBe(first.itemIds.length);
  });

  it("AC#2: the seen record is the exams table, so it survives a restart", async () => {
    const before = await store.listServedAnchorsForLevel("N4");
    expect(before.length).toBeGreaterThan(0);

    // A real restart: the handle is closed and every in-memory map, including
    // the service's, is gone. Only the file survives.
    db.$client.close();
    db = await createUserDb(DB_URL);
    client = makeExamClient(db);
    store = createItemStore(db);

    const after = await store.listServedAnchorsForLevel("N4");
    expect(new Set(after)).toEqual(new Set(before));

    // And the fresh service still excludes them, which is the point: the seen
    // set is read from the database at build time, not remembered in a map.
    const paper = await buildPaper(n4Paper("t148-disjoint"));
    expect(paper.assembled.ready).toBe(true);
    const reused = paper.anchors.filter((anchor) => after.includes(anchor));
    expect(reused).toEqual([]);
  });

  it("AC#5: re-assembling a ready paper replays its stored items instead of re-drawing", async () => {
    const paper = await buildPaper(n4Paper("t148-retake"));
    expect(paper.assembled.ready).toBe(true);

    const again = await client.exam.assemble({ examId: paper.examId });
    const state = await client.exam.get({ examId: paper.examId });
    // A deliberate retake of ONE paper stays possible: the same items, ids
    // included, so the exclusion never touches a paper that already exists.
    expect(state.items.map((entry) => entry.item.id)).toEqual([
      ...paper.itemIds,
    ]);
    expect(again.validatedSlots).toBe(paper.itemIds.length);
    // The replay path never re-walks the pool, so it has no drainage to report.
    expect(again.contentExhausted).toBe(false);
  });

  it("AC#7: every item drawn from the reduced unseen pool still passes validateQuestionItem", async () => {
    const paper = await buildPaper(n4Paper("t147-validate"));
    expect(paper.assembled.ready).toBe(true);
    const served = await store.listServedAnchorsForLevel("N4");
    expect(paper.anchors.filter((anchor) => served.includes(anchor))).toEqual(
      []
    );

    const view = __test__.corpusViewOf(paper.examId);
    if (!view) {
      throw new Error(`no corpus view was recorded for ${paper.examId}`);
    }
    const state = await client.exam.get({ examId: paper.examId });
    const resolved = await Promise.all(
      state.items.map((entry) => store.resolveItem(entry.item.id))
    );
    const items = resolved.filter((item) => item !== null);
    expect(items).toHaveLength(state.items.length);
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      const result = validateQuestionItem(item, sourcesFor(item), view);
      expect(result.ok).toBe(true);
    }
  });

  it("AC#4 + AC#3: sitting papers runs one level dry and says so, and leaves the next level intact", async () => {
    const served: string[] = [];
    let last: BuiltPaper | null = null;
    for (let paper = 0; paper < 20; paper += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: each paper is only unseen because the previous one was started, so the loop is the history under test and cannot be parallelised.
      const built = await buildPaper(n5GrammarPaper(`t148-drain-${paper}`));
      last = built;
      // Every paper on the way down is new, which is AC#1 at scale: the level
      // narrows rather than cycles.
      expect(built.anchors.filter((anchor) => served.includes(anchor))).toEqual(
        []
      );
      if (!built.assembled.ready) {
        break;
      }
      // `in_progress` is what makes these questions SERVED. A paper assembled
      // and never opened would not count, which is why this loop has to start
      // each one rather than just request it.
      await client.exam.start({ examId: built.examId });
      served.push(...built.anchors);
    }

    const drained = last;
    if (!drained) {
      throw new Error("the drain loop never built a paper");
    }
    // AC#4: the hole reports itself instead of being filled with a repeat.
    expect(drained.assembled.ready).toBe(false);
    expect(drained.assembled.shortfall).toBeGreaterThan(0);
    expect(drained.assembled.contentExhausted).toBe(true);
    expect(
      drained.assembled.sections.some((section) => section.shortfall > 0)
    ).toBe(true);
    expect(drained.anchors.filter((anchor) => served.includes(anchor))).toEqual(
      []
    );
    // The short paper is a draft, so it served nothing: an unfulfillable
    // request must not spend content it does not show.
    expect((await store.listServedAnchorsForLevel("N5")).length).toBe(
      served.length
    );
    // And a draft cannot be opened, which is what makes the short receipt safe
    // to hand to a learner-facing surface: `exam.start` refuses it with the
    // typed `NOT_READY`, so neither the `/ai` button nor `start_exam` can put a
    // paper in front of someone who cannot answer it (`context.ts:219` relies
    // on exactly this when it throws instead of projecting).
    const [startError] = await safe(
      client.exam.start({ examId: drained.examId })
    );
    expect(isDefinedError(startError)).toBe(true);
    if (isDefinedError(startError)) {
      expect(startError.code).toBe("NOT_READY");
    }

    // AC#3: N5 is dry and N2 has never been sat. The exclusion is scoped by the
    // exam's level, so one level's history cannot starve another's build.
    const n2 = await buildPaper({
      budget: { "language-knowledge-reading": 4, listening: 2 },
      level: "N2",
      mode: "shortened",
      sections: ["language-knowledge-reading", "listening"],
      seed: "t148-n2",
    });
    expect(n2.assembled.shortfall).toBe(0);
    expect(n2.assembled.validatedSlots).toBe(n2.assembled.totalSlots);
    expect(n2.assembled.contentExhausted).toBe(false);
    expect(n2.anchors.length).toBeGreaterThan(0);
  }, 300_000);
});
