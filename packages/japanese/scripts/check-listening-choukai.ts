/**
 * `check:listening-choukai` — the deterministic CI gate for the 聴解統合理解
 * (integrated-understanding) listening store (TASK-173.9.4.2 AC#3). NO LLM,
 * no network. The screens live in `check-listening-shared.ts`; this file owns
 * the block id, the floor and the ONE rule that makes this block different:
 * the official form hears ONE 長めの話 ONCE and asks TWO 小問 of it
 * (`二つの質問`, N2L.pdf 問題5; ねらい n2.pdf p.1), so the reuse screen is
 * INVERTED — each script must appear exactly `GROUP_SIZE` times in the store
 * (one paper's worth of its 小問), never once and never more, while every
 * ANSWER stays unique. The floor is 4 小問 × 4 papers = 16 rows (paper.ts
 * PAPER_BLUEPRINTS N2 大問5), i.e. 8 dialogues of 2 小問. N1 prints the 大問
 * too (TASK-173.9.4.3) and a shipped file this table does not name fails
 * `store-shipped-but-not-checked`.
 */

import { runListeningGate } from "./check-listening-shared";

const MIN_ROWS: Readonly<Record<string, number>> = {
  // TASK-173.9.4.3: N1 prints 大問5 聴解統合理解 4 小問 like N2
  // (paper.ts PAPER_BLUEPRINTS), so the same 16-row floor.
  N1: 16,
  N2: 16,
};

/** The official grouping: one dialogue backs two 小問 (二つの質問). */
const GROUP_SIZE = 2;

if (import.meta.main) {
  runListeningGate("choukai-tougou-rikai", "choukai", MIN_ROWS, GROUP_SIZE);
}
