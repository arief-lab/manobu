import { expect } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExamBudget, ExamSectionId } from "@manobu/api-contract";
import { createUserDb } from "@manobu/db";
import type { UserDatabase } from "@manobu/db/item-store";
import { applyContentMigrations } from "@manobu/db/migrate";
import { createRouterClient } from "@orpc/server";
import { createChatContext } from "../src/chat-hub";
import { createRpcHandlers } from "../src/rpc";
import { __test__ as corpusTest } from "../src/services/exam-corpus";
import type { __test__ } from "../src/services/exam-service";
import { isolatedDbUrl } from "./harness";

/*
 * Shared harness for the per-family exam tests. The picker seam of every family
 * drives the same `CandidateCatalogState`, and every store-boundary test reaches
 * its drained/unjudged state the same way: a scratch data root that symlinks the
 * shipped `packages/japanese/data` tree and substitutes ONE reading store file.
 * Both shapes live here so the family tests assert, not reimplement.
 */

const DATA_DIR = join(import.meta.dir, "../../../packages/japanese/data");

/** The picker's `catalog` argument, read off its own signature rather than
 * reimplemented (`CandidateCatalogState` is a private service shape). Every
 * picker takes the same state, so one derivation serves all families; the
 * `seenAnchors` spend is widened to a mutable `Set` because the walks write it. */
type Catalog = Parameters<
  typeof __test__.discourseClozeSourceFor
>[0]["catalog"];
export type WritableCatalog = Omit<Catalog, "seenAnchors"> & {
  seenAnchors: Set<string>;
};

export const newCatalog = (): WritableCatalog => ({
  anchorLevels: new Map(),
  candidates: [],
  declinedAnchors: new Set(),
  exhaustedFamilies: new Set(),
  fragmentRecords: new Map(),
  refusedSections: new Set(),
  seenAnchors: new Set(),
  sourcingCases: new Map(),
  targetByItemId: new Map(),
  usedBunshouPassages: new Set(),
  usedChoubunPassages: new Set(),
  usedClaimUnderstandingPassages: new Set(),
  usedFocusAnchors: new Set(),
  usedGoseikeiSentences: new Set(),
  usedGrammarIds: new Set(),
  usedHyoukiSentences: new Set(),
  usedIikaeSentenceSentences: new Set(),
  usedIikaeSentences: new Set(),
  usedJouhouPassages: new Set(),
  usedKiteiPassages: new Set(),
  usedListeningScenarios: new Set(),
  usedMediumReadingPassages: new Set(),
  usedShortReadingPassages: new Set(),
  usedTougouPairs: new Set(),
  usedUsagePassages: new Set(),
  usedVocabWords: new Set(),
});

/** A scratch data root mirroring `DATA_DIR` with ONE reading store file left out
 * (`rows = null`) or rewritten (`rows` is its new bytes). Everything else is
 * symlinked, so the vocab/grammar corpora stay the real ones and a shipped file
 * can never be written by the overlay. */
export const readingScratch = ({
  fileName,
  prefix,
  rows,
}: {
  fileName: string;
  prefix: string;
  rows: string | null;
}): { root: string; scratch: string } => {
  const scratch = mkdtempSync(join(tmpdir(), prefix));
  const root = join(scratch, "data");
  const reading = join(root, "reading");
  mkdirSync(reading, { recursive: true });
  for (const entry of readdirSync(DATA_DIR)) {
    if (entry !== "reading") {
      symlinkSync(join(DATA_DIR, entry), join(root, entry));
    }
  }
  for (const entry of readdirSync(join(DATA_DIR, "reading"))) {
    if (entry !== fileName) {
      symlinkSync(join(DATA_DIR, "reading", entry), join(reading, entry));
    }
  }
  if (rows !== null) {
    writeFileSync(join(reading, fileName), rows);
  }
  return { root, scratch };
};

