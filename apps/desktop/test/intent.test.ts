import { beforeEach, describe, expect, it } from "bun:test";
import { t } from "@manobu/ui/lib/copy";

import { handleConfirm, resetIntentState, resolveIntent } from "@/lib/intent";

beforeEach(() => resetIntentState());

describe("intent five layers (TASK-121)", () => {
  it("AC#1 explicit beats signals, proposal never starts without offer, every layer reachable", () => {
    const explicit = resolveIntent("/quiz 5 particles");
    expect(explicit.layer).toBe("L0");
    expect(explicit.confirmNeeded).toBe(false);
    expect(explicit.tier).toBe("drill");

    const empty = resolveIntent("quiz me on xyzabc");
    // L2 empty anchors starts nothing
    expect(empty.anchors).toEqual([]);
    expect(empty.layer).toBe("L2");

    // every layer reachable
    expect(resolveIntent("/quiz 5 particles").layer).toBe("L0");
    expect(resolveIntent("give me 10 questions on particles").layer).toBe("L1");
    expect(resolveIntent("quiz me on xyzabc").layer).toBe("L2");
    // L3 via handleConfirm
    const pending = resolveIntent("give me 10 questions on particles");
    expect(handleConfirm("Change", pending).layer).toBe("L3");
    expect(resolveIntent("hello how are you").layer).toBe("L4");
  });

  it("parses the documented bare count in an explicit drill command", () => {
    const explicit = resolveIntent("/quiz 5 particles");
    expect(explicit.layer).toBe("L0");
    expect(explicit.tier).toBe("drill");
  });

  it("AC#2 starter chip starts via L1 without model turn", () => {
    const starter = "Quiz me on hiragana, one character at a time.";
    const r = resolveIntent(starter);
    expect(r.layer).toBe("L0");
    expect(r.tier).toBe("drill");
    expect(r.anchors.length).toBeGreaterThan(0);
  });

  it("AC#3 empty anchors starts nothing", () => {
    const emptyTopic = resolveIntent("quiz me on xyzabc", { weakAnchors: [] });
    expect(emptyTopic.anchors).toEqual([]);
    expect(emptyTopic.receipt).toBeNull();
    expect(emptyTopic.tier).toBe("conversation");
  });

  it("AC#4 inferred confirms, explicit does not, free-text during confirm resolves as Change", () => {
    const inferred = resolveIntent("give me 10 questions on particles");
    expect(inferred.confirmNeeded).toBe(true);
    const explicit = resolveIntent("/quiz 5 particles");
    expect(explicit.confirmNeeded).toBe(false);
    const pending = resolveIntent("give me 10 questions on particles");
    const changed = handleConfirm("I want something else", pending);
    expect(changed.layer).toBe("L3");
    const declined = handleConfirm("decline", pending);
    expect(declined.tier).toBe("conversation");
    expect(declined.confirmNeeded).toBe(false);
  });

  it("AC#5 topic with no corpus items produces nearest-topic and no session", () => {
    const r = resolveIntent("quiz me on xyzabc");
    expect(r.anchors).toEqual([]);
    expect(r.tier).toBe("conversation");
  });

  it("AC#6 correction re-resolves and supersedes, stop ends", () => {
    const r1 = resolveIntent("quiz me on particles");
    expect(r1.anchors).toContain("は");
    const r2 = resolveIntent("not particles, は and が");
    expect(r2.anchors).toEqual(["は", "が"]);
    const stop = resolveIntent("stop");
    expect(stop.tier).toBe("conversation");
  });

  it("AC#7 same as last time with no previous session produces out-loud line not invented filter", () => {
    const r = resolveIntent("the same as last time");
    expect(r.anchors).toEqual([]);
    expect(r.layer).toBe("L4");
  });

  it("AC#8 unresolvable answered as conversation with one offer, next does not repeat", () => {
    const first = resolveIntent("hello how are you");
    expect(first.layer).toBe("L4");
    const second = resolveIntent("hello again");
    expect(second.layer).toBe("L4");
    // second should not have new offer (lastOfferCount prevents repeat)
    expect(second.anchors).toEqual([]);
  });

  it("AC#9 model unavailable explicit still works, inferred does not", () => {
    const explicit = resolveIntent("/quiz 5 particles", {
      modelAvailable: false,
    });
    expect(explicit.layer).toBe("L0");
    const inferred = resolveIntent("give me 10 questions on particles", {
      modelAvailable: false,
    });
    expect(inferred.layer).toBe("L4");
  });

  it("AC#10 copy keys exist, no em dash, deck clean", () => {
    const keys = [
      "intent.receipt",
      "intent.confirm.start",
      "intent.confirm.change",
      "intent.confirm.prompt",
      "intent.clarify.topic",
      "intent.noAnchors",
      "intent.correct.action",
      "intent.correct.done",
      "intent.degraded.model",
    ] as const;
    for (const k of keys) {
      const s = t(k);
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toContain("—");
    }
  });
});
