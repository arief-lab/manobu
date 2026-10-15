/**
 * Shared constants and screens for the 内容理解（短文）reading pipeline
 * (TASK-173.9.11): since TASK-173.9.18 the authored N3 store, since
 * TASK-173.9.19 the authored N4 store, since TASK-173.9.20 the authored N2 store
 * and since TASK-173.9.21 the authored N1 store, whose bands this module also
 * owns. The generator and the gate both import it, so a screen is a contract
 * rather than a claim, exactly as in `reading-chuubun-corpus.ts`.
 *
 * Nothing here re-implements a predicate: the segmentation, coverage, slot,
 * frame and distractor-pool screens ARE the 中文 ones, so one difficulty claim
 * (`COVERAGE_FLOOR`) governs both 大問. What differs is the LENGTH BAND, the
 * block the row fills, and one cross-family exclusion.
 *
 * The band is pinned by two measured facts. The server caps a `short-reading`
 * passage at `MAX_PASSAGE_LENGTH` (240 runes, `apps/server/src/services/exam-service.ts:159`),
 * and the 中文 floor of 200 exists because a short 白書 `<p>` is often a heading
 * or a lead-in fragment rather than a passage. Measured over the shipped corpus
 * on 2026-10-08, the 100-240 rune window still holds connected prose: 131 N3,
 * 336 N2 and 190 N1 paragraphs clear their floor there, yielding 1099/3375/2780
 * admissible cloze slots over 252/473/542 distinct answer nouns. So 100 is the
 * floor that keeps headings out, and 240 is the ceiling the server already
 * enforces.
 *
 * The exclusion is what makes two 大問 of ONE paper print different texts. The
 * 中文, 主張理解 and 統合理解 stores drew from the same 白書 paragraphs, and their
 * bands overlap the 短文 band between 200 and 240 runes, so a 短文 row may not
 * source from a paragraph the level's other stores already spend. The other
 * levels' 短文 stores are excluded for a second reason: three levels generated
 * from the head of the same corpus picked the same paragraphs, and the item's
 * own id cannot tell a repeat learner about it because it names its level.
 * Since TASK-173.9.21 NO level builds this block from a 白書 window any more
 * (`TANBUN_SOURCE` is `authored` at N1, N2, N3 and N4, and N5 is licensed), so
 * the exclusion derives an empty level list and subtracts nothing: a written row
 * prints no `sourceIds`, spends no paragraph and blocks no other level. The
 * branch is closed, not deleted, exactly as 中文's `stitched-in-level` arm is,
 * and `tanbunSpentSourceIds` stays the predicate that would keep two windowed
 * stores apart if a level ever went back.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PassageBand } from "./reading-chuubun-corpus";
import { readRejectedIdsFrom } from "./reading-n4-corpus";

/** The block this pipeline fills: N3 大問4 / N2 大問10 / N1 大問8. */
export const TANBUN_BLOCK = "naiyou-rikai-tanbun";

/** The signer a generated 短文 row carries. Names the PIPELINE, not a model:
 * the key is the word the source paragraph itself prints. */
export const TANBUN_SIGNER = "deterministic:gen-reading-tanbun";

/** The construction tag, shared with the 中文 and N4 短文 stores: one noun of a
 * sourced paragraph replaced by `＿＿`, that noun as the key. */
export const TANBUN_CONSTRUCTION = "masked-slot";

/** Fixed stem every 短文 小問 prints. It claims exactly what the screens prove
 * (the passage licenses one noun in that slot), so the question is never
 * stronger than its oracle, and fixed text cannot leak the key. Same wording as
 * the 中文 stem because the construction is the same; it says 文章, not 文,
 * because a 短文 row prints several sentences. */
export const TANBUN_STEM =
  "この文章の＿＿に入る語として、最も適切なものを一つ選びなさい。";

/** Shortest printed 短文 passage: below this a 白書 `<p>` is a heading, not a
 * passage (see the module header). */
export const TANBUN_MIN_PASSAGE_LENGTH = 100;

/** Mirror of the server's `short-reading` passage cap. A 短文 that will not fit
 * that budget is not a 短文 row however well it screens. */
export const TANBUN_MAX_PASSAGE_LENGTH = 240;

