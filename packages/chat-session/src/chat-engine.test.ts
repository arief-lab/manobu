/**
 * Pure frame-fold tests for the TASK-80.3 AionUi-style message engine.
 *
 * No React, no WebSocket — just `transformFrame` and `deriveStatus`.
 * The `useChatEngine` hook (React wiring) is covered by the multi-mount
 * retarget + e2e chat tests; this file locks the reducer contract.
 *
 * Id conventions (from `chatEngine.ts`):
 * - text / thinking: `id = frame.msg_id`
 * - plan:            `id = plan:{msg_id}`
 * - acp_tool_call:   `id = tool:{toolCallId}`
 * - acp_permission:  `id = perm:{request_id}`
 * - ask:             `id = ask:{request_id}`
 * - error:           `id = err:{msg_id}`
 * - user_created:    `id = user:{msg_id}`
 */

import { describe, expect, it } from "bun:test";
import {
  INLINE_IMAGE_RESULT_LIMIT,
  sanitizeAcpToolUpdate,
} from "@manobu/acp/acp-events";
import type { ChatFrame } from "@manobu/api-contract";
import type {
  TMessageAcpPermission,
  TMessageAcpToolCall,
  TMessageTerminal,
  TMessageText,
} from "./chat-engine";
import { deriveStatus, type TMessage, transformFrame } from "./chat-engine";
import { foldText } from "./chat-engine/folds/text";
import { foldAcpToolCall } from "./chat-engine/folds/tool-call";

// ── Frame fixture helper ─────────────────────────────────────────────────────

/** Build a valid `ChatFrame` with sensible defaults; override per test. */
function makeFrame(
  partial: Record<string, unknown> & { type: string }
): ChatFrame {
  return {
    conversation_id: "c1",
    data: {},
    msg_id: "m1",
    ...partial,
  } as unknown as ChatFrame;
}

/** A `content` frame with a proper ContentBlock payload. */
function contentFrame(
  text: string,
  extra?: Record<string, unknown>
): ChatFrame {
  return makeFrame({ data: { text, type: "text" }, type: "content", ...extra });
}

/** A `thinking` frame with a proper ContentBlock payload. */
function thinkingFrame(
  text: string,
  extra?: Record<string, unknown>
): ChatFrame {
  return makeFrame({
    data: { text, type: "thinking" },
    type: "thinking",
    ...extra,
  });
}

// ── (a) content fold ─────────────────────────────────────────────────────────
describe("content fold", () => {
  it("start → content → content merges into one text card with a deterministic id", () => {
    const start = makeFrame({ data: { session_id: "s1" }, type: "start" });
    const c1 = contentFrame("Hello");
    const c2 = contentFrame(", world");

    const afterStart = transformFrame([], start, {});
    const afterC1 = transformFrame(afterStart, c1, {});
    const afterC2 = transformFrame(afterC1, c2, {});

    // `start` produces no card; two `content` frames fold into one.
    expect(afterStart).toEqual([]);
    expect(afterC1).toHaveLength(1);
    expect(afterC2).toHaveLength(1);

    const card = afterC2[0] as TMessageText;
    expect(card.type).toBe("text");
    expect(card.id).toBe("text:m1"); // deterministic: type-scoped msg_id
    expect((card as { content?: string }).content).toBe("Hello, world");
  });

  it("replace:true replaces the accumulated text instead of appending", () => {
    const c1 = contentFrame("abc");
    const c2 = contentFrame("xyz", { replace: true });

    const prev = transformFrame([], c1, {});
    const next = transformFrame(prev, c2, {});

    expect(next).toHaveLength(1);
    expect((next[0] as { content?: string }).content).toBe("xyz");
    expect((next[0] as { replace?: boolean }).replace).toBe(true);
  });
});

// ── (b) thinking fold ────────────────────────────────────────────────────────

