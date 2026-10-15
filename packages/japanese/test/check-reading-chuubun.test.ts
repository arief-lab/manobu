/**
 * `check:reading-chuubun` is pinned with REAL data assertions over fixtures
 * (objects and parsed reports), not source-text `readFileSync`/`toContain`
 * checks (TASK-134). A valid generated row must pass; each defect the gate
 * exists to catch (a tampered blank, a distractor printed in the source, a lost
 * signature, a lost validation flag, a judge rejection, a broken source link)
 * must be REJECTED with its own issue code.
 *
 * The fixtures are built through the real generator (`buildEntry`,
 * `buildStitchedEntry`) and then checked through the real gate (`checkEntry`), so
 * neither half can drift from the other.
 */

import { describe, expect, it } from "bun:test";
import {
  type ChuubunReadingEntry,
  checkEntry,
} from "../scripts/check-reading-chuubun";
import { buildEntry, buildStitchedEntry } from "../scripts/gen-reading-chuubun";
import { PASSAGE_BAND } from "../scripts/reading-chuubun-corpus";
import {
  blankedPassage,
  type SourceSentence,
} from "../scripts/reading-n4-corpus";
import { frameKeyOfAnswer } from "./reading-frame-fixture";
import {
  identityRejectionTests,
  sourceLinkRejectionTest,
} from "./reading-identity-suite";
import { INDEX } from "./reading-noun-vocab";
import { stitchKey, stitchSentences } from "./reading-stitch-fixture";

const FILLER =
  "これはとてもながいぶんしょうでありまして、よみにくいところもありますが、さいごまでよんでください。".repeat(
    6
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
  throw new Error("fixture must produce a row");
}

const paragraphs = new Map<string, string>([["p1", SOURCE_TEXT]]);

const check = (
  entry: ChuubunReadingEntry,
  rejections: ReadonlySet<string> = new Set(),
  // TASK-173.9.21 closed the last windowed level: `CHUUBUN_SOURCE` is `authored`
  // at N1-N4 and N5 is licensed, so a masked-slot fixture is refused on routing
  // wherever it is gated. The fixtures stay at N1 because the screens UNDER the
  // routing check still run, which is what keeps this branch falsifiable (the same
  // shape TASK-173.9.19 set for the stitch): every `toContain` below is a corpus
  // screen firing, not a routing complaint.
  level = "N1"
): readonly string[] =>
  checkEntry({
    entry,
    fillers: new Map(),
    index: INDEX,
    level,
    paragraphs,
    rejections,
  });

const withEntry = (
  overrides: Partial<ChuubunReadingEntry>
): ChuubunReadingEntry => ({ ...base, ...overrides });

describe("checkEntry: a valid generated row passes", () => {
  it("reports no issues but the routing refusal", () => {
    // Every masked-slot screen below fires only when the row is broken, and a
    // well-formed row now reports exactly one issue: the level it is gated at is
    // authored (TASK-173.9.21). That single difference is the proof that the
    // restore-to-source screens still ran and found nothing else to say.
    expect(check(base)).toEqual(["construction-not-for-N1"]);
  });
});

describe("checkEntry: the construction defects it exists to catch", () => {
  it("rejects a tampered blank (the answer no longer restores the source)", () => {
    const tampered = withEntry({
      passage: base.passage.replace("＿＿", "風"),
    });
    expect(check(tampered)).toContain("passage-not-restorable-to-source");
  });

  it("rejects a distractor printed in the source", () => {
    // Swap a distractor for a word the passage prints: a second defensible
    // answer the learner can simply read off the page.
    const { answerIndex } = base;
    const swapped = base.options.map((option, index) =>
      index === answerIndex ? option : "降る"
    );
    expect(check(withEntry({ options: swapped }))).toContain(
      "distractor-occurs-in-source"
    );
  });

  const battery = { base, gate: check, tamper: withEntry };
  identityRejectionTests(battery);
  sourceLinkRejectionTest(battery);

  it("rejects a slot whose frame the corpus licenses another noun in", () => {
    // The frame of 電車 holds exactly ONE noun corpus-wide for the valid row.
    // Feeding a fillers map that adds 風 to that same frame is exactly what the
    // real corpus does when another sentence fills the frame with a second noun:
    // the blank is then not decided by the passage alone.
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
        level: "N1",
        paragraphs,
        rejections: new Set(),
      })
    ).toContain("answer-frame-ambiguous");
  });
});

/* ---------------------------------------------------------------------------
 * The `stitched-in-level` arms (TASK-173.9.15). A stitch changes three things
 * the gate has to keep up with: its source is the concatenation of the SENTENCES
 * it cites (not one paragraph), its passage is judged against ITS band, and the
 * document has to share a noun. Each is a proof the masked-slot path never runs,
 * so each gets its own refusal. The generator test reads the same document from
 * ./reading-stitch-fixture, so the two halves fail on identical bytes.
 * ------------------------------------------------------------------------- */

const stitchedSentences = stitchSentences();
stitchKey(stitchedSentences);

const stitched = buildStitchedEntry("手紙", stitchedSentences, "N4", INDEX);

if (stitched === null) {
  throw new Error("stitch fixture must produce a row");
}

const KEY = stitched.options[stitched.answerIndex] as string;

const sentenceMap = (
  sentences: readonly SourceSentence[]
): Map<string, SourceSentence> =>
  new Map(
    sentences.map((sentence): [string, SourceSentence] => [
      sentence.id,
      sentence,
    ])
  );

const stitchedMap = sentenceMap(stitchedSentences);

