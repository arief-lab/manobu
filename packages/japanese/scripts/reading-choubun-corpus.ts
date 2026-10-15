/**
 * Shared constants and screens for the 内容理解（長文） reading pipeline
 * (TASK-173.9.12, TASK-173.9.16). The generator (`gen-reading-choubun.ts`) and
 * the gate (`check-reading-choubun.ts`) both import this module, so a screen is
 * a contract rather than a claim, exactly as in `reading-chuubun-corpus.ts` and
 * `reading-tanbun-corpus.ts`.
 *
 * THIS BLOCK SHIPS TWO CONSTRUCTIONS, and the screens below split accordingly.
 *
 * `masked-slot` (no level since TASK-173.9.21): one noun of a multi-paragraph
 * 白書 WINDOW replaced by `＿＿`. Every property of the row is mechanically
 * provable, because the key is a word the source itself prints: restore the blank
 * and the passage is byte equal to a window the corpus still admits. N1 shipped
 * eight such rows and the branch is CLOSED, not deleted: the gate, the generator,
 * `CHOUBUN_COVERAGE_FLOOR` and this file's window screens stay, exercised by the
 * committed fixtures in `test/check-reading-choubun.test.ts`, because a blanked
 * noun trains slot recovery under a 内容理解（長文）heading.
 *
 * `authored` (N3 since TASK-173.9.16, N1 since TASK-173.9.21): a comprehension
 * 小問 written for this app. There is no source
 * to restore to and no blank to refill, so none of the window screens apply, and
 * the key is a READING of the text rather than a word inside it. What replaces
 * them is the two-leg certification doc-27 §11 records: the shape screens in
 * this file (band, distinct options, verbatim evidence span, stem spread, key
 * spread), and blind judges that must QUOTE the deciding sentence with the keys
 * withheld. There is no third leg. Nobody in this project reads Japanese, so no
 * human can check whether a passage decides its key, and an English review sheet
 * would only ask a reader to agree with the model's own translation. The coverage
 * floor is deliberately NOT one of the legs either; see
 * `CHOUBUN_AUTHORED_BAND`. The residual risk is unbounded by construction and is
 * stated rather than fixed: a wrong key this model believes ships wrong.
 *
 * Nothing here re-implements a predicate: the segmentation, coverage, slot,
 * frame and distractor-pool screens ARE the 中文 ones, imported below. What
 * differs for the masked-slot route is the PASSAGE: a 長文 小問 prints a WINDOW
 * of consecutive 白書 paragraphs rather than one `<p>`, because the official
 * 長文 ねらい is a 1000字程度 document and no single 白書 paragraph in this
 * corpus reaches it (the longest is 1570 runes, and only 19 clear 900).
 *
 * THE FLOOR IS A MEASURED CLAIM, NOT A CONCESSION, and it is a floor on the
 * masked-slot route only. `COVERAGE_FLOOR.N1 = 0.9`
 * stays exactly where it is, and it still governs every WINDOWED row this package
 * can build; what has changed is that since TASK-173.9.18/.19/.20/.21 no shipped
 * 読解 store at N1 is windowed, so an N1 learner meets the bar nowhere in served
 * data and the number survives as the screen the fixtures still prove. This block
 * declares its own 0.85 for one reason: pointed at the official 2018 読解
 * sample papers (`https://www.jlpt.jp/samples/sample2018/pdf/N1R.pdf`, read
 * with `pdftotext -layout`, nothing vendored, doc-27 §1), the five extracted
 * official N1 読解 texts (1052-2716 runes) score 86.0% to 89.1% under this
 * same instrument. A bar that rejects authentic N1 exam prose is mis-measuring
 * the 長文 register, not protecting the learner, so 長文 screens at 0.85 and
 * every other 大問 keeps the 0.9 the shipped stores already clear (medians
 * 90.0 / 90.2 / 91.6). The trade is stated in `data/LICENSE.md` rather than
 * buried: 長文 rows are screened 5 points looser than their 中文 neighbours,
 * and they print MORE unknown runes per window than the real exam does at this
 * level by the same measurement.
 *
 * The masked-slot band is pinned by two facts. The server budgets a
 * `long-reading` passage at `LONG_READING_MAX_PASSAGE_LENGTH` (1200 runes,
 * `apps/server/src/services/exam-service.ts:161`), and the official N1 長文 is
 * 1000字程度 (doc-26 §3.5), so 900-1200 is the window that is both a 長文 and
 * printable. Measured over the shipped corpus on 2026-10-08 with the adjacency
 * rule below and every sibling store's paragraphs subtracted: 443 strict
 * windows, 35 clear 0.85, 30 of them mutually disjoint, against the 4 one N1
 * paper spends. These three counts move whenever another store freezes (the
 * `spent` set is a function of the whole shelf), so re-measure rather than
 * quote them.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type HakushoParagraph,
  type PassageBand,
  readHakushoParagraphs,
} from "./reading-chuubun-corpus";
import { readRejectedIdsFrom } from "./reading-n4-corpus";

/** The block this pipeline fills: N1 大問10 and N3 大問6. The two levels get
 * there differently. N3 was MEASURED against the same floor and refused
 * (TASK-173.9.14: 1 disjoint buildable row across three non-環境省 arms, where
 * the 大問 prints 4), and doc-27 §10 closes it by authoring: the floor screens
 * vocabulary simplicity, which is not what a 長文 小問 asks. N1 took the same
 * route in TASK-173.9.21, and for the 大問 rather than the corpus: its windows
 * cleared 0.85 and filled eight rows, but every one of them asked for a noun. */
