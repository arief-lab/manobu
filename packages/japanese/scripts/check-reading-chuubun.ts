/**
 * `check:reading-chuubun` — the deterministic CI gate for the composed
 * N3/N2/N1 内容理解（中文） store (TASK-173.9.2 AC#1). NO LLM runs here.
 *
 * This gate is the only thing that makes `validated: true` in
 * `data/reading/{level}-chuubun.json` mean something: the server trusts the
 * flag at assembly time exactly the way it trusts a licensed store row, so this
 * script re-proves offline, on every run, that each frozen row is
 *
 *   1. provenance `composed`, `validated`, and signed by the pipeline
 *      (`deterministic:gen-reading-chuubun`), a construction this gate
 *      re-proves rather than a model opinion it takes on faith,
 *   2. sourced from the corpus its `construction` names: one 白書 paragraph for
 *      `masked-slot`, a set of in-level `sentences.jsonl` rows for
 *      `stitched-in-level` (TASK-173.9.15),
 *   3. inside the passage band that construction declares (`PASSAGE_BAND`, whose
 *      ceiling never exceeds the medium-reading cap of 1200 runes),
 *   4. structurally valid per the item-engine validator
 *      (`validateQuestionItem`) over a minimal corpus view.
 *
 * Plus the masked-slot contract, which is the whole point of either source:
 *   a. exactly one `BLANK`,
 *   b. putting the answer option back reproduces the source text byte for byte
 *      (the key comes from the source, so this is the proof),
 *   c. the answer occurs exactly once in the source,
 *   d. the answer is an in-level noun printed in its listed kanji form,
 *   e. the source's coverage at the item's level is at or above its floor (the
 *      difficulty claim is measured, not asserted),
 *   f. no distractor occurs anywhere in the source or passage,
 *   g. the answer and every distractor are in-level nouns,
 *   h. no distractor collides with the answer's dominant sense,
 *   i. the slot is SOLVABLE from the passage alone: its collocation frame is
 *      filled by exactly ONE noun corpus-wide (`answer-frame-ambiguous`),
 *   j. the row is not in the freeze-time judge record.
 *
 * A `stitched-in-level` row runs all ten of those as well, against the text its
 * cited sentences concatenate to, and two more: every cited sentence must be
 * in-level, and the document must have a noun every sentence of it prints
 * (`stitchedTopicOf`), because a stitch that shares nothing is a list and a list
 * is not a 中文 passage.
 *
 * File-level: at least one 大問's worth of rows (9 at N1/N2, 6 at N3, 4 at N4),
 * ids, passages and answers unique.
 *
 * Run from this package: `bun run check:reading-chuubun`. Exit 0 = every row
 * passes; exit 1 = issues listed, or a store is not frozen yet. The exported
 * `checkReadingFile` is the test seam.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  certIssues,
  type EntryReport,
  type ReadingEntryFields,
  readingShapeOf,
  runReadingGateMain,
  spendIssue,
  stampIssues,
  structuralIssuesFor,
} from "./check-reading-shared";
import {
  AUTHORED_MAX_EVIDENCE_RATIO,
  AUTHORED_MIN_EVIDENCE_RUNES,
  AUTHORED_MIN_INTENTS,
  type AuthoredConfig,
  authoredRowIssues,
  comprehensionIntentFor,
  isAuthoredConstruction,
  mixedAndAuthoredFileIssues,
} from "./reading-authored-corpus";
import {
  buildFrameFillers,
  CHUUBUN_BLOCK,
  CHUUBUN_CONSTRUCTIONS,
  CHUUBUN_SIGNER,
  CHUUBUN_SOURCE,
  type ChuubunConstruction,
  COVERAGE_FLOOR,
  inLevelSentences,
  LEVEL_RANKS,
  levelsUpTo,
  maskedSlotIssues,
  PASSAGE_BAND,
  readChuubunRejections,
  readCumulativeVocabIndex,
  readHakushoParagraphs,
  sentencesOfText,
  splitSentences,
  stitchedTopicOf,
} from "./reading-chuubun-corpus";
import { readSourceSentences, type SourceSentence } from "./reading-n4-corpus";

/** The 中文 block's authored configuration. The band is the construction's own
 * (`PASSAGE_BAND.authored`), and `bandFor` returns it only for a level this block
 * actually writes at, so a store cannot ask for the authored screens at a level
 * whose proof is still a source window: an unknown level fails closed with
 * `authored-band-unknown`. `minParagraphs` is 0 because what separates a 中文 from
 * a 短文 here is length, and the band already decides it (短文 stops at the
 * server's 240-rune cap, 中文 starts at 250). */