/** Runs `run` with `MANOBU_DATA_DIR` pointed at a substituted reading store,
 * then restores the environment. The `*StoreFor` caches key by level, not by
 * directory, so the corpus cache is cleared on both sides of the run or the
 * overlay serves the shipped rows instead. */
export const withSubstitutedReadingStore = async <T>({
  fileName,
  prefix,
  rows,
  run,
}: {
  fileName: string;
  prefix: string;
  rows: string | null;
  run: () => Promise<T>;
}): Promise<T> => {
  const { root, scratch } = readingScratch({ fileName, prefix, rows });
  const previousDataDir = process.env.MANOBU_DATA_DIR;
  process.env.MANOBU_DATA_DIR = root;
  corpusTest.resetCorpusCache();
  try {
    return await run();
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.MANOBU_DATA_DIR;
    } else {
      process.env.MANOBU_DATA_DIR = previousDataDir;
    }
    corpusTest.resetCorpusCache();
    rmSync(scratch, { force: true, recursive: true });
  }
};

/** One shipped reading store, read as JSON so an overlay can rewrite one
 * field. `null` means the file is absent, which is the same absence as an
 * empty one. */
export const shippedReadingRows = (
  fileName: string
): Record<string, unknown>[] =>
  JSON.parse(
    readFileSync(join(DATA_DIR, "reading", fileName), "utf8")
  ) as Record<string, unknown>[];

/** The oRPC test client over the full server router, against one user
 * database. Every exam spec dials the same router with the same empty
 * locals and a fresh chat context, so the wiring lives here once. */
export const makeExamClient = (database: UserDatabase) =>
  createRouterClient(
    createRpcHandlers({}, async () => database),
    {
      context: createChatContext(),
    }
  );

export type ExamClient = ReturnType<typeof makeExamClient>;

/** A client over a freshly created user database at `dbUrl`. */
export const connectExamClient = async (dbUrl: string): Promise<ExamClient> =>
  makeExamClient(await createUserDb(dbUrl));

/** The input `client.exam.request` takes, read off the client itself. */
type ExamRequestInput = NonNullable<
  Parameters<ExamClient["exam"]["request"]>[0]
>;

/** Request, assemble, and read back one exam over `client`. Every family
 * test ends its real-paper builder with this exact three-call sequence, so
 * the sequence lives here once and the builders only say WHAT to ask. */
export const requestAssembleRead = async (
  client: ExamClient,
  input: ExamRequestInput
): Promise<{
  assembled: Awaited<ReturnType<ExamClient["exam"]["assemble"]>>;
  state: Awaited<ReturnType<ExamClient["exam"]["get"]>>;
}> => {
  const requested = await client.exam.request(input);
  const assembled = await client.exam.assemble({ examId: requested.examId });
  const state = await client.exam.get({ examId: requested.examId });
  return { assembled, state };
};

/** 400 per section, deliberately over-large: the ask is clamped to the
 * section's official indicative total at parse time, so this requests the
 * WHOLE section and every 大問 of it stays hole-reportable. */
export const fullBudget = (sections: readonly ExamSectionId[]): ExamBudget => {
  const budget: ExamBudget = {};
  for (const section of sections) {
    budget[section] = 400;
  }
  return budget;
};

/** One test file's content database: an isolated SQLite path, advertised
 * through `DATABASE_URL`, with the content migrations applied. The
 * `afterAll` cleanup that `isolatedDbUrl` registers still belongs to the
 * spec file, because this runs during that file's module evaluation. */
export const prepareContentDb = (name: string): string => {
  const dbUrl = isolatedDbUrl(name);
  process.env.DATABASE_URL = dbUrl;
  applyContentMigrations(dbUrl);
  return dbUrl;
};

/*
 * The fill-loop assertions every store family repeats. Each one states a
 * property of a whole 大問 the same way for every family, so the family test
 * only supplies the shape that differs: its block name, its store rows, and
 * the checks only that family's 小問 carry.
 */