describe("thinking fold", () => {
  it("start → thinking produces one thinking card", () => {
    const t1 = thinkingFrame("reasoning…");
    const t2 = thinkingFrame(" more");

    const prev = transformFrame([], t1, {});
    const next = transformFrame(prev, t2, {});

    expect(prev).toHaveLength(1);
    expect(next).toHaveLength(1);
    expect(next[0]?.type).toBe("thinking");
    expect(next[0]?.id).toBe("thinking:m1");
    expect((next[0] as { content?: string }).content).toBe("reasoning… more");
  });

  it("thinking then text on ONE shared turn msg_id folds to TWO distinct cards (no duplication)", () => {
    // Live-UI regression (2026-09-21): the server stamps every frame in a
    // turn with the same msg_id. The old bare-msg_id card id collided
    // across types, so each text chunk hit the different-type
    // fall-through and appended a duplicate card (transcript grew to
    // 2000+ entries, 12 unique ids, duplicate React keys).
    const think = thinkingFrame("reasoning");
    const text = contentFrame("answer");

    const afterThink = transformFrame([], think, {});
    const afterText = transformFrame(afterThink, text, {});

    expect(afterThink).toHaveLength(1);
    expect(afterText).toHaveLength(2);
    expect(afterText[0]?.id).toBe("thinking:m1");
    expect(afterText[1]?.id).toBe("text:m1");

    // Subsequent chunks keep merging into their own card — no growth.
    const more = transformFrame(afterText, contentFrame("!", {}), {});
    expect(more).toHaveLength(2);
    expect((more[1] as { content?: string }).content).toBe("answer!");
  });
});

// ── (c) tool_call merge ──────────────────────────────────────────────────────

