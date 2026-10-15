/**
 * Direct ChatCardSwitch coverage (TASK-81.5): pins every card family's
 * render decision at the new dispatch component so CRAP is earned down
 * by tests, not suppressions. SSR markup assertions mirror the transcript
 * suites' style (renderToStaticMarkup, no DOM).
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  answeredTurnMsgIds,
  ChatCardSwitch,
  STRETCHED_TYPES,
} from "./chat-card-switch";
import type { TMessage } from "./chat-engine/types";

const render = (card: TMessage, isStreaming = false, answered = false) =>
  renderToStaticMarkup(
    <ChatCardSwitch answered={answered} card={card} isStreaming={isStreaming} />
  );

/** Test fixture: CardBase fields shared by every card literal. */
const base = { conversation_id: "c1", msg_id: "m1" };

describe("ChatCardSwitch dispatch (TASK-81.5)", () => {
  test("user_created renders the user bubble with You header", () => {
    const html = render({
      ...base,
      id: "u1",
      text: "hello",
      type: "user_created",
    });
    expect(html).toContain("You");
    expect(html).toContain("hello");
  });

  test("text card renders the assistant bubble and TextPart markdown", () => {
    const html = render({
      ...base,
      content: "answer **bold**",
      id: "t1",
      type: "text",
    });
    expect(html).toContain("AI Assistant");
    expect(html).toContain("answer");
  });

  test("thinking card renders the collapsed strip, body hidden (TASK-87 AC#1)", () => {
    const html = render({
      ...base,
      content: "pondering",
      id: "k1",
      type: "thinking",
    });
    expect(html).toContain("AI Assistant");
    expect(html).toContain("Thought");
    expect(html).not.toContain("pondering");
  });

  test("thinking card renders expanded while the turn streams (AC#2)", () => {
    const html = render(
      { ...base, content: "pondering", id: "k1", type: "thinking" },
      true
    );
    expect(html).toContain("Thinking...");
    expect(html).toContain("<pre");
    expect(html).toContain("pondering");
  });

  test("thinking card stays collapsed once the turn's answer arrived (AC#2)", () => {
    const html = render(
      { ...base, content: "pondering", id: "k1", type: "thinking" },
      false,
      true
    );
    expect(html).not.toContain("<pre");
  });

  test("acp_tool_call renders the tool-call part with the call title", () => {
    const html = render({
      ...base,
      content: [],
      id: "tool:tc1",
      status: "completed",
      title: "Read File",
      toolCallId: "tc1",
      type: "acp_tool_call",
    } as unknown as TMessage);
    expect(html).toContain("AI Assistant");
    expect(html).toContain("Read File");
  });

  test("acp_permission renders the permission options", () => {
    const html = render({
      ...base,
      id: "perm:tc2",
      options: [{ kind: "allow_once", name: "Allow once", optionId: "a1" }],
      request_id: "r1",
      toolCallId: "tc2",
      type: "acp_permission",
    } as unknown as TMessage);
    expect(html).toContain("Allow once");
  });

  test("acp_permission with a replayed error status renders expired, not tappable (TASK-109)", () => {
    const html = render({
      ...base,
      id: "perm:tc9",
      options: [{ kind: "allow_once", name: "Allow once", optionId: "a1" }],
      requestId: "r9",
      status: "error",
      toolCall: null,
      type: "acp_permission",
    } as unknown as TMessage);
    expect(html).toContain("Permission request expired");
    expect(html).toContain("disabled");
    // The live title must be gone: the card cannot read as awaiting.
    expect(html).not.toContain("Permission requested");
  });

  test("ask renders the question set", () => {
    const html = render({
      ...base,
      id: "ask:r2",
      questions: [{ options: [], question: "Which one?" }],
      requestId: "r2",
      type: "ask",
    } as unknown as TMessage);
    expect(html).toContain("Which one?");
  });

  test("drill_item renders the shared drill card and stays interactive", () => {
    const html = render({
      ...base,
      drillSessionId: "drill-1",
      id: "drill:req-3",
      item: {
        anchors: ["grammar:particle"],
        id: "item-3",
        itemType: "grammar-form",
        level: "N5",
        options: ["に", "で"],
        prompt: "Choose the particle.",
      },
      phase: "pending",
      requestId: "req-3",
      sessionId: "session-1",
      snapshot: {
        answered: 0,
        asked: 1,
        declaredCount: 5,
        remaining: 4,
      },
      type: "drill_item",
    } as TMessage);
    expect(html).toContain('data-slot="drill-card"');
    expect(html).toContain("Choose the particle.");
    expect(html).toContain('data-variant="ghost"');
  });

  test("paper renders the key-free paper card", () => {
    const html = render({
      ...base,
      examId: "exam-1",
      id: "paper:exam-1",
      label: "shortened-paper-banded",
      level: "N5",
      mode: "shortened",
      phase: "ready",
      sections: [
        {
          id: "vocabulary",
          label: "Vocabulary",
          state: "ready",
          total: 10,
          validated: 10,
        },
      ],
      totalSlots: 10,
      type: "paper",
      validatedSlots: 10,
    } as TMessage);
    expect(html).toContain('data-slot="paper-card"');
    expect(html).toContain("shortened paper");
    expect(html).toContain("10/10");
    expect(html).toContain('data-variant="ghost"');
  });

  test("read-only drill cards expose no answer buttons", () => {
    const html = renderToStaticMarkup(
      <ChatCardSwitch
        card={
          {
            ...base,
            drillSessionId: "drill-1",
            id: "drill:req-4",
            item: {
              anchors: [],
              id: "item-4",
              itemType: "grammar-form",
              level: "N5",
              options: ["に", "で"],
              prompt: "Choose the particle.",
            },
            phase: "pending",
            requestId: "req-4",
            sessionId: "session-1",
            snapshot: {
              answered: 0,
              asked: 1,
              declaredCount: 5,
              remaining: 4,
            },
            type: "drill_item",
          } as TMessage
        }
        isStreaming={false}
        readOnly
      />
    );
    expect(html).toContain('data-read-only="true"');
    expect(html).not.toContain("<button");
  });

  test("plan renders the checklist with status icons", () => {
    const html = render({
      ...base,
      entries: [
        { content: "step one", status: "completed" },
        { content: "step two", status: "in_progress" },
      ],
      id: "plan:p1",
      type: "plan",
    } as unknown as TMessage);
    expect(html).toContain("step one");
    expect(html).toContain("step two");
    expect(html).toContain("✓");
  });

  test("acp_terminal_output renders the terminal card", () => {
    const html = render({
      ...base,
      command: "ls",
      id: "term:t1",
      output: "file.txt",
      terminalId: "t1",
      type: "acp_terminal_output",
    } as unknown as TMessage);
    expect(html).toContain("AI Assistant");
  });

  test("error renders the destructive bubble", () => {
    const html = render({ ...base, id: "e1", text: "boom", type: "error" });
    expect(html).toContain("boom");
  });

  test("retry_notice renders bare muted lines per state (TASK-104 AC#2)", () => {
    const retrying = render({
      ...base,
      id: "retry:c1",
      reason: "rate limit",
      state: "retrying",
      type: "retry_notice",
    });
    expect(retrying).toContain("Retrying: rate limit");
    expect(retrying).toContain('data-retry-state="retrying"');
    // A comment line, not a bubble: no assistant/user envelope.
    expect(retrying).not.toContain("AI Assistant");
    expect(retrying).not.toContain("You");
    const recovered = render({
      ...base,
      id: "retry:c1",
      reason: "rate limit",
      state: "recovered",
      type: "retry_notice",
    });
    expect(recovered).toContain("Auto-recovered after rate limit");
    expect(recovered).toContain('data-retry-state="recovered"');
  });

  test("unknown card type renders nothing (defensive fall-through)", () => {
    const html = render({
      ...base,
      id: "x1",
      type: "mystery",
    } as unknown as TMessage);
    expect(html).toBe("");
  });
});

