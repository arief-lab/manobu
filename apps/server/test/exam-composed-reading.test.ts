import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUserDb } from "@manobu/db";
import { __test__ as corpusTest } from "../src/services/exam-corpus";
import {
  type ExamClient,
  makeExamClient,
  prepareContentDb,
} from "./exam-harness";

/*
 * TASK-173.9.5 AC#1/#2/#4: `real` turns an UNVALIDATED composed 短文 down, SERVES
 * one a judge agent has falsified, and the whole difference is provenance + the
 * `validated` flag - never the fixture prose.
 *
 * The honesty gate is the deliverable. A composed item is verbatim licensed PROSE
 * with an AI-authored question and key, so no corpus has proven the key the way it
 * proves a licensed row: the reading store SKIPS distractor verification
 * (`shortReadingSourceFor` leaves `sourcingCase` undefined, so `satisfies` cannot
 * judge it). AC#1: `real` must refuse it. AC#2 (the D1-flip): once an agent - the
 * app's own spawn capability (packages/acp), AionCore-style - runs the offline
 * distractor-falsification pass and signs the key off (`validated: true`), that IS
 * the missing corpus-proof, so `real` admits it. That is one expression in
 * `isRefused` (exam-service.ts:2115-2123), and pinning it means watching the SAME
 * prose refuse when `composed`+unvalidated, fill when `composed`+validated, and
 * fill when `licensed`. Because all three papers draw an identical grammar/
 * vocabulary corpus, the ONLY variable is the tag - exactly what the two mutation
 * seams (drop the composed branch; drop the `!validated` term) each break.
 *
 * Scope note: `short-reading` fills ONLY a real paper. The 短文 block's itemTypes
 * is `["short-reading"]` and that type carries weight 0 in every flat mix
 * (paper.ts:320-329), so a shortened/exam-conditions paper routes 大問4 to other
 * 小問 shapes and never consults the reading store. The composed gate's only
 * learner-visible surface is therefore `real`. So this file asserts real-vs-real.
 *
 * The 3-state A/B below injects a synthetic `reading/n4.json` into a scratch data
 * dir via `MANOBU_DATA_DIR` + `resetCorpusCache`, because the point of those
 * cases is the provenance TAG and the shipped store carries exactly one. The
 * fixture never leaves the temp directory, so it fabricates nothing a learner
 * sees. The licensed paths copy the genuine vendored N5 store, so the A/B and the
 * N5 regression are real papers.
 *
 * TASK-173.9.6 (masked-slot pipeline): the shipped `data/reading/n4.json` now
 * carries 24 composed rows whose keys were CONSTRUCTED, not authored - one word
 * of an in-level Tatoeba sentence is blanked and that word is the key. The last
 * describe block copies that genuine store and asserts the inverse of the
 * zero-composed state: a real N4 paper fills 大問4 instead of reporting
 * contentExhausted. `check:reading-n4` (packages/japanese) is what proves those
 * rows; this test only proves they REACH a paper.
 */

const DB_URL = prepareContentDb("exam-composed-reading");

const DATA = join(import.meta.dir, "../../../packages/japanese/data");

// The 短文 block is 大問4 of N4 grammar-reading (paper.ts:518-525); the default
// budget stops at 文法1, so a walk that reaches 大問4 asks for the whole 35-slot
// section.
const N4_GRAMMAR_READING = 35;

const scratch = mkdtempSync(join(tmpdir(), "manobu-composed-reading-"));
const previousDataDir = process.env.MANOBU_DATA_DIR;

let client: ExamClient;

beforeAll(async () => {
  // A faithful corpus: the real vocab + grammar + licensed N5 reading, so the
  // only variable left is the N4 reading provenance tag.
  mkdirSync(join(scratch, "grammar"), { recursive: true });
  mkdirSync(join(scratch, "reading"), { recursive: true });
  for (const level of ["n5", "n4", "n3", "n2", "n1"]) {
    copyFileSync(join(DATA, `${level}.json`), join(scratch, `${level}.json`));
    copyFileSync(
      join(DATA, "grammar", `${level}.json`),
      join(scratch, "grammar", `${level}.json`)
    );
  }
  copyFileSync(
    join(DATA, "grammar", "conjugations.json"),
    join(scratch, "grammar", "conjugations.json")
  );
  copyFileSync(
    join(DATA, "reading", "n5.json"),
    join(scratch, "reading", "n5.json")
  );
  process.env.MANOBU_DATA_DIR = scratch;
  corpusTest.resetCorpusCache();
  client = makeExamClient(await createUserDb(DB_URL));
});

afterAll(() => {
  if (previousDataDir === undefined) {
    delete process.env.MANOBU_DATA_DIR;
  } else {
    process.env.MANOBU_DATA_DIR = previousDataDir;
  }
  corpusTest.resetCorpusCache();
  rmSync(scratch, { force: true, recursive: true });
});

/** One composed-style 短文 row: four options, a distinct passage so the
 * per-passage spend does not collapse the block, and the tag under test. */
