/**
 * TASK-79.2 (chatbot-template parity): the composer's Enter handling is
 * IME-safe. The contract pinned here is the PURE decision inside
 * `onPromptKeyDown`: Enter without Shift and without an active
 * composition submits; Shift+Enter, or Enter while a Japanese IME is
 * composing a kana conversion, must not. Without the isComposing guard
 * the learner's conversion-confirm keypress sends a half-built sentence.
 */
import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SyntheticEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type ChatSessionActions,
  ChatSessionProvider,
  useChatSessionActions,
} from "./provider";

const testQueryClient = new QueryClient({
  defaultOptions: {
    mutations: { retry: 0 },
    queries: { retry: 0, staleTime: 0 },
  },
});

/** Render the Provider once and capture its actions slice. */
function captureActions(): ChatSessionActions {
  let captured: ChatSessionActions | null = null;
  function Probe() {
    captured = useChatSessionActions();
    return null;
  }
  renderToStaticMarkup(
    <QueryClientProvider client={testQueryClient}>
      <ChatSessionProvider>
        <Probe />
      </ChatSessionProvider>
    </QueryClientProvider>
  );
  if (!captured) {
    throw new Error("probe did not capture actions");
  }
  return captured;
}

/**
 * Minimal fake of the React keyboard event the handler reads: key,
 * shiftKey, nativeEvent.isComposing, preventDefault, and a currentTarget
 * whose form.requestSubmit we watch.
 */
function keyEvent(fields: {
  isComposing: boolean;
  key: string;
  shiftKey: boolean;
}) {
  let prevented = false;
  let submitted = false;
  const event = {
    currentTarget: {
      form: {
        requestSubmit: () => {
          submitted = true;
        },
      },
    },
    key: fields.key,
    nativeEvent: { isComposing: fields.isComposing },
    preventDefault: () => {
      prevented = true;
    },
    shiftKey: fields.shiftKey,
  };
  return {
    event: event as unknown as Parameters<
      ChatSessionActions["onPromptKeyDown"]
    >[0] &
      SyntheticEvent,
    wasPrevented: () => prevented,
    wasSubmitted: () => submitted,
  };
}

describe("onPromptKeyDown IME-safe Enter (TASK-79.2)", () => {
  const actions = captureActions();

  test("plain Enter submits", () => {
    const e = keyEvent({ isComposing: false, key: "Enter", shiftKey: false });
    actions.onPromptKeyDown(e.event);
    expect(e.wasPrevented()).toBe(true);
    expect(e.wasSubmitted()).toBe(true);
  });

  test("Shift+Enter inserts a newline (no submit)", () => {
    const e = keyEvent({ isComposing: false, key: "Enter", shiftKey: true });
    actions.onPromptKeyDown(e.event);
    expect(e.wasPrevented()).toBe(false);
    expect(e.wasSubmitted()).toBe(false);
  });

  test("Enter during IME composition does NOT submit", () => {
    const e = keyEvent({ isComposing: true, key: "Enter", shiftKey: false });
    actions.onPromptKeyDown(e.event);
    expect(e.wasPrevented()).toBe(false);
    expect(e.wasSubmitted()).toBe(false);
  });

  test("other keys never submit", () => {
    const e = keyEvent({ isComposing: false, key: "a", shiftKey: false });
    actions.onPromptKeyDown(e.event);
    expect(e.wasSubmitted()).toBe(false);
  });
});
