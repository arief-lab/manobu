import { describe, expect, it } from "bun:test";

import type { ChatFrame } from "@manobu/api-contract";

import { transformFrame } from "./transform";

const frame: ChatFrame = {
  conversation_id: "conversation-1",
  data: {
    exam_id: "exam-1",
    label: "shortened-paper-raw-only",
    level: "N5",
    mode: "shortened",
    phase: "raw-only",
    result: {
      overall: { correct: 1, total: 2 },
      scoring: "raw-only",
      sections: [
        {
          correct: 1,
          id: "vocabulary",
          label: "Vocabulary",
          total: 2,
        },
      ],
    },
    sections: [
      {
        id: "vocabulary",
        label: "Vocabulary",
        state: "ready",
        total: 2,
        validated: 2,
      },
    ],
    total_slots: 2,
    validated_slots: 2,
  },
  msg_id: "paper-msg",
  replace: true,
  status: "finish",
  type: "paper",
};

describe("paper frame fold", () => {
  it("folds a key-free paper card and replaces it deterministically", () => {
    const first = transformFrame([], frame, {});
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      examId: "exam-1",
      id: "paper:exam-1",
      type: "paper",
      validatedSlots: 2,
    });
    expect(JSON.stringify(first)).not.toContain("answerIndex");
    expect(JSON.stringify(first)).not.toContain("script");
    const second = transformFrame(first, frame, {});
    expect(second).toHaveLength(1);
    expect(second[0]?.id).toBe("paper:exam-1");
  });

  it("carries the honest abandoned terminal state", () => {
    const cards = transformFrame(
      [],
      {
        ...frame,
        data: {
          ...frame.data,
          abandoned: true,
          phase: "unavailable",
        },
      },
      {}
    );
    expect(cards[0]).toMatchObject({
      abandoned: true,
      phase: "unavailable",
    });
  });

  it("names the folded result section by the paper's mode (TASK-173.3)", () => {
    // The fold re-derives the label from the stored id rather than trusting the
    // frame's own label, so a real-mode frame must come out in Japanese and the
    // same frame under `shortened` in English.
    const realCards = transformFrame(
      [],
      { ...frame, data: { ...frame.data, mode: "real" } },
      {}
    );
    expect(realCards[0]).toMatchObject({
      result: { sections: [{ label: "言語知識（文字・語彙）" }] },
    });
    const shortenedCards = transformFrame(
      [],
      { ...frame, data: { ...frame.data, mode: "shortened" } },
      {}
    );
    expect(shortenedCards[0]).toMatchObject({
      result: { sections: [{ label: "Vocabulary" }] },
    });
  });

  it("folds weak-anchor names beside the ids so the card can name them (TASK-160)", () => {
    const cards = transformFrame(
      [],
      {
        ...frame,
        data: {
          ...frame.data,
          debrief: {
            saved: true,
            weakAnchorLabels: ["東（ひがし）"],
            weakAnchors: ["vocab:N5:東:ひがし"],
          },
        },
      },
      {}
    );
    expect(cards[0]).toMatchObject({
      debrief: {
        saved: true,
        weakAnchorLabels: ["東（ひがし）"],
        weakAnchors: ["vocab:N5:東:ひがし"],
      },
    });
  });

  it("folds a pre-TASK-160 frame without inventing labels", () => {
    // A stored paper predating the field has ids and no names. The fold must
    // not synthesize labels, and must not drop the frame: the card reads the
    // absent key as "show nothing" rather than printing the id.
    const cards = transformFrame(
      [],
      {
        ...frame,
        data: {
          ...frame.data,
          debrief: {
            saved: true,
            weakAnchors: ["vocab:N5:東:ひがし"],
          },
        },
      },
      {}
    );
    const { debrief } = (cards[0] ?? {}) as {
      debrief?: Record<string, unknown>;
    };
    expect(debrief).toBeDefined();
    expect("weakAnchorLabels" in (debrief ?? {})).toBe(false);
    expect(debrief?.weakAnchors).toEqual(["vocab:N5:東:ひがし"]);
  });
});