describe("acp_tool_call merge", () => {
  function toolFrame(update: Partial<Record<string, unknown>>): ChatFrame {
    return makeFrame({
      data: {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        ...update,
      },
      type: "acp_tool_call",
    });
  }

  it("start → tool_call (new) → tool_call_update (same id) merges into one card", () => {
    const callFrame = toolFrame({
      kind: "read",
      sessionUpdate: "tool_call",
      status: "in_progress",
      title: "Read file",
    });
    const updateFrame = toolFrame({
      rawOutput: { result: "file contents" },
      sessionUpdate: "tool_call_update",
      status: "completed",
    });

    const prev = transformFrame([], callFrame, {});
    const next = transformFrame(prev, updateFrame, {});

    expect(prev).toHaveLength(1);
    expect(next).toHaveLength(1);

    const card = next[0] as TMessage & {
      toolCallId: string;
      status: string | null;
      title: string | null;
      raw_output?: unknown;
    };
    expect(card.id).toBe("tool:tc-1");
    expect(card.toolCallId).toBe("tc-1");
    // Merged: title survives from the initial frame; status comes from the update.
    expect(card.status).toBe("completed");
    expect(card.raw_output).toEqual({ result: "file contents" });
  });

  it("removes host drill tool calls when the semantic name arrives", () => {
    const initial = toolFrame({ title: "Preparing request" });
    const host = toolFrame({
      sessionUpdate: "tool_call_update",
      title: "manobu-host-tools_next_drill_item",
    });

    const withGeneric = transformFrame([], initial, {});
    expect(withGeneric).toHaveLength(1);
    const semanticOnly = transformFrame(withGeneric, host, {});

    expect(semanticOnly).toEqual([]);
  });

  it("keeps the ask card as the only representation of a host ask_user call (TASK-110)", () => {
    // The reported sequence: a generic tool card streams first (raw JSON
    // input, "In progress"), then the host tool's real name arrives and the
    // ask questionnaire appears. The raw card must go, in both title shapes,
    // and the ask card must survive.
    const askCard: ChatFrame = {
      conversation_id: "c1",
      data: {
        questions: [{ options: [], question: "Which one?" }],
        request_id: "req-1",
      },
      msg_id: "ask-1",
      type: "ask",
    } as unknown as ChatFrame;
    const streaming = transformFrame(
      [],
      toolFrame({ title: "Preparing question" }),
      {}
    );
    const withAsk = transformFrame(streaming, askCard, {});
    expect(withAsk.map((card) => card.type)).toEqual(["acp_tool_call", "ask"]);

    for (const title of ["ask_user", "manobu-host-tools_ask_user"]) {
      const settled = transformFrame(
        withAsk,
        toolFrame({ sessionUpdate: "tool_call_update", title }),
        {}
      );
      expect(settled.map((card) => card.type)).toEqual(["ask"]);
    }
  });
  it("builds no card from a host tool's title-less update (TASK-149)", () => {
    // The server suppresses the titled frame BEFORE publishing it, so the
    // first frame the reducer ever sees for that toolCallId is the title-less
    // update — live, and again when a stored turn is reopened. A fold that
    // only recognizes a host tool by its title therefore builds a raw-JSON
    // card out of that update, which is the duplicate the ask/drill/paper
    // card was suppressing in the first place.
    for (const title of ["ask_user", "next_drill_item", "start_exam"]) {
      const titledAway = transformFrame(
        transformFrame([], toolFrame({ title }), {}),
        toolFrame({ sessionUpdate: "tool_call_update", title }),
        {}
      );
      expect(titledAway).toEqual([]);
      // The update that follows it must not put the card back.
      expect(
        transformFrame(
          titledAway,
          toolFrame({
            rawOutput: { answer: "N5" },
            sessionUpdate: "tool_call_update",
            title: null,
          }),
          {}
        )
      ).toEqual([]);
    }
  });

  it("an update with no title and no card to update still keeps a real tool's card (TASK-149)", () => {
    // The control. The rule above is "never INVENT a card from an update", not
    // "drop title-less updates": a tool whose card already exists must still
    // take the update's status and output, or every ordinary tool card would
    // freeze at "in progress".
    const open = transformFrame(
      [],
      toolFrame({
        sessionUpdate: "tool_call",
        status: "in_progress",
        title: "Read file",
      }),
      {}
    );
    const settled = transformFrame(
      open,
      toolFrame({
        rawOutput: { result: "contents" },
        sessionUpdate: "tool_call_update",
        status: "completed",
        title: null,
      }),
      {}
    );
    expect(settled).toHaveLength(1);
    const card = settled[0] as TMessage & {
      raw_output?: unknown;
      status: string | null;
      toolCallId: string;
    };
    expect(card.id).toBe("tool:tc-1");
    expect(card.toolCallId).toBe("tc-1");
    expect(card.status).toBe("completed");
    expect(card.raw_output).toEqual({ result: "contents" });
  });

  it("still renders a card for every other tool (TASK-110)", () => {
    for (const title of ["read_file", "lookup_vocab", "ask_user_helper"]) {
      const cards = transformFrame([], toolFrame({ title }), {});
      expect(cards.map((card) => card.type)).toEqual(["acp_tool_call"]);
    }
  });

  it("sanitizes oversized base64 inline images in rawOutput", () => {
    // Build a base64 string larger than INLINE_IMAGE_RESULT_LIMIT that
    // the sanitizer will strip.
    const oversizedBase64 = `iVBORw0KGgo${"A".repeat(INLINE_IMAGE_RESULT_LIMIT)}`;
    expect(oversizedBase64.length).toBeGreaterThan(INLINE_IMAGE_RESULT_LIMIT);

    // The call opens with the frame that names it, then the completion streams
    // as a title-less update. TASK-149 made an update with no card to update
    // build nothing, so both legs are driven here rather than the update alone.
    const opened = transformFrame(
      [],
      toolFrame({
        rawOutput: { result: oversizedBase64 },
        title: "Read image",
      }),
      {}
    );
    expect(opened).toHaveLength(1);
    expect(
      (opened[0] as { raw_output?: unknown }).raw_output
    ).not.toHaveProperty("result");

    const updateFrame = toolFrame({
      rawOutput: { result: oversizedBase64 },
      sessionUpdate: "tool_call_update",
      status: "completed",
    });

    const prev = transformFrame(opened, updateFrame, {});
    expect(prev).toHaveLength(1);

    const card = prev[0] as TMessage & { raw_output?: unknown };
    const raw = card.raw_output as Record<string, unknown>;
    // The sanitizer strips the base64 and marks it omitted.
    expect(raw).not.toHaveProperty("result");
    expect(raw.result_omitted).toBe(true);
    expect(raw.image).toBeDefined();
    expect((raw.image as { path: string }).path).toBe("");
  });

  it("sanitizeAcpToolUpdate strips both camelCase and snake_case keys", () => {
    const oversized = `data:image/png;base64,${"B".repeat(1024 * 100)}`;
    const update: Record<string, unknown> = {
      raw_output: { result: oversized },
      rawOutput: { result: oversized },
      toolCallId: "tc-1",
    };
    const sanitized = sanitizeAcpToolUpdate(update);
    expect(sanitized.rawOutput).not.toHaveProperty("result");
    expect(sanitized.raw_output).not.toHaveProperty("result");
    expect(sanitized.rawOutput).toHaveProperty("result_omitted", true);
    expect(sanitized.raw_output).toHaveProperty("result_omitted", true);
  });
});

