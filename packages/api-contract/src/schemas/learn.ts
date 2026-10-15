import { z } from "zod";

/** POST /learn/chat body (spec §TASK-1.16) — mirrors LearnChatInput. */
const LearnChatInputSchema = z.object({
  includeNextCards: z.boolean().optional().default(false),
  learnerLevel: z.enum(["N5", "N4", "N3", "N2", "N1"]),
  message: z.string().min(1).max(2000),
  vocabIds: z.array(z.number().int().nonnegative()).max(50).optional(),
});
export type LearnChatInput = z.infer<typeof LearnChatInputSchema>;

/** GET /learn/nextCards query — corpus-anchored next cards (TASK-18.1). */
export const NextCardsInputSchema = z.object({
  level: z.enum(["N5", "N4", "N3", "N2", "N1"]).default("N5"),
});
export type NextCardsInput = z.infer<typeof NextCardsInputSchema>;

const NextCardSchema = z.object({
  jp: z.string(),
  level: z.string(),
  reading: z.string(),
  vocabId: z.number(),
});
export type NextCard = z.infer<typeof NextCardSchema>;

export const NextCardsOutputSchema = z.object({
  nextCards: z.array(NextCardSchema),
});
export type NextCardsOutput = z.infer<typeof NextCardsOutputSchema>;

export const RateLimitedError = z.object({ message: z.string() });
