import { z } from "zod";

/** The one level vocabulary on the wire. `exam.ts` aliases this schema instead
 * of declaring a second enum, and item-engine's `PAPER_LEVELS` is pinned to
 * `.options` by apps/server/test/level-vocabulary.test.ts. */
export const JlptLevelSchema = z.enum(["N5", "N4", "N3", "N2", "N1"]);
export type JlptLevel = z.infer<typeof JlptLevelSchema>;

/** GET ?level= query — N5 default, shared by every level-filtered route
 * (server /grammar, /vocab, /nextCards + the contract's list* inputs). */
export const LevelQuerySchema = z.object({
  level: JlptLevelSchema.default("N5"),
});

/** GET /kanji?character= — single-character lookup (spec §SCR-09). */
export const KanjiEntrySchema = z.object({
  character: z.string(),
  frequency: z.number().nullable(),
  grade: z.number().nullable(),
  jlpt: z.string().nullable(),
  kun: z.array(z.string()),
  meaningsEn: z.array(z.string()),
  on: z.array(z.string()),
  strokeCount: z.number(),
});
export type KanjiEntry = z.infer<typeof KanjiEntrySchema>;

/** GET /kanji?level= — list mode for the /kanji index grid (TASK-37 AC1). */
export const KanjiListRowSchema = z.object({
  character: z.string(),
  gloss: z.string(),
  jlpt: z.string().nullable(),
  strokeCount: z.number(),
});
export type KanjiListRow = z.infer<typeof KanjiListRowSchema>;

/** GET /kanji/stroke?character= — KanjiVG stroke order (TASK-23.5.2). */
const StrokeNumberSchema = z.object({
  n: z.number(),
  transform: z.string(),
});
export type StrokeNumber = z.infer<typeof StrokeNumberSchema>;

const StrokePathSchema = z.object({
  d: z.string(),
  id: z.string(),
  kind: z.string().optional(),
});
export type StrokePath = z.infer<typeof StrokePathSchema>;

export const StrokeOrderSchema = z.object({
  character: z.string(),
  elementPath: z.array(z.string()),
  numbers: z.array(StrokeNumberSchema),
  strokes: z.array(StrokePathSchema),
  svg: z.string(),
});
export type StrokeOrder = z.infer<typeof StrokeOrderSchema>;

const GrammarExampleSchema = z.object({
  english: z.string(),
  japanese: z.string(),
});
export type GrammarExample = z.infer<typeof GrammarExampleSchema>;

export const GrammarItemSchema = z.object({
  examples: z.array(GrammarExampleSchema).optional(),
  formality: z.string(),
  formation: z.string().optional(),
  id: z.string(),
  level: z.string(),
  meaning_detailed: z.string().optional(),
  meaning_en: z.string(),
  pattern: z.string(),
});
export type GrammarItem = z.infer<typeof GrammarItemSchema>;

/** GET /vocab?level= — word/reading/meaning rows from data/n*.json.
 * Two N5 rows omit meaning entirely and partOfSpeech is absent on some
 * rows — nullish() accepts both null and missing keys. */
export const VocabItemSchema = z.object({
  gloss: z.string(),
  level: z.string(),
  meaning: z.string().nullish(),
  partOfSpeech: z.string().nullish(),
  reading: z.string(),
  word: z.string(),
});
export type VocabItem = z.infer<typeof VocabItemSchema>;

export const KanjiNotFoundError = z.object({ message: z.string() });
export const NoStrokeDataError = z.object({ message: z.string() });