// ── (d) plan deterministic id ────────────────────────────────────────────────

describe("plan frame", () => {
  it("produces a card with id = plan:{msg_id}", () => {
    const frame = makeFrame({
      data: {
        entries: [
          { content: "step 1", status: "in_progress" },
          { content: "step 2", status: "pending" },
        ],
      },
      msg_id: "m-plan",
      type: "plan",
    });
    const next = transformFrame([], frame, {});
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("plan:m-plan");
    expect(next[0]?.type).toBe("plan");
  });

  it("a second plan frame with the same msg_id replaces in place (no new card)", () => {
    const frame1 = makeFrame({
      data: {
        entries: [
          { content: "step 1", status: "in_progress" },
          { content: "step 2", status: "pending" },
        ],
      },
      msg_id: "m-plan",
      type: "plan",
    });
    const frame2 = makeFrame({
      data: {
        entries: [{ content: "step 1", status: "completed" }],
      },
      msg_id: "m-plan",
      type: "plan",
    });

    const prev = transformFrame([], frame1, {});
    const next = transformFrame(prev, frame2, {});

    expect(prev).toHaveLength(1);
    expect(next).toHaveLength(1); // in-place replace, not append
    const card = next[0] as TMessage & { entries: Array<{ status: string }> };
    expect(card.entries).toHaveLength(1);
    expect(card.entries[0]?.status).toBe("completed");
  });
});

// ── (e) acp_permission parked + resolved ─────────────────────────────────────

describe("acp_permission parked + resolved", () => {
  const toolCall = { status: null, title: "Run command", toolCallId: "tc-1" };

  function permFrame(): ChatFrame {
    return makeFrame({
      data: {
        options: [
          {
            kind: "allow_once" as const,
            name: "Allow once",
            optionId: "opt-1",
          },
        ],
        request_id: "req-1",
        tool_call: toolCall,
      },
      msg_id: "m-perm",
      type: "acp_permission",
    });
  }

  function resolvedFrame(): ChatFrame {
    return makeFrame({
      data: {
        option_id: "opt-1",
        request_id: "req-1",
      },
      msg_id: "m-perm",
      type: "acp_permission_resolved",
    });
  }

  it("acp_permission produces a parked card with id = perm:{request_id}", () => {
    const next = transformFrame([], permFrame(), {});
    expect(next).toHaveLength(1);
    const card = next[0] as TMessageAcpPermission;
    expect(card.id).toBe("perm:req-1");
    expect(card.type).toBe("acp_permission");
    // Parked: no settled yet
    expect((card as TMessage & { settled?: unknown }).settled).toBeUndefined();
  });

  it("acp_permission_resolved settles the card in place", () => {
    const prev = transformFrame([], permFrame(), {});
    const next = transformFrame(prev, resolvedFrame(), {});

    expect(next).toHaveLength(1); // in-place, not appended
    const card = next[0] as TMessage & {
      settled?: { optionId?: string | null };
    };
    expect(card.settled).toEqual({ optionId: "opt-1" });
  });

  it("acp_permission_resolved with no matching card is a no-op", () => {
    const next = transformFrame([], resolvedFrame(), {});
    expect(next).toEqual([]);
  });

  it("a replayed lifecycle status lands on the card and survives a statusless refresh (TASK-109)", () => {
    const prev = transformFrame([], permFrame(), {});
    const expired = transformFrame(
      prev,
      { ...permFrame(), status: "error" },
      {}
    );
    expect((expired[0] as TMessageAcpPermission).status).toBe("error");
    // A later re-issue without a status must not erase the terminal state.
    const kept = transformFrame(expired, permFrame(), {});
    expect((kept[0] as TMessageAcpPermission).status).toBe("error");
  });
});

// ── (f) ask parked ────────────────────────────────────────────────────────────

