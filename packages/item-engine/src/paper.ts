import { hashString, seededPermutation } from "./hash";
import { stimulusTexts } from "./stimuli";
import {
  ITEM_TYPES,
  type ItemCorpusView,
  type ItemRejectionReason,
  type ItemType,
  type ItemValidationResult,
  type OptionSource,
  type QuestionItem,
} from "./types";
import { validateQuestionItem } from "./validation";

export const PAPER_LEVELS = ["N5", "N4", "N3", "N2", "N1"] as const;
export type PaperLevel = (typeof PAPER_LEVELS)[number];

export const PAPER_MODES = ["real", "shortened", "exam-conditions"] as const;
export type PaperMode = (typeof PAPER_MODES)[number];

export const PAPER_SECTION_IDS = [
  "vocabulary",
  "grammar-reading",
  "listening",
  "language-knowledge-reading",
] as const;
export type PaperSectionId = (typeof PAPER_SECTION_IDS)[number];

export type PaperScoringSectionId =
  | "language-knowledge"
  | "reading"
  | PaperSectionId;

export type PaperBudget = Readonly<Partial<Record<PaperSectionId, number>>>;

export interface PaperTestSectionBlueprint {
  id: PaperSectionId;
  minutes: number;
  scoringSectionIds: readonly PaperScoringSectionId[];
}

export interface PaperScoringSectionBlueprint {
  cap: 60 | 120;
  id: PaperScoringSectionId;
  itemTypes?: readonly ItemType[];
  passMark: 19 | 38;
  sourceSectionIds: readonly PaperSectionId[];
}

export interface PaperBlueprint {
  level: PaperLevel;
  overallPassMark: 80 | 90 | 95 | 100;
  scoringSections: readonly PaperScoringSectionBlueprint[];
  sections: readonly PaperTestSectionBlueprint[];
  totalCap: 120 | 180;
}

const LANGUAGE_KNOWLEDGE_ITEM_TYPES = [
  // TASK-173.9.26: the official 得点区分 scores 文字語彙 (語形成) in 言語知識, so
  // a placed `compound-completion` 小問 must feed that band or it silently loses
  // its point (the N2 57/60 precedent TASK-173.9.23 hit with 用法).
  "compound-completion",
  "conjugation",
  // TASK-173.9.29: the official 得点区分 scores 文字語彙 (文脈規定) in 言語知識,
  // so a placed `context-cloze` 小問 must feed that band or it silently loses
  // its point (the N2 57/60 precedent TASK-173.9.23 hit with 用法). N4/N5 need
  // no entry: their bands carry no `itemTypes` filter at all.
  "context-cloze",
  "discourse-cloze",
  "grammar-form",
  "kanji-reading",
  "particle",
  // TASK-173.9.29 (found by the full real-paper probe): the official 得点区分
  // counts 文の組み立て in 言語知識（文字・語彙・文法）, but a placed
  // `star-ordering` 小問 belonged to NO band, so each real N1/N2/N3 paper lost
  // exactly its 5 組み立て 小問 from the banded result (language+reading column
  // totals came up 5 short of the asked items at all three levels).
  "star-ordering",
  // TASK-173.9.28: the whole-SENTENCE form of 言い換え類義 is still 文字語彙, so
  // an N4/N5 `sentence-paraphrase` 小問 feeds the same 言語知識 band as its N1-N3
  // sibling. Without the entry the band classifier drops the placed 小問 and the
  // paper loses its point (the N2 57/60 precedent TASK-173.9.23 hit with 用法).
  "sentence-paraphrase",
  // TASK-173.9.27: the official 得点区分 scores 文字語彙 (言い換え類義) in
  // 言語知識, so a placed `synonym-paraphrase` 小問 must feed that band or it
  // silently loses its point (the N2 57/60 precedent TASK-173.9.23 hit with 用法).
  "synonym-paraphrase",
  "usage",
  // TASK-173.9.25: the official 得点区分 scores 文字語彙 (表記) in 言語知識, so
  // a placed `word-spelling` 小問 must feed that band or it silently loses its
  // point (the N2 57/60 precedent TASK-173.9.23 hit with 用法).
  "word-spelling",
  "word-in-context",
] as const satisfies readonly ItemType[];

const READING_ITEM_TYPES = [
  // TASK-173.9.29: a real paper places its 読解 大問 as short/medium/long 内容理解,
  // 主張理解, 統合理解 and 情報検索 (PAPER_BLOCK_SHAPES). Until now this list held
  // only the two flat-mix types, so every 小問 of those 大問 belonged to NO band:
  // the 読解 floor never met (shortfall 0 yet ready=false) and the result columns
  // silently lost their points (the N2 57/60 precedent TASK-173.9.23 hit with 用法).
  // `reading-info` and `long-reading` stay: they are the flat-mix 読解 carriers.
  "claim-understanding",
  "info-search",
  "long-reading",
  "medium-reading",
  "reading-info",
  "short-reading",
  "text-comparison",
] as const satisfies readonly ItemType[];

export const PAPER_BLUEPRINTS = {
  N1: {
    level: "N1",
    overallPassMark: 100,
    scoringSections: [
      {
        cap: 60,
        id: "language-knowledge",
        itemTypes: LANGUAGE_KNOWLEDGE_ITEM_TYPES,
        passMark: 19,
        sourceSectionIds: ["language-knowledge-reading"],
      },
      {
        cap: 60,
        id: "reading",
        itemTypes: READING_ITEM_TYPES,
        passMark: 19,
        sourceSectionIds: ["language-knowledge-reading"],
      },
      {
        cap: 60,
        id: "listening",
        passMark: 19,
        sourceSectionIds: ["listening"],
      },
    ],
    sections: [
      {
        id: "language-knowledge-reading",
        minutes: 110,
        scoringSectionIds: ["language-knowledge", "reading"],
      },
      {
        id: "listening",
        minutes: 55,
        scoringSectionIds: ["listening"],
      },
    ],
    totalCap: 180,
  },
  N2: {
    level: "N2",
    overallPassMark: 90,
    scoringSections: [
      {
        cap: 60,
        id: "language-knowledge",
        itemTypes: LANGUAGE_KNOWLEDGE_ITEM_TYPES,
        passMark: 19,
        sourceSectionIds: ["language-knowledge-reading"],
      },
      {
        cap: 60,
        id: "reading",
        itemTypes: READING_ITEM_TYPES,
        passMark: 19,
        sourceSectionIds: ["language-knowledge-reading"],
      },
      {
        cap: 60,
        id: "listening",
        passMark: 19,
        sourceSectionIds: ["listening"],
      },
    ],
    sections: [
      {
        id: "language-knowledge-reading",
        minutes: 105,
        scoringSectionIds: ["language-knowledge", "reading"],
      },
      {
        id: "listening",
        minutes: 50,
        scoringSectionIds: ["listening"],
      },
    ],
    totalCap: 180,
  },
  N3: {
    level: "N3",
    overallPassMark: 95,
    // The official N3 得点区分 is the same three columns N1/N2 use:
    // 言語知識（文字・語彙・文法） / 読解 / 聴解. The 文法 questions live in the
    // 文法・読解 科目 but score into 言語知識, so this band sources across BOTH the
    // vocabulary and grammar-reading sections and keeps only the language types,
    // while 読解 takes the reading types out of grammar-reading. (TASK-173.13)
    scoringSections: [
      {
        cap: 60,
        id: "language-knowledge",
        itemTypes: LANGUAGE_KNOWLEDGE_ITEM_TYPES,
        passMark: 19,
        sourceSectionIds: ["vocabulary", "grammar-reading"],
      },
      {
        cap: 60,
        id: "reading",
        itemTypes: READING_ITEM_TYPES,
        passMark: 19,
        sourceSectionIds: ["grammar-reading"],
      },
      {
        cap: 60,
        id: "listening",
        passMark: 19,
        sourceSectionIds: ["listening"],
      },
    ],
    sections: [
      {
        id: "vocabulary",
        minutes: 30,
        scoringSectionIds: ["language-knowledge"],
      },
      {
        id: "grammar-reading",
        minutes: 70,
        scoringSectionIds: ["language-knowledge", "reading"],
      },
      {
        id: "listening",
        minutes: 40,
        scoringSectionIds: ["listening"],
      },
    ],
    totalCap: 180,
  },
  N4: {
    level: "N4",
    overallPassMark: 90,
    scoringSections: [
      {
        cap: 120,
        id: "language-knowledge",
        passMark: 38,
        sourceSectionIds: ["vocabulary", "grammar-reading"],
      },
      {
        cap: 60,
        id: "listening",
        passMark: 19,
        sourceSectionIds: ["listening"],
      },
    ],
    sections: [
      {
        id: "vocabulary",
        minutes: 25,
        scoringSectionIds: ["language-knowledge"],
      },
      {
        id: "grammar-reading",
        minutes: 55,
        scoringSectionIds: ["language-knowledge"],
      },
      {
        id: "listening",
        minutes: 35,
        scoringSectionIds: ["listening"],
      },
    ],
    totalCap: 180,
  },
  N5: {
    level: "N5",
    overallPassMark: 80,
    scoringSections: [
      {
        cap: 120,
        id: "language-knowledge",
        passMark: 38,
        sourceSectionIds: ["vocabulary", "grammar-reading"],
      },
      {
        cap: 60,
        id: "listening",
        passMark: 19,
        sourceSectionIds: ["listening"],
      },
    ],
    sections: [
      {
        id: "vocabulary",
        minutes: 20,
        scoringSectionIds: ["language-knowledge"],
      },
      {
        id: "grammar-reading",
        minutes: 40,
        scoringSectionIds: ["language-knowledge"],
      },
      {
        id: "listening",
        minutes: 30,
        scoringSectionIds: ["listening"],
      },
    ],
    totalCap: 180,
  },
} as const satisfies Record<PaperLevel, PaperBlueprint>;

/**
 * TASK-173.4 AC#1. One official 大問: what it is printed as, and which item
 * types may fill it. An empty `itemTypes` is a statement, not a gap in this
 * table: 表記 asks for the kanji spelling of a kana word, the 内容理解 and
 * 文の組み立て blocks need a whole passage the corpus items do not produce, and
 * every 聴解 block needs audio. Naming a block unfilled is what stops a real
 * paper quietly filling it with something else. 文脈規定 left that list under
 * TASK-173.5: a grammar example sentence can be blanked and the blank verified,
 * so the block now fills with `context-cloze`.
 */
interface PaperBlockShape {
  itemTypes: readonly ItemType[];
  name: string;
}

