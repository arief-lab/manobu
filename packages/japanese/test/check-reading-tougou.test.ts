/**
 * `check:reading-tougou` is pinned with real data assertions over fixtures
 * (objects and parsed reports), not source-text reads (TASK-134). A row the real
 * generator produces must pass the real gate; each defect the gate exists to
 * catch (a tampered passage, a distractor both documents print, a distractor
 * neither prints, a distractor the OTHER document paraphrases, a key the corpus
 * as a whole owns, a lost signature, a broken source link, a pair from one page,
 * a pair over the 合計600字程度 band) must be REJECTED with its own issue code.
 *
 * The fixtures go through `buildEntry`, so the generator and the gate cannot
 * drift apart: the same screens that make a row are the screens that hold it.
 */

import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkEntry,
  checkReadingFile,
  type TougouReadingEntry,
} from "../scripts/check-reading-tougou";
import { buildEntry } from "../scripts/gen-reading-tougou";
import { AUTHORED_SIGNER } from "../scripts/reading-authored-corpus";
import type { HakushoParagraph } from "../scripts/reading-chuubun-corpus";
import {
  buildVocabIndex,
  type VocabEntry,
  type VocabIndex,
} from "../scripts/reading-n4-corpus";
import {
  nounIndex,
  prepareTougouCorpus,
  TOUGOU_AUTHORED_BAND,
  TOUGOU_AUTHORED_MIN_INTENTS,
  TOUGOU_AUTHORED_STEMS,
  TOUGOU_MAX_TOTAL_LENGTH,
  TOUGOU_MIN_TOTAL_LENGTH,
  TOUGOU_SIGNER,
  TOUGOU_STEM,
  type TougouDocument,
} from "../scripts/reading-tougou-corpus";
import { identityRejectionTests } from "./reading-identity-suite";
import { vocabFixtureDir } from "./reading-store-fixture";

const VOCAB: readonly VocabEntry[] = [
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "てがみ",
    senses: [["letter"]],
    word: "手紙",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "でんわ",
    senses: [["telephone"]],
    word: "電話",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "ひよう",
    senses: [["cost"]],
    word: "費用",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "せいど",
    senses: [["system"]],
    word: "制度",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "かんきょう",
    senses: [["environment"]],
    word: "環境",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "せきにん",
    senses: [["responsibility"]],
    word: "責任",
  },
  // 原価 and 費用 carry the same dominant English sense, which is exactly the
  // shape a surface screen cannot see: two documents that print different kanji
  // for "cost" still both mention cost.
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "げんか",
    senses: [["cost"]],
    word: "原価",
  },
];

const INDEX: VocabIndex = buildVocabIndex(VOCAB);

const FILLER =
  "これはとてもながいぶんしょうでありまして、よみにくいところもありますが、さいごまでよんでください。".repeat(
    4
  );

const TEXT_A = `${FILLER}手紙を書く。電話をかける。原価が下がる。環境が良くなる。`;
const TEXT_B = `${FILLER}手紙が届く。責任が生じる。費用がかかる。制度が変わる。環境が良くなる。`;

const row = (id: string, pageId: string, text: string): HakushoParagraph => ({
  id,
  license: "PDL-1.0",
  pageId,
  pageUrl: `https://example.test/${pageId}`,
  source: `credit ${pageId}`,
  text,
  title: pageId,
});

const PARAGRAPHS: readonly HakushoParagraph[] = [
  row("a", "pa", TEXT_A),
  row("b", "pb", TEXT_B),
];

const CLEARING_DOCS: readonly TougouDocument[] = prepareTougouCorpus(
  PARAGRAPHS,
  INDEX,
  "N1"
);
const BY_NOUN = nounIndex(CLEARING_DOCS);

const [pair, other] = CLEARING_DOCS;
if (pair === undefined || other === undefined) {
  throw new Error("fixture documents must clear the corpus screens");
}

/** 費用 is deliberately NOT a distractor of the base row: A prints 原価, and the
 * two share the dominant English sense, so the paraphrase screen the gate re-runs
 * would refuse the fixture it is built from. It is the swapped-in option below. */
const selected = {
  a: pair,
  b: other,
  distractors: ["電話", "責任", "制度"],
  key: "手紙",
};

const base = buildEntry("N1", selected);
if (base === null) {
  throw new Error("fixture must produce a row");
}

const paragraphs = new Map(PARAGRAPHS.map((one) => [one.id, one]));