export const CHOUBUN_BLOCK = "naiyou-rikai-choubun";

/** The signer a generated 長文 row carries. Names the PIPELINE, not a model:
 * the key is the word the window itself prints. */
export const CHOUBUN_SIGNER = "deterministic:gen-reading-choubun";

/** The construction tag: one noun of a multi-paragraph window replaced by
 * `＿＿`, that noun as the key. Same tag as the 中文 and 短文 stores. */
export const CHOUBUN_CONSTRUCTION = "masked-slot";

/** Fixed stem. Identical to the 中文 and 短文 wording because the construction
 * is identical, and it says 文章 rather than 文 because a 長文 row prints
 * several sentences across several paragraphs. Fixed text cannot leak the key. */
export const CHOUBUN_STEM =
  "この文章の＿＿に入る語として、最も適切なものを一つ選びなさい。";

/** Per-block coverage floor. See the module header: this is the measured 長文
 * bar, derived from the official sample papers scoring 86.0-89.1%, and it does
 * NOT touch `COVERAGE_FLOOR`. */
export const CHOUBUN_COVERAGE_FLOOR = 0.85;

/** Shortest and longest printed 長文 window: the server's 1200-rune
 * `long-reading` budget, and the 1000字程度 official target rounded down to a
 * band the corpus can actually fill. */
export const CHOUBUN_MIN_PASSAGE_LENGTH = 900;
export const CHOUBUN_MAX_PASSAGE_LENGTH = 1200;

/** The authored passage band per level, in runes. doc-27 §1 measured the
 * official N3 長文 sample text at 658 runes and the official N3 中文 at 382, so
 * 500-700 brackets the real 長文 and sits above the real 中文; the server prints
 * either under the same 1200-rune `long-reading` budget. Length alone does not
 * make a 長文 (the shipped N3 中文 store reaches 592 runes), which is why the
 * band is only one screen: what makes an authored row a 長文 is that it is a
 * multi-paragraph document carrying one argument, and the gate checks that the
 * stem's ねらい and the row's own evidence span land inside it. The coverage
 * floor is NOT part of this: an authored row is screened on whether its evidence
 * sentence decides the key, not on how many of its runes are on the wordlist.
 *
 * N1's band is the same 900-1200 window the masked store this level shipped
 * until TASK-173.9.21 was built in: the official N1 長文 is 1000字程度 (doc-26
 * §3.5), the frozen rows measured 900-1122 runes, and `max` is the server's
 * `LONG_READING_MAX_PASSAGE_LENGTH` budget. A written N1 長文 therefore owes the
 * learner exactly the document size the level already printed, and the ceiling
 * separation from N3 (700) is what stops an N1 row being an N3 row re-headed.
 */
export const CHOUBUN_AUTHORED_BAND: Readonly<Record<string, PassageBand>> = {
  N1: { max: 1200, min: 900 },
  N3: { max: 700, min: 500 },
};

/** A paragraph shorter than this is a heading or a lead-in fragment, not 長文
 * prose (the same reason `CHUUBUN_MIN_PASSAGE_LENGTH` exists), and it BREAKS a
 * window rather than being skipped: the printed text must be consecutive
 * document prose, not a collage of the paragraphs that happened to measure
 * well. */
export const CHOUBUN_MIN_PARAGRAPH_RUNES = 150;

/** A window is 2 to 5 paragraphs. Two is the minimum that makes it a multi-
 * paragraph 長文 rather than the 中文 store's single `<p>`; five bounds the
 * band at the server's 1200-rune budget. */
export const CHOUBUN_MIN_PARAGRAPHS = 2;
export const CHOUBUN_MAX_PARAGRAPHS = 5;

/** The rune cost of joining paragraphs: the store prints the window with a
 * `\n` between each pair. */
const JOIN_RUNES = 1;

