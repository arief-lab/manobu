/**
 * `check:reading-chuushou` is pinned with REAL data assertions over fixtures
 * (objects and parsed reports), not source-text `readFileSync`/`toContain`
 * checks (TASK-134). A valid generated row must pass; each defect the gate
 * exists to catch (a tampered passage, a distractor printed in the source, a
 * lost signature, a lost validation flag, a judge rejection, a broken source
 * link, a wrong stem) must be REJECTED with its own issue code.
 *
 * The fixtures are built through the real generator (`buildEntry`) and then
 * checked through the real gate (`checkEntry`), so neither half can drift from
 * the other.
 */

import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ChuushouReadingEntry,
  checkEntry,
  checkReadingFile,
} from "../scripts/check-reading-chuushou";
import { buildEntry } from "../scripts/gen-reading-chuushou";
import { AUTHORED_SIGNER } from "../scripts/reading-authored-corpus";
import {
  CHUSHOU_AUTHORED_BAND,
  CHUSHOU_SIGNER,
  CHUSHOU_SOURCE_EN,
  CHUSHOU_STEM,
} from "../scripts/reading-chuushou-corpus";
import {
  BLANK,
  buildVocabIndex,
  type VocabEntry,
} from "../scripts/reading-n4-corpus";
import {
  identityRejectionTests,
  sourceLinkRejectionTest,
} from "./reading-identity-suite";
import { vocabFixtureDir } from "./reading-store-fixture";

const VOCAB: readonly VocabEntry[] = [
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "あめ",
    senses: [["rain"]],
    word: "雨",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "かぜ",
    senses: [["wind"]],
    word: "風",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "ゆき",
    senses: [["snow"]],
    word: "雪",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "てがみ",
    senses: [["letter"]],
    word: "手紙",
  },
];

const INDEX = buildVocabIndex(VOCAB);

/** Same filler as the generator test, so the source sentence is real and
 * recoverable. */
const FILLER =
  "これはとてもながいぶんしょうでありまして、よみにくいところもありますが、さいごまでよんでください。".repeat(
    6
  );

const SOURCE_TEXT = `${FILLER}雨が降る。`;

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
  "雨",
  ["風", "雪", "手紙"],
  INDEX
);

if (base === null) {
  throw new Error("fixture must produce a row");
}

const paragraphs = new Map<string, string>([["p1", SOURCE_TEXT]]);

const check = (
  entry: ChuushouReadingEntry,
  rejections: ReadonlySet<string> = new Set()
): readonly string[] =>
  checkEntry({
    entry,
    index: INDEX,
    level: "N1",
    paragraphs,
    rejections,
  });

const withEntry = (
  overrides: Partial<ChuushouReadingEntry>
): ChuushouReadingEntry => ({ ...base, ...overrides });

describe("checkEntry: a valid generated row passes", () => {
  it("refuses a well-formed window on routing alone", () => {
    // TASK-173.9.21 authored N1, so the one-paragraph `authored-key` window this
    // route built is refused at the last level that used it. The routing issue is
    // the only one a clean row raises, and every screen under it still runs: the
    // defect tests below name what the branch still decides.
    expect(check(base)).toEqual(["construction-not-for-N1"]);
  });
});

describe("checkEntry: the construction defects it exists to catch", () => {
  it("rejects a tampered passage (it is no longer byte-equal to the source)", () => {
    const tampered = withEntry({
      passage: SOURCE_TEXT.replace("雨が降る", "風が降る"),
    });
    expect(check(tampered)).toContain("passage-not-byte-equal-to-source");
  });

  it("rejects a distractor printed in the source", () => {
    // Swap the distractors for a word the source prints: a second defensible
    // answer the learner can simply read off the page.
    const { answerIndex } = base;
    const swapped = base.options.map((option, index) =>
      index === answerIndex ? option : "降る"
    );
    expect(check(withEntry({ options: swapped }))).toContain(
      "distractor-occurs-in-source"
    );
  });

  it("rejects a claim the source does not print", () => {
    const { answerIndex } = base;
    const swapped = base.options.map((option, index) =>
      index === answerIndex ? "雷" : option
    );
    expect(check(withEntry({ options: swapped }))).toContain(
      "claim-not-in-source"
    );
  });

  const battery = { base, gate: check, tamper: withEntry };
  identityRejectionTests(battery);
  sourceLinkRejectionTest(battery);

  it("rejects a row whose stem is not the fixed 主張理解 stem", () => {
    expect(
      check(
        withEntry({
          stem: "この文章の＿＿に入る語として、最も適切なものを一つ選びなさい。",
        })
      )
    ).toContain("stem-not-chuushou-stem");
  });

  it("rejects a missing sourceEn field", () => {
    expect(check(withEntry({ sourceEn: undefined }))).toContain(
      "sourceEn-missing"
    );
  });

  it("rejects a construction outside the family's two tags", () => {
    expect(check(withEntry({ construction: "maskedslot" }))).toContain(
      "construction-unknown"
    );
  });

  it("rejects a 白書 window at a level whose route is authored", () => {
    // The SOURCE table decides the route: N1 prints 白書 windows, N2 prints
    // written rows. A generated row cannot be served at N2 by re-proving the
    // windowed screens, because that is not the 大問 the level trains.
    expect(
      checkEntry({
        entry: base,
        index: INDEX,
        level: "N2",
        paragraphs,
        rejections: new Set(),
      })
    ).toContain("construction-not-for-N2");
  });
});

