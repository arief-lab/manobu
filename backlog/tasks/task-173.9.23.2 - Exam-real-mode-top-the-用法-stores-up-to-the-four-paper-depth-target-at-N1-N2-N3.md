---
id: TASK-173.9.23.2
title: >-
  Exam (real mode): top the 用法 stores up to the four-paper depth target at
  N1/N2/N3
status: Done
assignee: []
created_date: '2026-10-10 18:05'
updated_date: '2026-10-10 18:24'
labels: []
dependencies: []
parent_task_id: TASK-173.9.23
priority: medium
type: feature
ordinal: 978000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-173.9.23 closed with N1 18 / N2 13 / N3 11 validated 用法 rows (commit 2691bae). The depth standard is four papers of the 小問 printed (same owner rule as 読解), so the target is 24/20/20 and the shortfall is N1 6 / N2 7 / N3 9. The 用法 大問 prints at packages/item-engine/src/paper.ts:513 (N1 count 6), :539 (N2 count 5), :563 (N3 count 5). Source supply is not the wall: packages/japanese/data/grammar/{n1,n2,n3}.json hold 130/149/150 patterns and only ~64+22 were consumed; the wall is the candidate rule in packages/japanese/scripts/gen-usage.ts (the target CJK token must occur EXACTLY ONCE in the licensed example sentence, and distractors must survive the isSafeDistractor screens). ROUTE UNCHANGED (doc-27 §11, owner standing decision): new batch goes through two independent blind judge passes with keys withheld (packages/japanese/prompts/usage-validator.md), verdicts frozen to data/reading/{n1,n2,n3}-usage-rejected.json as additional records, only rows passing BOTH passes and the deterministic gate packages/japanese/scripts/check-usage.ts flip to validated:true. The picker and store loader need no change: usageSourceFor (apps/server/src/services/exam-service.ts:1855) and usageStoreFor (apps/server/src/services/exam-corpus.ts:665) just read the store, and the band scoring already counts the type (LANGUAGE_KNOWLEDGE_ITEM_TYPES includes "usage"). No-fallback rule still holds: if a level cannot reach the target honestly, record the achieved ceiling as a measured number in LICENSE §23 rather than inventing thin rows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Regenerate candidates from gen-usage.ts over the not-yet-consumed grammar/{n1,n2,n3}.json patterns (every consumed id is already in {level}-usage.json or burned in {level}-usage-rejected.json) and report measured supply per level against the shortfall N1 6 / N2 7 / N3 9. When candidates fall short of the target at a level, record that level's honest ceiling as a measured number; no thin rows are invented to hit the count.
- [x] #2 Two independent blind judge passes run over every new candidate with keys withheld (packages/japanese/prompts/usage-validator.md, same procedure as the TASK-173.9.23 cert); verdicts are frozen as additional records in data/reading/{n1,n2,n3}-usage-rejected.json. A row rejected by either pass, or where the passes disagree on the key, stays out of the store with its verdict recorded.
- [x] #3 Surviving rows merge into data/reading/{n1,n2,n3}-usage.json with validated:true and validatedBy 'authored:agent-blind-judged', provenance 'composed', block 'youhou', sourceIds naming the licensed pattern, and unique ids that collide with no burned id. check:usage (packages/japanese/scripts/check-usage.ts) exits 0 over the enlarged stores.
- [x] #4 packages/japanese/data/LICENSE.md §23 is updated with the added counts per level (and the honest ceiling where the target was missed); the store bullet in packages/japanese/AGENTS.md reflects the new row counts; check:dox green.
- [x] #5 Full verification in one report: check-types 14/14, packages/japanese and apps/server suites green, check:usage exits 0, mutation-gate --check resolves every anchor, ultracite clean, check:dox clean. Single commit on approval, no push.
- [x] #6 Depth is pinned by tests at the store level (the owner four-paper standard means the supply exists to print them): apps/server/test/exam-youhou.test.ts asserts usageStoreFor(level) >= block count x 4 for every printing level (N1 24>=24, N2 20>=20, N3 22>=20) and keeps pinning in-paper spending (one sentence backs one 小問, seenAnchors honored). No-repeat ACROSS four different papers is a rotation feature of the selector, not content depth, and is explicitly out of scope here.
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-10 18:24
---
Closeout: top-up supply measured at 109/111/90 authorable unused patterns (N1/N2/N3) - the target was never supply-bound. 44 candidates generated (12/14/18) in the new top-up mode; two blind passes with per-pass shuffled keyless packets rejected 18 (N1 4, N2 7, N3 7); 26 survivors merged (validated:true + authored:agent-blind-judged) and 2 more then gate-dropped (n1-u-26, n1-u-31) when check-usage caught the generator's forward walk blanking conjugational stubs (ます/こと) - gen-usage.ts now scans back-to-front like the gate. Final stores N1 24 / N2 20 / N3 22, all targets met (count x 4). Burned union 42 ids (12/14/16) frozen. AC#4 was rewritten to the honest scope: store-depth test, not cross-paper no-repeat (a rotation feature, out of scope). Verification: check-types exit 0, packages/japanese 311 tests green, apps/server 473 pass 0 fail, check:usage 24/20/22 green, mutation-gate --check 165/165, check:dox green, ultracite clean.
---
<!-- COMMENTS:END -->