describe("ask frame", () => {
  it("produces a parked ask card with id = ask:{request_id}", () => {
    const frame = makeFrame({
      data: {
        questions: [
          {
            options: [{ label: "Yes" }, { label: "No" }],
            question: "Do you want to continue?",
          },
        ],
        request_id: "ask-1",
      },
      msg_id: "m-ask",
      type: "ask",
    });

    const next = transformFrame([], frame, {});
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("ask:ask-1");
    expect(next[0]?.type).toBe("ask");

    const card = next[0] as TMessage & {
      requestId: string;
      questions: Array<{ question: string }>;
    };
    expect(card.requestId).toBe("ask-1");
    expect(card.questions[0]?.question).toBe("Do you want to continue?");
  });

  it("a second ask frame with the same request_id refreshes in place", () => {
    const q1: ChatFrame = makeFrame({
      data: {
        questions: [{ options: [], question: "old" }],
        request_id: "ask-1",
      },
      msg_id: "m-ask",
      type: "ask",
    });
    const q2: ChatFrame = makeFrame({
      data: {
        questions: [{ options: [], question: "new" }],
        request_id: "ask-1",
      },
      msg_id: "m-ask",
      type: "ask",
    });

    const prev = transformFrame([], q1, {});
    const next = transformFrame(prev, q2, {});

    expect(next).toHaveLength(1);
    const card = next[0] as TMessage & {
      questions: Array<{ question: string }>;
    };
    expect(card.questions[0]?.question).toBe("new");
  });

  // TASK-86: a replayed settled ask row carries status + the answer
  // summary; the fold must park them on the card so the part can render
  // the compact state.
  it("a settled ask frame (finish + answers) carries status and settled", () => {
    const frame = makeFrame({
      data: {
        answers: [{ labels: ["N5"], question: "What level?" }],
        questions: [{ options: [{ label: "N5" }], question: "What level?" }],
        request_id: "ask-9",
      },
      msg_id: "m-ask",
      status: "finish",
      type: "ask",
    });
    const next = transformFrame([], frame, {});
    const card = next[0] as TMessage & {
      requestId: string;
      settled?: { answers?: Array<{ labels: string[] }>; decline?: boolean };
      status?: string;
    };
    expect(card.status).toBe("finish");
    expect(card.settled?.answers?.[0]?.labels).toEqual(["N5"]);
  });

  it("a declined ask frame settles with the decline flag", () => {
    const frame = makeFrame({
      data: {
        declined: true,
        questions: [{ options: [{ label: "N5" }], question: "What level?" }],
        request_id: "ask-10",
      },
      msg_id: "m-ask",
      status: "finish",
      type: "ask",
    });
    const next = transformFrame([], frame, {});
    const card = next[0] as TMessage & {
      settled?: { decline?: boolean };
    };
    expect(card.settled?.decline).toBe(true);
  });

  it("an expired ask frame carries status error and no summary", () => {
    const frame = makeFrame({
      data: {
        questions: [{ options: [{ label: "N5" }], question: "What level?" }],
        request_id: "ask-11",
      },
      msg_id: "m-ask",
      status: "error",
      type: "ask",
    });
    const next = transformFrame([], frame, {});
    const card = next[0] as TMessage & {
      settled?: unknown;
      status?: string;
    };
    expect(card.status).toBe("error");
    expect(card.settled).toBeUndefined();
  });

  it("a second ask frame refreshes status and settled in place", () => {
    const parked = makeFrame({
      data: {
        questions: [{ options: [{ label: "N5" }], question: "What level?" }],
        request_id: "ask-12",
      },
      msg_id: "m-ask",
      type: "ask",
    });
    const settledFrame = makeFrame({
      data: {
        answers: [{ labels: ["N5"], question: "What level?" }],
        questions: [{ options: [{ label: "N5" }], question: "What level?" }],
        request_id: "ask-12",
      },
      msg_id: "m-ask",
      status: "finish",
      type: "ask",
    });
    const prev = transformFrame([], parked, {});
    const next = transformFrame(prev, settledFrame, {});
    expect(next).toHaveLength(1);
    const card = next[0] as TMessage & {
      settled?: { answers?: unknown[] };
      status?: string;
    };
    expect(card.status).toBe("finish");
    expect(card.settled?.answers).toHaveLength(1);
  });

  // TASK-86 AC#3: a parked ask must keep the turn non-idle, otherwise the
  // composer swaps Stop out and the learner cannot abandon the blocked turn.
  it("a parked ask (live, no status) derives streaming so Stop stays available", () => {
    const parked = makeFrame({
      data: {
        questions: [{ options: [{ label: "N5" }], question: "What level?" }],
        request_id: "ask-20",
      },
      msg_id: "m-ask",
      type: "ask",
    });
    const next = transformFrame([], parked, {});
    expect(deriveStatus(next, parked)).toBe("streaming");
  });

  it("a replayed pending ask derives streaming; a settled replay row does not", () => {
    const askFrame = (status: "error" | "finish" | "pending") =>
      makeFrame({
        data: {
          questions: [{ options: [{ label: "N5" }], question: "What level?" }],
          request_id: `ask-21-${status}`,
        },
        msg_id: "m-ask",
        status,
        type: "ask",
      });
    for (const status of ["pending", "finish", "error"] as const) {
      const frame = askFrame(status);
      const next = transformFrame([], frame, {});
      const derived = deriveStatus(next, frame);
      if (status === "pending") {
        expect(derived).toBe("streaming");
      } else {
        // A settled replay row (finish/error) is not in flight: idle.
        expect(derived).toBe("idle");
      }
    }
  });
});