/**
 * The authored branch (TASK-173.9.20 AC#2): a written 主張理解 長文 with no 白書
 * window, so none of the corpus screens above run on it. These tests are the
 * evidence that the branch is a screen and not a pass-through: every defect the
 * shape can express has to be named, and the clean row has to pass with NO 白書
 * corpus and NO spent set in scope.
 */
const SH_P1 =
  "地方の大学が教学機能を都市部のキャンパスに移し始める動きが、この十年で目に見える形になった。入学志望者が減るなかで、立地の良い都会に校舎を構えれば募集は順調に進む、というのが導入側の説明である。実際、都市型の小さなキャンパスは三年で応募者数を二倍にした例もあり、数字だけを見れば判断は簡単に見える。だがその数字は、所在を移した結果として町に何が残ったかを数えていない。";
const SH_P2 =
  "そもそも大学が何のためにそこに在るかを、この数字は測っていない。大学の建物は住民税と固定資産税を町に納め、学生が通う食堂と書店とアパートが町の家賃と商店の売上を支えている。移転が決まった年の翌月から、駅前の空き店舗が七件増えたという調査結果もある。学生が消えた町では、商店街の灯りが夜八時には消えると地域の人が語る。";
const SH_EVIDENCE = "大学が町を出れば、その町は二度と学生を取り戻せない。";
const SH_P3 = `反対する声もないわけではない。都心に出た方が学生の就職に有利だ、地方に残っても人材は結局出ていく、という意見は学内でも繰り返される。だが就職率が都市への移転で上がったという根拠は示されておらず、人材が流出した町に大学が戻った例もない。${SH_EVIDENCE}`;
const SH_P4 =
  "だから問うべきは、来年度の応募者が増えるかどうかではない。町と大学の関係は十年二十年で積み上がるものであり、一度切れば同じ費用では作り直せない。移転は校舎の引っ越しではなく、町から一つの制度を引き抜く行為として評価されるべきだ。所在地を選ぶ権利は大学にある。しかしその選択が町にどんな費用を払わせるかを、町が知る権利も同じ重さで扱われるべきである。町は大学を選べないが、大学は町を選べるという非対称を、黙って受け入れる理由はない。";
const SH_PASSAGE = [SH_P1, SH_P2, SH_P3, SH_P4].join("\n\n");

/** The key states the thesis in other words: `passage.includes(key)` is the
 * screen, so a copy of the printed sentence is refused as the lookup this route
 * exists to end. */
const SH_KEY =
  "大学のあるべき場所は、募集の増減ではなく町に払わせる費用ではかるべきだ。";
/** A real supporting detail, printed verbatim, which is what makes it a detail
 * and not the claim. */
const SH_DETAIL = "駅前の空き店舗が七件増えた";
/** The opposite of what the passage argues, and absent from it. */
const SH_REVERSED = "移転は校舎の引っ越しにすぎず、町の費用には影響しない。";
/** An objection the passage never raises. */
const SH_COUNTER = "町の商店は学生の存在に頼っていない。";

// A `Record<string, PassageBand>` read through a variable key, the same form the
// sibling tests use: a literal key is either unreachable for biome or possibly
// undefined for tsc.
const N2_KEY: string = "N2";
const N2_BAND = CHUSHOU_AUTHORED_BAND[N2_KEY] ?? { max: 0, min: 0 };

