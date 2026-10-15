/**
 * `check:reading-tanbun` is pinned with real data assertions over fixtures, not
 * source-text reads (TASK-134). The valid row is built by the REAL generator
 * (`buildEntry`) and proven by the REAL gate (`checkEntry`), so the two halves
 * cannot drift apart, and every defect the gate exists to catch must come back
 * with its own issue code: a tampered blank, a distractor the source prints, a
 * lost signature, a lost validation flag, a judge rejection, a paragraph another
 * store already spends, a passage outside the 短文 band, a broken source link,
 * and a frame the corpus licenses a second noun in.
 */

import { describe, expect, it } from "bun:test";
import {
  checkEntry,
  type TanbunReadingEntry,
} from "../scripts/check-reading-tanbun";
import { buildEntry } from "../scripts/gen-reading-tanbun";
import {
  TANBUN_MAX_PASSAGE_LENGTH,
  TANBUN_MIN_PASSAGE_LENGTH,
} from "../scripts/reading-tanbun-corpus";
import { frameKeyOfAnswer } from "./reading-frame-fixture";
import {
  identityRejectionTests,
  sourceLinkRejectionTest,
} from "./reading-identity-suite";
import { INDEX } from "./reading-noun-vocab";

/** Four copies of the 49-rune sentence is 196 runes: above the 短文 floor and
 * under the server's 240-rune `short-reading` cap, so the fixture is a 短文 row
 * rather than a 中文 row that happens to be short. */
const FILLER =
  "これはとてもながいぶんしょうでありまして、よみにくいところもありますが、さいごまでよんでください。".repeat(
    4
  );

const SOURCE_TEXT = `${FILLER}電車が降る。`;

const base = buildEntry(
  {
    id: "p1",
    license: "PDL-1.0",
    pageId: "t",
    pageUrl: "https://example.test/",
    source: "credit",
    text: SOURCE_TEXT,
    title: "t",
  },
  "/nonexistent",
  "N1",
  INDEX,
  new Map()
);

if (base === null) {
  throw new Error("fixture must produce a 短文 row");
}

const paragraphs = new Map<string, string>([["p1", SOURCE_TEXT]]);

const check = (
  entry: TanbunReadingEntry,
  rejections: ReadonlySet<string> = new Set(),
  spent: ReadonlySet<string> = new Set()
): readonly string[] =>
  checkEntry({
    entry,
    fillers: new Map(),
    index: INDEX,
    level: "N1",
    paragraphs,
    rejections,
    spent,
  });

const withEntry = (
  overrides: Partial<TanbunReadingEntry>
): TanbunReadingEntry => ({
  ...base,
  ...overrides,
});

describe("checkEntry: a valid generated row passes", () => {
  it("refuses a well-formed window on routing alone", () => {
    // TASK-173.9.21 authored N1, the last level this route built, so the routing
    // refusal is now the only issue a clean window can raise. Every screen below
    // still fires when the row is broken, which is what keeps the branch
    // falsifiable rather than dead: the one-issue list IS the proof.
    expect(check(base)).toEqual(["construction-not-for-N1"]);
  });

  it("keeps the fixture inside the band it is tested against", () => {
    const runes = [...base.passage].length;
    expect(runes).toBeGreaterThanOrEqual(TANBUN_MIN_PASSAGE_LENGTH);
    expect(runes).toBeLessThanOrEqual(TANBUN_MAX_PASSAGE_LENGTH);
  });
});

describe("checkEntry: the construction defects it exists to catch", () => {
  it("rejects a tampered blank (the answer no longer restores the source)", () => {
    const tampered = withEntry({ passage: base.passage.replace("＿＿", "風") });
    expect(check(tampered)).toContain("passage-not-restorable-to-source");
  });

  it("rejects a distractor printed in the source", () => {
    const swapped = base.options.map((option, index) =>
      index === base.answerIndex ? option : "降る"
    );
    expect(check(withEntry({ options: swapped }))).toContain(
      "distractor-occurs-in-source"
    );
  });

  const battery = { base, gate: check, tamper: withEntry };
  identityRejectionTests(battery);
  sourceLinkRejectionTest(battery);

  it("rejects a paragraph another store already prints", () => {
    // The same screen the generator runs: a 中文, 主張理解, 統合理解 or other-level
    // 短文 row that spends this paragraph means one paper would show the text
    // twice, so the 短文 row is refused.
    expect(check(base, new Set(), new Set(["p1"]))).toContain(
      "source-spent-by-another-store"
    );
  });

  it("rejects a passage outside the 短文 band on either side", () => {
    const tooLong = withEntry({
      passage: `${".".repeat(10)}${"あ".repeat(TANBUN_MAX_PASSAGE_LENGTH)}＿＿だ。`,
    });
    expect(check(tooLong)).toContain("passage-too-long");
    const tooShort = withEntry({ passage: "短い＿＿文。" });
    expect(check(tooShort)).toContain("passage-too-short");
  });

  it("rejects a row stamped for another 大問", () => {
    expect(check(withEntry({ block: "naiyou-rikai-chuubun" }))).toContain(
      "block-not-tanbun"
    );
  });

  it("rejects a slot whose frame the corpus licenses another noun in", () => {
    const answer = base.options[base.answerIndex] as string;
    const key = frameKeyOfAnswer({
      answer,
      index: INDEX,
      sourceText: SOURCE_TEXT,
    });
    const fillers = new Map<string, ReadonlySet<string>>([
      [key, new Set([answer, "風"])],
    ]);
    expect(
      checkEntry({
        entry: base,
        fillers,
        index: INDEX,
        level: "N2",
        paragraphs,
        rejections: new Set(),
        spent: new Set(),
      })
    ).toContain("answer-frame-ambiguous");
  });

  it("rejects a construction outside the family's two tags", () => {
    expect(check(withEntry({ construction: "authored-key" }))).toContain(
      "construction-unknown"
    );
  });

  it("rejects a 白書 window at a level whose route is authored", () => {
    // `TANBUN_SOURCE` is the route: N1 masks a 白書 noun, N2/N3/N4 write the
    // sentence and have it judged. The masked row this level shipped before
    // TASK-173.9.20 therefore has no route at N2, and re-proving its screens
    // is not the ねらい the level owes.
    expect(
      checkEntry({
        entry: base,
        fillers: new Map(),
        index: INDEX,
        level: "N2",
        paragraphs,
        rejections: new Set(),
        spent: new Set(),
      })
    ).toContain("construction-not-for-N2");
  });
});
