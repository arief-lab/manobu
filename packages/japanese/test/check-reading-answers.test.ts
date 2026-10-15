import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  auditAnswers,
  checkAnswers,
  READING_STORES,
} from "../scripts/check-reading-answers";

const row = (answerIndex: number) => ({ answerIndex });

describe("auditAnswers", () => {
  it("scores the position distribution and mode share", () => {
    const audit = auditAnswers("x", [row(0), row(0), row(1), row(3)]);
    expect(audit.rows).toBe(4);
    expect(audit.distribution).toEqual({ 0: 2, 1: 1, 3: 1 });
    expect(audit.modeShare).toBe(0.5);
    expect(audit.constant).toBe(false);
  });

  it("flags a store whose key never moves", () => {
    const audit = auditAnswers("x", [row(2), row(2), row(2)]);
    expect(audit.constant).toBe(true);
    expect(audit.modeShare).toBe(1);
  });

  it("does not call a single-row or empty store constant", () => {
    expect(auditAnswers("x", [row(1)]).constant).toBe(false);
    expect(auditAnswers("x", []).constant).toBe(false);
  });
});

describe("checkAnswers", () => {
  it("passes a merely skewed store", () => {
    // 4 of 6 at index 0 is noise at this size, not a defect.
    const report = checkAnswers("x", [
      row(0),
      row(0),
      row(0),
      row(0),
      row(1),
      row(2),
    ]);
    expect(report.issues).toEqual([]);
  });

  it("rejects a constant key position", () => {
    const report = checkAnswers("x", [row(3), row(3)]);
    expect(report.issues).toEqual(["constant-key-position:3(2 rows)"]);
  });
});

describe("the shipped reading stores", () => {
  it("has no store whose correct option is always in the same position", () => {
    const dir = join(import.meta.dir, "..", "data", "reading");
    for (const store of READING_STORES) {
      const entries = JSON.parse(readFileSync(join(dir, store), "utf8")) as {
        answerIndex: number;
      }[];
      const report = checkAnswers(store, entries);
      expect(report.issues).toEqual([]);
    }
  });
});
