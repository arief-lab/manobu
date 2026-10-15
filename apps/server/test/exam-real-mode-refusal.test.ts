import { beforeAll, describe, expect, it } from "bun:test";
import { __test__ } from "../src/services/exam-service";
import {
  connectExamClient,
  type ExamClient,
  prepareContentDb,
} from "./exam-harness";

/*
 * TASK-173.1 AC#3/#4/#5: the real mode refuses, it does not fabricate.
 *
 * A gloss item whose wrong options came from the `same-pos-pool` or
 * `single-group-fallback` case is not the kind the real JLPT asks: the distractors
 * are either another entry's surfaces or renderings of the answer's own meaning.
 * In real mode such a candidate does not fill its slot.
 *
 * The state that shows this is the one TASK-148 built the fallback for: a learner
 * who has worked a level until its AUTHENTIC (own-sense-group) supply is spent.
 * The daily paper keeps filling there, from the fallback; the real one stops. So
 * the test burns that state with started papers and burns until a paper is MOSTLY
 * padding, not until it contains one fabricated item. That distinction is the
 * whole difficulty and was found the hard way: just past the boundary the real
 * paper still fills, because a paper that refuses comes up short, and coming up
 * short is what makes `fillCandidatePaper` widen its reserve and walk a deeper
 * slice of the level (exam-service.ts:1660-1714). The daily paper never does that
 * - it filled at the first attempt with padding, so it never looked further. The
 * real mode therefore finds authentic content the daily mode walks past, which is
 * the outcome TASK-148 wanted, and the hole only opens once the level is genuinely
 * out of real items.
 *
 * "Started", not just assembled: an unopened paper serves nothing
 * (packages/db/src/item-store.ts:53-59), so only a paper the learner reached
 * spends the level.
 *
 * AS OF TASK-173.4 the second test burns the state and then watches the REAL paper
 * come up short for a different reason. The 大問 walk asks what the official paper
 * asks, and the official N5 vocabulary 大問 it can build (漢字読み, and since
 * TASK-173.5 文脈規定) turn nothing down: a reading item's wrong options are other
 * readings, and a cloze's are same-POS siblings the join records with no
 * `sourcingCase` (`clozeSourceFor`). No gloss fallback fires, so the receipt
 * instead names the 大問 the item engine cannot build. The fabricated-candidate
 * guard below stays exactly where 173.1 put it and is still dormant: only
 * `word-in-context` ever gets a fallback `sourcingCase` (`exam-service.ts:762`),
 * and no real-mode 大問 asks it (TASK-173.6 文の組み立て, TASK-173.7 読解 and
 * TASK-173.8 聴解 remain to put it in one).
 */

const DB_URL = prepareContentDb("exam-real-mode-refusal");

const VOCAB_BUDGET = 40;
const BURN_LIMIT = 20;
/** The burn is over when at least this many of the paper's 40 items are
 * fabricated, i.e. the level's own sense-group content is spent and the daily
 * paper is mostly padding. Anything less is a boundary the widen loop can still
 * clear (see the loop comment), and the first version of this test burned to it
 * and asserted a hole that was never there. */
const PADDED_ITEMS = VOCAB_BUDGET / 2;

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

type Assembled = Awaited<ReturnType<typeof client.exam.assemble>>;

interface Built {
  assembled: Assembled;
  /** The item ids the paper actually holds, read back through the client. */
  itemIds: readonly string[];
  ledger: ReadonlyMap<string, string>;
}

const isFallback = (value: string | undefined): boolean =>
  value === "same-pos-pool" || value === "single-group-fallback";

const build = async (
  mode: "real" | "shortened",
  seed: string
): Promise<Built> => {
  const requested = await client.exam.request({
    budget: { vocabulary: VOCAB_BUDGET },
    level: "N5",
    mode,
    sections: ["vocabulary"],
    seed,
  });
  const assembled = await client.exam.assemble({ examId: requested.examId });
  const state = await client.exam.get({ examId: requested.examId });
  return {
    assembled,
    itemIds: state.items.map((entry) => entry.item.id),
    ledger: __test__.sourcingCasesOf(requested.examId),
  };
};

/** Assemble AND start, so the paper's anchors count as served. */
const serve = async (seed: string): Promise<Built> => {
  const built = await build("shortened", seed);
  if (built.assembled.ready) {
    await client.exam.start({ examId: built.assembled.examId });
  }
  return built;
};

/** The fabricated items the learner was actually handed, not the ones the walk
 * cataloged and the assembler left on the bench. */
const fabricatedItems = (built: Built): readonly string[] =>
  built.itemIds.filter((id) => isFallback(built.ledger.get(id)));