/**
 * The band an AUTHORED 短文 prints, per level. The masked-slot band above is a
 * property of the 白書 window it has to find (100 is where a `<p>` stops being a
 * heading), and a written passage owes nothing to that: what it owes is the real
 * 大問4 document, which the masked store this level shipped until
 * TASK-173.9.18 measures — over that frozen N3 batch the windows ran 101-182
 * runes, so 120 is a floor a written row cannot be fluffed under and 240 stays
 * the cap the server enforces for the whole family.
 *
 * Only the levels this block WRITES at appear. A level with no entry is refused
 * with `authored-band-unknown` rather than measured against a borrowed band,
 * which is the same fail-closed shape `CHOUBUN_AUTHORED_BAND` uses.
 */
export const TANBUN_AUTHORED_BAND: Readonly<Record<string, PassageBand>> = {
  // Measured the same way as the three entries above: over the frozen masked-slot
  // N1 batch this level shipped until TASK-173.9.21 the windows ran 100-197 runes,
  // and the written row has to clear both the shortest thing the level already
  // served AND the authored floors below it (N2 140, N3 120, N4 110), so 160 is the
  // first number that is none of those. 240 stays the cap the server enforces for
  // the whole family (`MAX_PASSAGE_LENGTH`,
  // `apps/server/src/services/exam-service.ts:159`).
  N1: { max: 240, min: 160 },
  // Measured the same way as the two entries below: over the frozen masked-slot
  // N2 batch this level shipped until TASK-173.9.20 the windows ran 101-233
  // runes, so the written row has to clear the shortest thing the level already
  // served. 140 sits above the N3 authored floor (120) and above the shortest
  // written N3 row (122), so an N2 短文 is never an N3 短文 by length, and 240
  // stays the cap the server enforces for the family. The difficulty itself is
  // the word list the rows are written with, which no length can express.
  N2: { max: 240, min: 140 },
  N3: { max: 240, min: 120 },
  // No official N4 短文 length is pinned anywhere in this repo (doc-26 §3.2 gives
  // the 小問 count, and the per-level PDF names 字程度 only for 中文 and 情報検索),
  // so this band is a SHAPE contract, not a difficulty ladder: 110 sits above the
  // shortest real N5 passage in the licensed store (`data/reading/n5.json`, 60 rows
  // measuring 102-149) so a written N4 row is not an N5 row by length, and 240 stays
  // the cap the server enforces for the family. What makes it N4 is the word list the
  // rows are written with, which no length can express and no authored screen measures.
  N4: { max: 240, min: 110 },
};

/** The construction a 短文 store is built with, per level. The generator reads this
 * to decide whether it may run at all, and the gate reads it to decide which proof
 * a row may claim: a row cannot choose its own evidence, so a 白書 window tagged
 * into the authored N2 store is refused exactly like a written row smuggled into a
 * windowed one. `hakusho` masks one kanji noun out of a 白書 paragraph,
 * `authored` writes the sentence and has it blind-judged. N5 is absent: its 短文
 * store is licensed, not composed, and a different gate reads it.
 *
 * Since TASK-173.9.21 no level is `hakusho`, so `gen:reading-tanbun` refuses every
 * level in this table and the windowed branch survives only as code plus its
 * fixtures. That is the closed-not-deleted shape TASK-173.9.19 set for 中文's
 * stitch: a blanked noun trains a vocabulary lookup, not the 内容理解 ねらい the
 * 大問 states (doc-27 §14). */
export const TANBUN_SOURCE: Readonly<Record<string, "authored" | "hakusho">> = {
  N1: "authored",
  N2: "authored",
  N3: "authored",
  N4: "authored",
};

/** The construction tags this block's two routes print. A row tagged anything else
 * is unknown at the boundary and gets no branch, hence no proof. */
export const TANBUN_CONSTRUCTIONS = ["authored", "masked-slot"] as const;

export type TanbunConstruction = (typeof TANBUN_CONSTRUCTIONS)[number];

/** The construction the level's route builds. A level with no entry is treated as
 * the windowed store it would have to be, which is the fail-closed half: an
 * unlisted level has no authored band, so its written row is refused there too. */
export const tanbunConstructionForLevel = (
  level: string
): TanbunConstruction =>
  TANBUN_SOURCE[level] === "authored" ? "authored" : TANBUN_CONSTRUCTION;