// TASK-90: the Card-based families must render in a stretched ghost
// bubble. A `w-full` Card inside a `w-fit` bubble collapses to 0 width
// because Card carries inline-size containment; the ghost full-width
// wrapper removes the fit-content dependency.
describe("stretched wrapper for Card-based families (TASK-90)", () => {
  test("drill_item is registered as a stretched Card family", () => {
    expect(STRETCHED_TYPES.has("drill_item")).toBe(true);
    expect(STRETCHED_TYPES.has("paper")).toBe(true);
  });

  const stretchedCards: [string, TMessage][] = [
    [
      "acp_tool_call",
      {
        ...base,
        content: [],
        id: "tool:tc1",
        status: "completed",
        title: "Read File",
        toolCallId: "tc1",
        type: "acp_tool_call",
      } as unknown as TMessage,
    ],
    [
      "acp_permission",
      {
        ...base,
        id: "perm:tc2",
        options: [{ kind: "allow_once", name: "Allow once", optionId: "a1" }],
        request_id: "r1",
        toolCallId: "tc2",
        type: "acp_permission",
      } as unknown as TMessage,
    ],
    [
      "ask",
      {
        ...base,
        id: "ask:r2",
        questions: [{ options: [], question: "Which one?" }],
        requestId: "r2",
        type: "ask",
      } as unknown as TMessage,
    ],
    [
      "drill_item",
      {
        ...base,
        drillSessionId: "drill-1",
        id: "drill:r3",
        item: {
          anchors: [],
          id: "item-3",
          itemType: "grammar-form",
          level: "N5",
          options: ["に", "で"],
          prompt: "Choose the particle.",
        },
        phase: "pending",
        requestId: "r3",
        sessionId: "session-1",
        snapshot: {
          answered: 0,
          asked: 1,
          declaredCount: 5,
          remaining: 4,
        },
        type: "drill_item",
      } as TMessage,
    ],
    [
      "acp_terminal_output",
      {
        ...base,
        command: "ls",
        id: "term:t1",
        output: "file.txt",
        terminalId: "t1",
        type: "acp_terminal_output",
      } as unknown as TMessage,
    ],
  ];

  for (const [type, card] of stretchedCards) {
    test(`${type} renders in a stretched ghost bubble`, () => {
      const html = render(card);
      expect(html).toContain('data-variant="ghost"');
      expect(html).toContain("w-full items-stretch");
      expect(html).not.toContain('data-variant="secondary"');
    });
  }

  test("text keeps the fit-content secondary bubble", () => {
    const html = render({
      ...base,
      content: "answer",
      id: "t1",
      type: "text",
    });
    expect(html).toContain('data-variant="secondary"');
    expect(html).not.toContain('data-variant="ghost"');
  });

  test("plan keeps the fit-content secondary bubble", () => {
    const html = render({
      ...base,
      entries: [{ content: "step one", status: "completed" }],
      id: "plan:p1",
      type: "plan",
    } as unknown as TMessage);
    expect(html).toContain('data-variant="secondary"');
    expect(html).not.toContain('data-variant="ghost"');
  });
});

describe("answeredTurnMsgIds (TASK-87 AC#2)", () => {
  test("collects only msg_ids that have a text card", () => {
    const cards = [
      { ...base, content: "think", id: "k1", msg_id: "m1", type: "thinking" },
      { ...base, content: "answer", id: "t1", msg_id: "m1", type: "text" },
      { ...base, content: "think", id: "k2", msg_id: "m2", type: "thinking" },
    ] as unknown as TMessage[];
    expect([...answeredTurnMsgIds(cards)]).toEqual(["m1"]);
  });
});