const check = (
  entry: TougouReadingEntry,
  rejections: ReadonlySet<string> = new Set(),
  sources: ReadonlyMap<string, HakushoParagraph> = paragraphs
): readonly string[] =>
  checkEntry({
    byNoun: BY_NOUN,
    clearingDocs: CLEARING_DOCS,
    entry,
    index: INDEX,
    level: "N1",
    paragraphs: sources,
    rejections,
  });

const withEntry = (
  overrides: Partial<TougouReadingEntry>
): TougouReadingEntry => ({
  ...base,
  ...overrides,
});

/** Tamper with one PRINTED option, named rather than slotted: the seeded draw
 * puts the answer wherever it draws it, so a test that said "the first
 * distractor" would be testing the draw rather than the screen. */
const replaceOption = (
  surface: string,
  replacement: string
): TougouReadingEntry =>
  withEntry({
    options: base.options.map((option) =>
      option === surface ? replacement : option
    ),
  });

describe("checkEntry: a valid generated row passes", () => {
  it("refuses a well-formed pair on routing alone", () => {
    // TASK-173.9.21 authored N1, the last level this route paired, so a clean
    // shared-topic pair now reports exactly one issue and it is the routing one.
    // The sourcing screens below still fire on a broken pair, which is what keeps
    // the lookup branch falsifiable rather than silently unreachable.
    expect(check(base)).toEqual(["construction-not-for-N1"]);
  });
});

describe("checkEntry: the sourcing screens", () => {
  it("rejects a tampered passage (it is no longer byte-equal to its source)", () => {
    expect(
      check(withEntry({ passages: [TEXT_A.replace("手紙", "郵便"), TEXT_B] }))
    ).toContain("passage-not-byte-equal-to-source");
  });

  it("rejects a row that does not cite two documents", () => {
    expect(check(withEntry({ sourceIds: [] }))).toContain("sourceIds-not-pair");
    expect(check(withEntry({ sourceIds: ["a"] }))).toContain(
      "sourceIds-not-pair"
    );
    expect(
      check(
        withEntry({ sourceCredits: ["c", "c"], sourceIds: ["missing", "b"] })
      )
    ).toContain("sourceId-unknown");
  });

  it("rejects provenance that was not copied from the source paragraphs", () => {
    expect(check(withEntry({ sourceUrls: ["x", "y"] }))).toContain(
      "sourceUrl-not-from-source-page"
    );
    expect(check(withEntry({ sourceCredits: ["x", "y"] }))).toContain(
      "sourceCredit-not-from-source"
    );
    expect(check(withEntry({ sourceCredits: ["credit pa"] }))).toContain(
      "source-provenance-not-pair"
    );
  });

  it("rejects two paragraphs from the same page", () => {
    const onePage = new Map(
      PARAGRAPHS.map((one) => [one.id, { ...one, pageId: "same" }])
    );
    expect(check(base, new Set(), onePage)).toContain("same-page-pair");
  });

  it("rejects a pair whose total is over the 合計600字程度 band", () => {
    const long = `${FILLER}手紙を書く。電話をかける。環境が良くなる。`.repeat(
      2
    );
    const sources = new Map<string, HakushoParagraph>([
      ["a", row("a", "pa", long)],
      ["b", row("b", "pb", long)],
    ]);
    const entry = withEntry({ passages: [long, long] });
    expect(check(entry, new Set(), sources)).toContain("pair-too-long");
  });
});

describe("checkEntry: the two-document option screens", () => {
  it("rejects a distractor BOTH documents print (a second defensible key)", () => {
    expect(check(replaceOption("電話", "環境"))).toContain(
      "distractor-in-both-documents"
    );
  });

  it("rejects a distractor NEITHER document prints", () => {
    expect(check(replaceOption("電話", "宇宙"))).toContain(
      "distractor-in-neither-document"
    );
  });

  it("rejects a key only one document prints", () => {
    expect(check(replaceOption("手紙", "電話"))).toContain(
      "key-not-printed-by-both"
    );
  });

  it("rejects a key the corpus as a whole owns, not this pair", () => {
    // 電話 belongs to one document only, so the pair-specificity screen refuses
    // it for a second, independent reason.
    expect(check(replaceOption("手紙", "電話"))).toContain(
      "key-not-pair-specific"
    );
  });

  it("rejects an option list that lost one of its three distractors", () => {
    // answerIndex is pinned to 0 so the answer slot stays inside the shortened
    // list: the defect under test is the missing distractor, not the index.
    expect(
      check(withEntry({ answerIndex: 0, options: ["手紙", "電話", "費用"] }))
    ).toContain("distractors-not-three");
  });

  it("rejects a distractor the other document paraphrases", () => {
    // 費用 is printed by B only, so it clears the presence screens, but A prints
    // 原価 and the vocabulary gives both the dominant English sense "cost". A
    // reader who says both documents mention cost is not wrong, so the row is not
    // a 小問. This is the residue a surface read cannot see, and it is why the
    // gate re-runs the paraphrase screen from `sourceIds` rather than trusting
    // the generator to have applied it.
    expect(check(replaceOption("電話", "費用"))).toContain(
      "distractor-paraphrased-in-other-document"
    );
  });

  it("screens only the distractors, never the key", () => {
    // A key both documents print is SUPPOSED to collide with the other side:
    // that is the construction. Moving the collision onto the answer slot must
    // not report the distractor screen.
    expect(check(replaceOption("手紙", "原価"))).not.toContain(
      "distractor-paraphrased-in-other-document"
    );
  });
});

