/**
 * `check:listening-gaiyou` — the deterministic CI gate for the 概要理解
 * (gist-understanding) listening store (TASK-173.9.4.1 AC#3). NO LLM, no
 * network. The screens live in `check-listening-shared.ts`; this file owns
 * only the block id and the floor: the section prints 3 小問 at N3
 * (`packages/item-engine/src/paper.ts` PAPER_BLUEPRINTS), so four papers'
 * worth of UNSEEN material is 12. N2 and N1 print the 大問 too (5 and 6 小問)
 * but their stores are this task's successors' (TASK-173.9.4.2/.4.3), and a
 * shipped file this table does not name fails
 * `store-shipped-but-not-checked`, so depth cannot land unjudged.
 *
 * What re-proves the shape AC#2 decided: the `monologue` scenario band is this
 * block's own (`SCENARIO_BANDS.monologue`, N3 only today), so a 概要理解 row
 * must be a single coherent TALK at that length — neither a short ポイント理解
 * exchange nor a stimulus-only judgement with no options. The four printed
 * options, the frozen key slot and the prompt-leak screens are the same ones
 * every 聴解 block pays.
 */

import { runListeningGate } from "./check-listening-shared";

const MIN_ROWS: Readonly<Record<string, number>> = {
  // TASK-173.9.4.3: N1 prints 6 概要理解 小問 (paper.ts PAPER_BLUEPRINTS).
  // TASK-173.9.4.2: N2 prints 5 概要理解 小問 (paper.ts PAPER_BLUEPRINTS).
  N1: 24,
  N2: 20,
  N3: 12,
};

if (import.meta.main) {
  runListeningGate("gaiyou-rikai", "gaiyou", MIN_ROWS);
}
