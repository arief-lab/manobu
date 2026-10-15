import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { UserDatabase } from "@manobu/db/item-store";
import { type ExamClient, makeExamClient } from "./exam-harness";
import { manualContentDb, removeSqliteDbFiles } from "./harness";

/*
 * TASK-138 AC#8: a bare gloss question must not offer the target entry's own
 * other senses, and that is enforced at WRITE time rather than trusted from the
 * picker.
 *
 * The defect this pins came from the TASK-144 baseline (doc-23), where all three
 * `word-in-context` items in the assembled sample had MORE THAN ONE CORRECT
 * OPTION. "Choose the meaning of 暇." offered spare time / leisure / free time
 * and marked spare time, so a learner who answered "leisure" was right and was
 * marked wrong. The cause was the distractor family: the entry's own other
 * senses are not "the most plausible wrong answer", they are other correct
 * answers, and 86-90% of entries are multi-sense.
 *
 * Both halves are asserted here, deliberately. A picker-only test would pass
 * while a future item type reintroduced the family, which is the failure mode
 * AC#8 was written to close.
 */

const { DB_PATH, DB_URL } = manualContentDb("ac8");

const { createItemStore } = await import("@manobu/db/item-store");
const { examCorpus, fullSensesOf, senseGroupsOf, synonymsOf, vocabAnchorFor } =
  await import("../src/services/exam-corpus");
// The REAL validator seam. A hand-rolled `satisfies` proves nothing about the
// service, which is how `exam-gloss-ambiguity-not-refused` survived once.
const { __test__ } = await import("../src/services/exam-service");
const { validateQuestionItem } = await import("@manobu/item-engine/validation");

/** One valid source per option: the answer is `answer`, the rest `corpus`. The
 * validator checks sources BEFORE satisfaction, so an item cannot reach the
 * ambiguity check without them. */
const sourcesFor = (item: {
  anchors: readonly string[];
  options: readonly string[];
  answerIndex: number;
}) => {
  const anchorId = item.anchors[0] as string;
  return item.options.map((_, index) =>
    index === item.answerIndex
      ? { anchorId, kind: "answer" as const }
      : { anchorId, kind: "corpus" as const, relation: "same-pos" as const }
  );
};

let db: UserDatabase;
let client: ExamClient;
let store: ReturnType<typeof createItemStore>;

beforeAll(async () => {
  const { createUserDb } = await import("@manobu/db");
  db = await createUserDb(DB_URL);
  client = makeExamClient(db);
  store = createItemStore(db);
});

afterAll(() => {
  removeSqliteDbFiles(DB_PATH);
});

const assemble = async (budget: number, seed: string) => {
  const requested = await client.exam.request({
    budget: { vocabulary: budget },
    level: "N5",
    mode: "shortened",
    sections: ["vocabulary"],
    seed,
  });
  const assembled = await client.exam.assemble({ examId: requested.examId });
  const state = await client.exam.get({ examId: requested.examId });
  const items: NonNullable<Awaited<ReturnType<typeof store.resolveItem>>>[] =
    [];
  // `answerIndex` is a server-only field, so the client projection cannot tell
  // the answer from a distractor. Resolving through the store is the only way
  // to see which option is correct.
  const resolved = await Promise.all(
    state.items.map((entry) => store.resolveItem(entry.item.id))
  );
  for (const item of resolved) {
    if (item) {
      items.push(item);
    }
  }
  return { assembled, items };
};