const authored = (
  overrides: Partial<ChuushouReadingEntry> = {}
): ChuushouReadingEntry => ({
  answerIndex: 0,
  block: "shuchou-rikai-choubun",
  construction: "authored",
  distractorReasons: ["detail-as-claim", "reversed-stance", "counter-position"],
  evidence: SH_EVIDENCE,
  id: "sh-1",
  level: "N2",
  options: [SH_KEY, SH_DETAIL, SH_REVERSED, SH_COUNTER],
  passage: SH_PASSAGE,
  provenance: "composed",
  sourceEn: CHUSHOU_SOURCE_EN,
  stem: CHUSHOU_STEM,
  validated: true,
  validatedBy: AUTHORED_SIGNER,
  ...overrides,
});

/** The authored row's own check: no corpus, no spent set. Nothing here reads
 * `hakusho.jsonl`, which is the point. */
const checkWritten = (entry: ChuushouReadingEntry): readonly string[] =>
  checkEntry({
    entry,
    index: INDEX,
    level: "N2",
    paragraphs: new Map(),
    rejections: new Set(),
  });

describe("checkEntry: an authored 主張 row", () => {
  it("passes with no corpus in scope", () => {
    expect(checkWritten(authored())).toEqual([]);
  });

  it("keeps the fixture inside the band it is tested against", () => {
    const runes = [...SH_PASSAGE].length;
    expect(runes).toBeGreaterThanOrEqual(N2_BAND.min);
    expect(runes).toBeLessThanOrEqual(N2_BAND.max);
  });

  it("refuses the pipeline signature on a written row", () => {
    expect(checkWritten(authored({ validatedBy: CHUSHOU_SIGNER }))).toContain(
      "validatedBy-not-authored-signer"
    );
    expect(checkWritten(authored({ validatedBy: undefined }))).toContain(
      "validatedBy-not-authored-signer"
    );
  });

  it("refuses a row that lost its construction tag", () => {
    // Untagged is unknown at the boundary, so a row can never switch itself onto
    // the branch with fewer screens by dropping the tag.
    expect(checkWritten(authored({ construction: undefined }))).toContain(
      "construction-unknown"
    );
  });

  it("refuses a written row filed at a level this block does not compose at", () => {
    // Since TASK-173.9.21 no level routes to the one-paragraph 白書 window, so the
    // routing arm is now pinned the other way: a level this table does not NAME at
    // all (N3 has no 主張理解 大問) falls to the windowed construction by the
    // fail-closed default, and a written row there has no route and no band.
    // Neither refusal is a pass.
    expect(
      checkEntry({
        entry: authored({ level: "N3" }),
        index: INDEX,
        level: "N3",
        paragraphs,
        rejections: new Set(),
      })
    ).toEqual(
      expect.arrayContaining([
        "construction-not-for-N3",
        "authored-band-unknown",
      ])
    );
  });

  it("refuses a written row that claims a source window or a slot", () => {
    expect(
      checkWritten(authored({ sourceIds: ["p1"], sourceUrl: "x" }))
    ).toContain("authored-row-carries-sourceIds");
    expect(
      checkWritten(
        authored({ passage: SH_PASSAGE.replace(SH_EVIDENCE, BLANK) })
      )
    ).toContain("authored-row-carries-blank");
  });

  it("refuses a passage that stopped being an argument", () => {
    // Two of the four paragraphs is the store this level shipped until now, and
    // the length falls under the 700-rune floor with it.
    expect(
      checkWritten(authored({ passage: [SH_P1, SH_P3].join("\n\n") }))
    ).toEqual(expect.arrayContaining(["passage-too-short"]));
    const oneLine = SH_PASSAGE.replaceAll("\n\n", "");
    expect(checkWritten(authored({ passage: oneLine }))).toContain(
      "passage-single-paragraph"
    );
  });

  it("refuses a key the passage prints verbatim", () => {
    // The claim term copied out of the text is the word lookup this route ends.
    expect(
      checkWritten(
        authored({
          options: [
            "学生が通う食堂と書店とアパート",
            SH_DETAIL,
            SH_REVERSED,
            SH_COUNTER,
          ],
        })
      )
    ).toContain("authored-claim-printed-in-passage");
  });

  it("refuses distractors without exactly one stated reason each", () => {
    expect(checkWritten(authored({ distractorReasons: undefined }))).toContain(
      "distractor-reasons-not-3"
    );
    expect(
      checkWritten(
        authored({ distractorReasons: ["detail-as-claim", "detail-as-claim"] })
      )
    ).toContain("distractor-reasons-not-3");
    expect(
      checkWritten(
        authored({
          distractorReasons: [
            "plausible",
            "reversed-stance",
            "counter-position",
          ],
        })
      )
    ).toContain("distractor-reason-unknown:plausible");
  });

  it("refuses a reason the printed text contradicts", () => {
    // A detail-as-claim the passage never says is an invented fact dressed as a
    // quote, and a reversed-stance the passage does print is a second defensible
    // answer the learner can read off the page.
    expect(
      checkWritten(
        authored({
          options: [SH_KEY, "町の図書館が閉館した", SH_REVERSED, SH_COUNTER],
        })
      )
    ).toContain("detail-claim-not-printed-in-passage");
    expect(
      checkWritten(
        authored({
          options: [
            SH_KEY,
            SH_DETAIL,
            "住民税と固定資産税を町に納め",
            SH_COUNTER,
          ],
        })
      )
    ).toContain("invented-option-printed-in-passage");
  });

  it("refuses a row whose evidence is missing, invented or the whole document", () => {
    expect(checkWritten(authored({ evidence: undefined }))).toContain(
      "evidence-missing"
    );
    expect(
      checkWritten(authored({ evidence: "所在地を選ぶ権利は大学にある。" }))
    ).toContain("evidence-too-short");
    expect(
      checkWritten(authored({ evidence: SH_PASSAGE.slice(0, 400) }))
    ).toContain("evidence-covers-whole-passage");
    expect(
      checkWritten(
        authored({
          evidence: "大学が町をでれば、その町は二度と学生を取り戻せない。",
        })
      )
    ).toContain("evidence-not-in-passage");
  });

  it("refuses a stem the block does not ask", () => {
    expect(
      checkWritten(
        authored({ stem: "この文章の内容に合っているものはどれか。" })
      )
    ).toContain("stem-intent-unclassified");
  });

  it("refuses a row the judge recorded as ambiguous", () => {
    const row = authored();
    expect(
      checkEntry({
        entry: row,
        index: INDEX,
        level: "N2",
        paragraphs: new Map(),
        rejections: new Set([row.id]),
      })
    ).toContain("row-judge-rejected");
  });
});