/** Row id prefix: `n1b-<first paragraph id>`, mirroring 中文's `n1c-` and
 * 主張理解's `n1s-`. A window is identified by where it starts. */
export const choubunIdFor = (level: string, firstParagraphId: string): string =>
  `${level.toLowerCase()}b-${firstParagraphId}`;

/** One printable window of consecutive 白書 prose. */
export interface ChoubunWindow {
  readonly ids: readonly string[];
  readonly pageId: string;
  readonly pageUrl: string;
  readonly runes: number;
  /** The PDL1.0 credit the store must print, from the source page. */
  readonly sourceCredit: string;
  /** The joined text, `\n` between paragraphs: what the 小問 prints. */
  readonly text: string;
}

/** The sequence position a paragraph holds inside its page. `fetch-hakusho.ts`
 * numbers the paragraphs it keeps per page from 1, so the trailing `-<n>` of
 * the id is that position (`3-6-3-9` is 白書 section 3-6-3, paragraph 9). */
const positionOf = (paragraph: HakushoParagraph): number => {
  const dash = paragraph.id.lastIndexOf("-");
  const parsed = Number.parseInt(paragraph.id.slice(dash + 1), 10);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
};

const runesOf = (text: string): number => [...text].length;

/** The files a spent-source scan reads: shipped stores, not judge records,
 * claims, or the store this very pipeline freezes. */
const isSpentScanFile = (file: string): boolean =>
  file.endsWith(".json") &&
  !file.endsWith("-rejected.json") &&
  !file.endsWith("-claims.json") &&
  file !== "n1-choubun.json";

/** The ids one store file prints. */
const fileSourceIds = (storeDir: string, file: string): ReadonlySet<string> => {
  const ids = new Set<string>();
  const rows = JSON.parse(readFileSync(join(storeDir, file), "utf8")) as
    | { readonly sourceIds?: readonly unknown[] }
    | readonly { readonly sourceIds?: readonly unknown[] }[];
  for (const row of Array.isArray(rows) ? rows : [rows]) {
    for (const id of row?.sourceIds ?? []) {
      if (typeof id === "string") {
        ids.add(id);
      }
    }
  }
  return ids;
};

/**
 * Every 白書 paragraph id a 長文 window may not print: the ids ANY shipped
 * store spends, at any level. A 長文 window is several paragraphs long, so it
 * collides with far more rows than a single-paragraph 中文 does, and one paper
 * must not show a learner the same text twice across two 大問. This is the
 * `tanbunSpentSourceIds` rule widened: 短文 excludes the same level's siblings
 * plus the other levels' 短文, and a 長文 window adds the other levels' 中文,
 * 主張理解, 統合理解 and 情報検索 too, because a window 900-1200 runes long
 * overlaps every band.
 *
 * `n1-choubun.json` itself is excluded from the read so a regeneration is not
 * blocked by its own previous freeze.
 */
export const choubunSpentSourceIds = (
  storeDir: string
): ReadonlySet<string> => {
  const spent = new Set<string>();
  for (const file of readdirSync(storeDir)) {
    if (!isSpentScanFile(file)) {
      continue;
    }
    for (const id of fileSourceIds(storeDir, file)) {
      spent.add(id);
    }
  }
  return spent;
};

/**
 * Is this paragraph 長文 prose at all: long enough to be document body, and
 * positioned inside its page? A paragraph that fails either one BREAKS a run
 * rather than being skipped, because the printed window has to be consecutive
 * document prose.
 */
const isChoubunProse = (paragraph: HakushoParagraph): boolean =>
  runesOf(paragraph.text) >= CHOUBUN_MIN_PARAGRAPH_RUNES &&
  Number.isFinite(positionOf(paragraph));

/** Accumulate from `start` until the joined text first reaches the floor, or
 * the paragraph cap / run end is hit. */
const gatherWindowParts = (
  band: PassageBand,
  run: readonly HakushoParagraph[],
  start: number
): { readonly parts: HakushoParagraph[]; readonly runes: number } => {
  const parts: HakushoParagraph[] = [];
  let runes = 0;
  for (
    let at = start;
    at < run.length && parts.length < CHOUBUN_MAX_PARAGRAPHS;
    at += 1
  ) {
    const paragraph = run[at];
    if (paragraph === undefined) {
      continue;
    }
    parts.push(paragraph);
    runes += runesOf(paragraph.text) + (parts.length > 1 ? JOIN_RUNES : 0);
    if (runes < band.min) {
      continue;
    }
    break;
  }
  return { parts, runes };
};

/** Why this accumulation is not a window: under the floor, over the cap, too
 * few paragraphs, or a paragraph another store already spends. */
