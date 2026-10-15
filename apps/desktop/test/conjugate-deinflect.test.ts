import { describe, expect, it } from "bun:test";

import { classify, toTeForm, verifyDetailed } from "@/lib/conjugate";

/*
 * TASK-23.29: verifyDetailed keeps the exact te-form contract (SCR-06) and
 * adds the deinflection hint layer — right verb, wrong form → hint; wrong
 * verb → wrong.
 */

describe("verifyDetailed", () => {
  const taberu = classify("食べる");
  const nomu = classify("飲む");

  it("exact te-form matches as before (SCR-06 unchanged)", () => {
    expect(taberu).not.toBeNull();
    if (taberu === null) {
      return;
    }
    expect(verifyDetailed(taberu, toTeForm(taberu))).toEqual({
      kind: "exact",
    });
  });

  it("deinflectable near-miss gets a hint, never a silent pass", () => {
    // 食べた deinflects to 食べる, whose te-form is 食べて → hint.
    if (taberu === null) {
      return;
    }
    const result = verifyDetailed(taberu, "食べた");
    expect(result.kind).toBe("deinflected");
    if (result.kind === "deinflected") {
      expect(result.hint).toContain("食べる");
    }
  });

  it("wrong verb stays wrong even when inflected", () => {
    // 飲んだ deinflects to 飲む, whose te-form 飲んで ≠ 食べて.
    if (taberu === null) {
      return;
    }
    expect(verifyDetailed(taberu, "飲んだ").kind).toBe("wrong");
    expect(nomu).not.toBeNull();
  });
  it("dictionary form input is simply wrong (no deinflection applies)", () => {
    // 食べる doesn't end in any inflection suffix — deinflect() returns
    // nothing, so the answer grades wrong, not hinted.
    expect(verifyDetailed(taberu, "食べる").kind).toBe("wrong");
  });
  it("null verb never matches", () => {
    expect(verifyDetailed(null, "食べて").kind).toBe("wrong");
  });
});
