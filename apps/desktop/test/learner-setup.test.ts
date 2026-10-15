import { describe, expect, it } from "bun:test";

import {
  completeSetup,
  getGoal,
  getSetupDone,
  isGoalId,
  resetSetup,
  subscribeLearnerSetup,
} from "@/lib/learner-setup";

describe("learner-setup store", () => {
  it("rejects unknown goal ids", () => {
    expect(isGoalId("travel")).toBe(true);
    expect(isGoalId("japanese")).toBe(false);
  });

  it("completeSetup writes goal + gate and notifies subscribers", () => {
    resetSetup();
    let notified = 0;
    const unsubscribe = subscribeLearnerSetup(() => {
      notified += 1;
    });
    completeSetup("jlpt");
    expect(getGoal()).toBe("jlpt");
    expect(getSetupDone()).toBe(true);
    expect(notified).toBe(1);
    unsubscribe();
  });

  it("resetSetup clears both and is the dev escape hatch", () => {
    completeSetup("anime");
    resetSetup();
    expect(getGoal()).toBeNull();
    expect(getSetupDone()).toBe(false);
  });

  it("survives repeated subscribe/unsubscribe", () => {
    const unsubscribe = subscribeLearnerSetup(() => undefined);
    unsubscribe();
    unsubscribe(); // idempotent delete
    completeSetup("travel");
    expect(getSetupDone()).toBe(true);
    resetSetup();
  });
});
