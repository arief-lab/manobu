/**
 * `check:listening-point` — the deterministic CI gate for the ポイント理解
 * (key-point-understanding) listening stores (TASK-173.8.1 AC#4). NO LLM, no
 * network. The screens live in `check-listening-shared.ts`; this file owns
 * only the block id and the floor: the section prints 6 小問 at N5 and 7 at
 * N4 (`packages/item-engine/src/paper.ts` PAPER_BLUEPRINTS), so four papers
 * need 24 at N5 and 28 at N4. The N4 line joins `MIN_ROWS` when the N4 store
 * ships; an unnamed shipped file fails `store-shipped-but-not-checked`.
 */

import { runListeningGate } from "./check-listening-shared";

const MIN_ROWS: Readonly<Record<string, number>> = {
  // TASK-173.9.4.3: N1 prints 7 ポイント理解 小問 (paper.ts PAPER_BLUEPRINTS).
  // TASK-173.9.4.2: N2 prints 6 ポイント理解 小問 (paper.ts PAPER_BLUEPRINTS).
  N1: 28,
  N2: 24,
  N3: 24,
  N4: 28,
  N5: 24,
};

if (import.meta.main) {
  runListeningGate("point-rikai", "point", MIN_ROWS);
}
