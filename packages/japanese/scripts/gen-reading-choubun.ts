/**
 * `gen:reading-choubun` — build the composed N1 内容理解（長文） reading store
 * from MASKED SLOTS in multi-paragraph 白書 WINDOWS (TASK-173.9.12).
 * Deterministic: no LLM, no network, same input bytes produce the same output
 * bytes.
 *
 * The construction is the 中文 one (`gen-reading-chuubun.ts`) at 長文 length:
 * one noun the window prints exactly once is blanked and that noun IS the key,
 * the distractors are same-category in-level nouns the window never prints, and
 * the options are drawn by the same seeded permutation. "Exactly one defensible
 * option" holds by construction, so the batch is signed
 * `deterministic:gen-reading-choubun` and the server's existing `long-reading`
 * seam serves these rows with no new item type.
 *
 * What is different, and why: a 長文 passage is 2 to 5 CONSECUTIVE prose
 * paragraphs from ONE pinned page (see `reading-choubun-corpus.ts` for the
 * measurement that forces it), never a collage of the paragraphs that happened
 * to screen well, and it screens at this block's own 0.85 coverage floor rather
 * than the 0.9 `COVERAGE_FLOOR.N1` the single-paragraph stores clear.
 *
 * What is still judgement, and labelled the same way the 中文 and 短文 stores
 * label it: a distractor can be semantically arguable even though the window
 * never prints it. The deterministic screens remove the mechanical ambiguity
 * (single occurrence, POS match, a collocation frame no other noun fills, a
 * measured coverage floor); the residue is removed by the blind judge pass
 * frozen in `data/reading/{level}-choubun-rejected.json`, which CI only ever
 * reads.
 *
 * Two screens belong to this family alone: no paragraph of the window may be
 * one ANY shipped store already spends (a window overlaps every band), and no
 * two rows of one batch may share a paragraph (one 大問 must print 4 different
 * texts).
 *
 * Run from this package: `bun run gen:reading-choubun --level N1 --count 8`.
 */

import { join } from "node:path";
import { hashString } from "@manobu/item-engine/hash";
import { drawOptions } from "./gen-reading-chuubun";
import { parseArgsWithLevel, writeFormattedStore } from "./gen-reading-cli";
import {
  CHOUBUN_AUTHORED_BAND,
  CHOUBUN_BLOCK,
  CHOUBUN_CONSTRUCTION,
  CHOUBUN_COVERAGE_FLOOR,
  CHOUBUN_MAX_PASSAGE_LENGTH,
  CHOUBUN_SIGNER,
  CHOUBUN_STEM,
  type ChoubunWindow,
  choubunIdFor,
  choubunSpentSourceIds,
  choubunStorePath,
  choubunWindowsFor,
  readChoubunParagraphs,
  readChoubunRejections,
} from "./reading-choubun-corpus";
import {
  buildFrameFillers,
  CHUUBUN_MAX_PASSAGE_LENGTH,
  type ChuubunSlot,
  chuubunDistractorPool,
  coverageOf,
  type HakushoParagraph,
  isFrameSolvable,
  LEVEL_RANKS,
  levelsUpTo,
  type PassageBand,
  readCumulativeVocabIndex,
  slotsFor,
  splitSentences,
} from "./reading-chuubun-corpus";
import { BLANK, blankedPassage } from "./reading-n4-corpus";

const OPTION_COUNT = 4;

export interface ChoubunEntry {
  readonly answerIndex: number;
  readonly block: string;
  readonly construction: "masked-slot";
  readonly id: string;
  readonly level: string;
  readonly options: readonly string[];
  readonly passage: string;
  readonly provenance: "composed";
  /** The PDL1.0 credit the store must print, with the page URL substituted. */
  readonly sourceCredit: string;
  readonly sourceIds: readonly string[];
  readonly sourceUrl: string;
  readonly stem: string;
  readonly validated: boolean;
  readonly validatedBy: string;
}

/** The window's own sentences. The blank's frame is a property of the sentence
 * that HOLDS it, so the same `splitSentences` the 中文 pipeline uses runs over
 * the joined text. */
const sentencesOf = (
  window: ChoubunWindow
): ReturnType<typeof splitSentences> =>
  splitSentences({
    id: window.pageId,
    license: "PDL-1.0",
    pageId: window.pageId,
    pageUrl: window.pageUrl,
    source: window.sourceCredit,
    text: window.text,
    title: "",
  });