const PAPER_BLOCK_SHAPES = {
  // TASK-173.12: `conjugation` was removed. Its official ねらい is 文の内容に合った
  // 文法形式かどうかを判断する (judge which grammar form fits the （ ） in a sentence),
  // which only the sentence-blank `grammar-form` / `particle` ask. A `conjugation`
  // item is word material with no sentence and no blank, so it printed a second shape
  // under one instruction. It is not a `hyouki` (表記) item either: 表記 asks how ONE
  // kana word is written in kanji, while a conjugation item varies the inflection
  // across its options. So no `real` 大問 fits it today; it stays out of the block walk
  // and a real paper does not ask it. Its grammar-reading flat weight is unchanged, so
  // `shortened` still emits it. See `candidateStemFor` in the server.
  "bun-no-bunpou-1": {
    itemTypes: ["grammar-form", "particle"],
    name: "文の文法1（文法形式の判断）",
  },
  "bun-no-bunpou-2": {
    itemTypes: ["star-ordering"],
    name: "文の文法2（文の組み立て）",
  },
  "bunmi-kitei": { itemTypes: ["context-cloze"], name: "文脈規定" },
  // TASK-173.9.24: 文章の文法 is filled by `discourse-cloze`, one authored
  // passage with one ＿＿ and four candidate SENTENCES, answered from the per-level
  // store (`packages/japanese/data/reading/{level}-bunshou.json`). The ねらい is
  // 文章の流れに合った文かどうかを判断する (doc-26 §3), so the thing judged is
  // discourse coherence - connective, referent, tense - not the sentence-level
  // form a `usage` or `grammar-form` 小問 asks. Real mode only: `discourse-cloze`
  // carries weight 0 in every flat mix. A level with no store leaves this block
  // short and the real paper names the hole rather than fabricate (TASK-173.1);
  // all five levels now carry a store, the N4 and N5 legs being TASK-179.
  "bunshou-no-bunpou": {
    itemTypes: ["discourse-cloze"],
    name: "文章の文法",
  },
  "choukai-tougou-rikai": {
    // TASK-173.9.4.2: 聴解統合理解 is filled by `listening-choukai`. The
    // official ねらい (n2.pdf p.1) is 「長めのテキストを聞いて、複数の情報を
    // 比較・統合しながら、内容が理解できるかを問う」 and the sample paper's
    // directions (N2L.pdf 問題5) pin the granularity: ONE long dialogue heard
    // ONCE backs TWO 小問 (二つの質問), the one lawful case where the same
    // script re-airs inside one paper.
    itemTypes: ["listening-choukai"],
    name: "統合理解",
  },
  // TASK-173.9.4.1: 概要理解 is filled by `listening-gaiyou`, one heard
  // COHERENT TEXT (a longer monologue or dialogue) whose printed question asks
  // about the text as a whole - 話者の意図や主張 (n3.pdf p.1 ねらい), not one
  // point of it, which is what separates it from `listening-point`. Per-level
  // (`packages/japanese/data/reading/{level}-gaiyou.json`), real mode only,
  // `listening-gaiyou` weight 0 in every flat mix. Only N3-N1 print the 大問;
  // a level with no store leaves the block short and names the hole rather
  // than fabricate (TASK-173.1).
  "gaiyou-rikai": { itemTypes: ["listening-gaiyou"], name: "概要理解" },
  // TASK-173.9.26: 語形成 is filled by `compound-completion`, one authored
  // sentence printing a compound's fragment beside a （　） blank plus FOUR
  // SINGLE KANJI, exactly one of which completes the compound the sentence
  // means (the official shape measured from the 2018 N2V sample: 結婚（観）、
  // （高）水準、日本（式）、（未）使用; the wrong options are known kanji whose
  // completion with the fragment is attested as NO word - the two-answer guard
  // the 表記 walk carries, run blind because words like 幼稚舎/去昨日 exist while
  // absent from the band files). The store is per level
  // (`packages/japanese/data/reading/{level}-goseikei.json`), real mode only:
  // `compound-completion` carries weight 0 in every flat mix. Only N2 prints the
  // 大問 among the levels measured so far; a level with no store leaves the block
  // short and names the hole rather than fabricate (TASK-173.1).
  goseikei: { itemTypes: ["compound-completion"], name: "語形成" },
  // TASK-173.8.1: 場面対応表現, the best-response listening block. A short
  // situation is spoken; the learner picks the most appropriate thing to say.
  // Per-level (`packages/japanese/data/reading/{level}-hatsuwa.json`), real mode
  // only, `listening-hatsuwa` weight 0 in every flat mix.
  "hatsuwa-hyougen": { itemTypes: ["listening-hatsuwa"], name: "発話表現" },
  // TASK-173.9.25: 表記 is filled by `word-spelling`, one authored sentence that
  // prints one word in kana plus four spellings, exactly one of which writes that
  // word (the official shape measured from the 2018 sample papers: N5V/N4V
  // もんだい２ 「＿＿の ことばは どう かきますか。」, N3V/N2V 問題２ 「＿＿のことばを
  // 漢字で書くとき…」; the wrong options there are real words read DIFFERENTLY
  // (なみ → 池/湖/港, only 波 reads なみ) and fabricated component-mangled
  // spellings (まんぞく → 満続/万続/万足), never same-reading homophones). The
  // store is per level (`packages/japanese/data/reading/{level}-hyouki.json`),
  // real mode only: `word-spelling` carries weight 0 in every flat mix. A level
  // whose store is drained leaves this block short and names the hole (TASK-173.4).
  hyouki: { itemTypes: ["word-spelling"], name: "表記" },
  // TASK-173.9.27: 言い換え類義 is filled at N1/N2/N3 by `synonym-paraphrase`,
  // one authored sentence printing one 「　」-bracketed word plus FOUR
  // PARAPHRASES, exactly one of which keeps the sentence's meaning (the official
  // shape measured from the 2018 samples: N1 大問3 / N2 大問5 closest-meaning
  // word items; the wrong options are real words whose substitution the
  // sentence refuses - the two-answer guard the 表記 walk carries, run blind
  // because synonymy is a judgement, not a lookup). The store is per level
  // (`packages/japanese/data/reading/{level}-iikae.json`), real mode only:
  // `synonym-paraphrase` carries weight 0 in every flat mix.
  // TASK-173.9.28: the same 大問 at N4/N5 is a DIFFERENT SHAPE, not a thinner
  // store - the WHOLE sentence is underlined and all four options are complete
  // sentences (N4V.pdf p.6 れい にねんまえに きょうとへ 行きました → おととし
  // きょうとへ 行きました; N5V.pdf p.7 これは りょうしんの しゃしんです →
  // これは あねと いもうとの しゃしんです), so the block carries
  // `sentence-paraphrase` too and each level's blueprint ROW names the one form
  // it asks (`itemTypes` on PaperBlockRow). The official ねらい is the same
  // sentence at all five levels (n4_revised.pdf and n5_revised.pdf 文字・語彙 大問4
  // both read 出題される語や表現と意味的に近い語や表現を問う), which is why one block
  // hosts two shapes: the ねらい does not distinguish them, the paper's layout
  // does. A level whose store is missing leaves the block short and names the
  // hole rather than fabricate (TASK-173.1).
  "iikae-ruiji": {
    itemTypes: ["synonym-paraphrase", "sentence-paraphrase"],
    name: "言い換え類義",
  },
  // TASK-173.9.7: 情報検索 is filled by `info-search`, one question against one
  // 案内 / お知らせ document (a table of prices, a poster, a timetable) with four
  // Japanese options, from the per-level store
  // (`packages/japanese/data/reading/{level}-jouhou.json`). Real mode only:
  // `info-search` carries weight 0 in every flat mix. N5 asks 1 小問, N4/N3/N2/N1
  // ask 2. N5 is the licensed paper-7 set (CC BY-SA 4.0). N3 and N4 are AUTHORED
  // 書き下ろし 素材 in their own ねらい bands (TASK-173.9.18 and TASK-173.9.19):
  // they used to be that N5 set re-stamped downward, which was a ねらい problem
  // rather than a licence one, and the band a written 素材 must clear is what
  // keeps it from coming back (`JOUHOU_AUTHORED_BAND`). N2 and N1 are COMPOSED
  // PDL1.0 government 情報素材 (TASK-173.9.13, LICENSE §18), because no licensed
  // notice reaches a 大問 that asks 700字-grade material. Either way a level whose
  // file is missing leaves the block short and reports the hole rather than
  // fabricate a notice (TASK-173.1).
  "jouhou-kensaku": { itemTypes: ["info-search"], name: "情報検索" },
  // TASK-173.8.1: 聴解 fills the four N4/N5 listening blocks from per-level
  // spoken-scenario stores. 課題理解 is a dialogue the learner hears, one
  // comprehension question, four options; the store is per level
  // (`packages/japanese/data/reading/{level}-kadai.json`), real mode only,
  // `listening-kadai` weight 0 in every flat mix. A level whose store is drained
  // leaves the block short and names the hole (TASK-173.4).
  "kadai-rikai": { itemTypes: ["listening-kadai"], name: "課題理解" },
  "kanji-yomi": { itemTypes: ["kanji-reading"], name: "漢字読み" },
  // TASK-173.9.12: 内容理解（長文） is filled by `long-reading`. At N1 it is a
  // 900-1200 rune window of 2 to 5 CONSECUTIVE prose paragraphs from one pinned
  // 白書 page with one noun masked (`packages/japanese/data/reading/n1-choubun.json`,
  // screened at this block's own 0.85 coverage floor — see
  // `packages/japanese/scripts/reading-choubun-corpus.ts` for the official
  // sample-paper measurement that derives it). At N3 it is an AUTHORED 500-700
  // rune 大問 read whole, with the 小問 asking a 長文 ねらい in its stem and no
  // blank (`reading/n3-choubun.json`, TASK-173.9.16): doc-27 §10 measured the
  // official N3 長文 text itself at 88.9% under that coverage instrument, so a
  // floor cannot be cleared at that level and the 大問 was closed by writing
  // instead of sourcing. Real mode only for THIS block: `long-reading` keeps
  // weight 20 in the N1 `language-knowledge-reading` and N3 `grammar-reading`
  // flat mixes of `PAPER_ITEM_TYPE_WEIGHTS_V2`, and those papers still print the
  // canned passage, because a flat mix allocates item types directly and never
  // consults block shapes.
  "naiyou-rikai-choubun": {
    itemTypes: ["long-reading"],
    name: "内容理解（長文）",
  },
  // TASK-173.9.2: 内容理解（中文） is filled by `medium-reading`, a sourced
  // multi-sentence passage with four Japanese options
  // (`packages/japanese/data/reading/{level}-chuubun.json`). Two constructions
  // share that one file: N2/N1 print a 白書 paragraph with a masked slot, and N3
  // and N4 print an AUTHORED whole passage whose 小問 asks a 内容理解 ねらい in
  // its stem (TASK-173.9.18 and TASK-173.9.19, which replaced N3's masked slot and
  // N4's stitched sentences). N5 is licensed. Real mode only: `medium-reading`
  // carries weight 0 in every flat mix, so a `shortened`/daily paper never emits
  // it. A level with no passage leaves this block short and the real paper refuses
  // rather than fabricate (TASK-173.1).
  "naiyou-rikai-chuubun": {
    itemTypes: ["medium-reading"],
    name: "内容理解（中文）",
  },
  // TASK-173.7: 内容理解（短文） is filled by `short-reading`, a short passage
  // with a Japanese stem and four Japanese options, drawn from the per-level
  // reading store (`packages/japanese/data/reading/{level}.json`). The store is
  // licensed at N5 (a real comprehension question) and composed above it: N3 and
  // N4 print AUTHORED whole passages whose 小問 asks one official 短文 ねらい in
  // the stem (TASK-173.9.18 and TASK-173.9.19, which replaced N4's blanked
  // Tatoeba noun of TASK-173.9.6 and N3's blanked 白書 noun), while N2/N1 still
  // blank one noun of a short 白書 paragraph (TASK-173.9.11), so those levels'
  // 小問 print the fixed cloze line and the passage carries its own `＿＿`.
  // Real mode only: `short-reading` carries weight 0 in every flat mix, so a
  // `shortened`/daily paper never emits it. A level with no sourced passage
  // leaves this block short and the real paper refuses rather than reuse the
  // hardcoded `LONG_READING_PASSAGE` or fabricate (TASK-173.1).
  "naiyou-rikai-tanbun": {
    itemTypes: ["short-reading"],
    name: "内容理解（短文）",
  },
  // TASK-173.8.1: ポイント理解, the detail-point listening block. Same store
  // shape as 課題理解 but the question targets a specific fact in the dialogue
  // (a time, a place, a reason), not the overall task. Per-level
  // (`packages/japanese/data/reading/{level}-point.json`), real mode only,
  // `listening-point` weight 0 in every flat mix.
  "point-rikai": { itemTypes: ["listening-point"], name: "ポイント理解" },
  "shuchou-rikai-choubun": {
    itemTypes: ["claim-understanding"],
    name: "主張理解（長文）",
  },
  // TASK-173.8.1: 即時応答, the immediate-response listening block. A short
  // phrase is spoken and the learner picks the best reply from four; the
  // scenario is a single line, not a dialogue. Per-level
  // (`packages/japanese/data/reading/{level}-sokuji.json`), real mode only,
  // `listening-sokuji` weight 0 in every flat mix.
  "sokuji-outou": { itemTypes: ["listening-sokuji"], name: "即時応答" },
  // TASK-173.9.3: 統合理解 is filled by `text-comparison`, TWO sourced 白書
  // paragraphs printed together behind one question
  // (`packages/japanese/data/reading/{level}-tougou.json`), whose key is the
  // topic both documents mention and whose distractors each appear in only one.
  // Real mode only: `text-comparison` carries weight 0 in every flat mix. It is
  // NOT `integrated-reading`, which still means the canned TASK-132 pair; a
  // level with no sourced pair leaves this block short and the real paper
  // refuses rather than fabricate (TASK-173.1). N1 asks 3 小問, N2 asks 2.
  "tougou-rikai": { itemTypes: ["text-comparison"], name: "統合理解" },
  youhou: { itemTypes: ["usage"], name: "用法" },
} as const satisfies Record<string, PaperBlockShape>;

export type PaperBlockId = keyof typeof PAPER_BLOCK_SHAPES;

