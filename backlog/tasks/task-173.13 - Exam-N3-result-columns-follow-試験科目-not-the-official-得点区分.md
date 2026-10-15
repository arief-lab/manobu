---
id: TASK-173.13
title: 'Exam: N3 result columns follow 試験科目, not the official 得点区分'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-29 18:42'
updated_date: '2026-09-29 19:14'
labels: []
dependencies: []
documentation:
  - doc-26
parent_task_id: TASK-173
priority: medium
type: enhancement
ordinal: 951000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while adding the Japanese section names in TASK-173.3. The app scores an N3 paper into one column per test 科目 (vocabulary / grammar-reading / listening), the shape apps/server/test/exam-section-labels.test.ts:18 and :27 pin. The official JLPT N3 得点区分 is instead 言語知識（文字・語彙・文法） / 読解 / 聴解, i.e. the same three columns N1/N2 use (which DO already score language-knowledge / reading / listening). This divergence predates 173.3 (the English table has always named N3 this way); 173.3 deliberately preserved it rather than silently changing what a scored N3 paper reports, and recorded it in doc-26 §8. Re-splitting is an item-composition decision (which scoring ids an N3 paper projects into), not a labelling one, so it belongs here and not in a naming task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An N3 composed paper projects into the three official 得点区分 columns: 言語知識（文字・語彙・文法） / 読解 / 聴解 (English: Language Knowledge / Reading / Listening), matching how N1/N2 already score
- [x] #2 Every N3 item lands in the correct official column (文字・語彙 and 文法 items into 言語知識, reading items into 読解, listening into 聴解), re-derived in the N3 blueprint the same way N1/N2 derive theirs
- [x] #3 apps/server/test/exam-section-labels.test.ts is updated for the new N3 ids in BOTH languages, and the divergence paragraph in doc-26 §8 is resolved (replaced with the corrected mapping, not left standing)
- [x] #4 No regression for N1/N2/N4/N5 column composition or any result surface that reads the scored columns (result pane, chat fold, debrief)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
N3 currently bands 1:1 with its test sections (vocabulary/grammar-reading/listening); the official 得点区分 is language-knowledge(文字・語彙・文法)/読解/聴解, the same split N1/N2 already do. Slices: (1) packages/item-engine/src/paper.ts N3 scoringSections -> [language-knowledge(itemTypes LANGUAGE_KNOWLEDGE_ITEM_TYPES, source [vocabulary,grammar-reading]), reading(itemTypes READING_ITEM_TYPES, source [grammar-reading]), listening], and sections[].scoringSectionIds (vocabulary->[language-knowledge], grammar-reading->[language-knowledge,reading]). (2) Bump PAPER_DEFAULT_BUDGETS.N3 grammar-reading so the new reading band clears the 10-item floor (default 10 -> ~24, reading share ~12). No api-contract/server change: resultSectionEntries derives columns from (section,itemType), and the label choosers already treat N3 on the split side. (3) Update exam-section-labels.test.ts N3 rows (both languages), item-engine paper.test.ts N3 blueprint/floor, exam-pipeline.test.ts N3 result. (4) Resolve the divergence paragraph in doc-26 §8. (5) DOX: item-engine + api-contract AGENTS.md N3 wording. (6) Verify: check-types, ultracite, suites, fallow boundaries, check:dox, mutation-gate --check. Real-mode N3 reading 大問 are still unfilled blocks (doc-26 §4) so a real N3 読解 column is separately gated on 173.9 content; this task is the scoring shape + daily default.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scoring shape done in packages/item-engine/src/paper.ts PAPER_BLUEPRINTS.N3.scoringSections: language-knowledge (LANGUAGE_KNOWLEDGE_ITEM_TYPES, sourceSectionIds [vocabulary, grammar-reading]), reading (READING_ITEM_TYPES, source [grammar-reading]), listening. sections[].scoringSectionIds: vocabulary->[language-knowledge], grammar-reading->[language-knowledge, reading]. PAPER_DEFAULT_BUDGETS.N3.grammar-reading 10->24 so the new reading band clears the 10-item floor (a 10/10/10 N3 paper is now raw-only, unmet column reading). No api-contract/server source change: examScoringSectionLabel already treats N3 on the split side (FOLDED_READING_LEVELS is only N4/N5), and every result consumer derives columns from the blueprint generically. The daily default N3 paper now bands reading=~12 items.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TASK-173.13: an N3 paper now projects into the three official 得点区分 columns (Language Knowledge / Reading / Listening), matching N1/N2, instead of one column per test 科目. Changed the N3 blueprint in packages/item-engine/src/paper.ts (scoringSections + section scoringSectionIds) and raised PAPER_DEFAULT_BUDGETS.N3.grammar-reading 10->24. Updated the tests that pinned the old shape (item-engine paper.test.ts, apps/server exam-section-labels.test.ts both languages, exam-pipeline.test.ts N3 band result) and resolved the doc-26 8 divergence note. DOX: item-engine and api-contract AGENTS.md. Verified: item-engine 64 pass, server 277 pass/1 skip, desktop 556 pass/3 skip, exam-section-labels 7 pass, exam-pipeline 28 pass; tsc clean for item-engine/api-contract/server; ultracite clean; fallow boundary 0 violations; check:dox complete; mutation-gate --check all 82 anchors resolve.
<!-- SECTION:FINAL_SUMMARY:END -->
