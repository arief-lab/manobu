/**
 * `check:listening-sokuji` — the deterministic CI gate for the 即時応答
 * (instant-response) listening stores (TASK-173.8.1 AC#4). NO LLM, no
 * network. The screens live in `check-listening-shared.ts`; this file owns
 * only the block id and the floor: the section prints 6 小問 at N5 and 8 at
 * N4 (`packages/item-engine/src/paper.ts` PAPER_BLUEPRINTS), so four papers
 * need 24 at N5 and 32 at N4. The N4 line joins `MIN_ROWS` when the N4 store
 * ships; an unnamed shipped file fails `store-shipped-but-not-checked`.
 */

import { runListeningGate } from "./check-listening-shared";

const MIN_ROWS: Readonly<Record<string, number>> = {
  // TASK-173.9.4.3: N1 prints 14 即時応答 小問, the deepest single 聴解 store
  // in the app (paper.ts PAPER_BLUEPRINTS).
  // TASK-173.9.4.2: N2 prints 12 即時応答 小問, the biggest single listening
  // store in the app (paper.ts PAPER_BLUEPRINTS).
  N1: 56,
  N2: 48,
  N3: 36,
  N4: 32,
  N5: 24,
};

if (import.meta.main) {
  runListeningGate("sokuji-outou", "sokuji", MIN_ROWS);
}