describe("checkEntry: the construction contract", () => {
  const battery = { base, gate: check, tamper: withEntry };
  identityRejectionTests(battery);

  it("rejects a construction outside the family's two tags", () => {
    expect(check(withEntry({ construction: "authored-key" }))).toContain(
      "construction-unknown"
    );
  });

  it("rejects a shared-topic pair at a level whose route is authored", () => {
    // N1 prints the deterministic topic-lookup pair, N2 prints a written pair,
    // so a generated row has no route at N2 however well it screens.
    expect(
      checkEntry({
        byNoun: BY_NOUN,
        clearingDocs: CLEARING_DOCS,
        entry: base,
        index: INDEX,
        level: "N2",
        paragraphs,
        rejections: new Set(),
      })
    ).toContain("construction-not-for-N2");
  });

  it("rejects a stem that is not the fixed 統合理解 stem", () => {
    expect(
      check(withEntry({ stem: "この文章で筆者が最も主張していることはどれか" }))
    ).toContain("stem-not-tougou-stem");
  });

  it("rejects a missing sourceEn gloss", () => {
    expect(check(withEntry({ sourceEn: undefined }))).toContain(
      "sourceEn-missing"
    );
  });

  it("rejects a row filed under another block", () => {
    expect(check(withEntry({ block: "jouhou-kensaku" }))).toContain(
      "block-not-tougou"
    );
  });
});

/**
 * The authored branch (TASK-173.9.20 AC#3): a written PAIR with no 白書 window,
 * so the corpus screens above never run on it, and the claim contract INVERTS:
 * the key is the relation and is printed by neither document, while every
 * distractor is one thing the two texts really say and is printed by exactly one.
 * These tests are the evidence that the branch is a screen and not a
 * pass-through, and that the clean row passes with NO corpus and NO noun index.
 */
const TG_DOC_A =
  "市の図書館は午後九時まで開いている。開館時間を延ばした年は、夜の利用者が三万人増えたという報告書が出た。昼に働いていて昼間の図書館を使えない人が、その報告書の数字を埋めている。\n費用についても、延長分の光熱費は新規の蔵書購入より安いと館長は説明する。閉まる時間を決めるのは、使う人の都合ではかるべきだという考えが、この館の運営の基礎にある。市民が本を借りる通路として、開いている時間は短いより長いほうが役に立つ。";
const TG_DOC_B =
  "区の公民館は午後五時に閉まる。利用者からは、仕事を終えてから寄れる時間に開けてほしいという声が毎年出ている。しかし指定管理者は夜間の職員を置けず、空いている建物を使えないでいる。\n一方で、開館時間を延ばすと警備と照明の費用が増える。同じ費用で催しを一つ増やせるなら、と担当者は言い、時間延長の提案には応じていない。閉館後の建物は施錠され、放課後に子どもが寄る場所にもなっていないという指摘も、担当者の説明には現れない。";
const TG_EVIDENCE_A =
  "市民が本を借りる通路として、開いている時間は短いより長いほうが役に立つ。";
const TG_EVIDENCE_B =
  "しかし指定管理者は夜間の職員を置けず、空いている建物を使えないでいる。";
/** The relation, stated in words neither writer uses: the key of a 比較・統合 小問
 * is what the two documents have to be READ TOGETHER to produce. */
const TG_KEY =
  "建物が空いている時間は、市民が実際に使える時間にすべきだという考え方。";
/** Each distractor is a sentence ONE of the two documents really prints. */
const TG_FROM_A = "夜の利用者が三万人増えた";
const TG_FROM_A2 = "開いている時間は短いより長いほうが役に立つ";
const TG_FROM_B = "仕事を終えてから寄れる時間に開けてほしい";
const TG_SOURCE_EN =
  "What do the two writers share, or where do they part company?";