const AUTHORED_CONFIG: AuthoredConfig = {
  bandFor: (level) =>
    CHUUBUN_SOURCE[level] === "authored" ? PASSAGE_BAND.authored : undefined,
  evidence: {
    maxRatio: AUTHORED_MAX_EVIDENCE_RATIO,
    minRunes: AUTHORED_MIN_EVIDENCE_RUNES,
  },
  intentFor: comprehensionIntentFor,
  minIntents: AUTHORED_MIN_INTENTS,
  minParagraphs: 0,
  optionCount: 4,
};

/** One real 中文 大問 prints 9 小問 at N2 and N1 (doc-26 §3.4/§3.5) and 6 at
 * N3 (§3.3), so the store must hold at least one 大問's worth. N4 大問5 prints 4
 * (`packages/item-engine/src/paper.ts:579`). */
const MIN_ITEMS_BY_LEVEL: Readonly<Record<string, number>> = {
  N1: 9,
  N2: 9,
  N3: 6,
  N4: 4,
};

/** The reading store row shape as frozen in `{level}-chuubun.json`. `sourceIds`
 * belongs to the two windowed constructions and `evidence` to the written one,
 * and each branch refuses the other's. */
export interface ChuubunReadingEntry extends ReadingEntryFields {
  readonly construction?: ChuubunConstruction;
}

/** The row's verdict shape and the item-engine scaffolding live in
 * `check-reading-shared`; EntryReport is re-exported for this store's tests. */
export type { EntryReport } from "./check-reading-shared";

/** The row's construction as a value this gate knows, or null. JSON is `unknown`
 * at the boundary: a hand-edited store can print any string, and every proof
 * below is chosen by it, so an unlisted value gets no further check rather than
 * the strongest one. */
const constructionOf = (
  entry: ChuubunReadingEntry
): ChuubunConstruction | null =>
  CHUUBUN_CONSTRUCTIONS.find(
    (construction) => construction === entry.construction
  ) ?? null;

/** The construction the level's corpus backs, from the same table the generator
 * picked its assembly from. A row may not choose its own proof: an N4 store of
 * 白書 rows, or an N2 store of stitched rows, would be a level claiming the
 * easier corpus. */
const constructionForLevel = (level: string): ChuubunConstruction => {
  const source = CHUUBUN_SOURCE[level];
  if (source === "sentences") {
    return "stitched-in-level";
  }
  return source === "authored" ? "authored" : "masked-slot";
};

/** Is this row written rather than windowed? The tag picks the branch, and an
 * untagged row falls into the windowed arm and fails its restore-to-source
 * proof, so a row cannot slip through on the easier screens by omitting the tag. */
const isAuthored = (entry: ChuubunReadingEntry): boolean =>
  isAuthoredConstruction(entry.construction);

/** Screens 1: the construction the LEVEL's corpus backs — a row may not choose
 * its own proof. */
const routeIssues = (entry: ChuubunReadingEntry, level: string): string[] => {
  const issues: string[] = [];
  const construction = constructionOf(entry);
  if (construction === null) {
    issues.push("construction-unknown");
  } else if (construction !== constructionForLevel(level)) {
    // The level's corpus decides which construction a row may claim, so an N4
    // store of 白書 rows and an N2 store of stitched rows are both refusals of
    // the harder proof, and both are caught here rather than at the source step.
    issues.push(`construction-not-for-${level}`);
  }
  return issues;
};

