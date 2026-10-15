import { describe, expect, it } from "bun:test";

import { file } from "./helpers/source-contract";

/**
 * GSM event-scope guards (TASK-68, spec §Measurement).
 * lesson_start / lesson_complete are LESSON-scoped — the same source-
 * contract pattern as tts-surfaces.test.ts (assert the wiring exists in
 * source; runtime is browser-verified).
 */

describe("GSM lesson_start scope (TASK-68)", () => {
  it("DrillLab logs lesson_start once per set, not per kana", () => {
    const src = file("features/drill/drill-lab.tsx");
    // The old bug: effect keyed on current.char → one event per advance
    // (46 per set), inflating computeMetrics().lessonCompletion's
    // denominator (packages/ui/src/lib/gsm.ts).
    expect(src).not.toContain('log("lesson_start", { char: current.char })');
    expect(src).toContain('log("lesson_start", { set: initial.chars.length })');
    expect(src).toContain("}, [initial.chars.length]);");
  });

  it("gsm computeMetrics divides lesson_complete by lesson_start — the denominator must stay lesson-scoped", () => {
    const src = file("../../../packages/ui/src/lib/gsm.ts");
    expect(src).toContain("completes.length / lessons.length");
  });
});