// A `Record<string, PassageBand>` read through a variable key, the shape the
// sibling tests use: a literal key is either unreachable for biome or possibly
// undefined for tsc.
const TG_N2_KEY: string = "N2";
const TG_N2_BAND = TOUGOU_AUTHORED_BAND[TG_N2_KEY] ?? { max: 0, min: 0 };

const authored = (
  overrides: Partial<TougouReadingEntry> = {}
): TougouReadingEntry => ({
  answerIndex: 0,
  block: "tougou-rikai",
  construction: "authored",
  evidence: [TG_EVIDENCE_A, TG_EVIDENCE_B],
  id: "tg-1",
  level: "N2",
  options: [TG_KEY, TG_FROM_A, TG_FROM_A2, TG_FROM_B],
  passages: [TG_DOC_A, TG_DOC_B],
  provenance: "composed",
  sourceEn: TG_SOURCE_EN,
  stem: TOUGOU_AUTHORED_STEMS[0]?.stem ?? "",
  validated: true,
  validatedBy: AUTHORED_SIGNER,
  ...overrides,
});

/** The written pair's own check: no corpus, no clearing docs, no noun index.
 * Nothing here reads `hakusho.jsonl`, which is the point. */
const checkWritten = (entry: TougouReadingEntry): readonly string[] =>
  checkEntry({
    byNoun: new Map(),
    clearingDocs: [],
    entry,
    index: INDEX,
    level: "N2",
    paragraphs: new Map(),
    rejections: new Set(),
  });

describe("checkEntry: an authored 統合 pair", () => {
  it("passes with no corpus in scope", () => {
    expect(checkWritten(authored())).toEqual([]);
  });

  it("keeps the fixture inside the bands it is tested against", () => {
    for (const passage of [TG_DOC_A, TG_DOC_B]) {
      const runes = [...passage].length;
      expect(runes).toBeGreaterThanOrEqual(TG_N2_BAND.min);
      expect(runes).toBeLessThanOrEqual(TG_N2_BAND.max);
    }
    const total = [...TG_DOC_A].length + [...TG_DOC_B].length;
    expect(total).toBeGreaterThanOrEqual(TOUGOU_MIN_TOTAL_LENGTH);
    expect(total).toBeLessThanOrEqual(TOUGOU_MAX_TOTAL_LENGTH);
  });

  it("refuses the pipeline signature on a written pair", () => {
    expect(checkWritten(authored({ validatedBy: TOUGOU_SIGNER }))).toContain(
      "validatedBy-not-authored-signer"
    );
    expect(checkWritten(authored({ validatedBy: undefined }))).toContain(
      "validatedBy-not-authored-signer"
    );
  });

  it("refuses a pair that lost its construction tag", () => {
    expect(checkWritten(authored({ construction: undefined }))).toContain(
      "construction-unknown"
    );
  });

  it("refuses a written pair filed at a level this block does not compose at", () => {
    // Since TASK-173.9.21 no level routes to the shared-topic pair, so the routing
    // arm is pinned at a level the table never names: N3 has no 統合理解 大問, falls
    // to the windowed construction by the fail-closed default, and a written pair
    // there is refused.
    expect(
      checkEntry({
        byNoun: BY_NOUN,
        clearingDocs: CLEARING_DOCS,
        entry: authored({ level: "N3" }),
        index: INDEX,
        level: "N3",
        paragraphs,
        rejections: new Set(),
      })
    ).toContain("construction-not-for-N3");
  });

  it("refuses a row that is not a pair", () => {
    expect(checkWritten(authored({ passages: [TG_DOC_A] }))).toContain(
      "passages-not-pair"
    );
  });

  it("refuses a pair the 大問 does not print", () => {
    // Two documents under the per-side floor drag the 合計 under 400 too, so the
    // pair band and the document band both speak.
    const short = authored({
      passages: ["短い一方だけ。".repeat(3), TG_DOC_B],
    });
    expect(checkWritten(short)).toEqual(
      expect.arrayContaining(["passage-too-short", "pair-too-short"])
    );
    // The band arithmetic makes the two ceilings agree at the top: 2 x 400 is the
    // 合計 ceiling, so a pair over 800 runes is necessarily one document over 400.
    const long = authored({
      passages: [`${TG_DOC_A}${"同じ話。".repeat(130)}`, TG_DOC_B],
    });
    expect(checkWritten(long)).toEqual(
      expect.arrayContaining(["passage-too-long", "pair-too-long"])
    );
  });

  it("refuses a key that either document prints", () => {
    // On the lookup route the key had to be in BOTH texts; here it is the
    // relation, so printing it in either one means the row asks for a copy.
    expect(
      checkWritten(
        authored({
          options: [TG_EVIDENCE_A, TG_FROM_A, TG_FROM_A2, TG_FROM_B],
        })
      )
    ).toContain("authored-key-printed-in-document:0");
  });

  it("refuses a distractor the two documents share, or neither states", () => {
    expect(
      checkWritten(
        authored({
          options: [TG_KEY, TG_FROM_A, TG_EVIDENCE_B, "午後"],
        })
      )
    ).toContain("distractor-in-both-documents");
    expect(
      checkWritten(
        authored({
          options: [TG_KEY, TG_FROM_A, TG_FROM_A2, "両方にもない話"],
        })
      )
    ).toContain("distractor-in-neither-document");
    expect(
      checkWritten(authored({ options: [TG_KEY, TG_FROM_A, TG_FROM_A2] }))
    ).toContain("distractors-not-three");
  });

  it("refuses a document that lost its own evidence span", () => {
    expect(checkWritten(authored({ evidence: undefined }))).toContain(
      "evidence-missing"
    );
    expect(
      checkWritten(
        authored({ evidence: [TG_EVIDENCE_A, "事実とは違う引用文。"] })
      )
    ).toContain("evidence-not-in-passage");
  });

  it("refuses a document that is a single sentence", () => {
    expect(
      checkWritten(
        authored({
          passages: [TG_DOC_A.replace("\n", ""), TG_DOC_B.replace("\n", "")],
        })
      )
    ).toContain("passage-single-paragraph");
  });

  it("refuses the lookup stem the authored route replaces", () => {
    expect(checkWritten(authored({ stem: TOUGOU_STEM }))).toContain(
      "stem-intent-unclassified"
    );
  });

  it("refuses a pair the judge recorded as ambiguous", () => {
    const written = authored();
    expect(
      checkEntry({
        byNoun: new Map(),
        clearingDocs: [],
        entry: written,
        index: INDEX,
        level: "N2",
        paragraphs: new Map(),
        rejections: new Set([written.id]),
      })
    ).toContain("row-judge-rejected");
  });
});