describe("TASK-173.1 real mode refuses fabricated distractors", () => {
  it("a fresh real paper catalogues no fallback-sourced item", async () => {
    const real = await build("real", "fresh-real");
    expect([...real.ledger.values()].filter(isFallback)).toEqual([]);
  });

  /**
   * TASK-173.4 changed WHICH ITEMS a real paper asks for, so this test's premise
   * moved and it says so. Under the flat mix a real N5 vocabulary paper asked for
   * `word-in-context`, the one gloss type the picker can only pad by widening away
   * from the entry's own sense group, so 173.1's refusal is what stopped it. Under
   * the 大問 walk it asks for 漢字読み and 文脈規定, the two official N5 vocabulary
   * 大問 the item engine can build, and neither is gloss-sourced: a reading item's
   * wrong options are other READINGS, and a cloze's are same-POS siblings the join
   * records with no `sourcingCase` (`clozeSourceFor`). So `refusedSections` is
   * empty, and the paper comes up short for reasons that are not refusals: the
   * 大問 with no engine are a structural hole, and since TASK-173.5 the 文脈規定
   * cloze 大問3 is a content hole, because a real N5 vocabulary paper now walks the
   * grammar pool and that pool cannot back all ten 小問. The guard is not dead:
   * it waits for a real-mode 大問 to ask `word-in-context`, the one
   * type that does get a fallback `sourcingCase` (TASK-173.6 文の組み立て,
   * TASK-173.7 読解, TASK-173.8 聴解); what is pinned here is that the real paper
   * still contains no fabricated item, and that the receipt now names the 大問 it
   * gave up on, which is finer than the section 173.1 had.
   */
  it("AC#3/#4/#5: where the daily paper pads, the real one stops and says where", async () => {
    // Burn N5 vocabulary down to the state TASK-148's fallback exists for.
    let padded: Built | null = null;
    for (let round = 0; round < BURN_LIMIT; round += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: the burn is a sequence of papers the learner actually reached, and each one only spends the level after the previous one is served.
      const daily = await serve(`burn-${String(round)}`);
      if (fabricatedItems(daily).length >= PADDED_ITEMS) {
        padded = daily;
        break;
      }
    }
    if (padded === null) {
      throw new Error(
        `burning ${String(BURN_LIMIT)} N5 vocabulary papers never reached ${String(PADDED_ITEMS)} fabricated items in one paper, so the premise of this test is gone. Check how the picker falls back (apps/server/src/services/exam-service.ts:1143) before trusting anything below.`
      );
    }
    // Non-vacuity: the daily paper at this state is mostly padding. It may be
    // full (ready) or short, which is why neither is asserted: what the state has
    // to prove is that the level's own content is gone and the daily mode is
    // handing the learner fabricated items anyway.
    expect(fabricatedItems(padded).length).toBeGreaterThanOrEqual(PADDED_ITEMS);
    expect(padded.assembled.refusedSections).toEqual([]);
    expect(padded.assembled.unfilledBlocks).toEqual([]);

    const real = await build("real", "after-burn");
    // AC#3: nothing fabricated crossed into the paper.
    expect(fabricatedItems(real)).toEqual([]);
    // The slot the daily paper padded is a hole here, so the paper is not ready
    // and the learner is not handed a "real" paper built on made-up options.
    expect(real.assembled.ready).toBe(false);
    expect(real.assembled.validatedSlots).toBeLessThan(
      padded.assembled.validatedSlots
    );
    // AC#4, as of 173.4: no fabricated candidate was turned down, because the real
    // paper asks no gloss item type. What it did refuse is the official shape it
    // cannot build, and that was named 大問 by 大問. 表記 closed with
    // TASK-173.9.25 and 言い換え類義 with TASK-173.9.28, so N5 vocabulary now has
    // NO structural 大問 hole at all: every 大問 of the section has an engine and a
    // source, and what is left is content running out.
    expect(real.assembled.refusedSections).toEqual([]);
    expect(
      real.assembled.unfilledBlocks.map(
        (block) => `${block.section}:大問${String(block.bigQuestion)}`
      )
    ).toEqual([]);
    // The 小問 each unfilled 大問 gave up on is its own count, and they were the
    // part of the hole no content could ever close. With the section's last
    // structural hole filled, that count is zero and every remaining missing 小問
    // is the TASK-148 kind of gap: this run ran out of backing, not out of shapes.
    const structuralHole = real.assembled.unfilledBlocks.reduce(
      (total, block) => total + block.requestedItems,
      0
    );
    expect(structuralHole).toBe(0);
    expect(structuralHole).toBeLessThanOrEqual(real.assembled.shortfall);
    // A real section cannot ask for more 小問 than the official paper has, so the
    // 40 this test asked for is the whole 35-question section and the receipt does
    // not report the difference as a hole.
    expect(real.assembled.request.budget.vocabulary).toBeLessThan(VOCAB_BUDGET);
    expect(
      real.assembled.sections.find((section) => section.id === "vocabulary")
        ?.shortfall
    ).toBeGreaterThan(0);
    // It is reported as content exhaustion too, and that is a NEW fact
    // TASK-173.5 brought. Enabling 文脈規定 makes a real N5 vocabulary paper walk
    // the grammar pool for the first time, and N5's unseen grammar backing cannot
    // fill all ten cloze 小問 even on an unbuilt level (about five source), so the
    // cloze walk hits `sourced < required` and marks the family drained. The two
    // diagnoses stay separate and both true: the 大問 with no engine at all are
    // still named in `unfilledBlocks` above, whatever the learner has seen, while
    // `contentExhausted` reports the 大問 this run genuinely ran out of backing for.
    // Under 173.4's 漢字読み-only real paper the flag was false because no grammar
    // walk ever happened.
    expect(real.assembled.contentExhausted).toBe(true);
  });
});