/**
 * TASK-173.2 AC#1: the sentence the paper prints under the 大問 heading, which
 * is what tells the learner what a 小問 is asking for. The paper prints it once
 * per 大問 and never repeats it per 小問, so this is keyed by 大問 rather than
 * being one string per item.
 *
 * Only the blocks whose heading has been read off a pinned sample paper are
 * here. An empty entry is not a gap to fill in later: a 聴解 or 読解 block has
 * no 小問 to head until some sibling task gives it an item type
 * (`PAPER_BLOCK_SHAPES`), and inventing its wording from a block list rather
 * than from a paper is the from-recall failure this repo's house rule exists
 * to stop. 主張理解（長文） and 統合理解 now HAVE an item type
 * (`claim-understanding`, `text-comparison`) but no entry on purpose: nobody
 * has transcribed their 大問 sentence from the 2018 sample paper yet, so the
 * heading prints its name and no instruction line.
 *
 * Each string is transcribed from the Foundation's 2018 レベル別 sample paper
 * named in `doc-26` §7, which records the page each one came from and why
 * `pdftotext` could not have yielded them. The wording is level-band specific: N5 and
 * N4 print the whole instruction in kana, N3 switches the question to kanji
 * (読み方 / えらびなさい stays kana), and N2 and N1 switch it through to
 * 言葉 and 選びなさい. So this is a per-(level, 大問) fact, which is why it is a
 * table rather than a rule over `PAPER_BLOCK_SHAPES`.
 */
const PAPER_BLOCK_INSTRUCTIONS: Readonly<
  Partial<Record<PaperBlockId, Readonly<Partial<Record<PaperLevel, string>>>>>
> = {
  "bun-no-bunpou-1": {
    N1: "次の文の（　）に入れるのに最もよいものを、１・２・３・４から一つ 選びなさい。",
    N2: "次の文の（　）に入れるのに最もよいものを、１・２・３・４から一つ 選びなさい。",
    N3: "つぎの文の（　）に入れるのに最もよいものを、１・２・３・４から一つ えらびなさい。",
    N4: "（　）に 何を 入れますか。１・２・３・４から いちばん いい ものを 一つ えらんで ください。",
    N5: "（　）に 何を 入れますか。１・２・３・４から いちばん いい ものを 一つ えらんで ください。",
  },
  "bunshou-no-bunpou": {
    // TASK-173.9.24, read from the official 2018 sample papers: N1G.pdf p.10
    // (問題７), N2G.pdf p.12 (問題９), N3G.pdf p.6 (問題３). The paper prints one
    // 文章 whose blanks are numbered １から５, so the official line says 「１から５の
    // 中に」; our 小問 carries a single ＿＿ per passage (the same packaging
    // adaptation the 内容理解 大問 already make), so the marker names that one blank
    // and every other word is the paper's. N1 asks for the 趣旨 and N2/N3 for the
    // 内容, and only N3 is kana-ised, exactly as the 漢字読み and 文の文法1 rows show.
    N1: "次の文章を読んで、文章全体の趣旨を踏まえて、＿＿に入る最もよいものを、１・２・３・４から一つ選びなさい。",
    N2: "次の文章を読んで、文章全体の内容を考えて、＿＿に入る最もよいものを、１・２・３・４から一つ選びなさい。",
    N3: "つぎの文章を読んで、文章全体の内容を考えて、＿＿に入る最もよいものを、１・２・３・４から一つえらびなさい。",
  },
  goseikei: {
    // TASK-173.9.26, read from the official 2018 語彙 sample paper: N2V.pdf p.5
    // (問題３). The blank padding inside （　） on the page is layout, not
    // wording, so the row keeps one full-width space. N1 has no 語形成 大問 in
    // the measured papers and N3–N5 do not print this 大問 at all, so only N2
    // has a row.
    N2: "（　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。",
  },
  hyouki: {
    // TASK-173.9.25, read from the official 2018 語彙 sample papers: N5V p.3
    // (もんだい２), N4V p.3 (もんだい２), N3V p.2 (問題２), N2V p.2 (問題２). N1
    // does not ask 表記, so it has no row. The N2 line really prints no 「、」
    // after をもの: raw text extraction shows をもの、 at N2V p.1 (読み) and
    // p.3+ (文脈規定/言い換え) but をもの１・… at p.2, so the 表記 instruction
    // keeps the booklet's own comma-less wording rather than normalising it.
    N2: "＿＿＿ の言葉を漢字で書くとき、最もよいものを１・２・３・４から一つ 選びなさい。",
    N3: "＿＿＿ のことばを漢字で書くとき、最もよいものを、１・２・３・４から一つ えらびなさい。",
    N4: "＿＿＿ の ことばは どう かきますか。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
    N5: "＿＿＿ の ことばは どう かきますか。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
  },
  "iikae-ruiji": {
    // TASK-173.9.27, read from the official 2018 語彙 sample papers: N1V.pdf
    // (大問3) and N2V.pdf (大問5) ask the closest-meaning WORD form in kanji
    // wording, N3V.pdf (問題4) keeps the question word in kana and switches the
    // verb to えらびなさい.
    N1: "＿＿＿の言葉に意味が最も近いものを、１・２・３・４から一つ選びなさい。",
    N2: "＿＿＿の言葉に意味が最も近いものを、１・２・３・４から一つ選びなさい。",
    N3: "＿＿＿に意味が最も近いものを、１・２・３・４から一つえらびなさい。",
    // TASK-173.9.28: N4V.pdf (もんだい４, p.6) and N5V.pdf (もんだい４, p.7) ask
    // the whole-SENTENCE form, and the heading is word-for-word the same at both
    // levels: 「＿＿＿の ぶんと だいたい おなじ いみの ぶんが あります。
    // １・２・３・４から いちばん いい ものを ひとつ えらんで ください。」 The
    // papers print it as a two-line heading with the blank over the underlined
    // sentence; the line breaks are layout, the word spacing is the booklet's own
    // (the same hiragana-spaced N4/N5 register 表記 and 漢字読み carry here).
    N4: "＿＿＿の ぶんと だいたい おなじ いみの ぶんが あります。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
    N5: "＿＿＿の ぶんと だいたい おなじ いみの ぶんが あります。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
  },
  "kanji-yomi": {
    N1: "＿＿＿ の言葉の読み方として最もよいものを、１・２・３・４から一つ 選びなさい。",
    N2: "＿＿＿ の言葉の読み方として最もよいものを、１・２・３・４から一つ 選びなさい。",
    N3: "＿＿＿ のことばの読み方として最もよいものを、１・２・３・４から一つ えらびなさい。",
    N4: "＿＿＿ の ことばは ひらがなで どう かきますか。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
    N5: "＿＿＿ の ことばは ひらがなで どう かきますか。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
  },
  youhou: {
    N1: "次の文中の（  ）に入れるのに最も適切なものを、１・２・３・４から一つ 選びなさい。",
    N2: "次の文の（  ）に入れるのに最も適切なものを、１・２・３・４から一つ 選びなさい。",
    N3: "つぎの文の（  ）にいれるのに、いちばん 適切 なものを、１・２・３・４から一つ えらびなさい。",
  },
};

/**
 * The instruction a real paper prints for one 大問 at one level, or null when
 * this table has no wording for it. Null is the honest answer rather than a
 * fallback: the heading still prints its name, and a learner is never shown a
 * sentence nobody printed for that block.
 */
export const paperBlockInstruction = ({
  block,
  level,
}: {
  block: PaperBlockId;
  level: PaperLevel;
}): string | null => PAPER_BLOCK_INSTRUCTIONS[block]?.[level] ?? null;

export interface PaperBlock {
  bigQuestion: number;
  id: PaperBlockId;
  indicativeCount: number;
  itemTypes: readonly ItemType[];
  name: string;
  sectionId: PaperSectionId;
}

interface PaperBlockRow {
  bigQuestion: number;
  block: PaperBlockId;
  count: number;
  /**
   * TASK-173.9.28: the question kinds THIS level's 大問 asks, when the block's
   * shape carries more than one form and the paper does not mix them. One
   * official 大問 can be two different item shapes in two different level bands
   * (言い換え類義 prints a WORD and four short paraphrases at N1/N2/N3 but a whole
   * SENTENCE and four complete sentences at N4/N5), and the flat weights cannot
   * route it: they are shared with `shortened`, so a non-zero weight here would
   * put a real-paper-only kind into a daily paper. A row that names the list
   * must name a subset of its block's shape, and `paperBlocksForSection` throws
   * at module load when it does not, so a typo cannot route a 大問 to a kind the
   * shape never carried.
   */
  itemTypes?: readonly ItemType[];
}

const paperBlocksForSection = (
  sectionId: PaperSectionId,
  rows: readonly PaperBlockRow[]
): readonly PaperBlock[] =>
  rows.map((row) => {
    const shape = PAPER_BLOCK_SHAPES[row.block];
    const routed = row.itemTypes;
    if (routed !== undefined) {
      // Read as the wide list: `shape.itemTypes` is a tuple of one block's own
      // literals, and over the union of all blocks its element type intersects to
      // never. The subset check is still against this block's shape.
      const shapeItemTypes: readonly ItemType[] = shape.itemTypes;
      for (const itemType of routed) {
        if (!shapeItemTypes.includes(itemType)) {
          throw new Error(
            `${row.block} 大問${row.bigQuestion} asks ${itemType}, which its shape does not carry`
          );
        }
      }
    }
    return {
      ...shape,
      ...(routed === undefined ? {} : { itemTypes: routed }),
      bigQuestion: row.bigQuestion,
      id: row.block,
      indicativeCount: row.count,
      sectionId,
    };
  });

/**
 * The 大問 each level prints, in exam order, numbered as the paper numbers them
 * (N2 and N1 run one continuous 大問 sequence across the merged 言語知識・読解
 * 科目; the other levels restart per 科目).
 *
 * Order, numbering and names are read from the current official レベル別
 * 大問のねらい PDFs; the composition page itself publishes only a per-level
 * presence matrix. `count` is the 小問数 from the only count table the
 * Foundation has online, the 2009 問題構成例 sheet, whose own footnote calls it
 * 目安 and whose section times predate the 2020 and 2022 reforms. No current
 * official document states per-block counts, so these are shape targets and
 * must not be presented to a learner as the real paper's numbers. See doc-26 §0
 * and §3.
 */
/** TASK-173.9.28: 言い換え類義 prints TWO shapes under one ねらい, and which one
 * a level asks is a fact about the paper, not about the block. Each level's 大問
 * row names its form with one of these two. A row that forgets to choose would
 * split its 小問 across both forms by the block's order, which is a paper nobody
 * printed, so `test/paper.test.ts` pins every 言い換え類義 大問 to exactly one. */
const IIKAE_WORD_FORM: readonly ItemType[] = ["synonym-paraphrase"];
const IIKAE_SENTENCE_FORM: readonly ItemType[] = ["sentence-paraphrase"];

