/*
 * The persisted-row → card fold (TASK-101 AC#1/#2/#7) and the older-history
 * paging primitives (TASK-106 AC#3/#4).
 *
 * `cardsFromRows` is what makes a stored transcript renderable anywhere: it
 * rebuilds a wire frame from each database row and folds it through the SAME
 * reducer the live stream uses, so the history viewer and a connect-time
 * replay cannot drift apart. These tests pin that claim, including the two
 * ways real rows break: an unparseable `content` payload, and the legacy
 * `datetime('now')` timestamp shape.
 */

import { describe, expect, test } from "bun:test";
import type { TMessageDrillItem } from "./chat-engine";
import type { MessageRow } from "./history";
import {
  cardsFromRows,
  flattenOlderPages,
  mergeTranscript,
  messageHistoryQueryKey,
  messageHistoryQueryOptions,
  OLDER_PAGE_SIZE,
  oldestRowId,
  storedStampToEpochMs,
} from "./history";

/** One persisted row with the defaults a writer actually produces. */
function row(
  over: Partial<MessageRow> & Pick<MessageRow, "msg_id" | "type">
): MessageRow {
  return {
    content: JSON.stringify({ text: "hi", type: "text" }),
    conversation_id: "conv-1",
    created_at: "2026-09-22T08:00:00.000Z",
    hidden: false,
    id: 1,
    ref_id: null,
    status: "finish",
    turn_id: "turn-1",
    ui_id: null,
    ...over,
  };
}