/** The outcome of one slot attempt: emit the row, skip to the next slot, or
 * abandon the window. `drawOptions` can return null and the original loop
 * ABORTED the whole row on that null while every other screen only skipped
 * the slot, so the three outcomes are a union, not a nullable entry. */
type SlotAttempt =
  | { readonly kind: "abort" }
  | { readonly kind: "continue" }
  | { readonly entry: ChoubunEntry; readonly kind: "row" };

/** The window with the slot blanked, or null when the blank did not land. */
const slotPassage = (
  slot: ChuubunSlot,
  window: ChoubunWindow
): string | null => {
  const passage = blankedPassage(
    { en: "", id: window.pageId, jp: window.text, linkedWords: [] },
    slot.surface,
    // The window already fits this block's band; the blank cannot lengthen it,
    // and the cap the row prints under stays the 中文 ceiling the server
    // budgets for a long passage.
    Math.min(CHUUBUN_MAX_PASSAGE_LENGTH, CHOUBUN_MAX_PASSAGE_LENGTH)
  );
  if (passage === null || !passage.includes(BLANK)) {
    return null;
  }
  return passage;
};

/** Screen one slot of the window and, when it survives every screen, finish
 * the row. */
const finishSlot = ({
  fillers,
  index,
  level,
  maxRank,
  sentences,
  slot,
  window,
}: {
  fillers: ReturnType<typeof buildFrameFillers>;
  index: ReturnType<typeof readCumulativeVocabIndex>;
  level: string;
  maxRank: number;
  sentences: ReturnType<typeof splitSentences>;
  slot: ChuubunSlot;
  window: ChoubunWindow;
}): SlotAttempt => {
  if (!isFrameSolvable(sentences, slot, index, fillers)) {
    return { kind: "continue" };
  }
  if (CHOUBUN_STEM.includes(slot.surface)) {
    // stem-leak: the fixed stem itself prints 一つ, so a slot with that
    // surface is an answer inside the question, which the gate's
    // validateQuestionItem refuses — skip the slot, do not emit the row.
    return { kind: "continue" };
  }
  const passage = slotPassage(slot, window);
  if (passage === null) {
    return { kind: "continue" };
  }
  const pool = chuubunDistractorPool(
    index,
    slot.pos,
    maxRank,
    slot.entry,
    slot.surface,
    window.text
  );
  if (pool.length < OPTION_COUNT - 1) {
    return { kind: "continue" };
  }
  const drawn = drawOptions(
    slot.surface,
    pool,
    hashString(`choubun:${window.ids.join("+")}:${slot.surface}`)
  );
  if (drawn === null) {
    return { kind: "abort" };
  }
  return {
    entry: {
      ...drawn,
      block: CHOUBUN_BLOCK,
      construction: CHOUBUN_CONSTRUCTION,
      id: choubunIdFor(level, window.ids[0] ?? ""),
      level,
      passage,
      provenance: "composed",
      sourceCredit: window.sourceCredit,
      sourceIds: window.ids,
      sourceUrl: window.pageUrl,
      stem: CHOUBUN_STEM,
      validated: true,
      validatedBy: CHOUBUN_SIGNER,
    },
    kind: "row",
  };
};

/** Build one row from a window, or null when no slot in it is decidable from
 * the window alone.
 *
 * `floor` defaults to this block's own 0.85. A caller that measures a candidate
 * source at the level's SINGLE-PARAGRAPH bar (`COVERAGE_FLOOR.N3` = 0.8) passes
 * it explicitly, so the supply is counted at both bars through this same code
 * path rather than a second copy of the screens that could drift from it. */
export const buildChoubunEntry = (
  window: ChoubunWindow,
  level: string,
  index: ReturnType<typeof readCumulativeVocabIndex>,
  fillers: ReturnType<typeof buildFrameFillers>,
  floor: number = CHOUBUN_COVERAGE_FLOOR
): ChoubunEntry | null => {
  const maxRank = LEVEL_RANKS[level] ?? 0;
  if (coverageOf(window.text, index, maxRank) < floor) {
    return null;
  }
  const sentences = sentencesOf(window);
  for (const slot of slotsFor(window.text, sentences, index, maxRank)) {
    const attempt = finishSlot({
      fillers,
      index,
      level,
      maxRank,
      sentences,
      slot,
      window,
    });
    if (attempt.kind === "row") {
      return attempt.entry;
    }
    if (attempt.kind === "abort") {
      return null;
    }
  }
  return null;
};