// ── (g) error terminal ────────────────────────────────────────────────────────

describe("error frame", () => {
  it("produces an error card with id = err:{msg_id} and status = 'error'", () => {
    const start = makeFrame({ data: { session_id: "s1" }, type: "start" });
    const err = makeFrame({
      data: { text: "Something went wrong" },
      msg_id: "m-err",
      type: "error",
    });

    const afterStart = transformFrame([], start, {});
    const next = transformFrame(afterStart, err, {});

    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("err:m-err");
    expect(next[0]?.type).toBe("error");

    const status = deriveStatus(next, err);
    expect(status).toBe("error");
  });
});

// ── (g.2) finish frame carrying the turn's error (TASK-102 AC#4/#6) ───────────

describe("finish frame error", () => {
  const finishFrame = (
    data: Record<string, unknown>,
    msgId = "m-finish"
  ): ChatFrame => makeFrame({ data, msg_id: msgId, type: "finish" });

  it("an error finish folds an err card and keeps the turn in error", () => {
    const frame = finishFrame({
      error: { code: "AUTH_REQUIRED", message: "agent needs you to sign in" },
      stopReason: "error",
    });
    const next = transformFrame([], frame, {});

    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("err:m-finish");
    expect(next[0]?.type).toBe("error");
    expect((next[0] as { text?: string }).text).toBe(
      "agent needs you to sign in"
    );
    // The code survives the fold so the client can render a sign-in heading.
    expect((next[0] as { code?: string }).code).toBe("AUTH_REQUIRED");
    expect(deriveStatus(next, frame)).toBe("error");
  });

  it("a clean finish produces no card", () => {
    const frame = finishFrame({ stopReason: "end_turn" });
    const next = transformFrame([], frame, {});
    expect(next).toHaveLength(0);
  });

  it("an error finish with no message degrades to no card", () => {
    // No fabricated empty error bubble: without a message there is nothing
    // legible to show, so the fold leaves the list untouched.
    const frame = finishFrame({ stopReason: "error" });
    const next = transformFrame([], frame, {});
    expect(next).toHaveLength(0);
  });
});

// ── (h) stale-turn guard ─────────────────────────────────────────────────────

describe("stale-turn guard", () => {
  it("frames with a different turn_id than ctx.turnId are ignored", () => {
    const c1 = contentFrame("hello", { turn_id: "turn-A" });

    const withTurnA = transformFrame([], c1, { turnId: "turn-A" });
    expect(withTurnA).toHaveLength(1);

    // A frame from a different turn is dropped:
    const c2 = contentFrame("stale", { turn_id: "turn-B" });
    const next = transformFrame(withTurnA, c2, { turnId: "turn-A" });
    expect(next).toHaveLength(1); // unchanged
    expect((next[0] as { content?: string }).content).toBe("hello");
  });

  it("frames without turn_id pass the guard when ctx.turnId is set", () => {
    const c1 = contentFrame("no-turn");
    const next = transformFrame([], c1, { turnId: "turn-A" });
    expect(next).toHaveLength(1);
    expect((next[0] as { content?: string }).content).toBe("no-turn");
  });
});

// ── (i) user_created ─────────────────────────────────────────────────────────

