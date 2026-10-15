/**
 * `check:listening-kadai` — the deterministic CI gate for the 課題理解
 * (task-understanding) listening stores (TASK-173.8.1 AC#4). NO LLM, no
 * network. The screens live in `check-listening-shared.ts` and are shared by
 * all four 聴解 blocks; this file owns only the block id and the floor:
 * one N5 聴解 section prints 7 課題理解 小問 and one N4 prints 8
 * (`packages/item-engine/src/paper.ts` PAPER_BLUEPRINTS), so four papers'
 * worth of UNSEEN material is 28 at N5 and 32 at N4. The N4 line joins
 * `MIN_ROWS` in the commit that ships the N4 store; a shipped file the table
 * does not name fails `store-shipped-but-not-checked`, so the depth cannot
 * land unjudged.
 */

import { runListeningGate } from "./check-listening-shared";

const MIN_ROWS: Readonly<Record<string, number>> = {
  // TASK-173.9.4.3: N1 prints 6 課題理解 小問 (paper.ts PAPER_BLUEPRINTS).
  // TASK-173.9.4.2: N2 prints 5 課題理解 小問 (paper.ts PAPER_BLUEPRINTS).
  N1: 24,
  N2: 20,
  N3: 24,
  N4: 32,
  N5: 28,
};

if (import.meta.main) {
  runListeningGate("kadai-rikai", "kadai", MIN_ROWS);
}
