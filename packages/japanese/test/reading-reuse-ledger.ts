/**
 * The reuse ledger every authored-store gate test shares: one text (a passage,
 * an option, a key spelling) may be spent by exactly one row, because two rows
 * carrying the same text are the same 小問 printed twice across the stores.
 *
 * It is shared rather than copied because a fifth store gate that re-typed the
 * loop could quietly diverge on the message or the dedupe direction, and the
 * clash list is the only thing these tests assert. Each gate keeps its own
 * levels, its own loader and its own text extraction.
 */

import { expect } from "bun:test";

export const expectNoReusedTexts = <Row extends { id: string }>(
  rowSets: readonly (readonly Row[])[],
  textsOf: (row: Row) => readonly string[]
): void => {
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const rows of rowSets) {
    for (const row of rows) {
      for (const text of textsOf(row)) {
        const prior = seen.get(text);
        if (prior !== undefined) {
          clashes.push(`${row.id} reuses ${prior}`);
        }
        seen.set(text, row.id);
      }
    }
  }
  expect(clashes).toEqual([]);
};
