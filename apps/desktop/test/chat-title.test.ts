/*
 * The one unnamed-chat label (TASK-163).
 *
 * The header used to say "New Chat" while the history row and the exam
 * workspace said "Untitled chat" for the same conversation. `chatTitle` is
 * now the single source, so this test pins the label and the two states that
 * share it.
 */
import { describe, expect, it } from "bun:test";
import { chatTitle } from "@/lib/chat-title";

describe("unnamed chat label", () => {
  it("uses the deck label for a conversation with no title", () => {
    expect(chatTitle({ title: null })).toBe("Untitled chat");
    // a chat with nothing persisted yet takes the name its history row will
    // show once it saves
    expect(chatTitle(undefined)).toBe("Untitled chat");
  });

  it("shows the stored title when there is one", () => {
    expect(chatTitle({ title: "Weekend plans" })).toBe("Weekend plans");
  });
});