export const PAPER_BLOCKS = {
  N1: [
    ...paperBlocksForSection("language-knowledge-reading", [
      { bigQuestion: 1, block: "kanji-yomi", count: 6 },
      { bigQuestion: 2, block: "bunmi-kitei", count: 7 },
      {
        bigQuestion: 3,
        block: "iikae-ruiji",
        count: 6,
        itemTypes: IIKAE_WORD_FORM,
      },
      { bigQuestion: 4, block: "youhou", count: 6 },
      { bigQuestion: 5, block: "bun-no-bunpou-1", count: 10 },
      { bigQuestion: 6, block: "bun-no-bunpou-2", count: 5 },
      { bigQuestion: 7, block: "bunshou-no-bunpou", count: 5 },
      { bigQuestion: 8, block: "naiyou-rikai-tanbun", count: 4 },
      { bigQuestion: 9, block: "naiyou-rikai-chuubun", count: 9 },
      { bigQuestion: 10, block: "naiyou-rikai-choubun", count: 4 },
      { bigQuestion: 11, block: "tougou-rikai", count: 3 },
      { bigQuestion: 12, block: "shuchou-rikai-choubun", count: 4 },
      { bigQuestion: 13, block: "jouhou-kensaku", count: 2 },
    ]),
    ...paperBlocksForSection("listening", [
      { bigQuestion: 1, block: "kadai-rikai", count: 6 },
      { bigQuestion: 2, block: "point-rikai", count: 7 },
      { bigQuestion: 3, block: "gaiyou-rikai", count: 6 },
      { bigQuestion: 4, block: "sokuji-outou", count: 14 },
      { bigQuestion: 5, block: "choukai-tougou-rikai", count: 4 },
    ]),
  ],
  N2: [
    ...paperBlocksForSection("language-knowledge-reading", [
      { bigQuestion: 1, block: "kanji-yomi", count: 5 },
      { bigQuestion: 2, block: "hyouki", count: 5 },
      { bigQuestion: 3, block: "goseikei", count: 5 },
      { bigQuestion: 4, block: "bunmi-kitei", count: 7 },
      {
        bigQuestion: 5,
        block: "iikae-ruiji",
        count: 5,
        itemTypes: IIKAE_WORD_FORM,
      },
      { bigQuestion: 6, block: "youhou", count: 5 },
      { bigQuestion: 7, block: "bun-no-bunpou-1", count: 12 },
      { bigQuestion: 8, block: "bun-no-bunpou-2", count: 5 },
      { bigQuestion: 9, block: "bunshou-no-bunpou", count: 5 },
      { bigQuestion: 10, block: "naiyou-rikai-tanbun", count: 5 },
      { bigQuestion: 11, block: "naiyou-rikai-chuubun", count: 9 },
      { bigQuestion: 12, block: "tougou-rikai", count: 2 },
      { bigQuestion: 13, block: "shuchou-rikai-choubun", count: 3 },
      { bigQuestion: 14, block: "jouhou-kensaku", count: 2 },
    ]),
    ...paperBlocksForSection("listening", [
      { bigQuestion: 1, block: "kadai-rikai", count: 5 },
      { bigQuestion: 2, block: "point-rikai", count: 6 },
      { bigQuestion: 3, block: "gaiyou-rikai", count: 5 },
      { bigQuestion: 4, block: "sokuji-outou", count: 12 },
      { bigQuestion: 5, block: "choukai-tougou-rikai", count: 4 },
    ]),
  ],
  N3: [
    ...paperBlocksForSection("vocabulary", [
      { bigQuestion: 1, block: "kanji-yomi", count: 8 },
      { bigQuestion: 2, block: "hyouki", count: 6 },
      { bigQuestion: 3, block: "bunmi-kitei", count: 11 },
      {
        bigQuestion: 4,
        block: "iikae-ruiji",
        count: 5,
        itemTypes: IIKAE_WORD_FORM,
      },
      { bigQuestion: 5, block: "youhou", count: 5 },
    ]),
    ...paperBlocksForSection("grammar-reading", [
      { bigQuestion: 1, block: "bun-no-bunpou-1", count: 13 },
      { bigQuestion: 2, block: "bun-no-bunpou-2", count: 5 },
      { bigQuestion: 3, block: "bunshou-no-bunpou", count: 5 },
      { bigQuestion: 4, block: "naiyou-rikai-tanbun", count: 4 },
      { bigQuestion: 5, block: "naiyou-rikai-chuubun", count: 6 },
      { bigQuestion: 6, block: "naiyou-rikai-choubun", count: 4 },
      { bigQuestion: 7, block: "jouhou-kensaku", count: 2 },
    ]),
    ...paperBlocksForSection("listening", [
      { bigQuestion: 1, block: "kadai-rikai", count: 6 },
      { bigQuestion: 2, block: "point-rikai", count: 6 },
      { bigQuestion: 3, block: "gaiyou-rikai", count: 3 },
      { bigQuestion: 4, block: "hatsuwa-hyougen", count: 4 },
      { bigQuestion: 5, block: "sokuji-outou", count: 9 },
    ]),
  ],
  N4: [
    ...paperBlocksForSection("vocabulary", [
      { bigQuestion: 1, block: "kanji-yomi", count: 9 },
      { bigQuestion: 2, block: "hyouki", count: 6 },
      { bigQuestion: 3, block: "bunmi-kitei", count: 10 },
      {
        bigQuestion: 4,
        block: "iikae-ruiji",
        count: 5,
        itemTypes: IIKAE_SENTENCE_FORM,
      },
      { bigQuestion: 5, block: "youhou", count: 5 },
    ]),
    ...paperBlocksForSection("grammar-reading", [
      { bigQuestion: 1, block: "bun-no-bunpou-1", count: 15 },
      { bigQuestion: 2, block: "bun-no-bunpou-2", count: 5 },
      { bigQuestion: 3, block: "bunshou-no-bunpou", count: 5 },
      { bigQuestion: 4, block: "naiyou-rikai-tanbun", count: 4 },
      { bigQuestion: 5, block: "naiyou-rikai-chuubun", count: 4 },
      { bigQuestion: 6, block: "jouhou-kensaku", count: 2 },
    ]),
    ...paperBlocksForSection("listening", [
      { bigQuestion: 1, block: "kadai-rikai", count: 8 },
      { bigQuestion: 2, block: "point-rikai", count: 7 },
      { bigQuestion: 3, block: "hatsuwa-hyougen", count: 5 },
      { bigQuestion: 4, block: "sokuji-outou", count: 8 },
    ]),
  ],
  N5: [
    ...paperBlocksForSection("vocabulary", [
      { bigQuestion: 1, block: "kanji-yomi", count: 12 },
      { bigQuestion: 2, block: "hyouki", count: 8 },
      { bigQuestion: 3, block: "bunmi-kitei", count: 10 },
      {
        bigQuestion: 4,
        block: "iikae-ruiji",
        count: 5,
        itemTypes: IIKAE_SENTENCE_FORM,
      },
    ]),
    ...paperBlocksForSection("grammar-reading", [
      { bigQuestion: 1, block: "bun-no-bunpou-1", count: 16 },
      { bigQuestion: 2, block: "bun-no-bunpou-2", count: 5 },
      { bigQuestion: 3, block: "bunshou-no-bunpou", count: 5 },
      { bigQuestion: 4, block: "naiyou-rikai-tanbun", count: 3 },
      { bigQuestion: 5, block: "naiyou-rikai-chuubun", count: 2 },
      { bigQuestion: 6, block: "jouhou-kensaku", count: 1 },
    ]),
    ...paperBlocksForSection("listening", [
      { bigQuestion: 1, block: "kadai-rikai", count: 7 },
      { bigQuestion: 2, block: "point-rikai", count: 6 },
      { bigQuestion: 3, block: "hatsuwa-hyougen", count: 5 },
      { bigQuestion: 4, block: "sokuji-outou", count: 6 },
    ]),
  ],
} as const satisfies Record<PaperLevel, readonly PaperBlock[]>;

/** Every 大問 a level prints inside one blueprint section, in exam order. */
export const paperBlocksFor = ({
  level,
  section,
}: {
  level: PaperLevel;
  section: PaperSectionId;
}): readonly PaperBlock[] => {
  const blueprint = paperBlueprintFor(level);
  if (!blueprint.sections.some((candidate) => candidate.id === section)) {
    throw new Error(`${section} is not a ${level} paper section`);
  }
  return PAPER_BLOCKS[level].filter((block) => block.sectionId === section);
};

/**
 * The size of the official paper for one section: the sum of its 大問 counts.
 * Real mode asks for this instead of the daily default, because a paper that
 * only asks for ten items has no room for the 大問 that come after them, and a
 * paper that drops 大問 silently is not the real thing.
 */
export const paperSectionIndicativeCount = ({
  level,
  section,
}: {
  level: PaperLevel;
  section: PaperSectionId;
}): number =>
  paperBlocksFor({ level, section }).reduce(
    (total, block) => total + block.indicativeCount,
    0
  );

const isPaperLevel = (value: unknown): value is PaperLevel =>
  typeof value === "string" && PAPER_LEVELS.some((level) => level === value);

const isPaperMode = (value: unknown): value is PaperMode =>
  typeof value === "string" && PAPER_MODES.some((mode) => mode === value);

const isPaperSectionId = (value: unknown): value is PaperSectionId =>
  typeof value === "string" &&
  PAPER_SECTION_IDS.some((section) => section === value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const hasOwn = (value: object, key: string): boolean =>
  Object.hasOwn(value, key);

export const paperBlueprintFor = (level: PaperLevel): PaperBlueprint => {
  if (!isPaperLevel(level)) {
    throw new Error(`unsupported paper level: ${String(level)}`);
  }
  return PAPER_BLUEPRINTS[level];
};

export const PAPER_DEFAULT_BUDGETS = {
  N1: { "language-knowledge-reading": 40, listening: 10 },
  N2: { "language-knowledge-reading": 70, listening: 10 },
  N3: { "grammar-reading": 24, listening: 10, vocabulary: 10 },
  N4: { "grammar-reading": 10, listening: 10, vocabulary: 10 },
  N5: { "grammar-reading": 10, listening: 10, vocabulary: 10 },
} as const satisfies Record<PaperLevel, PaperBudget>;

export const paperSectionTimeLimitSeconds = ({
  budget,
  level,
  mode,
  section,
}: {
  budget?: number;
  level: PaperLevel;
  mode: PaperMode;
  section: PaperSectionId;
}): number => {
  const definition = paperBlueprintFor(level).sections.find(
    (candidate) => candidate.id === section
  );
  if (!definition) {
    throw new Error(`${section} is not a ${level} paper section`);
  }
  if (mode === "exam-conditions" || mode === "real") {
    return definition.minutes * 60;
  }
  const defaultBudget = defaultPaperBudgetFor(level)[section] ?? 1;
  const requestedBudget = budget ?? defaultBudget;
  const scale = Math.min(1, Math.max(0, requestedBudget / defaultBudget) * 0.5);
  return Math.max(60, Math.round(definition.minutes * 60 * scale));
};

const validatePaperBudgetOverrides = (
  blueprint: PaperBlueprint,
  overrides: PaperBudget
): void => {
  const allowedSections = new Set(
    blueprint.sections.map((section) => section.id)
  );
  for (const key of Object.keys(overrides)) {
    if (!(isPaperSectionId(key) && allowedSections.has(key))) {
      throw new Error(`unsupported paper budget section: ${key}`);
    }
    if (!isNonNegativeInteger(overrides[key])) {
      throw new Error(`paper budget for ${key} must be a non-negative integer`);
    }
  }
};

const buildPaperBudget = (
  blueprint: PaperBlueprint,
  defaults: PaperBudget,
  overrides: PaperBudget
): PaperBudget => {
  const budget: Partial<Record<PaperSectionId, number>> = {};
  for (const { id } of blueprint.sections) {
    budget[id] = hasOwn(overrides, id)
      ? (overrides[id] ?? 0)
      : (defaults[id] ?? 0);
  }
  return budget;
};

export const defaultPaperBudgetFor = (
  level: PaperLevel,
  overrides: PaperBudget = {}
): PaperBudget => {
  const blueprint = paperBlueprintFor(level);
  if (!isRecord(overrides)) {
    throw new Error("paper budget overrides must be a record");
  }
  validatePaperBudgetOverrides(blueprint, overrides);
  return buildPaperBudget(blueprint, PAPER_DEFAULT_BUDGETS[level], overrides);
};

export interface PaperScoringFloor {
  cap: 60 | 120;
  id: PaperScoringSectionId;
  itemCount: number;
  minimumItems: 10 | 20;
  status: "met" | "unmet";
}

export interface PaperScoringFloorStatus {
  floors: readonly PaperScoringFloor[];
  scoring: "band" | "raw-only";
}

export interface PaperScoringFloorInput {
  budget: PaperBudget;
  level: PaperLevel;
  /** Real mode floors are measured against the 大問 mix, not the flat one. */
  mode?: PaperMode;
  sections?: readonly PaperSectionId[];
}

export const paperScoringFloorStatus = ({
  budget,
  level,
  mode = "shortened",
  sections,
}: PaperScoringFloorInput): PaperScoringFloorStatus => {
  const blueprint = paperBlueprintFor(level);
  const allowedSections = new Set(
    blueprint.sections.map((section) => section.id)
  );
  const requestedSections = sections ?? [...allowedSections];
  for (const section of requestedSections) {
    if (!allowedSections.has(section)) {
      throw new Error(`${section} is not a ${level} paper section`);
    }
    if (!isNonNegativeInteger(budget[section] ?? 0)) {
      throw new Error(
        `paper budget for ${section} must be a non-negative integer`
      );
    }
  }
  if (requestedSections.length === 0) {
    throw new Error(`paper request for ${level} must include a section`);
  }
  const requested = new Set(requestedSections);
  const floors = blueprint.scoringSections
    .filter((section) =>
      section.sourceSectionIds.some((sourceSection) =>
        requested.has(sourceSection)
      )
    )
    .map((section): PaperScoringFloor => {
      const itemCount = section.sourceSectionIds.reduce(
        (count, sourceSection) => {
          if (!requested.has(sourceSection)) {
            return count;
          }
          const sourceBudget = budget[sourceSection] ?? 0;
          if (!section.itemTypes) {
            return count + sourceBudget;
          }
          const allocation = allocatePaperMix({
            budget: sourceBudget,
            level,
            mode,
            section: sourceSection,
          });
          return (
            count +
            section.itemTypes.reduce(
              (subtotal, itemType) => subtotal + allocation[itemType],
              0
            )
          );
        },
        0
      );
      const minimumItems = section.cap === 120 ? 20 : 10;
      return {
        cap: section.cap,
        id: section.id,
        itemCount,
        minimumItems,
        status: itemCount >= minimumItems ? "met" : "unmet",
      };
    });
  return {
    floors,
    scoring: floors.every((floor) => floor.status === "met")
      ? "band"
      : "raw-only",
  };
};

export type PaperModeLabel =
  | "exam-conditions"
  | "real-paper-banded"
  | "real-paper-raw-only"
  | "shortened-paper-banded"
  | "shortened-paper-raw-only";

export interface PaperRequestInput {
  budget?: PaperBudget;
  focus?: readonly string[];
  level: PaperLevel;
  mode?: PaperMode;
  sections?: readonly PaperSectionId[];
  seed: string;
}

export interface PaperRequest {
  budget: PaperBudget;
  focus: readonly string[];
  level: PaperLevel;
  mode: PaperMode;
  sections: readonly PaperSectionId[];
  seed: string;
}

export type PaperRequestValidationResult =
  | {
      ok: true;
      request: PaperRequest;
    }
  | {
      errors: readonly string[];
      ok: false;
    };

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isNonEmptyString);

const isNonEmptyStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);

const parseSections = (
  value: unknown,
  level: PaperLevel
): readonly PaperSectionId[] => {
  if (value !== undefined && !isNonEmptyStringArray(value)) {
    throw new Error("paper sections must be a non-empty string array");
  }
  const blueprint = paperBlueprintFor(level);
  const sections =
    value === undefined
      ? blueprint.sections.map((section) => section.id)
      : value;
  const allowed = new Set(blueprint.sections.map((section) => section.id));
  const seen = new Set<PaperSectionId>();
  for (const section of sections) {
    if (!(isPaperSectionId(section) && allowed.has(section))) {
      throw new Error(`${String(section)} is not a ${level} paper section`);
    }
    if (seen.has(section)) {
      throw new Error(`duplicate paper section: ${section}`);
    }
    seen.add(section);
  }
  return blueprint.sections
    .map((section) => section.id)
    .filter((section) => seen.has(section));
};

const validatePaperBudgetKey = ({
  allowedSections,
  key,
  selectedSections,
  value,
}: {
  allowedSections: ReadonlySet<PaperSectionId>;
  key: string;
  selectedSections: ReadonlySet<PaperSectionId>;
  value: unknown;
}): void => {
  if (!(isPaperSectionId(key) && allowedSections.has(key))) {
    throw new Error(`unsupported paper budget section: ${key}`);
  }
  if (!selectedSections.has(key)) {
    throw new Error(`paper budget section is not selected: ${key}`);
  }
  if (!isNonNegativeInteger(value)) {
    throw new Error(`paper budget for ${key} must be a non-negative integer`);
  }
};

const readPaperBudgetValue = (
  budget: Record<string, unknown>,
  section: PaperSectionId,
  defaults: PaperBudget
): number => {
  if (hasOwn(budget, section)) {
    const value = budget[section];
    if (!isNonNegativeInteger(value)) {
      throw new Error(
        `paper budget for ${section} must be a non-negative integer`
      );
    }
    return value;
  }
  return defaults[section] ?? 0;
};

/**
 * The budget a section gets when the caller did not name one. Outside real mode
 * that is the daily practice default. In real mode it is the size of the
 * official paper, because a real paper that only asks for ten items has no room
 * for the 大問 that come after them and drops them silently.
 */
const paperBudgetDefaultsFor = (
  level: PaperLevel,
  mode: PaperMode,
  sections: readonly PaperSectionId[]
): PaperBudget => {
  if (mode !== "real") {
    return defaultPaperBudgetFor(level);
  }
  const defaults: Partial<Record<PaperSectionId, number>> = {};
  for (const section of sections) {
    defaults[section] = paperSectionIndicativeCount({ level, section });
  }
  return defaults;
};

const parseBudget = (
  value: unknown,
  level: PaperLevel,
  mode: PaperMode,
  sections: readonly PaperSectionId[]
): PaperBudget => {
  if (value !== undefined && !isRecord(value)) {
    throw new Error("paper budget must be a record");
  }
  const blueprint = paperBlueprintFor(level);
  const allowedSections = new Set(
    blueprint.sections.map((section) => section.id)
  );
  const selectedSections = new Set(sections);
  const budget: Record<string, unknown> = value ?? {};
  for (const key of Object.keys(budget)) {
    validatePaperBudgetKey({
      allowedSections,
      key,
      selectedSections,
      value: budget[key],
    });
  }
  const defaults = paperBudgetDefaultsFor(level, mode, sections);
  const normalized: Partial<Record<PaperSectionId, number>> = {};
  for (const section of sections) {
    const asked = readPaperBudgetValue(budget, section, defaults);
    normalized[section] =
      mode === "real"
        ? // A real paper is the official paper, so a section cannot ask for more
          // 小問 than the official shape has. Capping it here (rather than
          // counting the extra as a hole) is what keeps the receipt's shortfall
          // the size of the real gap: a request for 40 N5 vocabulary 小問 wants
          // all 35 the paper has, not 5 more than exist.
          Math.min(asked, paperSectionIndicativeCount({ level, section }))
        : asked;
  }
  return normalized;
};

const parsePaperRequestLevel = (value: unknown): PaperLevel => {
  if (!isPaperLevel(value)) {
    throw new Error(`unsupported paper level: ${String(value)}`);
  }
  return value;
};

const parsePaperRequestSeed = (value: unknown): string => {
  if (!isNonEmptyString(value)) {
    throw new Error("paper seed must be a non-empty string");
  }
  return value;
};

const parsePaperRequestMode = (value: unknown): PaperMode => {
  if (value !== undefined && !isPaperMode(value)) {
    throw new Error(`unsupported paper mode: ${String(value)}`);
  }
  return value ?? "shortened";
};

const parsePaperRequestFocus = (value: unknown): readonly string[] => {
  if (value !== undefined && !isStringArray(value)) {
    throw new Error("paper focus must be a string array");
  }
  return value === undefined ? [] : [...value];
};

export const parsePaperRequest = (input: unknown): PaperRequest => {
  if (!isRecord(input)) {
    throw new Error("paper request must be an object");
  }
  const level = parsePaperRequestLevel(input.level);
  const seed = parsePaperRequestSeed(input.seed);
  const mode = parsePaperRequestMode(input.mode);
  const focus = parsePaperRequestFocus(input.focus);
  const sections = parseSections(input.sections, level);
  const budget = parseBudget(input.budget, level, mode, sections);
  if (Object.values(budget).every((count) => count === 0)) {
    throw new Error("a paper request must contain at least one item");
  }
  return {
    budget,
    focus,
    level,
    mode,
    sections,
    seed,
  };
};

export const validatePaperRequest = (
  input: unknown
): PaperRequestValidationResult => {
  try {
    return { ok: true, request: parsePaperRequest(input) };
  } catch (error) {
    return {
      errors: [
        error instanceof Error ? error.message : "invalid paper request",
      ],
      ok: false,
    };
  }
};

export const paperModeLabel = (request: PaperRequest): PaperModeLabel => {
  const status = paperScoringFloorStatus(request);
  if (status.scoring === "raw-only") {
    return request.mode === "real"
      ? "real-paper-raw-only"
      : "shortened-paper-raw-only";
  }
  if (request.mode === "real") {
    return "real-paper-banded";
  }
  return request.mode === "exam-conditions"
    ? "exam-conditions"
    : "shortened-paper-banded";
};

export interface ShuffleQuestionItemOptionsInput {
  examId: string;
  item: QuestionItem;
  seed: string;
}

/**
 * The option order for one item: a seeded Fisher-Yates over `[0..n)`, so it
 * depends on the exam id, the request seed AND the item id. The same three
 * inputs always give the same order (the reproducibility `doc-14` §4 and
 * `doc-16` §3 promise), and an item whose order happens to be the identity is
 * a legitimate 1-in-24 draw, not the degenerate case it used to be.
 */
const deterministicOptionOrder = (
  examId: string,
  itemId: string,
  optionCount: number,
  seed: string
): readonly number[] =>
  seededPermutation(optionCount, hashString(`${examId}\0${seed}\0${itemId}`));

export const shuffleQuestionItemOptions = ({
  examId,
  item,
  seed,
}: ShuffleQuestionItemOptionsInput): QuestionItem => {
  if (
    !Number.isInteger(item.answerIndex) ||
    item.answerIndex < 0 ||
    item.answerIndex >= item.options.length
  ) {
    throw new Error("question item answer index is out of range");
  }
  const order = deterministicOptionOrder(
    examId,
    item.id,
    item.options.length,
    seed
  );
  const options = order.map((index) => {
    const option = item.options[index];
    if (option === undefined) {
      throw new Error("question item option is out of range");
    }
    return option;
  });
  const answerIndex = order.indexOf(item.answerIndex);
  if (answerIndex < 0) {
    throw new Error("question item answer option was not shuffled");
  }
  return { ...item, answerIndex, options };
};

export type PaperItemTypeWeights = Readonly<Record<ItemType, number>>;
export type PaperItemTypeCounts = Readonly<Record<ItemType, number>>;

const emptyItemTypeWeights = (): PaperItemTypeWeights => ({
  "claim-understanding": 0,
  // TASK-173.9.26: 語形成 is real-paper only. No flat mix weights it, so a
  // `shortened`/daily paper never emits it, exactly like `word-spelling`.
  "compound-completion": 0,
  conjugation: 0,
  "context-cloze": 0,
  // TASK-173.9.24: 文章の文法 is real-paper only. No flat mix weights it, so a
  // `shortened`/daily paper never emits it, exactly like `info-search` and
  // `usage`.
  "discourse-cloze": 0,
  "grammar-form": 0,
  // TASK-173.9.7: 情報検索 is real-paper only. No flat mix weights it, so a
  // `shortened`/daily paper never emits it, exactly like `short-reading` and
  // `medium-reading`.
  "info-search": 0,
  "integrated-listening": 0,
  "integrated-reading": 0,
  "kana-cell": 0,
  "kanji-reading": 0,
  // TASK-173.9.4.1/.2: 概要理解 and 統合理解 join the 聴解 blocks as real-paper
  // only. No flat mix weights them, so a `shortened`/daily paper never emits a
  // listening 大問.
  "listening-choukai": 0,
  "listening-detail": 0,
  "listening-gaiyou": 0,
  "listening-hatsuwa": 0,
  // TASK-173.8.1: the four N4/N5 聴解 blocks are real-paper only. No flat mix
  // weights them, so a `shortened`/daily paper never emits a listening 大問,
  // exactly like `info-search` and the reading-only types above.
  "listening-kadai": 0,
  "listening-point": 0,
  "listening-sokuji": 0,
  "long-reading": 0,
  "medium-reading": 0,
  particle: 0,
  "reading-info": 0,
  // TASK-173.9.28: the whole-SENTENCE form of 言い換え類義 is real-paper only, like
  // its word-form sibling below. No flat mix weights it, so a `shortened`/daily
  // paper never emits it.
  "sentence-paraphrase": 0,
  "short-reading": 0,
  "star-ordering": 0,
  // TASK-173.9.27: 言い換え類義 is real-paper only. No flat mix weights it, so
  // a `shortened`/daily paper never emits it, exactly like `compound-completion`.
  "synonym-paraphrase": 0,
  // TASK-173.9.3: 統合理解 is real-paper only. No flat mix weights it, so a
  // `shortened`/daily paper never emits it, exactly like `info-search`.
  "text-comparison": 0,
  // TASK-173.9.23: 用法 is real-paper only. No flat mix weights it, so a
  // `shortened`/daily paper never emits it, exactly like `info-search`.
  usage: 0,
  "word-in-context": 0,
  // TASK-173.9.25: 表記 is real-paper only. No flat mix weights it, so a
  // `shortened`/daily paper never emits it, exactly like `discourse-cloze`.
  "word-spelling": 0,
});

const itemTypeWeights = (
  overrides: Partial<Record<ItemType, number>>
): PaperItemTypeWeights => ({ ...emptyItemTypeWeights(), ...overrides });

export const PAPER_ITEM_TYPE_WEIGHTS_V2 = {
  N1: {
    "language-knowledge-reading": itemTypeWeights({
      conjugation: 10,
      "grammar-form": 20,
      "integrated-reading": 25,
      "kanji-reading": 15,
      "long-reading": 20,
      particle: 5,
      "reading-info": 15,
      usage: 5,
      "word-in-context": 25,
    }),
    listening: itemTypeWeights({
      "integrated-listening": 60,
      "listening-detail": 40,
    }),
  },
  N2: {
    "language-knowledge-reading": itemTypeWeights({
      conjugation: 10,
      "grammar-form": 20,
      "kanji-reading": 20,
      particle: 5,
      "reading-info": 15,
      usage: 5,
      "word-in-context": 30,
    }),
    listening: itemTypeWeights({ "listening-detail": 100 }),
  },
  N3: {
    "grammar-reading": itemTypeWeights({
      conjugation: 15,
      "grammar-form": 25,
      "long-reading": 20,
      particle: 10,
      "reading-info": 30,
    }),
    listening: itemTypeWeights({ "listening-detail": 100 }),
    vocabulary: itemTypeWeights({
      "kanji-reading": 25,
      usage: 5,
      "word-in-context": 75,
    }),
  },
  N4: {
    "grammar-reading": itemTypeWeights({
      conjugation: 20,
      "grammar-form": 30,
      particle: 15,
      "reading-info": 35,
    }),
    listening: itemTypeWeights({ "listening-detail": 100 }),
    vocabulary: itemTypeWeights({
      "kanji-reading": 30,
      "word-in-context": 70,
    }),
  },
  N5: {
    "grammar-reading": itemTypeWeights({
      conjugation: 20,
      "grammar-form": 35,
      particle: 15,
      "reading-info": 30,
    }),
    listening: itemTypeWeights({ "listening-detail": 100 }),
    vocabulary: itemTypeWeights({
      "kanji-reading": 30,
      "word-in-context": 70,
    }),
  },
} as const satisfies Readonly<
  Record<
    PaperLevel,
    Readonly<Partial<Record<PaperSectionId, PaperItemTypeWeights>>>
  >
