import { describe, expect, it } from "bun:test";

import { EXAM_MODE_LABELS, EXAM_MODES } from "@manobu/api-contract";
import { PAPER_MODES, type PaperModeLabel } from "@manobu/item-engine/paper";

/**
 * TASK-173.1 AC#9. The exam mode is declared in more than one package: the
 * wire enum (`api-contract` `EXAM_MODES`), the engine enum (`item-engine`
 * `PAPER_MODES`), and a private third copy in `db` `item-store.ts`. When a mode
 * is added to one and not the others, `parsePaperRequestMode` falls back to
 * `shortened` (`paper.ts:616`) while the contract advertises the new value, so a
 * request silently loses its mode rather than erroring. This test pins the two
 * public arrays to the same set so the drift fails here, not in a paper.
 */
const sorted = (values: readonly string[]): string[] => [...values].sort();

describe("exam mode parity", () => {
  it("keeps the contract mode enum and the engine mode enum identical", () => {
    expect(sorted(EXAM_MODES)).toEqual(sorted(PAPER_MODES));
  });

  it("carries the real-JLPT-mock mode in both lists", () => {
    expect(EXAM_MODES).toContain("real");
    expect(PAPER_MODES).toContain("real");
  });

  /**
   * `item-engine` models the label as a union TYPE and `api-contract` as a
   * runtime array. The object literal below makes the compiler reject the file
   * if the union changes shape, and the assertion ties the runtime array to it,
   * so a new `PaperModeLabel` cannot ship without its contract counterpart.
   * Kept alphabetical to mirror the sorted comparison.
   */
  it("keeps the engine label union and the contract label enum identical", () => {
    const engineLabels: Record<PaperModeLabel, true> = {
      "exam-conditions": true,
      "real-paper-banded": true,
      "real-paper-raw-only": true,
      "shortened-paper-banded": true,
      "shortened-paper-raw-only": true,
    };
    expect(sorted(Object.keys(engineLabels))).toEqual(sorted(EXAM_MODE_LABELS));
  });
});
