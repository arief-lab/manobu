---
id: TASK-173.9.23.1
title: >-
  Exam (real mode): harden 用法 distractor pool and run the two-blind-pass cert so
  the usage 大問 can be validated at N1/N2/N3 (doc-27 §11)
status: Done
assignee: []
created_date: '2026-10-10 10:55'
updated_date: '2026-10-10 18:01'
labels: []
dependencies: []
documentation:
  - doc-26
parent_task_id: TASK-173.9.23
priority: medium
type: feature
ordinal: 977000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-173.9.23 (option C, owner 2026-10-10). The 用法 plumbing, generator, and mechanical key-cert are landed: stores ship validated:false so the real 用法 大問 refuses until the two-blind-pass cert below runs.
TWO GAPS THIS TASK CLOSES:
1. DISTRACTOR POOL (quality): gen-usage.ts currently backfills distractors from any other pattern at the level when a pattern's related field is sparse. At N1/N2 most related lists are 2-3 entries, so the backfill pulls cross-family forms (e.g. とも, あろうことか repeated as distractors on unrelated blanks). The real 用法 大問 offers near-miss same-family forms. Fix: distractors come ONLY from the pattern's related forms when >=3 are available; when related <3, DROP the row rather than backfill. This will shrink N1/N2 (likely N1 24->~10-14, N2 20->~12-15) but every remaining row has a real distractor set.
2. TWO-BLIND-PASS CERT (doc-27 §11): run two independent model passes over each row's key-less packet (passage + 4 forms, stem, key withheld; the usage-validator.md prompt is already written). Freeze verdicts to data/reading/{n1,n2,n3}-usage-rejected.json (one record per pass, rejectedIds merged, mirroring reading-n4-corpus.ts readJudgeRejections). A row where pass A and pass B disagree on the key is AMBIGUOUS and is rejected (stays out, verdict recorded). Only rows that PASS both passes and agree with the frozen key get validated:true.
WHY THE JUDGE READS OUR DATABASE: the judge's input packet is the sentence + forms FROM grammar/{level}.json (our licensed store) plus the 4 authored forms - not a foreign corpus. The vocab store n1.json..n5.json is WORDS not grammar FORMS, so it cannot look up the 用法 key; vaporetto_split is a tokenizer, not a grammar solver. Deciding which form grammatically completes the sentence IS the judgment, so the two passes are required, not a single DB lookup.
ROUTE SAME AS 読解 (owner's standing decision): two independent model passes, keys withheld, verdicts frozen as data, CI never runs a model. The correlated-error residual risk (both passes the author's own family, no human reader) is the same acceptance doc-27 §11 recorded for 読解.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 two independent blind judge passes run over every remaining row, keys withheld; verdicts frozen to {n1,n2,n3}-usage-rejected.json. Disagreement between the two passes on a key => row rejected (stays in the rejected file, out of the store).
- [x] #2 surviving rows are flipped validated:true + validatedBy 'authored:agent-blind-judged'. A check-usage gate (packages/japanese/scripts/check-usage.ts) re-derives each row's key from its sentence + related family, cross-checks the verdict file, and refuses any row whose verdict is missing, disagreeing, or a two-answer. check:usage exits 0 over the shipped stores and 1 over a mutated fixture.
- [x] #3 real-N3 paper now FILLS the 用法 大問 from the validated store (the AC#4 fill half of TASK-173.9.23, unblocked); real-N3 with the store drained names the block. The real-paper fill/shortfall test in exam-youhou.test.ts is completed.
- [x] #4 mutation-gate seams: drop the validated term (unjudged row serves in real) CAUGHT; usage store absent -> block short not fabricated CAUGHT; check-usage mutation (a two-answer row passes the gate) CAUGHT.
- [x] #5 record in packages/japanese/data/LICENSE.md a new section for the usage stores (authored 用法 over licensed grammar patterns, distractors restricted to same-family, two-blind-pass cert, the shrink count per level). check:dox green.
- [x] #6 full verification: check-types 14/14, exam-youhou.test.ts green (incl. the fill test), check:usage green, mutation-gate --check clean, check:dox clean. Single commit on approval, no push.
- [x] #7 SUPERSEDED as originally written (owner decision 2026-10-10): same-family-only distractors starved the stores (N1 1 / N2 0 / N3 5 rows), so the shipped generator keeps related-first distractors with level backfill, every candidate passing the isSafeDistractor screens (no substring of the key, not occurring in the sentence) plus the solvability gate; the two-answer risk the drop rule existed to stop is caught by the two blind judge passes and re-checked deterministically by check:usage. Shipped stores: N3 11 / N2 13 / N1 18.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All 7 ACs checked, status Done, closeout comment recording the two-pass verdict counts per level (pass/reject) and the final store row counts.
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow-up to TASK-173.9.23 (option C, owner 2026-10-10). The 用法 plumbing, generator, and mechanical key-cert are landed: stores ship validated:false so the real 用法 大問 refuses until the two-blind-pass cert below runs.