>;

export interface PaperItemTypeAllocationInput {
  budget: number;
  level: PaperLevel;
  section: PaperSectionId;
}

const emptyItemTypeCounts = (): Record<ItemType, number> => ({
  "claim-understanding": 0,
  "compound-completion": 0,
  conjugation: 0,
  "context-cloze": 0,
  "discourse-cloze": 0,
  "grammar-form": 0,
  "info-search": 0,
  "integrated-listening": 0,
  "integrated-reading": 0,
  "kana-cell": 0,
  "kanji-reading": 0,
  // TASK-173.9.4.1/.2: 概要理解 and 統合理解 join the 聴解 blocks as real-paper
  // only. No flat mix weights them, so a `shortened`/daily paper never emits a
  // listening 大問.
  "listening-choukai": 0,
  "listening-detail": 0,
  "listening-gaiyou": 0,
  "listening-hatsuwa": 0,
  // TASK-173.8.1: the four N4/N5 聴解 blocks are real-paper only. No flat mix
  // weights them, so a `shortened`/daily paper never emits a listening 大問,
  // exactly like `info-search` and the reading-only types above.
  "listening-kadai": 0,
  "listening-point": 0,
  "listening-sokuji": 0,
  "long-reading": 0,
  "medium-reading": 0,
  particle: 0,
  "reading-info": 0,
  "sentence-paraphrase": 0,
  "short-reading": 0,
  "star-ordering": 0,
  "synonym-paraphrase": 0,
  "text-comparison": 0,
  usage: 0,
  "word-in-context": 0,
  "word-spelling": 0,
});

export const paperItemTypeWeightsFor = ({
  level,
  section,
}: Pick<
  PaperItemTypeAllocationInput,
  "level" | "section"
>): PaperItemTypeWeights => {
  const blueprint = paperBlueprintFor(level);
  if (!blueprint.sections.some((candidate) => candidate.id === section)) {
    throw new Error(`${section} is not a ${level} paper section`);
  }
  const levelWeights: Readonly<
    Partial<Record<PaperSectionId, PaperItemTypeWeights>>
  > = PAPER_ITEM_TYPE_WEIGHTS_V2[level];
  const weights = levelWeights[section];
  if (!weights) {
    throw new Error(`${section} has no ${level} item-type weights`);
  }
  return weights;
};

export const allocatePaperItemTypes = ({
  budget,
  level,
  section,
}: PaperItemTypeAllocationInput): PaperItemTypeCounts => {
  if (!isNonNegativeInteger(budget)) {
    throw new Error("paper item allocation must be a non-negative integer");
  }
  const weights = paperItemTypeWeightsFor({ level, section });
  const totalWeight = ITEM_TYPES.reduce(
    (total, itemType) => total + weights[itemType],
    0
  );
  if (totalWeight <= 0) {
    throw new Error(`${section} has no positive ${level} item-type weights`);
  }
  const allocation = emptyItemTypeCounts();
  const remainders: {
    itemType: ItemType;
    order: number;
    remainder: number;
  }[] = [];
  let allocated = 0;
  for (const [order, itemType] of ITEM_TYPES.entries()) {
    const numerator = budget * weights[itemType];
    const count = Math.floor(numerator / totalWeight);
    allocation[itemType] = count;
    allocated += count;
    if (weights[itemType] > 0) {
      remainders.push({
        itemType,
        order,
        remainder: numerator % totalWeight,
      });
    }
  }
  remainders.sort(
    (left, right) =>
      right.remainder * totalWeight - left.remainder * totalWeight ||
      left.order - right.order
  );
  for (const entry of remainders.slice(0, budget - allocated)) {
    const current = allocation[entry.itemType];
    allocation[entry.itemType] = current + 1;
  }
  return allocation;
};

/**
 * One block's share of the budget, spread over the item types that fill it. A
 * block with no item types is asked for and receives nothing: the budget stays
 * spent, so the section comes up short and the paper says so. Reallocating an
 * unfillable block's share to the next block would be how a paper that is not
 * the real one gets built.
 */
const allocateWithinBlock = ({
  block,
  count,
  level,
  section,
}: {
  block: PaperBlock;
  count: number;
  level: PaperLevel;
  section: PaperSectionId;
}): PaperItemTypeCounts => {
  const counts = emptyItemTypeCounts();
  if (count === 0 || block.itemTypes.length === 0) {
    return counts;
  }
  const weights = paperItemTypeWeightsFor({ level, section });
  const weightOf = (itemType: ItemType): number =>
    Math.max(0, weights[itemType]);
  const totalWeight = block.itemTypes.reduce(
    (total, itemType) => total + weightOf(itemType),
    0
  );
  const draw = block.itemTypes.map((itemType, order) => ({
    itemType,
    order,
    weight: totalWeight > 0 ? weightOf(itemType) : 1,
  }));
  const effectiveTotal = draw.reduce((total, entry) => total + entry.weight, 0);
  const remainders: { itemType: ItemType; order: number; remainder: number }[] =
    [];
  let allocated = 0;
  for (const entry of draw) {
    const numerator = count * entry.weight;
    const each = Math.floor(numerator / effectiveTotal);
    counts[entry.itemType] = each;
    allocated += each;
    remainders.push({
      itemType: entry.itemType,
      order: entry.order,
      remainder: numerator % effectiveTotal,
    });
  }
  remainders.sort(
    (left, right) =>
      right.remainder * effectiveTotal - left.remainder * effectiveTotal ||
      left.order - right.order
  );
  for (const entry of remainders.slice(0, count - allocated)) {
    counts[entry.itemType] += 1;
  }
  return counts;
};

export interface AllocatedPaperBlock {
  bigQuestion: number;
  id: PaperBlockId;
  itemTypeAllocation: PaperItemTypeCounts;
  /** The types that fill this 大問, empty when the engine cannot ask it yet. */
  itemTypes: readonly ItemType[];
  name: string;
  /** The 小問 this 大問 asks for, capped by whatever budget was
   * left. */
  requested: number;
  sectionId: PaperSectionId;
}

export interface PaperBlockAllocation {
  blocks: readonly AllocatedPaperBlock[];
  level: PaperLevel;
  /** Items the 大問 in this section asked for, which is the budget unless the
   * official shape is smaller than it. */
  requestedItems: number;
  sectionId: PaperSectionId;
  /** Budget the official shape could not use: a real paper does not pad. */
  unusedBudget: number;
}

export interface PaperBlockAllocationInput {
  budget: number;
  level: PaperLevel;
  section: PaperSectionId;
}

/**
 * TASK-173.4 AC#2. Fill a section by walking its 大問 in exam order and giving
 * each one its count, instead of spreading the budget over raw item types the
 * way `allocatePaperItemTypes` does. Order matters here: a paper that asks for
 * fewer items than the official shape gets the 大問 that come first, and every
 * 大問 after the budget runs out is reported as asked for nothing rather than
 * quietly dropped.
 */
export const allocatePaperBlocks = ({
  budget,
  level,
  section,
}: PaperBlockAllocationInput): PaperBlockAllocation => {
  if (!isNonNegativeInteger(budget)) {
    throw new Error("paper item allocation must be a non-negative integer");
  }
  let remaining = budget;
  const blocks = paperBlocksFor({ level, section }).map(
    (block): AllocatedPaperBlock => {
      const requested = Math.min(remaining, block.indicativeCount);
      remaining -= requested;
      return {
        bigQuestion: block.bigQuestion,
        id: block.id,
        itemTypeAllocation: allocateWithinBlock({
          block,
          count: requested,
          level,
          section,
        }),
        itemTypes: block.itemTypes,
        name: block.name,
        requested,
        sectionId: section,
      };
    }
  );
  return {
    blocks,
    level,
    requestedItems: budget - remaining,
    sectionId: section,
    unusedBudget: remaining,
  };
};

export interface PaperMixAllocationInput extends PaperBlockAllocationInput {
  mode: PaperMode;
}

/**
 * The item-type mix one section asks for under a given mode, and the single
 * source of truth for it. Real mode walks the 大問; every other mode keeps the
 * flat spread. The floors, the picker, the assembled paper and the validator all
 * read this one function, because a paper whose plan and whose check come from
 * two different allocators fails its own validation.
 */
export const allocatePaperMix = ({
  budget,
  level,
  mode,
  section,
}: PaperMixAllocationInput): PaperItemTypeCounts => {
  if (mode !== "real") {
    return allocatePaperItemTypes({ budget, level, section });
  }
  const counts = emptyItemTypeCounts();
  for (const block of allocatePaperBlocks({ budget, level, section }).blocks) {
    for (const itemType of ITEM_TYPES) {
      counts[itemType] += block.itemTypeAllocation[itemType];
    }
  }
  return counts;
};

/**
 * One 大問 the official shape asked for and the item engine has no question kind
 * for (TASK-173.4 AC#4). This is a different fact from a candidate being turned
 * down: no amount of unseen content fills it, because the engine cannot build
 * that kind of question at all. It is also not the learner having run a level
 * dry. Naming it is what keeps a short real paper from reading like either.
 */
export interface PaperUnfilledBlock {
  bigQuestion: number;
  id: PaperBlockId;
  name: string;
  requestedItems: number;
  section: PaperSectionId;
}

export interface PaperUnfillableBlocksInput extends PaperBlockAllocationInput {
  /**
   * Whether real mode can still source this 大問 at this level. Defaults to
   * every 大問 being sourceable, which is the engine-only meaning of a hole: a
   * 大問 with no question kind at all (`itemTypes` empty) can never be asked.
   *
   * A 大問 whose question kinds all come from a level-keyed corpus store is
   * unfillable a SECOND way: the store may not exist for that level, so the walk
   * has nothing to print even though the question has a shape. That is a fact
   * about the corpus rather than about the engine, so the caller, which is the
   * only layer that can see the store, answers it here. Both reasons are the
   * same diagnosis to a learner: this part of the real paper cannot be asked,
   * and no amount of unseen content closes it. Note the boundary: this asks
   * whether ANY source exists, not whether there is enough of it. A store with
   * one row backing a five-小問 大問 is sourceable and comes up short instead.
   */
  hasSource?: (block: AllocatedPaperBlock) => boolean;
}

/**
 * The 大問 a section asks for that nothing can fill. Only the real mode has an
 * official shape to miss, so this is for real requests: the flat modes spread a
 * budget over whatever types the level has and leave no block unfilled by
 * construction.
 */
export const paperUnfillableBlocks = ({
  budget,
  hasSource = () => true,
  level,
  section,
}: PaperUnfillableBlocksInput): readonly PaperUnfilledBlock[] =>
  allocatePaperBlocks({ budget, level, section })
    .blocks.filter(
      (block) =>
        block.requested > 0 &&
        (block.itemTypes.length === 0 || !hasSource(block))
    )
    .map((block) => ({
      bigQuestion: block.bigQuestion,
      id: block.id,
      name: block.name,
      requestedItems: block.requested,
      section,
    }));

export const paperSectionForItemType = ({
  itemType,
  level,
}: {
  itemType: ItemType;
  level: PaperLevel;
}): PaperSectionId | null => {
  const blueprint = paperBlueprintFor(level);
  const levelWeights: Readonly<
    Partial<Record<PaperSectionId, PaperItemTypeWeights>>
  > = PAPER_ITEM_TYPE_WEIGHTS_V2[level];
  for (const section of blueprint.sections) {
    const weights = levelWeights[section.id];
    if (weights && weights[itemType] > 0) {
      return section.id;
    }
  }
  // A 大問-shaped type carries no flat weight, because it is asked only through
  // the real-mode block walk and must never leak into a shortened paper's flat
  // spread. Its section is the one its 大問 lives in, read from the block table:
  // TASK-173.5 文脈規定 (context-cloze) sits in 語彙 at N3-N5 and in the merged
  // 言語知識・読解 at N1-N2, exactly where its block does.
  for (const block of PAPER_BLOCKS[level]) {
    if (block.itemTypes.includes(itemType)) {
      return block.sectionId;
    }
  }
  return null;
};

