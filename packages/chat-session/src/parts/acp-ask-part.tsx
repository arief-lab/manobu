import {
  type AcpAskAnswer,
  AcpAskCard,
  type AcpAskQuestion,
  type AcpAskResolution,
} from "@manobu/ui/components/acp-ask-card";
import { useCallback } from "react";
import type { AskAnswer, AskQuestion, TMessageAsk } from "../chat-engine";
import { getChatWsClient } from "../orpc";

/**
 * AcpAskPart — the chat-session adapter for the AionUi ask_user card
 * (TASK-80.4). Replaces the old `ask-user-part.tsx` + pinned
 * `question-card.tsx`: the ask card now renders inline in the
 * transcript (like the permission and tool-call cards) and submits
 * through `chat.answerAsk` over the WS oRPC link.
 *
 * Maps `TMessageAsk` (the engine card) to the structural
 * `AcpAskCardProps` the @manobu/ui card consumes, keeping
 * `packages/ui` free of a dependency on `@manobu/chat-session`.
 *
 * TASK-86: a replayed row carries its lifecycle `status` (finish/error)
 * and, for answers, the persisted summary. That settles the card into
 * its compact answered/declined/expired render — interactive only while
 * the ask is still pending.
 */

/** The engine `AskQuestion` already matches the UI card's shape
 * structurally; this is an identity adapter kept for type clarity. */
function toUiQuestions(questions: AskQuestion[]): AcpAskQuestion[] {
  return questions.map((q) => ({
    header: q.header,
    multiSelect: q.multiSelect,
    options: q.options.map((o) => ({
      description: o.description,
      label: o.label,
    })),
    question: q.question,
  }));
}

function toUiAnswers(answers: AskAnswer[]): AcpAskAnswer[] {
  return answers.map((a) => ({ labels: a.labels, question: a.question }));
}

/** The persisted terminal state of a replayed ask card, if any. */
function resolutionFrom(part: TMessageAsk): AcpAskResolution | undefined {
  if (part.status === "error") {
    return { kind: "expired" };
  }
  if (part.status !== "finish") {
    return undefined;
  }
  if (part.settled?.decline === true) {
    return { kind: "declined" };
  }
  return {
    answers: part.settled?.answers ? toUiAnswers(part.settled.answers) : [],
    kind: "answered",
  };
}

export function AcpAskPart({ part }: { part: TMessageAsk }) {
  const onSubmit = useCallback(
    async (payload: {
      answers?: Array<{ labels: string[]; question: string }>;
      decline?: boolean;
    }) => {
      await getChatWsClient().chat.answerAsk({
        answers: payload.answers,
        conversationId: part.conversation_id,
        decline: payload.decline,
        requestId: part.requestId,
      });
    },
    [part.conversation_id, part.requestId]
  );

  return (
    <AcpAskCard
      onSubmit={onSubmit}
      questions={toUiQuestions(part.questions)}
      requestKey={part.requestId}
      resolution={resolutionFrom(part)}
    />
  );
}
