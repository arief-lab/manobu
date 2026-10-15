/**
 * Invariants over the /jlpt-mock route seed (TASK-158).
 *
 * The seed is hand-typed data with no server behind it, so nothing but this
 * file notices a broken question. It found one: q2 offered "は" under both `a`
 * and `b` while keying the answer to `b`, so a learner who picked the other
 * copy of the correct string was scored wrong and no UI ever showed why.
 *
 * These are property checks over the data the wizard actually renders, not
 * source-text assertions (TASK-134).
 */
import { describe, expect, it } from "bun:test";

import { SEED } from "@/routes/jlpt-mock";

describe("/jlpt-mock seed", () => {
  it("has a unique id per question", () => {
    const ids = SEED.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keys every answer to an option the question offers", () => {
    const broken = SEED.filter(
      (question) => !question.choiceIds.includes(question.correctId)
    ).map((question) => question.id);
    expect(broken).toEqual([]);
  });

  it("renders a string for every option it offers", () => {
    const missing = SEED.flatMap((question) =>
      question.choiceIds
        .filter((id) => !question.choices[id])
        .map((id) => `${question.id}:${id}`)
    );
    expect(missing).toEqual([]);
  });

  it("never offers the same answer text twice", () => {
    const duplicated = SEED.filter((question) => {
      const texts = question.choiceIds.map((id) => question.choices[id]);
      return new Set(texts).size !== texts.length;
    }).map((question) => question.id);
    expect(duplicated).toEqual([]);
  });

  it("keys the answer to the only option carrying that text", () => {
    // The duplicate case above already fails this if it regresses, but this
    // pins the stronger property: the correct string appears exactly once.
    const ambiguous = SEED.filter((question) => {
      const wanted = question.choices[question.correctId];
      return (
        question.choiceIds.filter((id) => question.choices[id] === wanted)
          .length !== 1
      );
    }).map((question) => question.id);
    expect(ambiguous).toEqual([]);
  });
});