describe("user_created frame", () => {
  it("appends a user card with id = user:{msg_id}", () => {
    const frame = makeFrame({
      data: { text: "Hello, agent" },
      msg_id: "m-user",
      type: "user_created",
    });

    const next = transformFrame([], frame, {});
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("user:m-user");
    expect(next[0]?.type).toBe("user_created");
    expect((next[0] as TMessage & { text: string }).text).toBe("Hello, agent");
  });

  it("replaces an existing user card with the same msg_id", () => {
    const f1 = makeFrame({
      data: { text: "first" },
      msg_id: "m-user",
      type: "user_created",
    });
    const f2 = makeFrame({
      data: { text: "updated" },
      msg_id: "m-user",
      type: "user_created",
    });

    const prev = transformFrame([], f1, {});
    const next = transformFrame(prev, f2, {});

    expect(next).toHaveLength(1);
    expect((next[0] as TMessage & { text: string }).text).toBe("updated");
  });
});

// ── (j) status derivation ────────────────────────────────────────────────────

describe("deriveStatus", () => {
  it("returns 'idle' for an empty list with no last frame", () => {
    expect(deriveStatus([], null)).toBe("idle");
  });

  it("returns 'idle' when the last frame is finish (no error stopReason)", () => {
    const text = contentFrame("hi");
    const finish = makeFrame({
      data: { stopReason: "end_turn" },
      type: "finish",
    });
    const msgs = transformFrame([], text, {});
    expect(deriveStatus(msgs, finish)).toBe("idle");
  });

  it("returns 'error' when the last frame is finish with stopReason=error", () => {
    const text = contentFrame("hi");
    const finish = makeFrame({
      data: { stopReason: "error" },
      type: "finish",
    });
    const msgs = transformFrame([], text, {});
    expect(deriveStatus(msgs, finish)).toBe("error");
  });

  it("returns 'streaming' when the last frame is content", () => {
    const c1 = contentFrame("thinking…");
    const next = transformFrame([], c1, {});
    expect(deriveStatus(next, c1)).toBe("streaming");
  });

  it("returns 'streaming' when the last frame is thinking", () => {
    const t1 = thinkingFrame("reasoning…");
    const next = transformFrame([], t1, {});
    expect(deriveStatus(next, t1)).toBe("streaming");
  });

  it("returns 'submitted' when there is a user card but no assistant card", () => {
    const user = makeFrame({
      data: { text: "question" },
      msg_id: "m-u",
      type: "user_created",
    });
    const msgs = transformFrame([], user, {});
    expect(deriveStatus(msgs, user)).toBe("submitted");
  });

  it("returns 'error' when an error card is present regardless of lastFrame", () => {
    const err = makeFrame({
      data: { text: "boom" },
      msg_id: "m-e",
      type: "error",
    });
    const msgs = transformFrame([], err, {});
    // Even with a finish lastFrame, the error card wins:
    const finish = makeFrame({
      data: { stopReason: "end_turn" },
      type: "finish",
    });
    expect(deriveStatus(msgs, finish)).toBe("error");
  });

  it("returns 'idle' when there are no cards at all", () => {
    expect(deriveStatus([], null)).toBe("idle");
  });
});
describe("transient frames", () => {
  it("does not produce a card for any transient frame type", () => {
    const transientFrames: Array<{
      type: string;
      data: Record<string, unknown>;
    }> = [
      { data: { session_id: "s1" }, type: "start" },
      { data: { stopReason: "end_turn" }, type: "finish" },
      { data: { status: "connected" }, type: "agent_status" },
      // acp_context_usage moved to a durable card in TASK-103 (see the
      // "acp_context_usage fold" suite in context-usage.test.ts).
      { data: { configOptions: [] }, type: "acp_config_option" },
      { data: { currentModeId: "m1" }, type: "acp_mode_info" },
      { data: {}, type: "acp_session_info" },
      { data: { commands: [] }, type: "available_commands" },
    ];

    for (const { type, data } of transientFrames) {
      const frame = makeFrame({ data, type }) as unknown as ChatFrame;
      const next = transformFrame([], frame, {});
      expect(next, `${type} should produce no card`).toHaveLength(0);
    }
  });
});