/** The whole batch for a level: walk the admissible windows in corpus order,
 * keep the first `count` rows, one row per ANSWER WORD (a paper must ask
 * distinct things), spend each paragraph once, and skip any row the judge
 * rejected. */
export const buildChoubunBatch = ({
  band,
  count,
  fillers,
  floor,
  index,
  level,
  paragraphs,
  rejections,
  spent,
}: {
  band?: PassageBand;
  count: number;
  fillers: ReturnType<typeof buildFrameFillers>;
  floor?: number;
  index: ReturnType<typeof readCumulativeVocabIndex>;
  level: string;
  paragraphs: readonly HakushoParagraph[];
  rejections: ReadonlySet<string>;
  spent: ReadonlySet<string>;
}): readonly ChoubunEntry[] => {
  const batch: ChoubunEntry[] = [];
  const seenAnswers = new Set<string>();
  const usedParagraphs = new Set<string>();
  for (const window of choubunWindowsFor({ band, paragraphs, spent })) {
    if (batch.length >= count) {
      break;
    }
    if (window.ids.some((id) => usedParagraphs.has(id))) {
      continue;
    }
    const entry = buildChoubunEntry(window, level, index, fillers, floor);
    if (entry === null || rejections.has(entry.id)) {
      continue;
    }
    const answer = entry.options[entry.answerIndex];
    if (answer === undefined || seenAnswers.has(answer)) {
      continue;
    }
    seenAnswers.add(answer);
    for (const id of window.ids) {
      usedParagraphs.add(id);
    }
    batch.push(entry);
  }
  return batch;
};

const parseArgs = (argv: readonly string[]): { count: number; level: string } =>
  parseArgsWithLevel(argv, {
    defaultCount: 8,
    defaultLevel: "N1",
    levelGuard: (level) => {
      if (CHOUBUN_AUTHORED_BAND[level] !== undefined) {
        // The same table the gate reads to pick the authored screens is what says this
        // level's 長文 rows are written, so the refusal cannot drift from the proof.
        // N1 joined the authored route in TASK-173.9.21, which is why this generator no
        // longer has a level it may write: the window builder stays as the code the
        // fixtures exercise, not as a route a regeneration can take back.
        throw new Error(
          `--level ${level} is composed as authored 長文 rows (doc-27 §10); write the store and freeze its judge record instead of generating`
        );
      }
      if (level !== "N1") {
        throw new Error(
          `--level must be N1: this generator builds masked-slot windows over the 白書 corpus and N3's 大問6 does not use them. The probe measured three non-環境省 arms at 1 disjoint buildable row where the 大問 prints 4 (TASK-173.9.14, \`bun run probe:n3-choubun\`), and doc-27 §10 closed the hole a different way rather than by lowering the floor: N3 長文 ships AUTHORED comprehension rows, screened by the authored branch of \`check-reading-choubun.ts\` and certified per doc-27 §11. Regenerating that file by hand means writing rows, not running this script.`
        );
      }
    },
  });

if (import.meta.main) {
  const dataDir = join(import.meta.dir, "..", "data");
  const storeDir = join(dataDir, "reading");
  const { count, level } = parseArgs(process.argv.slice(2));
  const paragraphs = readChoubunParagraphs(join(storeDir, "hakusho.jsonl"));
  const index = readCumulativeVocabIndex(dataDir, levelsUpTo(level));
  const maxRank = LEVEL_RANKS[level] ?? 0;
  const fillers = buildFrameFillers(
    paragraphs.flatMap((paragraph) => splitSentences(paragraph)),
    index,
    maxRank
  );
  const batch = buildChoubunBatch({
    count,
    fillers,
    index,
    level,
    paragraphs,
    rejections: readChoubunRejections(storeDir, level),
    spent: choubunSpentSourceIds(storeDir),
  });
  const outPath = choubunStorePath(storeDir, level);
  writeFormattedStore(outPath, batch, "gen:reading-choubun");
  console.log(
    `${level}-choubun.json: ${batch.length} masked-slot rows from ${paragraphs.length} paragraphs`
  );
}