/** The construction a frozen row claims, or null when the tag is not one this
 * block knows. */
export const tanbunConstructionOf = (
  construction: string | undefined
): TanbunConstruction | null =>
  TANBUN_CONSTRUCTIONS.find((each) => each === construction) ?? null;

/** The other 白書 stores of the SAME level, whose source paragraphs a 短文 row
 * may not reuse. `tougou` contributes both sides of each pair. */
const SIBLING_STORE_SUFFIXES = ["chuubun", "chuushou", "tougou"] as const;

/** The levels whose 短文 store is composed from 白書 paragraphs, and whose
 * sources therefore compete for the same paragraphs. Read off `TANBUN_SOURCE`,
 * so the table that picks the proof is the same table that spends the corpus.
 * Since TASK-173.9.21 this list is EMPTY: every level this block serves is
 * licensed (N5) or written (N1, N2, N3, N4), and none of them shares a paragraph
 * id with the 白書 family. An empty list is a real state, not a bug: the
 * exclusion below subtracts nothing and still subtracts correctly the day a level
 * goes back to windows. */
const HAKUSHO_TANBUN_LEVELS: readonly string[] = Object.entries(TANBUN_SOURCE)
  .filter(([, source]) => source === "hakusho")
  .map(([level]) => level);

/** The 短文 ids one store file prints; a missing file contributes nothing. */
const tanbunFileSourceIds = (path: string): string[] => {
  if (!existsSync(path)) {
    return [];
  }
  const rows = JSON.parse(readFileSync(path, "utf8")) as readonly {
    readonly block?: string;
    readonly sourceIds?: readonly unknown[];
  }[];
  const ids: string[] = [];
  for (const row of rows) {
    if (row.block !== TANBUN_BLOCK) {
      continue;
    }
    for (const id of row.sourceIds ?? []) {
      if (typeof id === "string") {
        ids.push(id);
      }
    }
  }
  return ids;
};

/** Source ids printed by the 短文 stores of the OTHER levels. A learner who
 * steps from an N3 paper to an N2 one meets a new text, not the same passage
 * with the same key: `seenAnchors` cannot catch that repeat because the ids
 * differ by level, so the disjointness has to be a corpus property. */
const otherLevelTanbunSourceIds = (
  storeDir: string,
  level: string
): readonly string[] => {
  const ids: string[] = [];
  for (const each of HAKUSHO_TANBUN_LEVELS) {
    if (each === level) {
      continue;
    }
    ids.push(
      ...tanbunFileSourceIds(join(storeDir, `${each.toLowerCase()}.json`))
    );
  }
  return ids;
};

/** Every 白書 paragraph id a 短文 row may not print: the level's other stores,
 * plus the 短文 stores of the other 白書 levels. A missing file contributes
 * nothing, which is correct: N3 has no 主張理解 or 統合理解 store, so nothing
 * there is excluded. */
export const tanbunSpentSourceIds = (
  storeDir: string,
  level: string
): ReadonlySet<string> => {
  const spent = new Set<string>(otherLevelTanbunSourceIds(storeDir, level));
  const prefix = level.toLowerCase();
  for (const suffix of SIBLING_STORE_SUFFIXES) {
    const path = join(storeDir, `${prefix}-${suffix}.json`);
    if (!existsSync(path)) {
      continue;
    }
    const rows = JSON.parse(readFileSync(path, "utf8")) as readonly {
      readonly sourceIds?: readonly unknown[];
    }[];
    for (const row of rows) {
      for (const id of row.sourceIds ?? []) {
        if (typeof id === "string") {
          spent.add(id);
        }
      }
    }
  }
  return spent;
};

/**
 * The freeze-time judge record for one level: row ids the blind judge rejected
 * (AMBIGUOUS or UNANSWERABLE). Same shape and same use as the 中文 record, and
 * the same file name the N4 短文 store already uses for its own record
 * (`{level}-rejected.json`), because the 短文 store IS `{level}.json`.
 */
export const readTanbunRejections = (
  storeDir: string,
  level: string
): ReadonlySet<string> =>
  readRejectedIdsFrom(storeDir, `${level.toLowerCase()}-rejected.json`);