describe("cardsFromRows", () => {
  test("folds a stored turn into the cards the live stream would have built", () => {
    const cards = cardsFromRows([
      row({
        content: JSON.stringify({ text: "hello", type: "text" }),
        msg_id: "u1",
        type: "user_created",
      }),
      row({
        content: JSON.stringify({ text: "hi there", type: "text" }),
        id: 2,
        msg_id: "a1",
        type: "content",
      }),
      row({
        content: JSON.stringify({ stopReason: "end_turn" }),
        id: 3,
        msg_id: "a1",
        type: "finish",
      }),
    ]);
    expect(cards.map((card) => card.type)).toEqual(["user_created", "text"]);
  });

  test("a row that fails the frame schema is skipped, not fatal", () => {
    // A frame type the union does not know (a row written by an older
    // server) and a `content` column that is not JSON at all: one bad row
    // must not blank the whole transcript.
    const cards = cardsFromRows([
      row({ msg_id: "ghost", type: "not_a_frame" }),
      row({
        content: "this is not json",
        id: 2,
        msg_id: "broke",
        type: "content",
      }),
      row({
        content: JSON.stringify({ text: "kept", type: "text" }),
        id: 3,
        msg_id: "a1",
        type: "content",
      }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.type).toBe("text");
  });

  test("the stored text wins over a partial card because rows replay as replace", () => {
    // The persisted row is the frame's FINAL accumulated state (the sink
    // updates it in place by ui_id), so folding it must not append onto a
    // card built from an earlier row of the same msg_id.
    const cards = cardsFromRows([
      row({
        content: JSON.stringify({ text: "Hel", type: "text" }),
        msg_id: "a1",
        type: "content",
      }),
      row({
        content: JSON.stringify({ text: "Hello", type: "text" }),
        id: 2,
        msg_id: "a1",
        type: "content",
      }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ content: "Hello" });
  });

  test("an ask row carries its parked status so the card stays answerable", () => {
    const cards = cardsFromRows([
      row({
        content: JSON.stringify({
          questions: [{ options: [], question: "Which one?" }],
          request_id: "req-1",
        }),
        msg_id: "ask-1",
        status: "pending",
        type: "ask",
      }),
    ]);
    expect(cards[0]).toMatchObject({ status: "pending", type: "ask" });
  });

  test("a saved ask_user turn shows the ask card only, never a raw JSON card (TASK-110)", () => {
    // The live fold drops the host tool card (chat-engine.test.ts); a reopened
    // conversation folds the same rows through the same reducer, so the stored
    // transcript must not resurrect the raw card the live one removed.
    const RAW_MARKER = "RAW-TOOL-CARD-MARKER";
    const cards = cardsFromRows([
      // The generic card the agent streams first, with its raw input. The
      // stored `content` column IS the frame's data payload (FRAME_CONTENT
      // keeps the sanitized update, which carries sessionUpdate).
      row({
        content: JSON.stringify({
          kind: "read",
          rawInput: { questions: [RAW_MARKER] },
          sessionUpdate: "tool_call",
          status: "pending",
          title: "Preparing question",
          toolCallId: "tc-1",
        }),
        id: 1,
        msg_id: "tool-1",
        type: "acp_tool_call",
      }),
      // Then the host tool's real name arrives and must remove it.
      row({
        content: JSON.stringify({
          sessionUpdate: "tool_call_update",
          title: "manobu-host-tools_ask_user",
          toolCallId: "tc-1",
        }),
        id: 2,
        msg_id: "tool-1",
        type: "acp_tool_call",
      }),
      row({
        content: JSON.stringify({
          questions: [{ options: [], question: "Which one?" }],
          request_id: "req-1",
        }),
        id: 3,
        msg_id: "ask-1",
        status: "pending",
        type: "ask",
      }),
      // Control: the same row shape with a tool that is NOT a host tool. If
      // this one survives while the two above are dropped, the suppression is
      // what removed them and not a skipped-malformed-row fallback.
      row({
        content: JSON.stringify({
          kind: "read",
          sessionUpdate: "tool_call",
          status: "completed",
          title: "read_file",
          toolCallId: "tc-2",
        }),
        id: 4,
        msg_id: "tool-2",
        type: "acp_tool_call",
      }),
    ]);
    expect(cards.map((card) => card.type)).toEqual(["ask", "acp_tool_call"]);
    expect(JSON.stringify(cards)).not.toContain(RAW_MARKER);
  });

  test("a stored turn holding ONLY a title-less host update builds no raw card (TASK-149)", () => {
    // The server-side suppression writes no titled host row at all, so a
    // reopened conversation replays exactly this one row for that call. Folded
    // with an empty ctx and nothing to update, it is the frame that used to put
    // the raw JSON back on screen after a reload (the leak local.db row 19330
    // is). The control on the next row is a non-host title-less update with the
    // same shape and the same fate: an update never invents a card.
    const RAW_MARKER = "RAW-HOST-OUTPUT-MARKER";
    const cards = cardsFromRows([
      row({
        content: JSON.stringify({
          rawOutput: { questions: [RAW_MARKER] },
          sessionUpdate: "tool_call_update",
          title: null,
          toolCallId: "tc-ask",
        }),
        id: 1,
        msg_id: "tool-1",
        type: "acp_tool_call",
      }),
      row({
        content: JSON.stringify({
          questions: [{ options: [], question: "Which one?" }],
          request_id: "req-1",
        }),
        id: 2,
        msg_id: "ask-1",
        status: "pending",
        type: "ask",
      }),
    ]);
    expect(cards.map((card) => card.type)).toEqual(["ask"]);
    expect(JSON.stringify(cards)).not.toContain(RAW_MARKER);
  });

  test("a permission row carries its lifecycle status, like the wire replay (TASK-109)", () => {
    // Parity with `toWireFrame`: the DB-fold path must settle a crashed
    // park exactly as the connect-time replay does, or the card re-arms
    // interactively on open.
    const permissionContent = JSON.stringify({
      options: [{ kind: "allow_once", name: "Allow", optionId: "o-1" }],
      request_id: "req-9",
      tool_call: {
        status: "pending",
        title: "run command",
        toolCallId: "tc-9",
      },
    });
    const cards = cardsFromRows([
      row({
        content: permissionContent,
        msg_id: "perm-9",
        status: "error",
        type: "acp_permission",
      }),
    ]);
    expect(cards[0]).toMatchObject({ status: "error", type: "acp_permission" });
  });

  test("a pending drill row keeps its lifecycle status and key-free item", () => {
    const cards = cardsFromRows([
      row({
        content: JSON.stringify({
          drill_session_id: "drill-1",
          item: {
            anchors: ["grammar:particle"],
            answerIndex: 0,
            correctIndex: 0,
            fsrsVocabId: 4,
            id: "item-1",
            itemType: "grammar-form",
            level: "N5",
            options: ["に", "で"],
            prompt: "Choose the particle.",
            script: "hiragana",
          },
          phase: "pending",
          request_id: "request-1",
          session_id: "session-1",
          snapshot: {
            answered: 0,
            asked: 1,
            declaredCount: 5,
            pendingRefill: false,
            readyCount: 2,
            remaining: 4,
          },
        }),
        msg_id: "drill-1",
        status: "pending",
        type: "drill_item",
      }),
    ]);
    expect(cards[0]).toMatchObject({
      phase: "pending",
      status: "pending",
      type: "drill_item",
    });
    const card = cards[0] as TMessageDrillItem;
    expect(card.item).not.toHaveProperty("answerIndex");
    expect(card.item).not.toHaveProperty("correctIndex");
    expect(card.item).not.toHaveProperty("script");
    expect(card.item).not.toHaveProperty("fsrsVocabId");
    expect(card).not.toHaveProperty("resolution");
  });

  test("a finished drill row replays the stored resolution", () => {
    const resolution = {
      chosenIndex: 0,
      correct: true,
      correctIndex: 0,
      correctOption: "に",
      explanation: "に marks the destination.",
      itemId: "item-1",
    };
    const cards = cardsFromRows([
      row({
        content: JSON.stringify({
          drill_session_id: "drill-1",
          item: {
            anchors: ["grammar:particle"],
            id: "item-1",
            itemType: "grammar-form",
            level: "N5",
            options: ["に", "で"],
            prompt: "Choose the particle.",
          },
          phase: "answered",
          request_id: "request-1",
          resolution,
          session_id: "session-1",
          snapshot: {
            answered: 1,
            asked: 1,
            declaredCount: 5,
            pendingRefill: false,
            readyCount: 1,
            remaining: 4,
          },
        }),
        msg_id: "drill-1",
        status: "finish",
        type: "drill_item",
      }),
    ]);
    expect(cards[0]).toMatchObject({
      phase: "answered",
      resolution,
      status: "finish",
      type: "drill_item",
    });
  });

  test("a non-parked frame type still folds statusless", () => {
    // The status carry is family-scoped: a content row's bookkeeping
    // status must not leak into the frame the reducer sees.
    const cards = cardsFromRows([
      row({ id: 7, msg_id: "a7", status: "work", type: "content" }),
    ]);
    expect(cards[0]).not.toMatchObject({ status: "work" });
  });
});

describe("storedStampToEpochMs", () => {
  test("reads the legacy datetime('now') text as UTC", () => {
    const ms = storedStampToEpochMs("2026-09-22 08:00:00");
    expect(ms).toBe(Date.parse("2026-09-22T08:00:00Z"));
  });

  test("passes an ISO stamp through", () => {
    expect(storedStampToEpochMs("2026-09-22T08:00:00.000Z")).toBe(
      Date.parse("2026-09-22T08:00:00Z")
    );
  });

  test("an unparseable stamp is undefined, never NaN", () => {
    expect(storedStampToEpochMs("(datetime('now'))")).toBeUndefined();
  });
});

describe("mergeTranscript", () => {
  test("shared frames fold to identical ids, so persisted + replay dedupe", () => {
    // The same two rows reach the transcript twice: once from the database
    // (cardsFromRows) and once from the live connect-time replay. The merge
    // must show each card once, not double-render the opened history.
    const rows = [
      row({ msg_id: "u1", type: "user_created" }),
      row({ id: 2, msg_id: "a1", type: "content" }),
    ];
    const persisted = cardsFromRows(rows);
    const live = cardsFromRows(rows);
    const merged = mergeTranscript(persisted, live);
    expect(merged.map((card) => card.id)).toEqual(
      persisted.map((card) => card.id)
    );
    // No duplicate React keys among the merged cards.
    expect(new Set(merged.map((card) => card.id)).size).toBe(merged.length);
  });

  test("a send made after opening streams in without dropping the history", () => {
    const persisted = cardsFromRows([
      row({ msg_id: "u1", type: "user_created" }),
      row({ id: 2, msg_id: "a1", type: "content" }),
    ]);
    // The live list replays the stored turn AND carries a fresh second user
    // card that no stored row exists for yet.
    const live = cardsFromRows([
      row({ msg_id: "u1", type: "user_created" }),
      row({ id: 2, msg_id: "a1", type: "content" }),
      row({ id: 3, msg_id: "u2", type: "user_created" }),
    ]);
    const merged = mergeTranscript(persisted, live);
    expect(merged.map((card) => card.id)).toEqual([
      "user:u1",
      "text:a1",
      "user:u2",
    ]);
  });

  test("an offline agent (empty live replay) still shows the stored rows", () => {
    const persisted = cardsFromRows([
      row({ msg_id: "u1", type: "user_created" }),
      row({ id: 2, msg_id: "a1", type: "content" }),
    ]);
    const merged = mergeTranscript(persisted, []);
    expect(merged.map((card) => card.id)).toEqual(["user:u1", "text:a1"]);
  });

  test("a fresh chat (no stored rows) renders exactly the live cards", () => {
    const live = cardsFromRows([row({ msg_id: "u1", type: "user_created" })]);
    expect(mergeTranscript([], live)).toEqual(live);
    expect(mergeTranscript([], [])).toEqual([]);
  });
});

describe("older-history paging primitives (TASK-106)", () => {
  /** A frame row carrying only its place in the id sequence matters here. */
  function pagedRow(id: number): MessageRow {
    return row({
      content: JSON.stringify({ text: `row ${id}`, type: "text" }),
      id,
      msg_id: `m${id}`,
      type: "content",
    });
  }

  test("the page size is the store's hard cap, which is the replay window", () => {
    // If the server's clamp in `listMessages` ever changes, the client's
    // "short page means the table start" rule breaks silently; pin both.
    expect(OLDER_PAGE_SIZE).toBe(200);
  });

  test("oldestRowId reads the cursor off an ascending page", () => {
    expect(oldestRowId([pagedRow(61), pagedRow(62), pagedRow(63)])).toBe(61);
    expect(oldestRowId([pagedRow(7)])).toBe(7);
    expect(oldestRowId([])).toBeUndefined();
  });

  test("flattenOlderPages walks back to the first turn with no gaps or dups (AC#1/#3)", () => {
    // 260 rows: the connect-time window holds the newest 200, one older
    // fetch covers the first 60. Older pages arrive newest-page-first (the
    // fetch order), so flattening must reverse them.
    const all = Array.from({ length: 260 }, (_, i) => pagedRow(i + 1));
    const pageOne = all.slice(60);
    const olderPages = [all.slice(0, 60)];
    const merged = flattenOlderPages(olderPages, pageOne);
    expect(merged.map((r) => r.id)).toEqual(all.map((r) => r.id));
    expect(new Set(merged.map((r) => r.id)).size).toBe(all.length);
  });

  test("multiple older pages flatten oldest-first below the window", () => {
    // Two backward walks from a small held window: pages were fetched
    // [61..120] then [1..60], so the held order is newest-page-first.
    const oldest = Array.from({ length: 60 }, (_, i) => pagedRow(i + 1));
    const middle = Array.from({ length: 60 }, (_, i) => pagedRow(i + 61));
    const pageOne = Array.from({ length: 60 }, (_, i) => pagedRow(i + 121));
    const merged = flattenOlderPages([middle, oldest], pageOne);
    expect(merged.map((r) => r.id)).toEqual(
      Array.from({ length: 180 }, (_, i) => i + 1)
    );
  });

  test("older pages plus the window fold ahead of live-only cards (AC#4)", () => {
    // The merge the route performs once the learner has paged back: the
    // whole walked transcript (older + window) is the base, and only a
    // send made after opening joins it, at the end.
    const pageOne = [pagedRow(101), pagedRow(102)];
    const olderPages = [[pagedRow(1), pagedRow(2)]];
    const persisted = cardsFromRows(flattenOlderPages(olderPages, pageOne));
    expect(persisted.map((c) => c.id)).toEqual([
      "text:m1",
      "text:m2",
      "text:m101",
      "text:m102",
    ]);
    // The live lane replays the window AND carries a fresh send.
    const live = cardsFromRows([
      ...pageOne,
      row({
        content: JSON.stringify({ text: "new", type: "text" }),
        id: 103,
        msg_id: "m103",
        type: "user_created",
      }),
    ]);
    const merged = mergeTranscript(persisted, live);
    expect(merged.map((c) => c.id)).toEqual([
      "text:m1",
      "text:m2",
      "text:m101",
      "text:m102",
      "user:m103",
    ]);
  });
});

describe("messageHistoryQueryOptions TASK-157 gate", () => {
  test("stays silent for a conversation id the client invented", () => {
    // The old test was `conversationId.length > 0`, which every minted UUID
    // passed, so a fresh /ai asked for a transcript the server could only
    // answer NOT_FOUND. The gate is now the caller's proof, not the string.
    expect(
      messageHistoryQueryOptions({
        conversationId: "11111111-2222-3333-4444-555555555555",
        known: false,
      }).enabled
    ).toBe(false);
    expect(
      messageHistoryQueryOptions({
        conversationId: "11111111-2222-3333-4444-555555555555",
        known: true,
      }).enabled
    ).toBe(true);
  });

  test("the gate is not part of the cache key", () => {
    // An invalidation (a paper frame landing in the transcript) has to reach
    // the same entry whatever it thinks about the gate.
    const gated = messageHistoryQueryOptions({
      conversationId: "conv-1",
      known: false,
    });
    expect([...gated.queryKey]).toEqual([...messageHistoryQueryKey("conv-1")]);
    expect([...messageHistoryQueryKey("conv-1", 42)]).toEqual([
      "chat",
      "messages",
      "conv-1",
      42,
    ]);
  });
});
