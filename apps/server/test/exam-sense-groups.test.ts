import { beforeAll, describe, expect, it } from "bun:test";
import { createUserDb } from "@manobu/db";
import { createItemStore, type ItemStore } from "@manobu/db/item-store";
import {
  type CorpusVocabEntry,
  examCorpus,
  fullSensesOf,
  senseGroupsOf,
  synonymsOf,
} from "../src/services/exam-corpus";
import { __test__ } from "../src/services/exam-service";
import {
  connectExamClient,
  type ExamClient,
  prepareContentDb,
} from "./exam-harness";

/*
 * TASK-138 AC#10 and AC#7: what a bare gloss item is ABOUT, and what may
 * surround it.
 *
 * AC#10 - a bare gloss item draws its distractors from the entry's OTHER SENSE
 * GROUPS. The unit that makes this correct is the group, not the gloss. One
 * JMdict sense holds several renderings of ONE meaning - 黄色 is a single sense,
 * "yellow | amber" - so splitting `meaning` on `;` yields synonyms and an exam
 * built that way marks correct answers wrong. The structure was in the corpus
 * all along and being discarded at the join; recovering it took precedence over
 * the WordNet experiment that tried and got 1,196 single-sense entries wrong
 * (28d9b0a, reverted in c75cd5b).
 *
 * AC#7 - the ANSWER is the entry's first sense, `senses[0][0]`. See the last
 * describe for why that is the strategy and where it is weak.
 *
 * COVERAGE lives in the data, not here: 99% of entries carry `senses`, 3,918 of
 * them have exactly one group and therefore offer nothing of their own. What
 * this file pins is that the pipeline USES the groups, and that the share of
 * items which gain a real distractor stays high - a regression that quietly
 * fell back to the same-POS pool would leave every correctness test green.
 */

const DB_URL = prepareContentDb("exam-sense-groups");

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

interface GlossItem {
  anchor: string;
  answer: string;
  fromGroup: boolean;
  sameGroup: number;
}

/** Classify each option against the corpus's sense groups. */
const classifyOptions = (
  options: readonly string[],
  answer: string,
  entry: CorpusVocabEntry
): { fromGroup: boolean; sameGroup: number } => {
  const ownGroup = new Set(synonymsOf(entry, answer));
  const everyGroup = senseGroupsOf(entry);
  let fromGroup = false;
  let sameGroup = 0;
  for (const option of options) {
    if (option === answer) {
      continue;
    }
    if (ownGroup.has(option)) {
      sameGroup += 1;
    }
    if (everyGroup.some((group) => group.includes(option))) {
      fromGroup = true;
    }
  }
  return { fromGroup, sameGroup };
};

/** Measure one stored gloss item against the corpus's sense groups. */
const measure = async (
  item: { anchors: readonly string[]; id: string; itemType: string },
  store: ItemStore
): Promise<GlossItem | null> => {
  if (item.itemType !== "word-in-context") {
    return null;
  }
  const anchor = item.anchors[0] ?? "";
  const entry = examCorpus()?.vocabByAnchor.get(anchor);
  if (entry === undefined) {
    return null;
  }
  // `answerIndex` is server-only, so this resolves through the store rather than
  // the client projection.
  const resolved = await store.resolveItem(item.id);
  if (resolved === null) {
    return null;
  }
  const answer = resolved.options[resolved.answerIndex] ?? "";
  return {
    anchor,
    answer,
    ...classifyOptions(resolved.options, answer, entry),
  };
};

type PaperRow = Awaited<ReturnType<typeof client.exam.get>>["items"][number];

/**
 * Generate, assemble and read back one N5 vocabulary paper.
 *
 * Every case here draws through it: the request triple is the same in all four
 * and a fourth copy is how a paper stops being assembled identically everywhere.
 */
const vocabPaper = async (
  seed: string
): Promise<{ examId: string; rows: readonly PaperRow[] }> => {
  const requested = await client.exam.request({
    budget: { vocabulary: 10 },
    level: "N5",
    mode: "shortened",
    sections: ["vocabulary"],
    seed,
  });
  await client.exam.assemble({ examId: requested.examId });
  const state = await client.exam.get({ examId: requested.examId });
  return { examId: requested.examId, rows: state.items };
};