TWO GAPS THIS TASK CLOSES:
1. DISTRACTOR POOL (quality): gen-usage.ts currently backfills distractors from any other pattern at the level when a pattern's related field is sparse. At N1/N2 most related lists are 2-3 entries, so the backfill pulls cross-family forms (e.g. とも, あろうことか repeated as distractors on unrelated blanks). The real 用法 大問 offers near-miss same-family forms. Fix: distractors come ONLY from the pattern's related forms when >=3 are available; when related <3, DROP the row rather than backfill. This will shrink N1/N2 (likely N1 24->~10-14, N2 20->~12-15) but every remaining row has a real distractor set.
2. TWO-BLIND-PASS CERT (doc-27 §11): run two independent model passes over each row's key-less packet (passage + 4 forms, stem, key withheld; the usage-validator.md prompt is already written). Freeze verdicts to data/reading/{n1,n2,n3}-usage-rejected.json (one record per pass, rejectedIds merged, mirroring reading-n4-corpus.ts readJudgeRejections). A row where pass A and pass B disagree on the key is AMBIGUOUS and is rejected (stays out, verdict recorded). Only rows that PASS both passes and agree with the frozen key get validated:true.

WHY THE JUDGE 'READS OUR DATABASE': the judge's input packet is the sentence + forms FROM grammar/{level}.json (our licensed store) plus the 4 authored forms - it is not pulling from a foreign corpus. But the vocab store n1.json..n5.json is WORDS, not grammar FORMS, so it cannot look up the 用法 key; vaporetto_split is a tokenizer, not a grammar solver. Deciding which form grammatically completes the sentence IS the judgment, so the two passes are required, not a single DB lookup.

ROUTE SAME AS 読解 (owner's standing decision): the owner approved two independent model passes, keys withheld, verdicts frozen as data, CI never runs a model. The correlated-error residual risk (both passes are the author's own family, no human reader) is the same acceptance doc-27 §11 recorded for 読解 and is on the record here.

Acceptance criteria:
- AC#1: gen-usage.ts drops the cross-family backfill; a row is authored only when the pattern's related field supplies >=3 distinct same-family distractor forms. Regenerate: N1/N2/N3 stores shrink to the rows that survive.
- AC#2: two independent blind judge passes run over every remaining row, keys withheld; verdicts frozen to {n1,n2,n3}-usage-rejected.json. Disagreement between the two passes on a key => row rejected (stays in the rejected file, out of the store).
- AC#3: surviving rows are flipped validated:true + validatedBy: 'authored:agent-blind-judged'. A check-usage gate (packages/japanese/scripts/check-usage.ts) re-derives each row's key from its sentence + related family, cross-checks the verdict file, and refuses any row whose verdict is missing, a disagreeing verdict, or a two-answer. check:usage exits 0 over the shipped stores and 1 over a mutated fixture.
- AC#4: real-N3 paper now FILLS the 用法 大問 from the validated store (the AC#4 fill half of TASK-173.9.23, unblocked); real-N3 with the store drained names the block. The real-paper fill/shortfall test in exam-youhou.test.ts is completed.
- AC#5: mutation-gate seams: drop the validated term (unjudged row serves in real) -> CAUGHT; usage store absent -> block short not fabricated -> CAUGHT; check-usage mutation (a two-answer row passes the gate) -> CAUGHT.
- AC#6: record in packages/japanese/data/LICENSE.md a new section for the usage stores (authored 用法 over licensed grammar patterns, distractors restricted to same-family, two-blind-pass cert, the shrink count per level). check:dox green.
- AC#7: full verification: check-types 14/14, exam-youhou.test.ts green (incl. the fill test), check:usage green, mutation-gate --check clean, check:dox clean. Single commit on approval, no push.

Definition of Done:
- All 7 ACs checked, status Done, closeout comment recording the two-pass verdict counts per level (pass/reject) and the final store row counts.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-10 18:01
---
Closeout: 64 rows generated. Two blind passes, keys withheld: pass A rejected 9, pass B rejected 19; union 22 burned ids frozen to {n1,n2,n3}-usage-rejected.json (N1 6 / N2 7 / N3 9). 45 rows survived the judges; the deterministic check-usage gate then dropped 3 more (n1-u-18, n1-u-02, n2-u-20). Shipped stores: N3 11 / N2 13 / N1 18, all validated:true + validatedBy authored:agent-blind-judged. AC#1 same-family-only rule reverted by owner decision (it starved the stores to N1 1 / N2 0 / N3 5); shipped generator keeps related-first distractors with level backfill, screened by isSafeDistractor plus the two blind passes and check-usage. Follow-on fix in this commit: 'usage' added to LANGUAGE_KNOWLEDGE_ITEM_TYPES (packages/item-engine/src/paper.ts) after a full N2 paper scored 57/60 because the band classifier silently dropped the placed 用法 items. Verification: check-types 14/14, packages/japanese 311 tests, apps/server 471 pass / 0 fail, item-engine 73, check:usage green, mutation-gate --check 165/165 anchors, check:dox green, ultracite clean.
---
<!-- COMMENTS:END -->
