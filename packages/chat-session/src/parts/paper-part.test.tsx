import { describe, expect, it } from "bun:test";

import type { TMessagePaper } from "../chat-engine/types";
import { PaperPart } from "./paper-part";

const card: TMessagePaper = {
  conversation_id: "conversation-1",
  examId: "exam-1",
  id: "paper:exam-1",
  label: "shortened-paper-banded",
  level: "N5",
  mode: "shortened",
  msg_id: "message-1",
  phase: "ready",
  sections: [
    {
      id: "vocabulary",
      label: "Vocabulary",
      state: "ready",
      total: 1,
      validated: 1,
    },
  ],
  totalSlots: 1,
  type: "paper",
  validatedSlots: 1,
};

describe("PaperPart", () => {
  it("passes the card exam id to the existing action", () => {
    const opened: string[] = [];
    const element = PaperPart({
      card,
      onOpenPaper: (examId) => opened.push(examId),
    });
    const { onStart } = element.props;
    if (typeof onStart !== "function") {
      throw new Error("paper action was not forwarded");
    }
    onStart();
    expect(opened).toEqual(["exam-1"]);
  });
});