const glossItems = async (seeds: readonly string[]): Promise<GlossItem[]> => {
  const store = createItemStore(await createUserDb(DB_URL));
  const perSeed = await Promise.all(
    seeds.map(async (seed) => (await vocabPaper(seed)).rows)
  );
  const measured = await Promise.all(
    perSeed.flat().map((entry) => measure(entry.item, store))
  );
  return measured.filter((entry): entry is GlossItem => entry !== null);
};

/**
 * Every bare-gloss item drawn at a level, from papers requested the way a
 * learner requests them (the level's own default sections, not one section).
 *
 * AC#7's claim is that the sense strategy holds ACROSS a level, and the level
 * decides which entries are reachable: the four whose primary gloss the summary
 * parse mangles are N1-N3, so an N5-only sample cannot see them.
 */
const drawnGlosses = async (
  level: "N1" | "N5",
  seeds: readonly string[]
): Promise<GlossItem[]> => {
  const store = createItemStore(await createUserDb(DB_URL));
  const papers = await Promise.all(
    seeds.map(async (seed) => {
      const requested = await client.exam.request({
        level,
        mode: "shortened",
        seed,
      });
      await client.exam.assemble({ examId: requested.examId });
      return (await client.exam.get({ examId: requested.examId })).items;
    })
  );
  const measured = await Promise.all(
    papers.flat().map((row) => measure(row.item, store))
  );
  return measured.filter((entry): entry is GlossItem => entry !== null);
};

