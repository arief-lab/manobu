/*
 * The context-usage frame → card → reading path (TASK-103).
 *
 * AC#5 pins the whole chain a learner sees: a live `acp_context_usage`
 * frame folds to one durable card; a persisted row folds through the SAME
 * reducer (so a reload / agent restart restores the reading, AC#3); the
 * selector + view turn it into a percentage and a tier that warns before
 * the window is exhausted (AC#2), computed only from the agent's own
 * reported size (AC#4). No DOM environment in this workspace, so it is a
 * pure test over the reducer + selector.
 */

import { describe, expect, test } from "bun:test";
import type { ChatFrame } from "@manobu/api-contract";
import {
  contextUsageView,
  latestContextUsage,
  type TMessage,
  transformFrame,
} from "./chat-engine";
import { cardsFromRows, type MessageRow } from "./history";

function usageFrame(
  used: number,
  size: number,
  extra?: Record<string, unknown>
): ChatFrame {
  return {
    conversation_id: "conv-1",
    created_at: 1000,
    data: { size, used },
    msg_id: "u1",
    type: "acp_context_usage",
    ...extra,
  } as unknown as ChatFrame;
}

function usageRow(
  used: number,
  size: number,
  over?: Partial<MessageRow>
): MessageRow {
  return {
    content: JSON.stringify({ size, used }),
    conversation_id: "conv-1",
    created_at: "2026-09-22T08:00:00.000Z",
    hidden: false,
    id: 1,
    msg_id: "u1",
    ref_id: null,
    status: "finish",
    turn_id: "turn-1",
    type: "acp_context_usage",
    ui_id: null,
    ...over,
  };
}

describe("acp_context_usage fold", () => {
  test("a live usage frame folds to exactly one durable card", () => {
    const cards = transformFrame([], usageFrame(40_000, 100_000), {});
    expect(cards).toHaveLength(1);
    expect(cards[0]?.type).toBe("acp_context_usage");
  });

  test("the card is a per-conversation singleton: the latest frame replaces it", () => {
    let cards: TMessage[] = [];
    cards = transformFrame(cards, usageFrame(40_000, 100_000), {});
    cards = transformFrame(
      cards,
      usageFrame(60_000, 100_000, { created_at: 2000 }),
      {}
    );
    expect(cards).toHaveLength(1);
    const usage = latestContextUsage(cards);
    expect(usage).toEqual({ cost: undefined, size: 100_000, used: 60_000 });
  });
});

describe("persisted usage row → reading (AC#3/#5)", () => {
  test("a stored acp_context_usage row folds to the same card a live frame builds", () => {
    const cards = cardsFromRows([usageRow(52_000, 100_000)]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.type).toBe("acp_context_usage");
    const usage = latestContextUsage(cards);
    const view = usage ? contextUsageView(usage) : null;
    expect(view?.percent).toBe(52);
    expect(view?.tier).toBe("normal");
  });

  test("the newest persisted row wins when a conversation has several", () => {
    const cards = cardsFromRows([
      usageRow(20_000, 100_000, {
        created_at: "2026-09-22T08:00:00.000Z",
        id: 1,
      }),
      usageRow(95_000, 100_000, {
        created_at: "2026-09-22T09:00:00.000Z",
        id: 2,
      }),
    ]);
    const usage = latestContextUsage(cards);
    expect(usage?.used).toBe(95_000);
  });
});

describe("contextUsageView", () => {
  test("warning before exhausted, danger near the edge, both before 100", () => {
    expect(contextUsageView({ size: 100_000, used: 40_000 }).tier).toBe(
      "normal"
    );
    expect(contextUsageView({ size: 100_000, used: 70_000 }).tier).toBe(
      "warning"
    );
    expect(contextUsageView({ size: 100_000, used: 89_000 }).tier).toBe(
      "warning"
    );
    expect(contextUsageView({ size: 100_000, used: 90_000 }).tier).toBe(
      "danger"
    );
  });

  test("a reported window of 0 yields no invented percentage (AC#4)", () => {
    const view = contextUsageView({ size: 0, used: 500 });
    expect(view.percent).toBeNull();
    expect(view.tier).toBe("unknown");
  });

  test("the percentage is clamped to 100 when a turn reports over the window", () => {
    expect(contextUsageView({ size: 100_000, used: 120_000 }).percent).toBe(
      100
    );
  });
});