describe("bare-gloss items have exactly one correct answer (TASK-138 AC#8)", () => {
  it("the picker never offers a gloss from the answer's own sense group", async () => {
    const corpus = examCorpus();
    const { assembled, items } = await assemble(12, "ac8-picker");
    expect(assembled.ready).toBe(true);
    const gloss = items.filter((item) => item.itemType === "word-in-context");
    expect(gloss.length).toBeGreaterThan(0);

    for (const item of gloss) {
      const anchor = item.anchors[0] as string;
      const entry = corpus?.vocabByAnchor.get(anchor);
      expect(entry).toBeDefined();
      const answer = item.options[item.answerIndex] ?? "";
      // The property AC#8 exists for, in its TASK-138 AC#10 form: no distractor
      // may share a MEANING with the answer. The unit is the sense GROUP, not
      // the gloss - one JMdict sense holds several renderings of one meaning, so
      // 黄色's "amber" and 入口's "gate" are correct answers, while 暇's "time
      // off" is a different meaning and a legitimate distractor.
      const ownGroup = new Set(synonymsOf(entry as never, answer));
      for (const option of item.options) {
        if (option === answer) {
          continue;
        }
        expect(ownGroup.has(option)).toBe(false);
      }
    }
  });

  it("WRITE-TIME REFUSAL: an item carrying a second correct sense is rejected as ambiguous", () => {
    // The picker half can be satisfied by construction, so this drives the
    // validator directly with a deliberately ambiguous item. If the refusal
    // were only in the picker, this item would validate and ship.
    const corpus = examCorpus();
    expect(corpus).not.toBeNull();
    // A group with at least two renderings, because that is the only ambiguous
    // case AC#10 leaves: two options from the SAME sense are both correct. Two
    // options from DIFFERENT senses is a well-formed item now.
    const entry = [...(corpus?.vocabByAnchor.values() ?? [])].find(
      (candidate) => senseGroupsOf(candidate).some((s) => s.length > 1)
    );
    expect(entry).toBeDefined();
    const group = (senseGroupsOf(entry as never).find(
      (candidateGroup) => candidateGroup.length > 1
    ) ?? []) as readonly string[];
    expect(group.length).toBeGreaterThan(1);

    const item = {
      anchors: [vocabAnchorFor(entry as never)],
      answerIndex: 0,
      id: "ac8-ambiguous",
      itemType: "word-in-context" as const,
      level: "N5",
      options: [group[0] as string, group[1] as string, "zzz-a", "zzz-b"],
      prompt: `Choose the meaning of ${(entry as never as { word: string }).word}.`,
      surface: "exam" as const,
    };
    // The service's OWN view - especially its `satisfies`, which is the whole
    // subject here - spread FIRST so the two keys the test controls are the
    // ones that win. Spreading it last silently overwrote them.
    const result = validateQuestionItem(item, sourcesFor(item), {
      ...__test__.candidateCatalogCorpus(
        new Map([[item.id, group[0] as string]]),
        new Map([[item.anchors[0] as string, "N5"]]),
        corpus,
        new Map()
      ),
      isOptionSourceValid: () => true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("ambiguous");
    }
  });

  it("the same refusal does not fire on a reading item, where options are readings", () => {
    // Scoped to the gloss family on purpose: a reading item's options are
    // readings, so comparing them to English glosses is a category error. If
    // this started rejecting reading items, the gate would be too wide.
    const corpus = examCorpus();
    // An entry with at least 3 attested glosses, so the item gets the 4 options
    // the contract expects. Selecting "the first N5 entry" instead made this test
    // a canary for unrelated corpus churn: the first entry is 東/ひがし, a kanji
    // with a single gloss, so the item silently built 2 options and failed a
    // MIN_OPTIONS rule that has nothing to do with the family scoping under
    // test. The intent here is that the refusal is scoped to the gloss family,
    // and that intent needs a real multi-gloss word, not whichever entry sorts
    // first today.
    const entry = [...(corpus?.vocabByAnchor.values() ?? [])].find(
      (candidate) =>
        candidate.level === "N5" && fullSensesOf(candidate).length >= 3
    );
    expect(entry).toBeDefined();
    const item = {
      anchors: [vocabAnchorFor(entry as never)],
      answerIndex: 0,
      id: "ac8-reading-ok",
      itemType: "kanji-reading" as const,
      level: "N5",
      options: [
        (entry as never as { reading: string }).reading,
        ...senseGroupsOf(entry as never)
          .flat()
          .slice(0, 3),
      ],
      prompt: "Choose the correct reading.",
      surface: "exam" as const,
    };
    // The service's real view again, with a target that is the READING. Its
    // `satisfies` is scoped to the gloss family, so on a kanji-reading item it
    // answers "no" for every non-answer option and the item validates - which is
    // the point: the gate is exactly as wide as the gloss family and no wider.
    const result = validateQuestionItem(item, sourcesFor(item), {
      ...__test__.candidateCatalogCorpus(
        new Map([[item.id, item.options[0] as string]]),
        new Map([[item.anchors[0] as string, "N5"]]),
        corpus,
        new Map()
      ),
      isOptionSourceValid: () => true,
    });
    expect(result.ok).toBe(true);
  });
});