describe("sense-group distractors (TASK-138 AC#10)", () => {
  it("never offers a gloss from the answer's own group, over ten papers", async () => {
    const seeds = [
      "sg-1",
      "sg-2",
      "sg-3",
      "sg-4",
      "sg-5",
      "sg-6",
      "sg-7",
      "sg-8",
      "sg-9",
      "sg-10",
    ];
    const items = await glossItems(seeds);
    expect(items.length).toBeGreaterThan(0);
    const leaks = items
      .filter((item) => item.sameGroup > 0)
      .map((item) => `${item.anchor} leaked ${item.sameGroup}`);
    expect(leaks).toEqual([]);
  });

  it("a large share of items get a REAL distractor rather than the same-POS pool", async () => {
    // The regression this catches is silent: every correctness assertion above
    // stays green if the picker simply stops offering own-sense distractors and
    // falls back to "entrance / yellow / salt / skillful". So the rate is
    // asserted, not just the absence of the bug.
    const seeds = [
      "sg-1",
      "sg-2",
      "sg-3",
      "sg-4",
      "sg-5",
      "sg-6",
      "sg-7",
      "sg-8",
      "sg-9",
      "sg-10",
    ];
    const items = await glossItems(seeds);
    const corpus = examCorpus();

    // The denominator is the entries that CAN produce an own-group distractor,
    // and the bar is unchanged at 0.7. Lowering it would have been the wrong fix
    // and would have hidden the regression this test exists to catch: the
    // symptom is "the picker quietly fell back to the same-POS pool", and that
    // is exactly what is happening on the entries that have a second group.
    //
    // The two populations used to share one denominator, and `candidatesForReading`
    // is what separated them. It cut 105 of 697 N5 entries down to a single
    // group, correctly: 東 read ひがし means "east", so "Tokyo" and "winning hand
    // with a pung of east wind tiles" belong to あずま and are not distractors for
    // anchor vocab:N5:東:ひがし. Before the filter those wrong-reading senses were
    // being counted as a "fromGroup" success, which inflated this rate while
    // putting a wrong answer in front of the learner.
    //
    // So: assert the rate where the distractor is structurally available, and
    // assert the single-group share separately below. The signal is not deleted,
    // it stops being conflated with the part of the corpus that has nothing to
    // offer.
    const eligible = items.filter((item) => {
      const entry = corpus?.vocabByAnchor.get(item.anchor);
      return entry !== undefined && senseGroupsOf(entry).length >= 2;
    });
    expect(eligible.length).toBeGreaterThan(0);
    const withGroup = eligible.filter((item) => item.fromGroup).length;
    // 90% measured on this population; the bar is below that so ordinary pool
    // rotation cannot flip it, and above the 0% that shipped between c75cd5b
    // and this commit.
    expect(withGroup / eligible.length).toBeGreaterThan(0.7);
  });

  it("the single-group share of drawn gloss items stays a small minority", async () => {
    // The population option 2 above excludes, measured rather than assumed away.
    // If the reading filter ever narrows so much that most drawn items have
    // nothing of their own to offer, `eligible.length` shrinks, the rate above
    // stops meaning much, and this fails first. Without it the exclusion is a
    // quiet way to make a red test green.
    const seeds = [
      "sg-1",
      "sg-2",
      "sg-3",
      "sg-4",
      "sg-5",
      "sg-6",
      "sg-7",
      "sg-8",
    ];
    const items = await glossItems(seeds);
    const corpus = examCorpus();
    const single = items.filter((item) => {
      const entry = corpus?.vocabByAnchor.get(item.anchor);
      return entry !== undefined && senseGroupsOf(entry).length < 2;
    });
    // Now EXACTLY zero, and it can be exact. Two changes made that possible:
    //
    // 1. The picker DECLINES single-group anchors for bare-gloss items instead of
    //    sourcing them against the same-POS pool, which is what produced
    //    入口:いりぐち -> "entrance | salt | yellow | skillful". Those are not
    //    wrong meanings of the word; they are unrelated words.
    // 2. The walk seed is `request.seed` alone and no longer includes the random
    //    `examId`, so a named seed reproduces its paper exactly. That is why the
    //    bar can be 0 rather than a loose ceiling: this file previously had to
    //    concede 0.5 because the draw shifted whenever a neighbouring spec was
    //    added, since examId is minted per request.
    expect(single).toEqual([]);
  });

  it("declining single-group anchors still fills the paper's budget", async () => {
    // The other half of the fix, and the property that makes declining safe.
    // This is the same "fall through, do not give up" rule exam-grammar-once
    // pins for AC#9: when the walk exhausts the pool with every multi-group entry
    // already spent, single-group entries are admitted rather than returning null.
    // A short paper is a worse outcome than one weak item.
    const counts = await Promise.all(
      ["sg-1", "sg-2", "sg-3", "sg-4", "sg-5"].map(
        async (seed) => (await vocabPaper(seed)).rows.length
      )
    );
    expect(counts).toEqual([10, 10, 10, 10, 10]);
  });

  it("an explicit seed reproduces its paper, and a different one does not", async () => {
    // doc-21 §9 and TASK-139 both depend on this. The walk seed used to be
    // `${examId}:${request.seed}`, and examId is `exam-${randomUUID()}`, so an
    // explicit seed could NOT reproduce a paper - which is what made the
    // draw-distribution assertions above non-deterministic.
    const anchorsFor = async (seed: string): Promise<string> => {
      const store = createItemStore(await createUserDb(DB_URL));
      const { rows } = await vocabPaper(seed);
      const resolved = await Promise.all(
        rows.map(async (row) => {
          const item = await store.resolveItem(row.item.id);
          return item?.anchors.join(",") ?? "?";
        })
      );
      return resolved.join("|");
    };
    expect(await anchorsFor("repro-seed")).toBe(await anchorsFor("repro-seed"));
    expect(await anchorsFor("repro-seed")).not.toBe(
      await anchorsFor("other-seed")
    );
  });

  it("a single-sense entry offers nothing of its own", () => {
    // 3,918 entries have exactly one group, so there is no correct distractor
    // available and the fallback has to be the other-words pool. Asserted on the
    // data rather than on a paper, because which entries a seed happens to reach
    // is not something to assert.
    const corpus = examCorpus();
    const single = [...(corpus?.vocabByAnchor.values() ?? [])].filter(
      (entry) => senseGroupsOf(entry).length === 1
    );
    expect(single.length).toBeGreaterThan(0);
    for (const entry of single) {
      const group = senseGroupsOf(entry)[0] ?? [];
      for (const gloss of group) {
        // Every rendering is a correct answer, so the group is untouchable.
        expect(new Set(synonymsOf(entry, gloss))).toEqual(new Set(group));
      }
    }
  });

  it("the ANSWER is always one of the entry's own attested glosses", () => {
    // Behavioural, and aimed at the whole class rather than at four entries. The
    // gloss surface used to read the `meaning` SUMMARY, which is ";"-joined and
    // so mangles any JMdict gloss containing ";" inside parentheses: アウト is
    // "out (of a ball; in tennis, etc.)" and the summary parse yields
    // "out (of a ball" - which then became the marked ANSWER. Four entries
    // shipped that way, silently.
    //
    // Asserted over the WHOLE corpus rather than by assembling papers, because
    // the affected entries are N1-N3 and a seed-based search would pass
    // vacuously most of the time. The invariant: whatever the surface returns
    // must be a gloss the entry actually attests.
    const surface = __test__.surfaceByFamily.gloss;
    const offenders: string[] = [];
    for (const entry of examCorpus()?.vocabByAnchor.values() ?? []) {
      const answer = surface(entry);
      if (answer === undefined) {
        continue;
      }
      if (!fullSensesOf(entry).includes(answer)) {
        offenders.push(`${entry.word} -> ${answer}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the paper RECORDS which distractor case each item took", async () => {
    // Fix 5. AC#10 was being closed by assertion when it is only closed for part
    // of the corpus: ~56% of entries have a single sense group, and a declined
    // anchor leaves no trace in the assembled paper - it simply is not there. So
    // "how much of the corpus can actually produce a testable item" was
    // unanswerable, and the honest move is to count it the way TASK-142 records
    // an unverified mask instead of claiming a verification that did not happen.
    const seeds = ["sg-1", "sg-2", "sg-3", "sg-4", "sg-5"];
    const perSeed = await Promise.all(
      seeds.map(async (seed) => {
        const requested = await client.exam.request({
          budget: { vocabulary: 10 },
          level: "N5",
          mode: "shortened",
          sections: ["vocabulary"],
          seed,
        });
        await client.exam.assemble({ examId: requested.examId });
        return [...__test__.sourcingCasesOf(requested.examId).values()];
      })
    );
    const cases = perSeed.flat();
    // The ledger is populated, which is the property that was missing. A
    // declined anchor leaves no trace in the assembled paper, so without this
    // record AC#10's coverage is a claim rather than a count.
    expect(cases.length).toBeGreaterThan(0);
    // Every case is one of the three the design distinguishes, and the
    // distinction is the whole point: "the picker fell back to the same-POS
    // pool" and "the entry had nothing of its own" are different failures and
    // need different fixes.
    for (const value of cases) {
      expect([
        "from-own-group",
        "same-pos-pool",
        "single-group-fallback",
      ]).toContain(value);
    }
    // The record must agree with the artefact it describes. This is the guard
    // that makes fix 5 a measurement instead of another claim: a ledger that can
    // lie about which case an item took is worse than no ledger, because it
    // would let AC#10 be "closed" by writing down the answer.
    const store = createItemStore(await createUserDb(DB_URL));
    const corpus = examCorpus();
    const papers = await Promise.all(
      ["sg-1", "sg-2"].map(async (seed) => {
        const { examId, rows } = await vocabPaper(seed);
        return Promise.all(
          rows.map(async (row) => {
            const item = await store.resolveItem(row.item.id);
            return {
              caseValue: __test__.sourcingCasesOf(examId).get(row.item.id),
              item,
            };
          })
        );
      })
    );
    const checkedItems = papers
      .flat()
      .filter((row) => row.item !== null && row.caseValue !== undefined);
    expect(checkedItems.length).toBeGreaterThan(0);
    for (const { item, caseValue } of checkedItems) {
      if (item === null) {
        continue;
      }
      const answer = item.options[item.answerIndex] ?? "";
      const entry = corpus?.vocabByAnchor.get(item.anchors[0] ?? "");
      const otherGroups =
        entry === undefined
          ? []
          : senseGroupsOf(entry)
              .filter((group) => !group.includes(answer))
              .flat();
      const drewOwnGroup = item.options.some((option) =>
        otherGroups.includes(option)
      );
      if (caseValue === "from-own-group") {
        expect(drewOwnGroup).toBe(true);
      } else {
        expect(drewOwnGroup).toBe(false);
      }
    }
    // The design goal, as a majority rather than an exact figure: most drawn
    // items get a distractor from another sense group of the same entry, which is
    // the only case that is both unambiguous and testable.
    const fromOwn = cases.filter((value) => value === "from-own-group").length;
    expect(fromOwn / cases.length).toBeGreaterThan(0.5);
    // The exhaustion fallback is rare by construction - it only fires when the
    // pool is spent - so a large share means the pool is too small, not that the
    // fallback is broken.
    const fallback = cases.filter(
      (value) => value === "single-group-fallback"
    ).length;
    expect(fallback / cases.length).toBeLessThan(0.25);
  });

  it("the paper RECORDS which anchors the walk declined", async () => {
    // The decline ledger is the only trace a declined anchor leaves. Without
    // it, "how much of the corpus can actually produce a testable item" is
    // unanswerable from the paper alone.
    const requested = await client.exam.request({
      budget: { vocabulary: 10 },
      level: "N5",
      mode: "shortened",
      sections: ["vocabulary"],
      seed: "decline-test",
    });
    await client.exam.assemble({ examId: requested.examId });
    const declined = __test__.declinedAnchorsOf(requested.examId);
    // At least one anchor was declined (the pool has single-group entries).
    expect(declined.size).toBeGreaterThan(0);
    // And none of them appear in the assembled paper.
    const state = await client.exam.get({ examId: requested.examId });
    const assembled = new Set(state.items.map((row) => row.item.anchors[0]));
    for (const anchor of declined) {
      expect(assembled.has(anchor)).toBe(false);
    }
  });
});

/*
 * TASK-138 AC#7: the sense a bare gloss item ASKS FOR is the entry's first one.
 *
 * AC#8 and AC#10 pin which options may surround the answer; this pins the answer
 * itself. The strategy is `senses[0][0]` - JMdict orders senses by priority, so
 * group 0 is the teachable one for a learner - and the assertions below are the
 * AC's three clauses: the item names the sense it means, the choice reproduces
 * from the seed, and the strategy holds across a level rather than on one
 * hand-picked entry.
 *
 * The limit is stated rather than hidden: priority order is a lexicographer's
 * judgement, not a pedagogical one, so 人's primary sense is the suffix reading
 * "-ian (e.g. Italian)". Choosing better than sense[0] is a selection question
 * about Japanese, and doc-23 §3 already says an agent should not make it alone.
 */
describe("the answer is the entry's primary sense (TASK-138 AC#7)", () => {
  it("names senses[0][0] on every gloss item drawn at N5 and N1", async () => {
    const items = [
      ...(await drawnGlosses("N5", ["ac7-n5-a", "ac7-n5-b", "ac7-n5-c"])),
      ...(await drawnGlosses("N1", ["ac7-n1-a", "ac7-n1-b", "ac7-n1-c"])),
    ];
    const corpus = examCorpus();
    const offenders: string[] = [];
    for (const item of items) {
      const entry = corpus?.vocabByAnchor.get(item.anchor);
      if (entry === undefined) {
        continue;
      }
      // Group membership, not flat position: the answer has to come from group 0
      // AND be that group's first rendering, because a later rendering of group
      // 0 is a correct answer that is not the one being taught.
      const primary = senseGroupsOf(entry)[0]?.[0];
      if (primary !== undefined && item.answer !== primary) {
        offenders.push(`${item.anchor}: ${item.answer} != ${primary}`);
      }
    }
    // A vacuous pass is the failure mode here, so the sample is asserted before
    // the verdict: 42 bare-gloss items across six shortened papers at two levels.
    // The bar sits well below that because the draw is seed-deterministic but the
    // type's share of a paper is a weights table, not a constant.
    expect(items.length).toBeGreaterThan(30);
    expect(offenders).toEqual([]);
  });

  it("reproduces the same answers from the same seed at N1", async () => {
    // AC#10's reproduction test is N5-only and compares anchors. The sense choice
    // is a function of the anchor, so pinning it at the level where the summary
    // parse used to mangle the answer is what makes clause (b) mean something.
    const answersFor = async (seed: string): Promise<string> =>
      (await drawnGlosses("N1", [seed]))
        .map((item) => `${item.anchor}=${item.answer}`)
        .join("|");
    const first = await answersFor("ac7-repro");
    expect(first).not.toBe("");
    expect(await answersFor("ac7-repro")).toBe(first);
    expect(await answersFor("ac7-other")).not.toBe(first);
  });
});
