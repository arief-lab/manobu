/**
 * `check:listening-hatsuwa` — the deterministic CI gate for the 場面対応
 * (utterance/expression) listening stores (TASK-173.8.1 AC#4). NO LLM, no
 * network. The screens live in `check-listening-shared.ts`; this file owns
 * only the block id and the floor: the section prints 5 小問 at N5 and 5 at
 * N4 (`packages/item-engine/src/paper.ts` PAPER_BLUEPRINTS), so four papers
 * need 20 at both levels. The N4 line joins `MIN_ROWS` when the N4 store
 * ships; an unnamed shipped file fails `store-shipped-but-not-checked`.
 */

import { runListeningGate } from "./check-listening-shared";

const MIN_ROWS: Readonly<Record<string, number>> = {
  N3: 16,
  N4: 20,
  N5: 20,
};

if (import.meta.main) {
  runListeningGate("hatsuwa-hyougen", "hatsuwa", MIN_ROWS);
}