describe("checkReadingFile: the authored 統合 store", () => {
  /** A store dir with ONLY the vocab files: no `hakusho.jsonl`, so a walk that
   * still read the 白書 would throw rather than pass. */
  const writtenStore = (rows: readonly TougouReadingEntry[]): string => {
    const { storeDir } = vocabFixtureDir({
      prefix: "tougou-written-",
      vocab: VOCAB,
    });
    const storePath = join(storeDir, "n2-tougou.json");
    writeFileSync(storePath, JSON.stringify(rows), "utf8");
    return storePath;
  };

  const reportsOf = (rows: readonly TougouReadingEntry[]) => {
    const storePath = writtenStore(rows);
    return checkReadingFile({
      dataDir: join(storePath, "../.."),
      level: "N2",
      storePath,
    });
  };

  /** Three rows, three relations, three distinct pairs: the store spans every
   * 比較・統合 ask rather than printing one of them three times. */
  const spreadRows = (): TougouReadingEntry[] =>
    TOUGOU_AUTHORED_STEMS.map((relation, index) =>
      authored({
        id: `tg-${index + 1}`,
        passages: [`${TG_DOC_A}${"補足。".repeat(index)}`, TG_DOC_B],
        stem: relation?.stem ?? "",
      })
    );

  it("accepts a store that needs no corpus to be read", () => {
    expect(reportsOf(spreadRows()).flatMap((report) => report.issues)).toEqual(
      []
    );
  });

  it("refuses a store that asks one relation three times", () => {
    const oneStem = spreadRows().map((each) => ({
      ...each,
      stem: TOUGOU_AUTHORED_STEMS[0]?.stem ?? "",
    }));
    const fileReport = reportsOf(oneStem).find(
      (report) => report.entryId === "(file)"
    );
    expect(fileReport?.issues).toContain(
      `intents-below-floor:1<${TOUGOU_AUTHORED_MIN_INTENTS}`
    );
  });

  it("refuses a store too small to fill one real 大問", () => {
    const fileReport = reportsOf(spreadRows().slice(0, 1)).find(
      (report) => report.entryId === "(file)"
    );
    expect(fileReport?.issues).toContain("too-few-items:1<2");
  });
});