const windowRejected = ({
  band,
  first,
  parts,
  runes,
  spent,
}: {
  readonly band: PassageBand;
  readonly first: HakushoParagraph | undefined;
  readonly parts: readonly HakushoParagraph[];
  readonly runes: number;
  readonly spent: ReadonlySet<string>;
}): boolean =>
  first === undefined ||
  runes < band.min ||
  runes > band.max ||
  parts.length < CHOUBUN_MIN_PARAGRAPHS ||
  parts.some((each) => spent.has(each.id));

/**
 * The window a run yields when it starts at `start`, or null when that start
 * prints nothing: the paragraphs accumulate until the joined text first reaches
 * the floor, and one look at THAT is the whole decision, because a longer window
 * only adds runes and overshoots the cap. Under the floor, over the cap, fewer
 * than `CHOUBUN_MIN_PARAGRAPHS`, or a paragraph another store already spends, and
 * there is no window at this start.
 */
const windowFromStart = (
  band: PassageBand,
  run: readonly HakushoParagraph[],
  start: number,
  spent: ReadonlySet<string>
): ChoubunWindow | null => {
  const { parts, runes } = gatherWindowParts(band, run, start);
  const [first] = parts;
  if (
    first === undefined ||
    windowRejected({ band, first, parts, runes, spent })
  ) {
    return null;
  }
  return {
    ids: parts.map((each) => each.id),
    pageId: first.pageId,
    pageUrl: first.pageUrl,
    runes,
    sourceCredit: first.source,
    text: parts.map((each) => each.text).join("\n"),
  };
};

/**
 * The admissible windows for one level, in corpus order: every run of 2 to 5
 * consecutive prose paragraphs (each at least `CHOUBUN_MIN_PARAGRAPH_RUNES`,
 * from ONE page) whose joined length lands in the band and none of whose
 * paragraphs another store already spends.
 *
 * `band` defaults to THIS block's 900-1200 window, which is the N1 1000字程度
 * ねらい. A caller measuring another level's 長文 supply passes that level's own
 * official band, because the band is a property of the 大問 at a level, not of
 * the construction: N3's 長文 is 550字程度 (doc-26 §4), and searching the N1
 * window for it would answer a question nobody asked.
 *
 * Order is page order then start position, so the generator's first N rows are
 * a property of the corpus, not of a hash.
 */
export const choubunWindowsFor = ({
  band = {
    max: CHOUBUN_MAX_PASSAGE_LENGTH,
    min: CHOUBUN_MIN_PASSAGE_LENGTH,
  },
  paragraphs,
  spent,
}: {
  band?: PassageBand;
  paragraphs: readonly HakushoParagraph[];
  spent: ReadonlySet<string>;
}): readonly ChoubunWindow[] => {
  const byPage = new Map<string, HakushoParagraph[]>();
  for (const paragraph of paragraphs) {
    const list = byPage.get(paragraph.pageId) ?? [];
    list.push(paragraph);
    byPage.set(paragraph.pageId, list);
  }
  const out: ChoubunWindow[] = [];
  for (const list of byPage.values()) {
    list.sort((left, right) => positionOf(left) - positionOf(right));
    let run: HakushoParagraph[] = [];
    const flush = (): void => {
      for (let start = 0; start < run.length; start += 1) {
        const window = windowFromStart(band, run, start, spent);
        if (window !== null) {
          out.push(window);
        }
      }
      run = [];
    };
    for (const paragraph of list) {
      if (isChoubunProse(paragraph)) {
        run.push(paragraph);
      } else {
        flush();
      }
    }
    flush();
  }
  return out;
};

/** The shipped 白書 corpus, in file order. */
export const readChoubunParagraphs = (
  path: string
): readonly HakushoParagraph[] => readHakushoParagraphs(path);

/** The store dir a level's 長文 file lives in. */
export const choubunStorePath = (storeDir: string, level: string): string =>
  join(storeDir, `${level.toLowerCase()}-choubun.json`);

/** Is this level's 長文 store frozen yet? The gate reads a missing file as
 * "not frozen" and fails; the generator overwrites it. */
export const choubunStoreExists = (storeDir: string, level: string): boolean =>
  existsSync(choubunStorePath(storeDir, level));

/**
 * The freeze-time judge record for one 長文 level: row ids the blind judge
 * rejected (AMBIGUOUS or UNANSWERABLE), same shape as 中文's
 * `readChuubunRejections`, and the same rule: CI only ever READS this list, it
 * never runs a model to write it.
 */
export const readChoubunRejections = (
  storeDir: string,
  level: string
): ReadonlySet<string> =>
  readRejectedIdsFrom(storeDir, `${level.toLowerCase()}-choubun-rejected.json`);