/** Screens 2: the cert trio, signed per branch. */
const signerIssues = (entry: ChuubunReadingEntry): string[] =>
  certIssues(entry, CHUUBUN_SIGNER);

/** Screens 3: the stamps a row cannot re-own. */
const identityIssues = (entry: ChuubunReadingEntry, level: string): string[] =>
  stampIssues({
    block: CHUUBUN_BLOCK,
    blockName: "chuubun",
    entry,
    level,
  });

const checkFields = (entry: ChuubunReadingEntry, level: string): string[] => [
  ...routeIssues(entry, level),
  ...signerIssues(entry),
  ...identityIssues(entry, level),
];

/** The masked-slot screens (single `BLANK`, restore-to-source byte equality,
 * the in-level noun key, frame solvability, the distractor contract, the judge
 * record) live in `reading-chuubun-corpus.ts` as `maskedSlotIssues`, shared with
 * the 短文 and 長文 gates: the three composed cloze gates re-prove one contract,
 * so a screen one of them keeps as a private copy is only a claim. What stays
 * here is only what is 中文's own: the per-construction band, the source
 * resolution (a paragraph or a stitch), and the stitch's topic screen. The
 * blank's frame is resolved against the SOURCE text's own sentences, from the
 * same splitter the generator used, never against the global corpus. */

/**
 * One row's source text, resolved by the row's OWN construction: the single 白書
 * paragraph a `masked-slot` row cites, or the concatenation of the in-level
 * sentences a `stitched-in-level` row cites, in the order it cites them.
 *
 * The stitch resolves against the in-level sentence map, never against a
 * paragraph map, so "every cited sentence exists in the vendored corpus AND every
 * one of them is in-level" is one lookup rather than a claim: the map is built by
 * `inLevelSentences` and an out-of-level sentence simply is not in it.
 */
const sourceTextFor = ({
  construction,
  paragraphs,
  sentences,
  sourceIds,
}: {
  readonly construction: ChuubunConstruction;
  readonly paragraphs: ReadonlyMap<string, string>;
  readonly sentences: ReadonlyMap<string, SourceSentence>;
  readonly sourceIds: readonly string[];
}): { readonly issues: string[]; readonly text: string | null } => {
  if (construction === "masked-slot") {
    if (sourceIds.length !== 1) {
      return { issues: ["sourceIds-not-single"], text: null };
    }
    const text = paragraphs.get(sourceIds[0] as string);
    return text === undefined
      ? { issues: ["sourceId-unknown"], text: null }
      : { issues: [], text };
  }
  if (sourceIds.length < 2) {
    // A stitch of one sentence is not a 450字 document, and the row would be
    // asking for the short-reading proof under the 中文 id prefix.
    return { issues: ["sourceIds-not-stitched"], text: null };
  }
  const parts: string[] = [];
  for (const id of sourceIds) {
    const sentence = sentences.get(id);
    if (sentence === undefined) {
      return { issues: ["sourceId-unknown"], text: null };
    }
    parts.push(sentence.jp);
  }
  return { issues: [], text: parts.join("") };
};

/** The passage against its construction's own band. */
const passageBandIssues = (
  passage: string,
  band: { max: number; min: number }
): string[] => {
  const issues: string[] = [];
  const { length } = [...passage];
  if (length > band.max) {
    issues.push("passage-too-long");
  }
  if (length < band.min) {
    issues.push("passage-too-short");
  }
  return issues;
};

/** One frozen row: fields, byte-equal sourcing, the slot contract, then the
 * item-engine structural validator. */