export type PaperRejectionReason =
  | ItemRejectionReason
  | "floor-unmet"
  | "mix-mismatch";

export const PAPER_REJECTION_REASON_ORDER = [
  "no-anchor",
  "anchor-missing",
  "anchor-level",
  "ambiguous",
  "duplicate-option",
  "unlucky-distractor",
  "stem-leak",
  "mix-mismatch",
  "passage-missing",
  "passage-length",
  "script-missing",
  "stimuli-kind",
  "stimuli-count",
  "floor-unmet",
  "option-count",
  "answer-index",
  "answer-provenance",
  "fsrs-link",
  "no-correct-answer",
] as const satisfies readonly PaperRejectionReason[];

export interface PaperSlot {
  /** The 大問 this item was asked for, or null outside real mode, where the
   * paper has no 大問 structure to belong to. */
  block: PaperBlockId | null;
  item: QuestionItem;
  optionSources: readonly OptionSource[];
  requestedSlotIndex: number;
  section: PaperSectionId;
  sourceIndex: number;
}

export interface PaperValidationIssue {
  actual?: PaperItemTypeCounts;
  anchorIds?: readonly string[];
  expected?: PaperItemTypeCounts;
  itemId?: string;
  optionIndexes?: readonly number[];
  reason: PaperRejectionReason;
  scoringSectionId?: PaperScoringSectionId;
  section?: PaperSectionId;
  slotIndex?: number;
}

export type PaperValidationResult =
  | {
      floors: PaperScoringFloorStatus;
      ok: true;
      scoring: "band" | "raw-only";
    }
  | {
      floors: PaperScoringFloorStatus;
      issues: readonly PaperValidationIssue[];
      ok: false;
      reason: PaperRejectionReason;
    };

export interface ValidatePaperInput {
  corpus: ItemCorpusView;
  request: PaperRequestInput;
  slots: readonly PaperSlot[];
}

const paperReasonRank = (reason: PaperRejectionReason): number =>
  PAPER_REJECTION_REASON_ORDER.indexOf(reason);

const paperSectionRank = (
  level: PaperLevel,
  section: PaperSectionId | undefined
): number => {
  if (!section) {
    return Number.MAX_SAFE_INTEGER;
  }
  return paperBlueprintFor(level).sections.findIndex(
    (candidate) => candidate.id === section
  );
};

const compareText = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const sortPaperValidationIssues = (
  issues: PaperValidationIssue[],
  level: PaperLevel
): readonly PaperValidationIssue[] =>
  issues.sort(
    (left, right) =>
      paperReasonRank(left.reason) - paperReasonRank(right.reason) ||
      paperSectionRank(level, left.section) -
        paperSectionRank(level, right.section) ||
      (left.slotIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.slotIndex ?? Number.MAX_SAFE_INTEGER) ||
      compareText(left.itemId ?? "", right.itemId ?? "")
  );

const validatePaperMix = (
  request: PaperRequest,
  slots: readonly PaperSlot[]
): readonly PaperValidationIssue[] => {
  const blueprint = paperBlueprintFor(request.level);
  const requested = new Set(request.sections);
  const issues: PaperValidationIssue[] = [];
  for (const section of blueprint.sections) {
    if (!requested.has(section.id)) {
      continue;
    }
    const expected = allocatePaperMix({
      budget: request.budget[section.id] ?? 0,
      level: request.level,
      mode: request.mode,
      section: section.id,
    });
    const actual = emptyItemTypeCounts();
    for (const slot of slots) {
      if (slot.section === section.id) {
        actual[slot.item.itemType] += 1;
      }
    }
    if (
      ITEM_TYPES.some((itemType) => actual[itemType] !== expected[itemType])
    ) {
      issues.push({
        actual,
        expected,
        reason: "mix-mismatch",
        section: section.id,
      });
    }
  }
  for (const slot of slots) {
    if (!requested.has(slot.section)) {
      issues.push({
        itemId: slot.item.id,
        reason: "mix-mismatch",
        section: slot.section,
        slotIndex: slot.requestedSlotIndex,
      });
    }
  }
  return issues;
};

export const validatePaper = ({
  corpus,
  request: requestInput,
  slots,
}: ValidatePaperInput): PaperValidationResult => {
  const request = parsePaperRequest(requestInput);
  const floors = paperScoringFloorStatus(request);
  const issues: PaperValidationIssue[] = [...validatePaperMix(request, slots)];
  for (const slot of slots) {
    const result = validateQuestionItem(slot.item, slot.optionSources, corpus);
    if (slot.item.level !== request.level) {
      issues.push({
        anchorIds: slot.item.anchors,
        itemId: slot.item.id,
        reason: "anchor-level",
        section: slot.section,
        slotIndex: slot.requestedSlotIndex,
      });
    }
    if (!result.ok) {
      issues.push({
        anchorIds: result.anchorIds,
        itemId: slot.item.id,
        optionIndexes: result.optionIndexes,
        reason: result.reason,
        section: slot.section,
        slotIndex: slot.requestedSlotIndex,
      });
    }
  }
  if (request.mode === "exam-conditions" || request.mode === "real") {
    for (const floor of floors.floors) {
      if (floor.status === "unmet") {
        issues.push({
          reason: "floor-unmet",
          scoringSectionId: floor.id,
        });
      }
    }
  }
  const sortedIssues = sortPaperValidationIssues(issues, request.level);
  const [firstIssue] = sortedIssues;
  if (firstIssue) {
    return {
      floors,
      issues: sortedIssues,
      ok: false,
      reason: firstIssue.reason,
    };
  }
  return { floors, ok: true, scoring: floors.scoring };
};

export interface PaperCandidate {
  item: QuestionItem;
  optionSources: readonly OptionSource[];
  section: PaperSectionId;
}

export interface AssembledPaperSlot extends PaperSlot {
  order: number;
}

/**
 * One 大問 of an assembled real paper: what the official shape asked for, what
 * actually landed, and the name to print above them. AC#4. A block that landed
 * nothing is still here, because the paper dropped a 大問 and the learner is
 * owed that fact rather than a renumbered list.
 */
export interface AssembledPaperBlock {
  bigQuestion: number;
  id: PaperBlockId;
  itemCount: number;
  name: string;
  requestedItems: number;
}

export interface AssembledPaperSection {
  /** The 大問 walk for real mode, empty for every other mode. */
  blocks: readonly AssembledPaperBlock[];
  id: PaperSectionId;
  items: readonly AssembledPaperSlot[];
  itemTypeAllocation: PaperItemTypeCounts;
  minutes: number;
  requestedItems: number;
  scoringSectionIds: readonly PaperScoringSectionId[];
  shortfall: number;
}

export interface PaperAssemblyRejection {
  anchorIds: readonly string[];
  candidateIndex: number;
  itemId: string;
  itemType: ItemType;
  optionIndexes: readonly number[];
  reason: PaperRejectionReason;
  section: PaperSectionId;
  slotIndex: number;
}

export interface PaperAssemblyResult {
  blueprint: PaperBlueprint;
  floors: PaperScoringFloorStatus;
  label: PaperModeLabel;
  ready: boolean;
  rejections: readonly PaperAssemblyRejection[];
  request: PaperRequest;
  sections: readonly AssembledPaperSection[];
  shortfall: number;
  validation: PaperValidationResult;
}

export interface AssemblePaperInput {
  candidates: readonly PaperCandidate[];
  corpus: ItemCorpusView;
  examId: string;
  request: PaperRequestInput;
}

interface DesiredPaperSlot {
  /** The 大問 this slot was asked for, or null outside real mode. */
  block: PaperBlockId | null;
  itemType: ItemType;
  section: PaperSectionId;
  slotIndex: number;
}

interface DesiredPaperSlotDraft {
  block: PaperBlockId | null;
  counts: PaperItemTypeCounts;
  section: PaperSectionId;
  slotIndex: number;
}

/**
 * Expands one per-type count into the slots it asks for, in `ITEM_TYPES` order,
 * returning the next free slot index. Both the 大問 walk and the flat spread use
 * it, so the two modes cannot drift apart on numbering.
 */
const expandDesiredSlots = ({
  block,
  counts,
  section,
  slotIndex,
}: DesiredPaperSlotDraft): {
  nextSlotIndex: number;
  slots: DesiredPaperSlot[];
} => {
  const slots: DesiredPaperSlot[] = [];
  let index = slotIndex;
  for (const itemType of ITEM_TYPES) {
    for (let each = 0; each < counts[itemType]; each += 1) {
      slots.push({ block, itemType, section, slotIndex: index });
      index += 1;
    }
  }
  return { nextSlotIndex: index, slots };
};

const desiredPaperSlotsForSection = (
  request: PaperRequest,
  section: PaperSectionId
): DesiredPaperSlot[] => {
  const budget = request.budget[section] ?? 0;
  if (request.mode === "real") {
    const slots: DesiredPaperSlot[] = [];
    let slotIndex = 0;
    for (const block of allocatePaperBlocks({
      budget,
      level: request.level,
      section,
    }).blocks) {
      // AC#2: the paper is asked for 大問 by 大問, in exam order, so slot 0 of a
      // real paper is the first 小問 of the first 大問 rather than whichever
      // item type happens to sort first.
      const expanded = expandDesiredSlots({
        block: block.id,
        counts: block.itemTypeAllocation,
        section,
        slotIndex,
      });
      slots.push(...expanded.slots);
      slotIndex = expanded.nextSlotIndex;
    }
    return slots;
  }
  return expandDesiredSlots({
    block: null,
    counts: allocatePaperItemTypes({
      budget,
      level: request.level,
      section,
    }),
    section,
    slotIndex: 0,
  }).slots;
};

const desiredPaperSlots = (
  request: PaperRequest
): readonly DesiredPaperSlot[] => {
  const blueprint = paperBlueprintFor(request.level);
  const requested = new Set(request.sections);
  const slots: DesiredPaperSlot[] = [];
  for (const section of blueprint.sections) {
    if (!requested.has(section.id)) {
      continue;
    }
    slots.push(...desiredPaperSlotsForSection(request, section.id));
  }
  return slots;
};

const candidateSlotKey = (
  itemType: ItemType,
  section: PaperSectionId
): string => `${section}\0${itemType}`;

const candidatePools = (
  candidates: readonly PaperCandidate[]
): ReadonlyMap<string, readonly number[]> => {
  const pools = new Map<string, number[]>();
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const key = candidateSlotKey(candidate.item.itemType, candidate.section);
    const pool = pools.get(key) ?? [];
    pool.push(candidateIndex);
    pools.set(key, pool);
  }
  return pools;
};

const shuffledSources = (
  item: QuestionItem,
  optionSources: readonly OptionSource[],
  order: readonly number[]
): readonly OptionSource[] => {
  const sources: OptionSource[] = [];
  for (const index of order) {
    const source = optionSources[index];
    if (!source) {
      throw new Error("question item option source is out of range");
    }
    sources.push(source);
  }
  if (item.answerIndex < 0) {
    throw new Error("question item answer index is out of range");
  }
  return sources;
};

type CandidateAttempt =
  | {
      ok: true;
      slot: PaperSlot;
    }
  | {
      ok: false;
      rejection: PaperAssemblyRejection;
    };

const rejectionForCandidate = (
  candidate: PaperCandidate,
  candidateIndex: number,
  reason: PaperRejectionReason,
  slotIndex: number,
  anchorIds: readonly string[] = [],
  optionIndexes: readonly number[] = []
): PaperAssemblyRejection => ({
  anchorIds,
  candidateIndex,
  itemId: candidate.item.id,
  itemType: candidate.item.itemType,
  optionIndexes,
  reason,
  section: candidate.section,
  slotIndex,
});

const rejectionFromValidation = (
  candidate: PaperCandidate,
  candidateIndex: number,
  slotIndex: number,
  result: Extract<ItemValidationResult, { ok: false }>
): PaperAssemblyRejection =>
  rejectionForCandidate(
    candidate,
    candidateIndex,
    result.reason,
    slotIndex,
    result.anchorIds,
    result.optionIndexes
  );

