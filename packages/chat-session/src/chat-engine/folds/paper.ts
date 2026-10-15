import {
  type ChatFrame,
  type ExamLevel,
  type ExamMode,
  examScoringSectionLabelForMode,
} from "@manobu/api-contract";

import type { PaperResult, TMessage, TMessagePaper } from "../types";
import { upsertCard } from "./upsert";

type PaperFrame = ChatFrame & { type: "paper" };
type PaperFrameData = PaperFrame["data"];

const projectResult = (
  level: ExamLevel,
  result: PaperFrameData["result"],
  mode: ExamMode
): PaperResult | undefined => {
  if (!result) {
    return undefined;
  }
  if (result.scoring === "band") {
    const { max, passed, passMark, score } = result.overall;
    if (
      typeof max !== "number" ||
      typeof passed !== "boolean" ||
      typeof passMark !== "number" ||
      typeof score !== "number"
    ) {
      return undefined;
    }
    return {
      overall: { max, passed, passMark, score },
      scoring: "band",
      sections: result.sections.flatMap((section) =>
        typeof section.max === "number" &&
        typeof section.passed === "boolean" &&
        typeof section.score === "number"
          ? [
              {
                id: section.id,
                label: examScoringSectionLabelForMode({
                  id: section.id,
                  level,
                  mode,
                }),
                max: section.max,
                passed: section.passed,
                score: section.score,
              },
            ]
          : []
      ),
    };
  }
  const { correct, total } = result.overall;
  if (typeof correct !== "number" || typeof total !== "number") {
    return undefined;
  }
  return {
    overall: { correct, total },
    scoring: "raw-only",
    sections: result.sections.flatMap((section) =>
      typeof section.correct === "number" && typeof section.total === "number"
        ? [
            {
              correct: section.correct,
              id: section.id,
              label: examScoringSectionLabelForMode({
                id: section.id,
                level,
                mode,
              }),
              total: section.total,
            },
          ]
        : []
    ),
  };
};

export function foldPaper(prev: TMessage[], frame: PaperFrame): TMessage[] {
  const { data } = frame;
  const card: TMessagePaper = {
    ...(data.abandoned === undefined ? {} : { abandoned: data.abandoned }),
    conversation_id: frame.conversation_id,
    created_at: frame.created_at,
    ...(data.debrief === undefined
      ? {}
      : {
          debrief: {
            saved: data.debrief.saved,
            // Carried only when the frame has it: a paper stored before
            // TASK-160 has ids and no names, and the card shows nothing rather
            // than a corpus id.
            ...(data.debrief.weakAnchorLabels === undefined
              ? {}
              : { weakAnchorLabels: [...data.debrief.weakAnchorLabels] }),
            weakAnchors: [...data.debrief.weakAnchors],
          },
        }),
    examId: data.exam_id,
    hidden: frame.hidden,
    id: `paper:${data.exam_id}`,
    label: data.label,
    level: data.level,
    mode: data.mode,
    msg_id: frame.msg_id,
    ...(data.offline === undefined ? {} : { offline: data.offline }),
    phase: data.phase,
    position: frame.position,
    result: projectResult(data.level, data.result, data.mode),
    sections: data.sections.map((section) => ({
      id: section.id,
      label: section.label,
      state: section.state,
      total: section.total,
      validated: section.validated,
    })),
    status: frame.status,
    totalSlots: data.total_slots,
    turn_id: frame.turn_id,
    type: "paper",
    validatedSlots: data.validated_slots,
  };
  return upsertCard(prev, card);
}