export const checkEntry = ({
  entry,
  level,
  paragraphs,
  sentences = new Map<string, SourceSentence>(),
  index,
  fillers,
  rejections,
}: {
  entry: ChuubunReadingEntry;
  level: string;
  paragraphs: ReadonlyMap<string, string>;
  sentences?: ReadonlyMap<string, SourceSentence>;
  index: ReturnType<typeof readCumulativeVocabIndex>;
  fillers: ReturnType<typeof buildFrameFillers>;
  rejections: ReadonlySet<string>;
}): string[] => {
  const issues = checkFields(entry, level);
  const maxRank = LEVEL_RANKS[level] ?? 0;
  const construction = constructionOf(entry);
  if (construction === "authored") {
    // No source to restore to, so the shared written-row screens decide it: the
    // band, the option shape, a stem that classifies into a known ねらい, and an
    // evidence sentence the row prints verbatim.
    issues.push(
      ...authoredRowIssues(entry, level, AUTHORED_CONFIG, rejections)
    );
  } else if (construction !== null) {
    const resolved = sourceTextFor({
      construction,
      paragraphs,
      sentences,
      sourceIds: entry.sourceIds ?? [],
    });
    issues.push(...resolved.issues);
    const sourceText = resolved.text;
    if (sourceText !== null) {
      const band = PASSAGE_BAND[construction];
      issues.push(...passageBandIssues(entry.passage, band));
      issues.push(
        ...maskedSlotIssues({
          context: { fillers, index, maxRank, rejections },
          coverageFloor: COVERAGE_FLOOR[entry.level] ?? 1,
          coverageIssue: "source-coverage-too-low",
          entry,
          sourceSentences: sentencesOfText(sourceText),
          sourceText,
        })
      );
      if (
        construction === "stitched-in-level" &&
        stitchedTopicOf(sourceText, index, maxRank) === null
      ) {
        // The coherence claim of a stitch: some noun every sentence of the
        // document prints. Without it the passage is a list of unrelated
        // statements, which no 中文 大問 prints.
        issues.push("stitched-topic-not-shared");
      }
    }
  }
  issues.push(
    ...structuralIssuesFor({
      itemType: "medium-reading",
      // The ceiling the row's OWN construction prints under, so the structural
      // validator judges a stitched row against 600 runes, not against the 白書
      // ceiling it never claimed.
      maxPassageLength: () =>
        PASSAGE_BAND[constructionOf(entry) ?? "masked-slot"].max,
      row: readingShapeOf(entry),
    })
  );
  return issues;
};

/** Everything one store file needs from disk, read once per gate run. The LEVEL's
 * corpus choice decides which table is read: a written store cites no corpus at
 * all (so scanning one would be work that decides nothing), an in-level sentence
 * store cites `sentences.jsonl`, and a 白書 store cites the paragraphs — and a row
 * resolves against the table its own construction names, because an N4 store
 * cannot cite a 白書 paragraph and an N2 store cannot cite a Tatoeba sentence.
 *
 * The frame index is filled from the SAME corpus, or the two halves of the
 * difficulty claim measure different ambiguity: a 白書 level indexes the
 * paragraphs' sentences and a sentence level indexes its own supply. */
const storeContextFor = ({
  dataDir,
  index,
  level,
  storePath,
}: {
  readonly dataDir: string;
  readonly index: ReturnType<typeof readCumulativeVocabIndex>;
  readonly level: string;
  readonly storePath: string;
}): {
  readonly fillers: ReturnType<typeof buildFrameFillers>;
  readonly paragraphs: ReadonlyMap<string, string>;
  readonly rejections: ReadonlySet<string>;
  readonly sentences: ReadonlyMap<string, SourceSentence>;
} => {
  const maxRank = LEVEL_RANKS[level] ?? 0;
  const sentenceBacked = CHUUBUN_SOURCE[level] === "sentences";
  const windowed = CHUUBUN_SOURCE[level] !== "authored";
  const paragraphs = new Map<string, string>();
  if (windowed && !sentenceBacked) {
    for (const paragraph of readHakushoParagraphs(
      join(dataDir, "reading", "hakusho.jsonl")
    )) {
      paragraphs.set(paragraph.id, paragraph.text);
    }
  }
  const inLevel =
    windowed && sentenceBacked
      ? inLevelSentences(
          readSourceSentences(join(dataDir, "sentences", "sentences.jsonl")),
          index
        )
      : [];
  const sentences = new Map<string, SourceSentence>(
    inLevel.map((sentence) => [sentence.id, sentence])
  );
  const fillers = buildFrameFillers(
    sentenceBacked
      ? inLevel.map((sentence) => ({ id: sentence.id, text: sentence.jp }))
      : [...paragraphs.values()].flatMap((text) =>
          splitSentences({
            id: "corpus",
            license: "",
            pageId: "",
            pageUrl: "",
            source: "",
            text,
            title: "",
          })
        ),
    index,
    maxRank
  );
  return {
    fillers,
    paragraphs,
    rejections: readChuubunRejections(join(storePath, ".."), level),
    sentences,
  };
};

