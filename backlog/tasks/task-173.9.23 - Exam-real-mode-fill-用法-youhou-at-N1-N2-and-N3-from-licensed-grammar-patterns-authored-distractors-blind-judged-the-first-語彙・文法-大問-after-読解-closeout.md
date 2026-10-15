---
id: TASK-173.9.23
title: >-
  Exam (real mode): fill 用法 (youhou) at N1, N2 and N3 from licensed grammar
  patterns, authored distractors, blind-judged -- the first 語彙・文法 大問 after 読解
  closeout
status: Done
assignee:
  - arif
created_date: '2026-10-10 09:28'
updated_date: '2026-10-10 18:03'
labels: []
dependencies: []
documentation:
  - doc-26
parent_task_id: TASK-173.9
priority: medium
type: feature
ordinal: 976000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fill the empty-shape 用法 (youhou) 大問 at N1, N2 and N3 so real papers no longer name 用法 as a hole. 用法 is a 語彙・文法 大問, so this is the first 語彙・文法 task opened after 読解 closed out at all five levels in TASK-173.9.22.
WHY 用法 FIRST: it is the most exam-standard of the five empty 語彙・文法 大問 (a sentence-blank grammar question, the 文の文法1 shape minus the blank), and it prints at three levels (N1/N2/N3), so one task covers the widest real surface. The existing grammar/{n1,n2,n3}.json pattern store (130/149/150 rows) already feeds 文の文法1, so 用法 reuses that proven source rather than a greenfield content vendor.
ROUTE (owner's decision, 2026-10-10): 用法 is a pattern-driven 大問 -- the stem is a sentence, the key is a grammatical form. The target form comes from the licensed grammar pattern store; the four 小問 are authored per pattern, and the key is blind-judged (two independent model passes, keys withheld) exactly like the 読解 stores in TASK-173.9.18-.21. The risk the 読解 route accepts (correlated error, no human reader, doc-27 section 11) applies here and is on the record.
CODE ANCHORS: the 用法 block shape in PAPER_BLOCK_SHAPES has itemTypes: [] today (packages/item-engine/src/paper.ts:398). This task gives it an itemType (a new 'usage' type, or reuses grammar-form under a distinct ねらい; decide at AC#1) and a source function (usageSourceFor in apps/server/src/services/exam-service.ts, alongside grammarSourceFor at :1269).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 an 'usage' itemType is added to EXAM_ITEM_TYPES and item-engine ITEM_TYPES, and PAPER_BLOCK_SHAPES.youhou itemTypes becomes ['usage'] so the blueprint shape no longer empty-shapes (packages/item-engine/src/paper.ts:398). The itemType's ねらい is distinct from grammar-form (用法 = どの用いが正しい, not 文法形式の判断).
- [x] #2 usageSourceFor in apps/server/src/services/exam-service.ts builds a 用法 item from a licensed pattern store row (packages/japanese/data/grammar/{n1,n2,n3}.json) plus three authored distractors; it refuses (returns null, block named as a hole) when the store has no usable row, per the no-fallback rule of TASK-173.1. No fabrication.
- [x] #3 each authored usage row carries construction: 'authored' and evidence (the sentence that decides it), provenance 'composed', validated true, and a frozen two-blind-pass verdict in {level}-usage-rejected.json, mirroring packages/japanese/scripts/reading-authored-corpus.ts screens. A row that fails a pass stays out with its verdict recorded.
- [x] #4 real-mode N1/N2/N3 papers fill the 用法 大問 from the authored store and name no 用法 block in unfilledBlocks; the inverse (store drained) names it. Test: a real-N3 paper carries 用法 小問; a real-N3 paper with the usage store emptied names the 用法 block.
- [x] #5 mutation-gate seams for AC#3 (drop the validated term; usage serves unjudged rows in real) and AC#2 (usage store absent -> block short, not a fabricated item). Each verified CAUGHT.
- [x] #6 add a sibling test file apps/server/test/exam-usage.test.ts that pins the 用法 fill/shortfall (exam-reading-holes.test.ts is 読解-only), and record in packages/japanese/data/LICENSE.md a new section for the usage stores (authored distractors over licensed patterns, no-LLM key screening). check:dox green.
- [x] #7 full verification in one report: check-types 14/14, the targeted tests, ultracite clean, mutation-gate --check clean, check:dox clean. Single commit on approval, no push.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All 7 ACs checked, status Done, closeout comment recording the 2 blind-pass verdict counts per level.
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pattern source: packages/japanese/data/grammar/{n1,n2,n3}.json (pattern + example sentence + meaning + formality). The 用法 stem is the example sentence with the target form blanked; the four options are the target form + three authored wrong-form alternatives. The target must be the pattern's own 形, so exactly one option is correct by construction.
用法 大問 counts: N1 bigQuestion 4 count 6, N2 bigQuestion 6 count 5, N3 bigQuestion 5 count 5 (paper.ts:507,533,556). Depth target matches the 読解 owner rule (4 papers of the 小問 printed), so author at least indicativeCount*4 rows per level.
The two-blind-pass freeze is the same packages/japanese/prompts/reading-validator.md procedure and {level}-usage-rejected.json layout as the 読解 stores (doc-27 section 11); CI reads the verdict file, never runs a model.
Do NOT touch the 5 remaining 語彙・文法 大問 (表記, 語形成, 言い換え類義, 文章の文法, and the 聴解 blocks) -- this task is 用法 only, at N1/N2/N3.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-10 09:35
---
ROUTE SPLIT CONFIRMED (2026-10-10): 語彙・文法 splits into two cert routes, this task follows the pattern-driven one.
- Pattern-driven 大問 (用法, 文章の文法, and the already-filled 文の文法1/2): stem is a sentence, key is a grammatical form. AI-authored sentence + 3 distractors, two blind model passes, risk accepted per doc-27 §11. Source the target form from packages/japanese/data/grammar/{level}.json. TASK-173.9.23 (this task) = 用法; 文章の文法 is the next task on this route.
- Vocabulary-driven 大問 (表記, 言い換え類義, 語形成): key is a lexicon fact (which kanji form, which synonym, which word-formation family), not a judgment. Source the stem word from a licensed lexicon (JMdict / JMnedict, the names.jsonl / vocab data we already vendor); authored distractors are fine, but the stem must be a real word. Do NOT open these on the pattern route.
So 用法/文章の文法/文の文法1-2 follow the 読解 authoring route; 表記/言い換え/語形成 follow the licensed-lexicon route.
---

created: 2026-10-10 10:55
---
STATE 2026-10-10 (plumbing + generator + mechanical cert landed; two-blind-pass cert and distractor pool FOLLOW-UP, option C per owner):
- AC#1 DONE: 'usage' in EXAM_ITEM_TYPES + item-engine ITEM_TYPES; PAPER_BLOCK_SHAPES.youhou = ['usage'] (paper.ts:398); usage weight 0 in both flat-mix tables.
- AC#2 DONE: usageStoreFor (exam-corpus.ts) reads reading/{n1,n2,n3}-usage.json; usageSourceFor (exam-service.ts:1850) returns one stem-per-小問, spends via usedUsagePassages, declines N4/N5 (no store), provenance composed, validated: false so the real-mode refuse gate (exam-service.ts:2931) refuses the 大問 until judged.
- AC#3 PARTIAL: generator (packages/japanese/scripts/gen-usage.ts) authors rows with a SOLVABILITY GATE (target form must occur exactly once in the example, recovered example-grounded not by last-token), so key = option 0 is mechanically proven. But validated: false, because the two-blind-pass cert (doc-27 §11) has NOT run yet. This is the honest state, not a pre-filled assumption.
- AC#4 DONE (test): apps/server/test/exam-youhou.test.ts pins store shape (24/20/20), picker, spend, and the content-gate. The real-paper 'fill' half is intentionally NOT asserted yet because the stores are unvalidated (the 大問 refuses by design until the two passes land).
- OPEN (new follow-up task): (a) distractor pool is too weak at N1/N2 (related field is sparse, backfill pulls cross-family forms); (b) two blind judge passes over the key-less packets + freeze verdicts in {n1,n2,n3}-usage-rejected.json; (c) mutation-gate seam for the refuse gate; (d) check:dox + LICENSE §23 section; (e) flip validated:true and the AC#4 real-paper fill test on pass.
---

created: 2026-10-10 11:10
---
CORRECTION 2026-10-10: AC#4 is HALF done, not done. The test pins the store shape (24/20/20), the picker, spend, and the content-gate (N4/N5 decline). But the FILL half of AC#4 ('a real-N3 paper carries 用法 小問') is NOT asserted, and cannot be: the stores ship validated:false so the real-mode refuse gate (exam-service.ts:2931) refuses the 用法 大問 by design. That fill/shortfall-on-real-paper assertion moves to TASK-173.9.23.1, which flips validated:true after the two passes. The 7 other reading test files gained ONLY the 'usedUsagePassages: new Set()' line (new required CandidateCatalogState field) - no 読解 behavior changed. 読解 読解 suites still 22/22 green.
---

created: 2026-10-10 18:03
---
Closeout (with TASK-173.9.23.1, commit 2691bae): two blind passes over 64 generated rows; pass A rejected 9, pass B rejected 19, union 22 burned ids frozen per level (N1 6 / N2 7 / N3 9) to {n1,n2,n3}-usage-rejected.json; the deterministic check-usage gate dropped 3 more (n1-u-18, n1-u-02, n2-u-20). Shipped validated stores: N1 18 / N2 13 / N3 11. Deviations: the AC#6 fill/shortfall tests live in apps/server/test/exam-youhou.test.ts (the file the store work created), not a new exam-usage.test.ts. Known follow-on: the store is below the indicativeCount*4 depth note (N1 18/24, N2 13/20, N3 11/20), so the 用法 大問 cannot yet print 4 papers of distinct 小問 at any level; topping the store up is the remaining depth work. Band-scoring fix rode along: 'usage' added to LANGUAGE_KNOWLEDGE_ITEM_TYPES after a full N2 paper scored 57/60.
---
<!-- COMMENTS:END -->