type ExamState = Awaited<ReturnType<ExamClient["exam"]["get"]>>;
type AssembledPaper = Awaited<ReturnType<ExamClient["exam"]["assemble"]>>;
type PaperItemEntry = ExamState["items"][number];
type PaperItem = PaperItemEntry["item"];
type ItemLevel = PaperItem["level"];
type ScoringSectionId = NonNullable<
  AssembledPaper["sections"][number]["scoringSectionIds"]
>[number];

/** The whole 大問 landed and the receipt does not name it: a block short
 * here is a supply problem, not a plumbed one. */
export const assertBlockFullyPrinted = ({
  assembled,
  blockName,
  count,
  landed,
}: {
  assembled: AssembledPaper;
  blockName: string;
  count: number;
  landed: readonly PaperItemEntry[];
}): void => {
  expect(landed).toHaveLength(count);
  // The receipt must not name what it just printed.
  expect(assembled.unfilledBlocks.map((block) => block.name)).not.toContain(
    blockName
  );
};

/** Every landed item byte-equals a row of THIS level's own store, which is
 * also the proof that `resolveAnchor` trusts the family's anchor namespace
 * and the stimulus fits `maxPassageLength`: either failure drops the
 * candidate before it can land. `onRow` carries the checks only that
 * family's 小問 shape makes. */
export const eachLandedRowMatchesStore = <
  Row extends { passage: string; stem: string },
>({
  bigQuestion,
  blockName,
  landed,
  level,
  onRow,
  rows,
  stimulus,
}: {
  bigQuestion?: number;
  blockName: string;
  landed: readonly PaperItemEntry[];
  level: ItemLevel;
  onRow: (item: PaperItem, row: Row, passage: string) => void;
  rows: readonly Row[];
  stimulus: string;
}): void => {
  const rowsByPassage = new Map(
    rows.map((entry) => [entry.passage, entry] as const)
  );
  for (const entry of landed) {
    const { item } = entry;
    if (bigQuestion !== undefined) {
      expect(entry.bigQuestion).toBe(bigQuestion);
    }
    expect(item.level).toBe(level);
    const { passage } = item;
    if (passage === null) {
      throw new Error(`a real ${level} ${blockName} prints a ${stimulus}`);
    }
    const row = rowsByPassage.get(passage);
    if (row === undefined) {
      throw new Error(
        `a real ${level} ${blockName} prints a ${stimulus} it does not have`
      );
    }
    expect(item.stem).toBe(row.stem);
    onRow(item, row, passage);
  }
  // One 大問 never prints the same stimulus twice.
  expect(new Set(landed.map((entry) => entry.item.passage)).size).toBe(
    landed.length
  );
};

/** The landed options are the row's own, as a set (the engine may reorder
 * them), four of them, and the key never appears in the stimulus: a landed
 * 小問 cannot give its own answer away. */
export const assertOptionsAreRowsOwn = ({
  blockName,
  item,
  level,
  passage,
  row,
}: {
  blockName: string;
  item: PaperItem;
  level: ItemLevel;
  passage: string;
  row: { answerIndex: number; options: readonly string[] };
}): void => {
  expect(new Set(item.options)).toEqual(new Set(row.options));
  expect(item.options.length).toBe(4);
  const key = row.options[row.answerIndex];
  if (key === undefined) {
    throw new Error(`a ${level} ${blockName} row carries no answer`);
  }
  expect(item.options).toContain(key);
  expect(passage.includes(key)).toBe(false);
};

/** The landed 小問 score into exactly one assembled section, and that
 * section feeds the named scoring band. */
export const assertLandedScoresInto = ({
  assembled,
  landed,
  scoringSectionId,
}: {
  assembled: AssembledPaper;
  landed: readonly PaperItemEntry[];
  scoringSectionId: ScoringSectionId;
}): void => {
  const sections = new Set(landed.map((entry) => entry.section));
  expect(sections.size).toBe(1);
  const [sectionId] = [...sections];
  const section = assembled.sections.find((each) => each.id === sectionId);
  expect(section?.scoringSectionIds).toContain(scoringSectionId);
};

