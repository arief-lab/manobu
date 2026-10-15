import { describe, expect, it } from "bun:test";
import { ExamLevelSchema, JlptLevelSchema } from "@manobu/api-contract";
import { PAPER_LEVELS } from "@manobu/item-engine/paper";

// `api-contract` and `lib-item-engine` are both boundary leaves (.fallowrc.jsonc
// gives each `"allow": []`), so neither can import the other's level list and a
// single shared declaration is not available. The test zone may import every
// layer, so equality is asserted here instead of typed. This matters because a
// drift is invisible to the compiler: both lists infer the same string union, and
// it surfaces as exam-service.ts `toLevel` throwing INVALID_REQUEST for a level
// the zod boundary already accepted.
describe("the exam level vocabulary has one source", () => {
  it("the paper level aliases the wire level schema, not a second enum", () => {
    expect(ExamLevelSchema).toBe(JlptLevelSchema);
  });

  it("item-engine's paper levels match the contract, in the contract's order", () => {
    expect([...PAPER_LEVELS]).toEqual([...ExamLevelSchema.options]);
  });
});
