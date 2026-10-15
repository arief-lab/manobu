import { z } from "zod";

/**
 * Card as served by GET /cards/due — matches the drizzle `cards` row
 * shape the desktop `lib/cards.ts` consumer reads (TASK-40 AC7).
 */
const DueCardSchema = z.object({
  createdAt: z.string(),
  difficulty: z.number(),
  due: z.string(),
  id: z.number(),
  isLeech: z.boolean(),
  jp: z.string().nullable(),
  lapses: z.number(),
  level: z.string().nullable(),
  reading: z.string().nullable(),
  stability: z.number(),
  state: z.string(),
  vocabId: z.number(),
});
export type DueCard = z.infer<typeof DueCardSchema>;

export const CreateCardsInputSchema = z.object({
  cards: z.array(
    z.object({
      jp: z.string(),
      level: z.string(),
      reading: z.string(),
      vocabId: z.number(),
    })
  ),
});
export type CreateCardsInput = z.infer<typeof CreateCardsInputSchema>;

/**
 * The retention band a learner may choose, and the default they get if they
 * never touch the slider. Owned here because this is where the value is
 * validated on the way in: the grade write schedules at it (TASK-166), so a
 * client cannot ask for a retention the SRS has no sane answer for.
 * `apps/desktop/src/lib/settings.ts` clamps its stored copy against these.
 */
export const RETENTION_MIN = 0.7;
export const RETENTION_MAX = 0.97;
export const DEFAULT_RETENTION = 0.9;

export const GradeInputSchema = z.object({
  cardId: z.number().int().positive(),
  // TASK-166: the desk previews at the learner's retention, so the write has
  // to receive it. Without it `services/grading.ts` could only ever schedule
  // at 0.9, and every other setting made the button a lie.
  desiredRetention: z
    .number()
    .min(RETENTION_MIN)
    .max(RETENTION_MAX)
    .default(DEFAULT_RETENTION),
  grade: z.enum(["again", "hard", "good", "easy"]),
});
export type GradeInput = z.infer<typeof GradeInputSchema>;

export const GradeOutputSchema = z.object({
  card: DueCardSchema,
});
export type GradeOutput = z.infer<typeof GradeOutputSchema>;

export const CreateCardsOutputSchema = z.object({
  inserted: z.array(z.number()),
});
export type CreateCardsOutput = z.infer<typeof CreateCardsOutputSchema>;

/**
 * `cards` is the PAGE the queue read served (`apps/server/src/services/due-queue.ts`
 * caps it), so its length is not how many are due. The three counts beside it
 * are what the whole queue and the whole deck actually hold, which is the gap
 * that made every "N cards due" and "N total" on the dashboard tile and the
 * review desk a statement about 20 rows (TASK-165).
 */
export const DueOutputSchema = z.object({
  cards: z.array(DueCardSchema),
  /** Every card the learner owns, due or not. What the header's "total" names. */
  deckCount: z.number().int().nonnegative(),
  /** Rows matching the due predicate across the whole queue, page or no page. */
  dueCount: z.number().int().nonnegative(),
  /**
   * The earliest day AFTER today that any card is scheduled, or null when
   * nothing is waiting. Day-granular `YYYY-MM-DD` like `cards.due`, because
   * that is the finest the column stores. It is what lets the desk's empty
   * state say when the next review is instead of staying silent (TASK-155
   * withheld the claim for want of it).
   */
  nextDue: z.string().nullable(),
});
export type DueOutput = z.infer<typeof DueOutputSchema>;

export const CardNotFoundError = z.object({ message: z.string() });