describe("checkReadingFile: the authored 主張 store", () => {
  /** A store dir with ONLY the vocab files a written store needs: no
   * `hakusho.jsonl` at all, so a walk that still tried to read the 白書 would
   * throw rather than pass. */
  const writtenStore = (rows: readonly ChuushouReadingEntry[]): string => {
    const { storeDir } = vocabFixtureDir({
      prefix: "chuushou-written-",
      vocab: VOCAB,
    });
    const storePath = join(storeDir, "n2-chuushou.json");
    writeFileSync(storePath, JSON.stringify(rows), "utf8");
    return storePath;
  };

  const reportsOf = (rows: readonly ChuushouReadingEntry[]) => {
    const storePath = writtenStore(rows);
    return checkReadingFile({
      dataDir: join(storePath, "../.."),
      level: "N2",
      storePath,
    });
  };

  /** Three rows, three distinct documents, the same fixed stem: one N2 大問13's
   * worth, and all three failure modes present. */
  const spreadRows = (): ChuushouReadingEntry[] =>
    [0, 1, 2].map((index) =>
      authored({
        id: `sh-${index + 1}`,
        options: [`${SH_KEY}${index}`, SH_DETAIL, SH_REVERSED, SH_COUNTER],
        passage: `${SH_PASSAGE}${"補足する。".repeat(index)}`,
      })
    );

  it("accepts a store that needs no corpus to be read", () => {
    expect(reportsOf(spreadRows()).flatMap((report) => report.issues)).toEqual(
      []
    );
  });

  it("refuses a store that names one failure mode three times", () => {
    const oneReason = spreadRows().map((row) => ({
      ...row,
      distractorReasons: [
        "detail-as-claim",
        "detail-as-claim",
        "detail-as-claim",
      ],
    }));
    const fileReport = reportsOf(oneReason).find(
      (report) => report.entryId === "(file)"
    );
    expect(fileReport?.issues).toContain("distractor-reasons-below-floor:1<3");
  });

  it("refuses a store too small to fill one real 大問", () => {
    const fileReport = reportsOf(spreadRows().slice(0, 2)).find(
      (report) => report.entryId === "(file)"
    );
    expect(fileReport?.issues).toContain("too-few-items:2<3");
  });
});
