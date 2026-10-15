import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { __test__ } from "./chat-column";

const source = readFileSync(join(import.meta.dir, "chat-column.tsx"), "utf8");
const routeSource = readFileSync(
  join(import.meta.dir, "../../routes/ai.tsx"),
  "utf8"
);

describe("ChatColumn", () => {
  it("keeps the session provider owned by the route", () => {
    expect(source).not.toContain("ChatSessionProvider");
    expect(routeSource.match(/<ChatSessionProvider\b/g)).toHaveLength(1);
  });

  it("owns transcript history and forwards paper navigation", () => {
    expect(source).toContain(
      "useOlderHistory(meta.conversationId, storedRows)"
    );
    expect(source).toContain("onOpenPaper={onOpenPaper}");
  });

  it("preserves prompt and slash keyboard delegation", () => {
    expect(source).toContain("actions.onPromptKeyDown(event)");
    expect(source).toContain("slashMenuReducer");
  });

  it("blocks send without hiding stop", () => {
    expect(
      __test__.composerActionState({
        blockedMessage: "The paper is running.",
        input: "draft",
        isSending: false,
      })
    ).toEqual({ disabled: true, kind: "send" });
    expect(
      __test__.composerActionState({
        blockedMessage: "The paper is running.",
        input: "draft",
        isSending: true,
      })
    ).toEqual({ kind: "stop" });
  });
});