const attemptCandidate = ({
  candidate,
  candidateIndex,
  corpus,
  examId,
  request,
  slot,
}: {
  candidate: PaperCandidate;
  candidateIndex: number;
  corpus: ItemCorpusView;
  examId: string;
  request: PaperRequest;
  slot: DesiredPaperSlot;
}): CandidateAttempt => {
  const initialValidation = validateQuestionItem(
    candidate.item,
    candidate.optionSources,
    corpus
  );
  if (!initialValidation.ok) {
    return {
      ok: false,
      rejection: rejectionFromValidation(
        candidate,
        candidateIndex,
        slot.slotIndex,
        initialValidation
      ),
    };
  }
  const item = shuffleQuestionItemOptions({
    examId,
    item: candidate.item,
    seed: request.seed,
  });
  const order = deterministicOptionOrder(
    examId,
    item.id,
    item.options.length,
    request.seed
  );
  const optionSources = shuffledSources(item, candidate.optionSources, order);
  const finalValidation = validateQuestionItem(item, optionSources, corpus);
  if (!finalValidation.ok) {
    return {
      ok: false,
      rejection: rejectionFromValidation(
        candidate,
        candidateIndex,
        slot.slotIndex,
        finalValidation
      ),
    };
  }
  return {
    ok: true,
    slot: {
      block: slot.block,
      item,
      optionSources,
      requestedSlotIndex: slot.slotIndex,
      section: slot.section,
      sourceIndex: candidateIndex,
    },
  };
};

/**
 * The 大問 grouping for a paper already built, read back from the items it
 * holds. `exam_items` persists an item's type, section and order, not its 大問,
 * so a stored real paper is re-walked from the plan the section budget implies
 * and its rows assigned, in order, to each 大問 up to the number that 大問 asks
 * for. A 大問 that came up short of its plan keeps its heading with the count it
 * actually reached: 文脈規定 leans on a grammar pool a level can run out of
 * (TASK-173.5), so a partial fill is an honest short paper, not a corrupt one,
 * and hiding every heading for it would erase the 大問 a real paper does print.
 * What gets no grouping is a row that does not belong to the 大問 its position
 * names, or more rows than the shape holds: either is a paper whose items and
 * official shape disagree, and a wrong 大問 heading is a claim about the paper
 * that is not true.
 */
export const paperBlocksForLandedItems = ({
  budget,
  itemTypes,
  level,
  mode,
  section,
}: {
  budget: number;
  itemTypes: readonly ItemType[];
  level: PaperLevel;
  mode: PaperMode;
  section: PaperSectionId;
}): LandedPaperBlocks | null => {
  if (mode !== "real") {
    return null;
  }
  const allocation = allocatePaperBlocks({ budget, level, section });
  const capacities = allocation.blocks.map((block) =>
    ITEM_TYPES.reduce(
      (total, itemType) => total + block.itemTypeAllocation[itemType],
      0
    )
  );
  const itemBigQuestions: number[] = [];
  const blocks: AssembledPaperBlock[] = [];
  let cursor = 0;
  for (const [index, block] of allocation.blocks.entries()) {
    const capacity = capacities[index] ?? 0;
    let filled = 0;
    // Take the next rows up to this 大問's capacity, but stop the moment a row
    // is not a type this 大問 asks. A real paper stores its items in 大問 order,
    // so a row that belongs to another 大問 means the rows and the plan disagree
    // and no heading here can be trusted.
    while (filled < capacity && cursor < itemTypes.length) {
      const itemType = itemTypes[cursor];
      if (itemType === undefined || !block.itemTypes.includes(itemType)) {
        break;
      }
      itemBigQuestions.push(block.bigQuestion);
      filled += 1;
      cursor += 1;
    }
    blocks.push({
      bigQuestion: block.bigQuestion,
      id: block.id,
      itemCount: filled,
      name: block.name,
      requestedItems: block.requested,
    });
  }
  // Every row must land in a 大問. A leftover is a paper holding an item the
  // official shape has no block for (a pre-walk flat mix) or more items than the
  // shape asks; both disagree with the plan. A block that simply came up short is
  // not a leftover and keeps its heading.
  if (cursor !== itemTypes.length) {
    return null;
  }
  return { blocks, itemBigQuestions };
};

export interface LandedPaperBlocks {
  blocks: readonly AssembledPaperBlock[];
  /** The 大問 number of each landed item, in the order the items were given.
   * The blueprint's internal block id stays out of this: the number is what the
   * paper prints and what a view groups on. */
  itemBigQuestions: readonly number[];
}

const assembledPaperBlocks = (
  request: PaperRequest,
  section: PaperSectionId,
  items: readonly AssembledPaperSlot[]
): readonly AssembledPaperBlock[] => {
  if (request.mode !== "real") {
    return [];
  }
  const landed = new Map<PaperBlockId, number>();
  for (const item of items) {
    if (item.block) {
      landed.set(item.block, (landed.get(item.block) ?? 0) + 1);
    }
  }
  return allocatePaperBlocks({
    budget: request.budget[section] ?? 0,
    level: request.level,
    section,
  }).blocks.map((block) => ({
    bigQuestion: block.bigQuestion,
    id: block.id,
    itemCount: landed.get(block.id) ?? 0,
    name: block.name,
    requestedItems: block.requested,
  }));
};

const buildAssembledSections = (
  accepted: readonly PaperSlot[],
  request: PaperRequest
): readonly AssembledPaperSection[] => {
  const blueprint = paperBlueprintFor(request.level);
  return blueprint.sections
    .filter((section) => request.sections.includes(section.id))
    .map((section) => {
      // A real paper prints its items in 大問 order, so the 小問 numbered 1 to 5
      // sit under 大問1 and the view can print one heading per block. Every
      // other mode keeps the candidate order it has always printed in.
      const byPosition =
        request.mode === "real"
          ? (left: PaperSlot, right: PaperSlot) =>
              left.requestedSlotIndex - right.requestedSlotIndex
          : (left: PaperSlot, right: PaperSlot) =>
              left.sourceIndex - right.sourceIndex;
      const items = accepted
        .filter((slot) => slot.section === section.id)
        .sort(byPosition)
        .map((slot, order) => ({ ...slot, order }));
      const requestedItems = request.budget[section.id] ?? 0;
      return {
        blocks: assembledPaperBlocks(request, section.id, items),
        id: section.id,
        items,
        itemTypeAllocation: allocatePaperMix({
          budget: requestedItems,
          level: request.level,
          mode: request.mode,
          section: section.id,
        }),
        minutes: section.minutes,
        requestedItems,
        scoringSectionIds: section.scoringSectionIds,
        shortfall: requestedItems - items.length,
      };
    });
};

const sortAssemblyRejections = (
  rejections: PaperAssemblyRejection[]
): readonly PaperAssemblyRejection[] =>
  rejections.sort(
    (left, right) =>
      paperReasonRank(left.reason) - paperReasonRank(right.reason) ||
      left.slotIndex - right.slotIndex ||
      left.candidateIndex - right.candidateIndex
  );

const rejectMismatchedCandidates = (
  candidates: readonly PaperCandidate[],
  request: PaperRequest
): {
  rejectedCandidates: ReadonlySet<number>;
  rejections: PaperAssemblyRejection[];
} => {
  const rejectedCandidates = new Set<number>();
  const rejections: PaperAssemblyRejection[] = [];
  const requestedSections = new Set(request.sections);
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const expectedSection = paperSectionForItemType({
      itemType: candidate.item.itemType,
      level: request.level,
    });
    if (
      !requestedSections.has(candidate.section) ||
      expectedSection !== candidate.section
    ) {
      rejectedCandidates.add(candidateIndex);
      rejections.push(
        rejectionForCandidate(candidate, candidateIndex, "mix-mismatch", -1)
      );
    }
  }
  return { rejectedCandidates, rejections };
};

const selectPaperSlots = ({
  candidates,
  corpus,
  desiredSlots,
  examId,
  rejectedCandidates,
  request,
}: {
  candidates: readonly PaperCandidate[];
  corpus: ItemCorpusView;
  desiredSlots: readonly DesiredPaperSlot[];
  examId: string;
  rejectedCandidates: ReadonlySet<number>;
  request: PaperRequest;
}): {
  accepted: PaperSlot[];
  rejections: PaperAssemblyRejection[];
} => {
  const pools = candidatePools(candidates);
  const cursors = new Map<string, number>();
  const accepted: PaperSlot[] = [];
  const rejections: PaperAssemblyRejection[] = [];
  for (const slot of desiredSlots) {
    const key = candidateSlotKey(slot.itemType, slot.section);
    const pool = pools.get(key) ?? [];
    const cursor = cursors.get(key) ?? 0;
    for (let index = cursor; index < pool.length; index += 1) {
      const candidateIndex = pool[index];
      if (candidateIndex === undefined) {
        continue;
      }
      const candidate = candidates[candidateIndex];
      if (candidate === undefined || rejectedCandidates.has(candidateIndex)) {
        continue;
      }
      cursors.set(key, index + 1);
      const attempt = attemptCandidate({
        candidate,
        candidateIndex,
        corpus,
        examId,
        request,
        slot,
      });
      if (!attempt.ok) {
        rejections.push(attempt.rejection);
        continue;
      }
      accepted.push(attempt.slot);
      break;
    }
  }
  return { accepted, rejections };
};

export const assemblePaper = ({
  candidates,
  corpus,
  examId,
  request: requestInput,
}: AssemblePaperInput): PaperAssemblyResult => {
  const request = parsePaperRequest(requestInput);
  if (!isNonEmptyString(examId)) {
    throw new Error("paper exam id must be a non-empty string");
  }
  const blueprint = paperBlueprintFor(request.level);
  const desiredSlots = desiredPaperSlots(request);
  const mismatches = rejectMismatchedCandidates(candidates, request);
  const selected = selectPaperSlots({
    candidates,
    corpus,
    desiredSlots,
    examId,
    rejectedCandidates: mismatches.rejectedCandidates,
    request,
  });
  const sections = buildAssembledSections(selected.accepted, request);
  const slots = sections.flatMap((section) => [...section.items]);
  const validation = validatePaper({ corpus, request, slots });
  // The paper is short by whatever the 科目 asked for and did not get, not by
  // whatever a fillable slot failed to find. In the flat modes the two are the
  // same number; in real mode a 大問 with no item type to fill it asks for its
  // 小問 and receives none, and a paper that printed four of fourteen blocks is
  // not ready.
  const shortfall = sections.reduce(
    (total, section) => total + section.shortfall,
    0
  );
  const rejections = [...mismatches.rejections, ...selected.rejections];
  return {
    blueprint,
    floors: validation.floors,
    label: paperModeLabel(request),
    ready: shortfall === 0 && validation.ok,
    rejections: sortAssemblyRejections(rejections),
    request,
    sections,
    shortfall,
    validation,
  };
};

/** A client-readable stimulus. Scripts never cross this boundary. */
export interface PaperClientStimulus {
  kind: "passage";
  text: string;
}

export type PaperClientQuestionItem = Omit<
  QuestionItem,
  "answerIndex" | "explanation" | "fsrsVocabId" | "script" | "stimuli"
> & {
  stimuli: readonly PaperClientStimulus[];
};

export interface PaperClientSlot {
  /** The 大問 id this item answers, or null outside real mode. Names are not on
   * this leg: the view reads them once from the section, not per item. */
  block: PaperBlockId | null;
  item: PaperClientQuestionItem;
  order: number;
  requestedSlotIndex: number;
}

export interface PaperClientSection {
  /** The same 大問 list the assembly holds: nothing here is server-only. */
  blocks: readonly AssembledPaperBlock[];
  id: PaperSectionId;
  items: readonly PaperClientSlot[];
  minutes: number;
  requestedItems: number;
  scoringSectionIds: readonly PaperScoringSectionId[];
  shortfall: number;
}

export interface PaperClientProjection {
  floors: PaperScoringFloorStatus;
  label: PaperModeLabel;
  level: PaperLevel;
  mode: PaperMode;
  ready: boolean;
  sections: readonly PaperClientSection[];
  shortfall: number;
}

const projectQuestionItem = (item: QuestionItem): PaperClientQuestionItem => ({
  anchors: [...item.anchors],
  id: item.id,
  itemType: item.itemType,
  level: item.level,
  options: [...item.options],
  passage: item.passage ?? null,
  prompt: item.prompt,
  seedPart: item.seedPart ?? null,
  stimuli: stimulusTexts(item, "passage").map((text) => ({
    kind: "passage",
    text,
  })),
  surface: item.surface,
});

export const projectPaperForClient = (
  paper: PaperAssemblyResult
): PaperClientProjection => ({
  floors: paper.floors,
  label: paper.label,
  level: paper.request.level,
  mode: paper.request.mode,
  ready: paper.ready,
  sections: paper.sections.map((section) => ({
    blocks: section.blocks.map((block) => ({ ...block })),
    id: section.id,
    items: section.items.map((slot) => ({
      block: slot.block,
      item: projectQuestionItem(slot.item),
      order: slot.order,
      requestedSlotIndex: slot.requestedSlotIndex,
    })),
    minutes: section.minutes,
    requestedItems: section.requestedItems,
    scoringSectionIds: [...section.scoringSectionIds],
    shortfall: section.shortfall,
  })),
  shortfall: paper.shortfall,
});