const checkStitched = (
  entry: ChuubunReadingEntry,
  sentences: ReadonlyMap<string, SourceSentence> = stitchedMap
): readonly string[] =>
  checkEntry({
    entry,
    fillers: new Map(),
    index: INDEX,
    level: "N4",
    paragraphs: new Map(),
    rejections: new Set(),
    sentences,
  });

/** The valid row re-sourced onto another document: same key, same options, same
 * signature, so the text under proof is the only thing that differs. */
const resourced = (
  sentences: readonly SourceSentence[]
): ChuubunReadingEntry => {
  const source = sentences.map((sentence) => sentence.jp).join("");
  const passage = blankedPassage(
    { en: "", id: stitched.id, jp: source, linkedWords: [] },
    KEY,
    PASSAGE_BAND["stitched-in-level"].max
  );
  if (passage === null) {
    throw new Error("fixture document must carry the key once");
  }
  return { ...stitched, passage, sourceIds: sentences.map((s) => s.id) };
};

describe("checkEntry: the stitched-in-level source", () => {
  // TASK-173.9.19 closed the stitch: `CHUUBUN_SOURCE.N4` is `authored`, so no
  // composed level routes to a stitched row any more and every row below is
  // refused on routing FIRST. The routing issue is kept in each expectation rather
  // than stripped out, because the screens underneath still run: this block now
  // pins both halves of the fail-closed table, and the stitch's own screens stay
  // covered until TASK-173.9.22 decides whether the construction is deleted.
  it("refuses a stitched row at N4 even when the stitch itself is well formed", () => {
    expect(checkStitched(stitched)).toEqual(["construction-not-for-N4"]);
  });

  it("refuses a stitch that cites a sentence the corpus does not have", () => {
    const cited = stitched.sourceIds ?? [];
    const missing = new Map(stitchedMap);
    missing.delete(cited.at(-1) as string);
    expect(checkStitched(stitched, missing)).toContain("sourceId-unknown");
  });

  it("refuses a one-sentence stitch", () => {
    // One sentence is a 短文体 under a 中文 id, and the row would be claiming a
    // 450字 document it cannot show.
    expect(
      checkStitched({
        ...stitched,
        sourceIds: [(stitched.sourceIds ?? [])[0] as string],
      })
    ).toContain("sourceIds-not-stitched");
  });

  it("measures the difficulty of the document, not only of a 白書 paragraph", () => {
    // 手紙 everywhere, the band full, the key printed once: every masked-slot
    // screen passes and none of the prose is on the list. The N4 floor is what
    // refuses it.
    const noisy: SourceSentence[] = Array.from(
      { length: 25 },
      (_, index): SourceSentence => ({
        en: "",
        id: `x${String(index)}`,
        jp:
          index === 12
            ? `手紙は${KEY}のそばにありました。`
            : "手紙を漢字漢字漢字漢字漢字漢字漢字漢字。",
        linkedWords: [],
      })
    );
    expect(checkStitched(resourced(noisy), sentenceMap(noisy))).toEqual([
      "construction-not-for-N4",
      "source-coverage-too-low",
    ]);
  });

  it("refuses a stitch whose sentences share no noun", () => {
    // The coherence claim, measured: gathering statements about different
    // participants is a list, and no 中文 大問 prints one.
    const broken: SourceSentence[] = stitchedSentences.map(
      (sentence, index): SourceSentence =>
        index < 12
          ? sentence
          : { ...sentence, jp: sentence.jp.replace("手紙", "てがみ") }
    );
    expect(checkStitched(resourced(broken), sentenceMap(broken))).toEqual([
      "construction-not-for-N4",
      "stitched-topic-not-shared",
    ]);
  });
});

describe("checkEntry: the construction decides the proof", () => {
  it("refuses a row whose construction the level's corpus does not back", () => {
    // A stitch claiming the 白書 proof, and a 白書 row claiming the stitch's:
    // both would be a level volunteering for the easier corpus.
    expect(
      checkStitched({ ...stitched, construction: "masked-slot" })
    ).toContain("construction-not-for-N4");
    expect(check(withEntry({ construction: "stitched-in-level" }))).toContain(
      "construction-not-for-N1"
    );
  });

  it("refuses a 白書 window at a level whose source is authored", () => {
    // TASK-173.9.20 moved N2 中文 to the authored route, so the level no longer
    // backs a 白書 window AT ALL: a row that passes every masked-slot screen is
    // still refused, because the store the server assembles at N2 prints written
    // passages and a windowed row cannot mix into it.
    expect(check(withEntry({ level: "N2" }), new Set(), "N2")).toContain(
      "construction-not-for-N2"
    );
  });

  it("refuses a row whose construction the gate does not know", () => {
    // JSON is unknown at the boundary: with no construction there is no source
    // table to resolve against, so the row gets no stronger proof than a field
    // report.
    expect(checkStitched({ ...stitched, construction: undefined })).toContain(
      "construction-unknown"
    );
  });

  it("judges the passage against the band its own construction prints under", () => {
    // The 白書 band is 200..1200 runes and the stitch's is 400..600, so a row is
    // measured against the band of the construction it claims, never against
    // whichever store file it shipped in.
    expect(PASSAGE_BAND["masked-slot"]).toEqual({ max: 1200, min: 200 });
    expect(PASSAGE_BAND["stitched-in-level"]).toEqual({ max: 600, min: 400 });
    expect(checkStitched({ ...stitched, passage: "あ".repeat(601) })).toContain(
      "passage-too-long"
    );
    expect(checkStitched({ ...stitched, passage: "あ".repeat(399) })).toContain(
      "passage-too-short"
    );
    // The same 399 runes sit inside the 白書 band.
    expect(check(withEntry({ passage: "あ".repeat(399) }))).not.toContain(
      "passage-too-short"
    );
  });
});
