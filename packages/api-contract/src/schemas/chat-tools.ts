import { z } from "zod";

/**
 * ask_user tool contract (TASK-79.4). The agent calls the tool; the server
 * registers it with the ACP provider's tool proxy and its `execute` hands
 * off immediately (see apps/server); the browser pins a question card from
 * the streamed call and the learner's answers return as the next user
 * message. These schemas are the shared input contract for both sides.
 */
export const AskUserQuestionSchema = z.object({
  choices: z.array(z.string()).length(3),
  question: z.string(),
});
export type AskUserQuestion = z.infer<typeof AskUserQuestionSchema>;

export const AskUserInputSchema = z.object({
  questions: z.array(AskUserQuestionSchema).min(1),
});
export type AskUserInput = z.infer<typeof AskUserInputSchema>;