/** The level now assembling prints no stimulus an earlier level's paper
 * already printed: the disjointness a learner moving up a level actually
 * experiences, at the papers that ship rather than at the store files. */
export const assertNoStimulusReused = ({
  blockName,
  landed,
  level,
  seen,
  stimulus,
}: {
  blockName: string;
  landed: readonly PaperItemEntry[];
  level: ItemLevel;
  seen: Set<string>;
  stimulus: string;
}): void => {
  for (const entry of landed) {
    const { passage } = entry.item;
    if (passage === null) {
      throw new Error(`a real ${level} ${blockName} prints a ${stimulus}`);
    }
    expect(seen.has(passage)).toBe(false);
    seen.add(passage);
  }
};

/*
 * The store-shape assertions every reading family repeats over its own rows,
 * and the picker-shape assertions every family repeats over the source one row
 * becomes. The family test says which level, which store, and which extra
 * check only it makes; the repeated property lives here.
 */

const LATIN_RE = /[A-Za-z]/;
const QUESTION_RE = /か。$/u;

/** A row the blind-judged stores may serve: written down by this project,
 * signed off by the two independent passes, four options deep, and the answer
 * index points at one of them. */
export const assertJudgedFourOptionRow = (entry: {
  answerIndex: number;
  options: readonly string[];
  provenance?: string;
  validated?: boolean;
}): void => {
  expect(entry.provenance).toBe("composed");
  expect(entry.validated).toBe(true);
  expect(entry.options).toHaveLength(4);
  expect(entry.answerIndex).toBeGreaterThanOrEqual(0);
  expect(entry.answerIndex).toBeLessThan(4);
};

/** The four options are four DISTINCT strings and the answer is frozen first
 * (the authored stores pin `answerIndex: 0`, not merely a legal index). The
 * word-form store tests (語形成, 言い換え類義, 文脈規定) all print this
 * candidate-list property over their own rows. */
export const assertFourDistinctOptionsAnswerFirst = (entry: {
  answerIndex: number;
  options: readonly string[];
}): void => {
  expect(entry.options).toHaveLength(4);
  expect(new Set(entry.options).size).toBe(4);
  expect(entry.answerIndex).toBe(0);
};

/** The question side of a 読解 row is Japanese prose: the stem closes on か。,
 * and neither the stem nor an option arrived as a Latin placeholder. */
export const assertQuestionIsJapanese = (entry: {
  options: readonly string[];
  stem: string;
}): void => {
  expect(entry.stem).toMatch(QUESTION_RE);
  expect(entry.stem).not.toMatch(LATIN_RE);
  for (const option of entry.options) {
    expect(option).not.toMatch(LATIN_RE);
  }
};

/** The reading-family source one store row becomes: its anchor names a row of
 * THIS store (the lookup doubles as the anchor check, so a missing row throws
 * instead of a `toBeDefined()` proving nothing), the answer is that row's own
 * option, the three distractors are the rest and never the target, the cue is
 * the row's own stem, and the fields only a grammar item would carry stay
 * empty. Returns the row so the caller pins the stimulus only its family
 * prints: the single passage, or 統合理解's pair. */
export const assertSourceCarriesItsRow = <
  Row extends {
    answerIndex: number;
    id: string | number;
    options: readonly string[];
    passage?: string;
    passages?: readonly string[];
    stem: string;
  },
>({
  found,
  level,
  rows,
}: {
  found: {
    anchorId: string;
    cue?: string | null;
    distractors: readonly string[];
    level?: string;
    pattern?: unknown;
    sourcingCase?: unknown;
    stimulus?: unknown;
    target: string;
  };
  level: string;
  rows: readonly Row[];
}): Row => {
  const row = rows.find((each) => `reading:${each.id}` === found.anchorId);
  if (row === undefined) {
    throw new Error("the source's anchor names no row of this store");
  }
  expect(row.options[row.answerIndex]).toBe(found.target);
  expect(found.distractors).toHaveLength(3);
  expect(found.distractors).not.toContain(found.target);
  expect(found.cue).toBe(row.stem);
  expect(found.anchorId).toBe(`reading:${row.id}`);
  expect(found.level).toBe(level);
  expect(found.sourcingCase).toBeUndefined();
  expect(found.pattern).toBeNull();
  expect(found.stimulus).toBeNull();
  return row;
};