/** The repeats only the whole store can see: the same id, passage or answer
 * twice, which no single-row screen can notice. */
const repeatIssuesFor = ({
  entry,
  seenAnswers,
  seenIds,
  seenPassages,
}: {
  entry: ChuubunReadingEntry;
  seenAnswers: Set<string>;
  seenIds: Set<string>;
  seenPassages: Set<string>;
}): string[] => {
  const answer = entry.options[entry.answerIndex];
  return [
    ...spendIssue(seenIds, entry.id, "duplicate-id"),
    ...spendIssue(seenPassages, entry.passage, "duplicate-passage"),
    ...(answer === undefined
      ? []
      : spendIssue(seenAnswers, answer, "duplicate-answer")),
  ];
};

/** What no single row can satisfy or break: one 大問's worth of rows, one
 * construction per store, and the ねらい spread when the rows are written
 * rather than windowed. */
const fileIssuesFor = ({
  entries,
  intents,
  level,
}: {
  entries: readonly ChuubunReadingEntry[];
  intents: ReadonlySet<string>;
  level: string;
}): string[] => {
  const issues: string[] = [];
  const minItems = MIN_ITEMS_BY_LEVEL[level] ?? 9;
  if (entries.length < minItems) {
    issues.push(`too-few-items:${entries.length}<${minItems}`);
  }
  issues.push(
    ...mixedAndAuthoredFileIssues({
      config: AUTHORED_CONFIG,
      entries,
      intents,
    })
  );
  return issues;
};

/** The whole gate over one store file. */
export const checkReadingFile = ({
  storePath,
  level,
  dataDir,
}: {
  storePath: string;
  level: string;
  dataDir: string;
}): EntryReport[] => {
  const entries = JSON.parse(
    readFileSync(storePath, "utf8")
  ) as readonly ChuubunReadingEntry[];
  const index = readCumulativeVocabIndex(dataDir, levelsUpTo(level));
  const { fillers, paragraphs, rejections, sentences } = storeContextFor({
    dataDir,
    index,
    level,
    storePath,
  });

  const reports: EntryReport[] = [];
  const seenIds = new Set<string>();
  const seenPassages = new Set<string>();
  const seenAnswers = new Set<string>();
  // The ねらい spread is counted over the store, so a row cannot pass itself by
  // asking one novel question. A windowed store tallies nothing.
  const intents = new Set<string>();
  for (const entry of entries) {
    const issues = checkEntry({
      entry,
      fillers,
      index,
      level,
      paragraphs,
      rejections,
      sentences,
    });
    issues.push(
      ...repeatIssuesFor({ entry, seenAnswers, seenIds, seenPassages })
    );
    if (isAuthored(entry)) {
      const intent = comprehensionIntentFor(entry.stem);
      if (intent !== null) {
        intents.add(intent);
      }
    }
    reports.push({ entryId: entry.id, issues });
  }
  const fileIssues = fileIssuesFor({ entries, intents, level });
  if (fileIssues.length > 0) {
    reports.push({ entryId: "(file)", issues: fileIssues });
  }
  return reports;
};

if (import.meta.main) {
  runReadingGateMain({
    check: checkReadingFile,
    defaultLevel: "N2",
    gateName: "check:reading-chuubun",
    storeFileName: (level): string => `${level.toLowerCase()}-chuubun.json`,
  });
}
