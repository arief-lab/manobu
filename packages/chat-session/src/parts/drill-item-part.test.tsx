import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { TMessageDrillItem } from "../chat-engine";
import { DrillItemPart } from "./drill-item-part";

const part = (over: Partial<TMessageDrillItem> = {}): TMessageDrillItem => ({
  conversation_id: "conversation-1",
  drillSessionId: "drill-1",
  id: "drill:request-1",
  item: {
    anchors: ["grammar:particle"],
    id: "item-1",
    itemType: "grammar-form",
    level: "N5",
    options: ["に", "で"],
    prompt: "Choose the particle.",
  },
  msg_id: "message-1",
  phase: "pending",
  requestId: "request-1",
  sessionId: "session-1",
  snapshot: {
    answered: 0,
    asked: 1,
    declaredCount: 5,
    remaining: 4,
  },
  type: "drill_item",
  ...over,
});

describe("DrillItemPart", () => {
  it("renders a live pending card through the structural adapter", () => {
    const html = renderToStaticMarkup(<DrillItemPart part={part()} />);
    expect(html).toContain('data-slot="drill-card"');
    expect(html).toContain("Choose the particle.");
    expect(html).toContain('data-state="pending"');
  });

  it("renders replay and read-only state without transport controls", () => {
    const html = renderToStaticMarkup(
      <DrillItemPart
        part={part({
          phase: "answered",
          resolution: {
            chosenIndex: 0,
            correct: true,
            correctIndex: 0,
            correctOption: "に",
            itemId: "item-1",
          },
          status: "finish",
        })}
        readOnly
      />
    );
    expect(html).toContain('data-state="answered"');
    expect(html).toContain("Correct.");
    expect(html).not.toContain("<button");
  });
});