// ── terminal-output fold (TASK-80.4.1) ──────────────────────────────────────
describe("acp_terminal_output fold", () => {
  function terminalFrame(
    overrides: {
      data?: Record<string, unknown>;
      msg_id?: string;
      terminal_id?: string;
    } = {}
  ): ChatFrame {
    const terminalId = overrides.terminal_id ?? "t1";
    const data = {
      command: "npm test",
      exit_status: null,
      output: "PASS",
      terminal_id: terminalId,
      truncated: false,
      ...overrides.data,
    };
    return makeFrame({
      data,
      msg_id: overrides.msg_id ?? "m1",
      type: "acp_terminal_output",
    });
  }

  it("produces a card with a deterministic term:{msg_id}:{terminal_id} id", () => {
    const next = transformFrame([], terminalFrame({ msg_id: "m9" }), {});
    expect(next).toHaveLength(1);
    const card = next[0] as TMessageTerminal;
    expect(card.id).toBe("term:m9:t1");
    expect(card.terminalId).toBe("t1");
    expect(card.command).toBe("npm test");
    expect(card.exitStatus).toBeNull();
  });

  it("full-replaces the card in place on a subsequent cumulative snapshot", () => {
    const running = terminalFrame({
      data: { output: "step 1\n" },
      terminal_id: "t2",
    });
    const exited = terminalFrame({
      data: {
        exit_status: { exit_code: 0, signaled: false },
        output: "step 1\nstep 2\ndone",
      },
      terminal_id: "t2",
    });
    const first = transformFrame([], running, {});
    const next = transformFrame(first, exited, {});
    expect(next).toHaveLength(1);
    const card = next[0] as TMessageTerminal;
    // Same id, the snapshot now carries the exit status (full-replace, not
    // chunk-append: the cumulative buffer already has the whole output).
    expect(card.id).toBe("term:m1:t2");
    expect(card.output).toBe("step 1\nstep 2\ndone");
    expect(card.exitStatus).toEqual({ exit_code: 0, signaled: false });
  });

  it("two terminals in one conversation fold to two cards", () => {
    const a = terminalFrame({ terminal_id: "ta" });
    const b = terminalFrame({ terminal_id: "tb" });
    const next = transformFrame(transformFrame([], a, {}), b, {});
    expect(next).toHaveLength(2);
    expect(next[0]?.id).toBe("term:m1:ta");
    expect(next[1]?.id).toBe("term:m1:tb");
  });
});

// TASK-81.2: direct coverage of the extracted fold functions (lowers CRAP
// on the per-family folds; the golden transcript covers the dispatch path).

describe("foldText (direct)", () => {
  const textFrame = (text: string, replace?: boolean): ChatFrame =>
    ({
      conversation_id: "c1",
      data: { text },
      msg_id: "m1",
      type: "content",
      ...(replace === undefined ? {} : { replace }),
    }) as unknown as ChatFrame;

  it("appends onto an existing card with the same msg_id", () => {
    const first = foldText([], textFrame("a"), "text");
    const second = foldText(first, textFrame("b"), "text");
    expect(second).toHaveLength(1);
    expect((second[0] as TMessageText).content).toBe("ab");
  });

  it("replace:true re-stamps the accumulated content", () => {
    const first = foldText([], textFrame("a"), "text");
    const second = foldText(first, textFrame("FULL", true), "text");
    expect((second[0] as TMessageText).content).toBe("FULL");
  });

  it("different msg_id appends a new card", () => {
    const f1 = foldText([], textFrame("a"), "text");
    const f2 = foldText(f1, { ...textFrame("b"), msg_id: "m2" }, "text");
    expect(f2).toHaveLength(2);
  });
});

describe("foldAcpToolCall (direct)", () => {
  const toolFrame = (title: string): ChatFrame =>
    ({
      conversation_id: "c1",
      data: { kind: "read", title, toolCallId: "t1" },
      msg_id: "m1",
      type: "acp_tool_call",
    }) as unknown as ChatFrame;

  it("creates the tool: id card then merges updates into the same card", () => {
    const first = foldAcpToolCall(
      [],
      toolFrame("one") as ChatFrame & { type: "acp_tool_call" }
    );
    expect(first).toHaveLength(1);
    const second = foldAcpToolCall(
      first,
      toolFrame("two") as ChatFrame & { type: "acp_tool_call" }
    );
    expect(second).toHaveLength(1);
    expect((second[0] as TMessageAcpToolCall).title).toBe("two");
    expect(second[0]?.id).toBe("tool:t1");
  });
});