/** The composed shape a word-form picker hands over: three wrong options, the
 * store's own judgement flags, the store's own anchor namespace (the trailing
 * hyphen of `iikae-sentence` matters, because a sentence row echoing a word
 * row's id would otherwise be attested under the wrong namespace), the
 * official instruction line travelling as `cue` so the English daily prompt
 * never reaches a real 小問, nothing a grammar item would carry, and an answer
 * that never sits in the sentence it belongs to. */
export const assertComposedSourceShape = ({
  anchorPrefix,
  cue,
  source,
}: {
  anchorPrefix: string;
  cue: string;
  source: {
    anchorId: string;
    cue?: string | null;
    distractors: readonly string[];
    passage?: string | null;
    pattern?: unknown;
    provenance?: string;
    sourcingCase?: unknown;
    stimulus?: unknown;
    target: string;
    validated?: boolean;
  };
}): void => {
  expect(source.distractors).toHaveLength(3);
  expect(source.validated).toBe(true);
  expect(source.provenance).toBe("composed");
  expect(source.anchorId.startsWith(`${anchorPrefix}:`)).toBe(true);
  expect(source.cue).toBe(cue);
  expect(source.pattern).toBeNull();
  expect(source.stimulus).toBeNull();
  expect(source.sourcingCase).toBeUndefined();
  expect((source.passage ?? "").includes(source.target)).toBe(false);
};

/** The walk spends one stimulus per 小問: with the SAME catalog, index and
 * offset, the second pick is a different stimulus than the first. */
export const assertSpendsOneStimulusPerWalk = <
  Source extends { passage?: string | null },
>(
  pick: (catalog: WritableCatalog) => Source | null
): void => {
  const catalog = newCatalog();
  const first = pick(catalog);
  const second = pick(catalog);
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second?.passage).not.toBe(first?.passage);
};

/** The store EXISTS, so this is a shortfall, not a hole: nothing of this block
 * landed and the receipt says nothing about a block it could have asked. */
export const assertBlockNotPrintedNorNamed = ({
  assembled,
  blockName,
  landed,
}: {
  assembled: AssembledPaper;
  blockName: string;
  landed: readonly PaperItemEntry[];
}): void => {
  expect(landed).toHaveLength(0);
  expect(assembled.unfilledBlocks.map((block) => block.name)).not.toContain(
    blockName
  );
};

/** Non-vacuity for a drained-overlay test: the scratch data root still served
 * the 漢字読み 大問 above the drained block, so an empty block proves the
 * overlay worked, not that the root broke. */
export const assertOverlayRootStillFillsBlock = ({
  itemType,
  state,
}: {
  itemType: PaperItem["itemType"];
  state: ExamState;
}): void => {
  expect(
    state.items.filter((entry) => entry.item.itemType === itemType).length
  ).toBeGreaterThan(0);
};

/** The receipt names a hole by its 大問 number and official NAME, not by a
 * block id (the frame is what a learner-facing card reads), so the assertion
 * keys on the numbers of the blocks that filled. */
export const assertBigQuestionsNotHoled = ({
  assembled,
  bigQuestions,
}: {
  assembled: AssembledPaper;
  bigQuestions: readonly number[];
}): void => {
  const holes = new Map(
    assembled.unfilledBlocks.map((block) => [block.bigQuestion, block.name])
  );
  for (const bigQuestion of bigQuestions) {
    expect(holes.has(bigQuestion)).toBe(false);
  }
};