const readingRow = (
  index: number,
  provenance: "composed" | "licensed",
  validated = false
) => ({
  answerIndex: 2,
  block: "naiyou-rikai-tanbun",
  id: `fixture-n4-${String(index)}`,
  level: "N4",
  options: ["てつだつ", "すてた", "わたした", "おとした"],
  passage: `この つくえの うえに はんこが 落ちて いました。だれが ${String(
    index
  )} おとしたのか、わかりません。`,
  provenance,
  stem: "はんこが どうしましたか。",
  // Only a composed row carries the flag; a licensed row's trust is its
  // provenance, so it never needs a judge sign-off.
  validated: provenance === "composed" ? validated : undefined,
});

const writeN4Store = (
  provenance: "composed" | "licensed",
  validated = false
): void => {
  writeFileSync(
    join(scratch, "reading", "n4.json"),
    JSON.stringify(
      [1, 2, 3, 4].map((index) => readingRow(index, provenance, validated))
    )
  );
  corpusTest.resetCorpusCache();
};

const buildN4Real = async (
  provenance: "composed" | "licensed",
  validated = false
) => {
  writeN4Store(provenance, validated);
  const requested = await client.exam.request({
    budget: { "grammar-reading": N4_GRAMMAR_READING },
    level: "N4",
    mode: "real",
    sections: ["grammar-reading"],
    seed: `composed-reading-${provenance}-${String(validated)}`,
  });
  const assembled = await client.exam.assemble({ examId: requested.examId });
  const state = await client.exam.get({ examId: requested.examId });
  return {
    assembled,
    shortItems: state.items.filter(
      (entry) => entry.item.itemType === "short-reading"
    ),
  };
};

describe("the composed-短文 refusal is provenance, not the fixture prose", () => {
  it("real mode refuses an UNvalidated composed 短文 and names its section", async () => {
    const { assembled, shortItems } = await buildN4Real("composed");
    // AC#1: no un-falsified composed reading crossed into a paper labeled real.
    expect(shortItems).toEqual([]);
    // AC#4: the refusal is reported, not silent. With an identical corpus the
    // licensed A/B below refuses nothing, so this section refusal is the
    // composed 短文 and nothing else.
    expect(assembled.refusedSections).toContain("grammar-reading");
  });

  it("real mode SERVES the SAME prose once a judge falsified it", async () => {
    // AC#2, the D1-flip: identical passages, options and stem, only the
    // `validated` flag set. The offline distractor-falsification pass is the
    // corpus-proof a composed row otherwise lacks, so `real` admits it. The
    // only difference from the refusing case above is that one flag.
    const { assembled, shortItems } = await buildN4Real("composed", true);
    expect(shortItems.length).toBeGreaterThan(0);
    expect(assembled.refusedSections).not.toContain("grammar-reading");
  });

  it("real mode serves the SAME prose tagged licensed", async () => {
    const { assembled, shortItems } = await buildN4Real("licensed");
    // The single-variable control: same passages, same options, same stem, only
    // the provenance tag differs. A licensed store row is trusted, so 大問4 fills.
    expect(shortItems.length).toBeGreaterThan(0);
    expect(assembled.refusedSections).not.toContain("grammar-reading");
  });
});

describe("the shipped composed N4 store fills a real paper", () => {
  it("real mode fills 大問4 from data/reading/n4.json and refuses nothing", async () => {
    // The genuine masked-slot store, not a fixture: these rows are served
    // because they are `composed` + `validated`, and their keys are the words
    // their source sentences actually print (proved by check:reading-n4, not
    // here). Before the pipeline shipped, this paper refused the section.
    copyFileSync(
      join(DATA, "reading", "n4.json"),
      join(scratch, "reading", "n4.json")
    );
    corpusTest.resetCorpusCache();
    const requested = await client.exam.request({
      budget: { "grammar-reading": N4_GRAMMAR_READING },
      level: "N4",
      mode: "real",
      sections: ["grammar-reading"],
      seed: "shipped-composed-n4",
    });
    const assembled = await client.exam.assemble({ examId: requested.examId });
    const state = await client.exam.get({ examId: requested.examId });
    const shortItems = state.items.filter(
      (entry) => entry.item.itemType === "short-reading"
    );
    expect(shortItems.length).toBeGreaterThan(0);
    expect(assembled.refusedSections).not.toContain("grammar-reading");
  });
});

describe("a licensed 短文 still answers a real paper (regression guard)", () => {
  it("real mode fills verbatim N5 reading and refuses nothing", async () => {
    // The shipped N5 store carries no `provenance`, so `shortReadingSourceFor`
    // reads it as `licensed` (`?? "licensed"`), and the composed branch never
    // fires. Pinning this keeps the gate from quietly turning the real N5 paper
    // short.
    const requested = await client.exam.request({
      level: "N5",
      mode: "real",
      sections: ["grammar-reading"],
      seed: "licensed-n5-real",
    });
    const assembled = await client.exam.assemble({ examId: requested.examId });
    const state = await client.exam.get({ examId: requested.examId });
    const shortItems = state.items.filter(
      (entry) => entry.item.itemType === "short-reading"
    );
    expect(shortItems.length).toBeGreaterThan(0);
    expect(assembled.refusedSections).not.toContain("grammar-reading");
  });
});
