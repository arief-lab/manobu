import { describe, expect, it } from "bun:test";
import type { ChatFrame } from "@manobu/api-contract";

import { CHAT_CARD_MEASURE } from "./chat-card-measure";
import {
  deriveStatus,
  isDrillItemCard,
  type TMessageDrillItem,
  transformFrame,
} from "./chat-engine";

const item = {
  anchors: ["grammar:particle"],
  answerIndex: 2,
  correctIndex: 2,
  fsrsVocabId: 91,
  id: "item-1",
  itemType: "grammar-form",
  level: "N5",
  options: ["に", "で", "を", "が"],
  prompt: "Choose the particle.",
  script: "hiragana",
};

const snapshot = {
  answered: 0,
  asked: 1,
  declaredCount: 10,
  pendingRefill: false,
  readyCount: 3,
  remaining: 9,
};

const resolution = {
  chosenIndex: 1,
  correct: false,
  correctIndex: 2,
  correctOption: "を",
  explanation: "を marks the object.",
  itemId: item.id,
};

function frame(overrides: Record<string, unknown>): ChatFrame {
  return {
    conversation_id: "conversation-1",
    data: {
      drill_session_id: "drill-1",
      item,
      phase: "pending",
      request_id: "request-1",
      session_id: "session-1",
      snapshot,
    },
    msg_id: "message-1",
    type: "drill_item",
    ...overrides,
  } as unknown as ChatFrame;
}

describe("drill item fold", () => {
  it("keeps one transcript measure for Card families", () => {
    expect(CHAT_CARD_MEASURE).toBe("max-w-2xl");
  });

  it("projects a key-free pending item and hides any premature resolution", () => {
    const cards = transformFrame(
      [],
      frame({
        data: {
          drill_session_id: "drill-1",
          item,
          phase: "pending",
          request_id: "request-1",
          resolution,
          session_id: "session-1",
          snapshot,
        },
      }),
      {}
    );
    const card = cards[0] as TMessageDrillItem;
    expect(isDrillItemCard(card)).toBe(true);
    expect(card.id).toBe("drill:request-1");
    expect(card.phase).toBe("pending");
    expect(card.item).toEqual({
      anchors: ["grammar:particle"],
      id: "item-1",
      itemType: "grammar-form",
      level: "N5",
      options: ["に", "で", "を", "が"],
      prompt: "Choose the particle.",
    });
    expect(card.item).not.toHaveProperty("answerIndex");
    expect(card.item).not.toHaveProperty("correctIndex");
    expect(card.item).not.toHaveProperty("script");
    expect(card.item).not.toHaveProperty("fsrsVocabId");
    expect(card).not.toHaveProperty("resolution");
  });

  it("settles the same card in place when the answer frame arrives", () => {
    const pending = transformFrame([], frame({}), {});
    const answered = transformFrame(
      pending,
      frame({
        data: {
          drill_session_id: "drill-1",
          item,
          phase: "answered",
          request_id: "request-1",
          resolution,
          session_id: "session-1",
          snapshot: { ...snapshot, answered: 1 },
        },
      }),
      {}
    );
    expect(answered).toHaveLength(1);
    const card = answered[0] as TMessageDrillItem;
    expect(card.id).toBe("drill:request-1");
    expect(card.phase).toBe("answered");
    expect(card.resolution).toEqual(resolution);
  });

  it("folds suspended, summary, and unavailable phases without inventing an item", () => {
    for (const phase of ["suspended", "summary", "unavailable"] as const) {
      const cards = transformFrame(
        [],
        frame({
          data: {
            drill_session_id: "drill-1",
            item: null,
            phase,
            request_id: `request-${phase}`,
            session_id: "session-1",
            snapshot,
          },
        }),
        {}
      );
      const card = cards[0] as TMessageDrillItem;
      expect(card.phase).toBe(phase);
      expect(card.item).toBeNull();
      expect(card).not.toHaveProperty("resolution");
    }
  });

  it("keeps a settled card terminal when a later statusless pending replay arrives", () => {
    const pending = transformFrame([], frame({}), {});
    const answered = transformFrame(
      pending,
      frame({
        data: {
          drill_session_id: "drill-1",
          item,
          phase: "answered",
          request_id: "request-1",
          resolution,
          session_id: "session-1",
          snapshot,
        },
      }),
      {}
    );
    const refreshed = transformFrame(answered, frame({}), {});
    const card = refreshed[0] as TMessageDrillItem;
    expect(card.phase).toBe("answered");
    expect(card.resolution).toEqual(resolution);
  });

  it("renders an error replay as unavailable instead of an interactive card", () => {
    const cards = transformFrame(
      [],
      frame({
        status: "error",
      }),
      {}
    );
    const card = cards[0] as TMessageDrillItem;
    expect(card.phase).toBe("unavailable");
    expect(card.item).toEqual(expect.objectContaining({ id: item.id }));
  });

  it("keeps a pending item in flight for status derivation", () => {
    const pendingFrame = frame({});
    const cards = transformFrame([], pendingFrame, {});
    expect(deriveStatus(cards, pendingFrame)).toBe("streaming");
  });
});
