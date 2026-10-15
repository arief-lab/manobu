import { beforeEach, describe, expect, it } from "bun:test";

import { routeComposerSubmit } from "@/lib/composer-routing";
import { resetIntentState, resolveIntent } from "@/lib/intent";

const CONVERSATION = "conv-t147";

/** The route, fed by the REAL resolver: pinning a hand-built `IntentResult`
 * would only prove the seam agrees with itself. */
const routeFor = (text: string, pending: string | null = null) =>
  routeComposerSubmit({
    conversationId: CONVERSATION,
    intent: resolveIntent(text),
    pending:
      pending === null
        ? null
        : { intent: resolveIntent(pending), text: pending },
    text,
  });

beforeEach(() => resetIntentState());

describe("composer submit routing (TASK-147)", () => {
  it("starts a paper for the explicit /exam command, model-free", () => {
    const route = routeFor("/exam N5");
    expect(route.kind).toBe("paper");
    if (route.kind !== "paper") {
      return;
    }
    expect(route.conversationId).toBe(CONVERSATION);
    expect(route.level).toBe("N5");
    expect(route.focus.length).toBeGreaterThan(0);
  });

  it("sends an inferred exam wording to the agent instead of guessing a paper", () => {
    const route = routeFor("give me a mock exam");
    expect(route.kind).not.toBe("paper");
  });

  it("keeps the paper request shape limited to what the service may default", () => {
    const route = routeFor("/exam");
    if (route.kind !== "paper") {
      throw new Error(`/exam routed to ${route.kind}`);
    }
    expect(Object.keys(route).sort()).toEqual([
      "conversationId",
      "focus",
      "kind",
      "level",
    ]);
  });

  it("falls back to N5 when the level is not one of the five the wire accepts", () => {
    const route = routeComposerSubmit({
      conversationId: CONVERSATION,
      intent: {
        anchors: ["は"],
        confirmNeeded: false,
        layer: "L0",
        receipt: null,
        tier: "exam",
      },
      pending: null,
      text: "/exam N7",
    });
    if (route.kind !== "paper") {
      throw new Error(`/exam N7 routed to ${route.kind}`);
    }
    expect(route.level).toBe("N5");
  });

  it("parks an inferred drill as an offer and never as a paper", () => {
    const route = routeFor("give me 10 questions on particles");
    expect(route.kind).toBe("offer");
    if (route.kind !== "offer") {
      return;
    }
    expect(route.intent.confirmNeeded).toBe(true);
    expect(typeof route.intent.receipt).toBe("string");
  });

  it("accepting a parked offer starts the drill it offered", () => {
    const pending = routeFor("give me 10 questions on particles");
    if (pending.kind !== "offer") {
      throw new Error("the inferred drill did not park");
    }
    const route = routeFor("start", pending.text);
    expect(route.kind).toBe("pending");
    if (route.kind !== "pending") {
      return;
    }
    expect(route.startDrill).toBe(true);
    expect(route.text).toBe(pending.text);
  });

  it("a change of mind during confirm prompts instead of starting", () => {
    const route = routeFor("change", "give me 10 questions on particles");
    if (route.kind !== "pending") {
      throw new Error(`the reply routed to ${route.kind}`);
    }
    expect(route.startDrill).toBe(false);
    expect(route.receipt).not.toBeNull();
  });

  it("answering a parked offer outranks a new /exam command", () => {
    const route = routeFor("/exam N5", "give me 10 questions on particles");
    expect(route.kind).toBe("pending");
  });

  it("routes explicit drills to the drill start and plain chat to the agent", () => {
    expect(routeFor("/quiz 5 particles").kind).toBe("drill");
    expect(routeFor("hello how are you").kind).toBe("chat");
  });
});
