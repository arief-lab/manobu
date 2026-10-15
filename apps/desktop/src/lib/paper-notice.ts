/*
 * What the learner is told after a paper is built (TASK-148 AC#6).
 *
 * `routes/ai.tsx` used to answer every `/exam …` with a hardcoded "Paper
 * ready, it is in the conversation." without reading the assemble receipt, so a
 * short paper got the same sentence as a full one. The decision is a pure
 * function over the receipt so it can be tested without a DOM: as in
 * `lib/composer-routing.ts`, a render-only assertion in this package cannot tell
 * a wired branch from a dead one.
 */

import type {
  ExamBuildReceipt,
  ExamUnfilledPaperBlock,
} from "@manobu/api-contract";
import { examSectionLabelForMode } from "@manobu/api-contract";
import { t } from "@manobu/ui/lib/copy";

/** The receipt fields the notice reads, taken from the contract type so a
 * rename there breaks this at compile time rather than silently printing a
 * number that no longer means anything. `mode` is here because the unfilled
 * 大問 line names a section, and a real paper names it in Japanese (TASK-173.3
 * AC#4). */
export type PaperBuildResult = Pick<
  ExamBuildReceipt,
  | "contentExhausted"
  | "mode"
  | "ready"
  | "totalSlots"
  | "unfilledBlocks"
  | "validatedSlots"
>;

const missingBlockList = (
  blocks: readonly ExamUnfilledPaperBlock[],
  mode: ExamBuildReceipt["mode"]
): string =>
  blocks
    .map(
      (block) =>
        `${examSectionLabelForMode({ id: block.section, mode })} 大問 ${String(block.bigQuestion)} (${block.name})`
    )
    .join(", ");

/** One of four sentences and the tone that colours it. `ready` is a success, a
 * real paper missing whole 大問 and a level that ran dry are warnings the
 * learner can act on, and any other short build is a failure - never the ready
 * sentence for a paper that is not ready. `contentExhausted` only reaches a
 * receipt that is also short, so the exhaustion arm implies a real hole rather
 * than a warning about one.
 *
 * The unfilled 大問 are checked first: a real paper that asks parts the app
 * cannot ask is short mostly for that reason, and saying "this level has no new
 * questions left" over it would blame the learner's history for a hole in the
 * plan. */
export const paperBuildNotice = (
  receipt: PaperBuildResult
): { text: string; tone: "error" | "success" | "warning" } => {
  if (receipt.ready) {
    return {
      text: t("paper.build.ready", { total: receipt.validatedSlots }),
      tone: "success",
    };
  }
  if (receipt.unfilledBlocks.length > 0) {
    return {
      text: t("paper.build.unfilled", {
        missing: missingBlockList(receipt.unfilledBlocks, receipt.mode),
        total: receipt.totalSlots,
        validated: receipt.validatedSlots,
      }),
      tone: "warning",
    };
  }
  if (receipt.contentExhausted) {
    return {
      text: t("paper.build.exhausted", {
        total: receipt.totalSlots,
        validated: receipt.validatedSlots,
      }),
      tone: "warning",
    };
  }
  return { text: t("paper.build.failed"), tone: "error" };
};
