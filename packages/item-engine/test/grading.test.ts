import { describe, expect, it } from "bun:test";

import {
  type FsrsAttempt,
  type FsrsGradeName,
  mapAttemptToFsrsGrade,
} from "@manobu/item-engine/grading";

interface GradeCase {
  attempt: FsrsAttempt;
  expected: FsrsGradeName | null;
}

const cases: readonly GradeCase[] = [
  {
    attempt: { correct: false, fsrsLinked: true },
    expected: "again",
  },
  {
    attempt: { correct: true, fsrsLinked: true, responseQuality: "slow" },
    expected: "hard",
  },
  {
    attempt: { correct: true, fsrsLinked: true, responseQuality: "standard" },
    expected: "good",
  },
  {
    attempt: { correct: true, fsrsLinked: true, responseQuality: "fast" },
    expected: "easy",
  },
  {
    attempt: { correct: false, fsrsLinked: false },
    expected: null,
  },
];

describe("mapAttemptToFsrsGrade", () => {
  it("maps the complete item-attempt evidence table once", () => {
    for (const { attempt, expected } of cases) {
      expect(mapAttemptToFsrsGrade(attempt)).toBe(expected);
    }
  });
});
