import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DrillCard,
  type DrillCardData,
  type DrillCardResolution,
} from "./drill-card";

const snapshot = {
  answered: 1,
  asked: 2,
  correct: 1,
  declaredCount: 10,
  nextReview: "tomorrow",
  pendingRefill: false,
  readyCount: 3,
  remaining: 8,
  skipped: 0,
  unanswered: 8,
};

const item = {
  anchors: ["grammar:particle"],
  id: "item-1",
  itemType: "grammar-form",
  level: "N5",
  options: ["に", "で", "を", "が"],
  passage: "学校へ行きます。",
  prompt: "Choose the particle.",
};

const resolution: DrillCardResolution = {
  chosenIndex: 1,
  correct: false,
  correctIndex: 0,
  correctOption: "に",
  explanation: "に marks the destination.",
  itemId: item.id,
};

const onAnswer = () => Promise.resolve(undefined);

const card = (over: Partial<DrillCardData> = {}): DrillCardData => ({
  drillSessionId: "drill-1",
  item,
  phase: "pending",
  requestId: "request-1",
  sessionId: "acp-1",
  snapshot,
  ...over,
});

describe("DrillCard", () => {
  it("renders a pending item with native option controls", () => {
    const html = renderToStaticMarkup(
      <DrillCard card={card()} onAnswer={onAnswer} />
    );
    expect(html).toContain('data-slot="drill-card"');
    expect(html).toContain('data-state="pending"');
    expect(html).toContain("Choose the particle.");
    expect(html).toContain("学校へ行きます。");
    expect(html).toContain('data-testid="drill-option-0"');
    expect(html).toContain("に");
  });

  it("does not render a resolution supplied on a pending card", () => {
    const html = renderToStaticMarkup(
      <DrillCard card={card({ resolution })} onAnswer={onAnswer} />
    );
    expect(html).toContain('data-state="pending"');
    expect(html).not.toContain("Not quite. The answer is");
  });

  it("renders replay and read-only pending items without option buttons", () => {
    const html = renderToStaticMarkup(
      <DrillCard card={card({ phase: "pending" })} readOnly />
    );
    expect(html).toContain('data-read-only="true"');
    expect(html).toContain("Choose the particle.");
    expect(html).not.toContain("<button");
  });

  it("renders the picked and correct options after an answer", () => {
    const html = renderToStaticMarkup(
      <DrillCard card={card({ phase: "answered", resolution })} />
    );
    expect(html).toContain('data-state="answered"');
    expect(html).toContain("Not quite. The answer is に.");
    expect(html).toContain('data-option-state="correct"');
    expect(html).toContain('data-option-state="wrong"');
    expect(html).toContain("Your pick");
    expect(html).not.toContain("<button");
  });

  it("offers no explanation for an item that has none", () => {
    // TASK-137: a replayed exam item has no explanation, and the panel opened
    // with a bare "Generated from {anchor}" heading over nothing.
    const html = renderToStaticMarkup(
      <DrillCard
        card={card({
          phase: "answered",
          resolution: { ...resolution, explanation: null },
        })}
      />
    );
    expect(html).toContain("Not quite. The answer is に.");
    expect(html).not.toContain("Why?");
    expect(html).not.toContain("Generated from");
  });

  it("renders a skipped answer without grading feedback", () => {
    const html = renderToStaticMarkup(
      <DrillCard
        card={card({
          phase: "answered",
          resolution: { ...resolution, skipped: true },
        })}
      />
    );
    expect(html).toContain('data-state="answered"');
    expect(html).toContain("Skipped.");
    expect(html).not.toContain("Not quite.");
  });

  it("renders the suspended, summary, and unavailable states honestly", () => {
    const suspended = renderToStaticMarkup(
      <DrillCard
        card={card({ item: null, phase: "suspended", snapshot })}
        readOnly
      />
    );
    expect(suspended).toContain('data-state="suspended"');
    expect(suspended).toContain("1/10 paused. Resume or end?");

    const summary = renderToStaticMarkup(
      <DrillCard
        card={card({ item: null, phase: "summary", snapshot })}
        readOnly
      />
    );
    expect(summary).toContain('data-state="summary"');
    expect(summary).toContain("1/2");
    expect(summary).toContain("Next review: tomorrow");
    expect(summary).toContain("Next: return to chat");

    const unavailable = renderToStaticMarkup(
      <DrillCard
        card={card({ item: null, phase: "unavailable", snapshot })}
        readOnly
      />
    );
    expect(unavailable).toContain('data-state="unavailable"');
    expect(unavailable).toContain("No item right now.");
  });
});
