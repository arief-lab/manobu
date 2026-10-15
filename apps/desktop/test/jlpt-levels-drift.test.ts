import { describe, expect, it } from "bun:test";
import { JlptLevelSchema } from "@manobu/api-contract";
import { JLPT_LEVELS } from "../src/lib/learner-level";

describe("JLPT level runtime arrays stay in sync", () => {
  it("the desktop runtime list equals the contract's", () => {
    // The type unions are order-independent, so "N1" | "N5" and "N5" | "N1" are
    // the same type and can never produce a type error. The RUNTIME arrays are
    // the thing that can silently drift: two declarations, both currently
    // correct, nothing asserting they stay equal. This is the VocabItem shape
    // that already bit us once.
    expect([...JLPT_LEVELS]).toEqual([...JlptLevelSchema.options]);
  });
});
