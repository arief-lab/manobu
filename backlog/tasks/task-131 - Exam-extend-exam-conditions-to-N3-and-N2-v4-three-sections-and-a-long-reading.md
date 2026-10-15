---
id: TASK-131
title: >-
  Exam: extend exam-conditions to N3 and N2 (v4), three sections and a long
  reading
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:26'
updated_date: '2026-09-25 17:23'
labels: []
dependencies:
  - TASK-128
documentation:
  - >-
    backlog/docs/feature/doc-14 -
    JLPT-exam-generation-pipeline-request-assembler-validator-storage.md
  - >-
    backlog/docs/feature/doc-12 -
    Chat-generated-JLPT-exams-N5..N1-a-kana-readiness-gate.md
priority: low
type: feature
ordinal: 868500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Phase **v4** of `doc-12` §6. N3 and N2 add a third section shape (vocabulary split off from grammar plus reading) and N3 adds a long reading item, so the paper pipeline has to handle three sections with per-section timing and a reading passage long enough that it is its own item type. `doc-14` §9 currently puts this out of scope, so this task exists to track the work rather than to schedule it: it is deliberately `low` and it must not start until v3 ships (`TASK-126` to `TASK-128`), because building it earlier would shape the pipeline around a section count that the N5 and N4 papers never exercise. The section model correction matters here too: `doc-12` §2.6 and D11 mean N1 to N3 score **three** 60-point sections, so the N3 and N2 result view needs three badges where the N4 and N5 view needs two.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An N3 `shortened` and an `exam-conditions` paper both build with three sections and per-section timing.
- [x] #2 N3's long reading item type exists and is validated like any other item, including its own anchor requirements.
- [x] #3 The result view shows three scoring sections at N1 to N3 summing to 180, per `doc-12` §2.6 and D11, with no reading section invented at N4 or N5.
- [x] #4 N2 builds with the N2 section shape and minutes from `doc-14` §2.2.
- [x] #5 The D5 viability floor is applied per section, so a 60-point section still needs at least 10 items before bands are shown.
- [x] #6 Existing N5 and N4 papers are unchanged, and their tests still pass.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a distinct N3-only long-reading item contract across @manobu/item-engine and @manobu/api-contract, including N3 grammar-reading weights, passage requirements, and the validator anchor rule; keep reading-info unchanged for the other levels. 2. Update server candidate/passage generation and section projection, then prove N3 shortened and exam-conditions three-section builds, official minutes, N2 shape/timers, and D5 per-section floors without changing N5/N4. 3. Extend submitted result/debrief and desktop rendering/queries for N1-N3 three 60-point scoring sections summing to 180, with raw-only fallback and independent gates. 4. Add focused item-engine, server, contract, and desktop tests; update DOX and run workspace verification.

5. Split the N1/N2 combined Language Knowledge·Reading test section into two 60-point scoring columns by item type: non-reading items feed language-knowledge, reading-info/long-reading feed reading; apply the same per-column floor and result/debrief projection so all three caps sum to 180.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Research confirmed the N3/N2 blueprints, official minutes, D5 floor logic, and generic three-section result projection already existed. Added the approved N3-only long-reading item type, passage validation, server generation, and focused N3/N2 result/timer tests.

AC#3 research correction: the existing N1/N2 blueprints had only two 60-point scoring columns (120) despite totalCap 180. TASK-131 now carries the D11 split: the combined test section stays two sections, but scoring is three columns filtered by item type.

Implemented the D11 N1/N2 split: the combined language-knowledge-reading test section now filters into language-knowledge and reading scoring columns by item type, with per-column floors and 180 total caps. N1/N2 defaults are 40/10 and 70/10 so the reading column clears its 10-item floor.

Validation (2026-09-26): AC#1+AC#2 apps/server test/exam-pipeline.test.ts "builds and scores N3 papers in both modes with long reading" builds N3 shortened AND exam-conditions, asserts sections [vocabulary, grammar-reading, listening], minutes [30,70,40], per-mode timeLimitSeconds, and that long-reading items exist only in grammar-reading with a non-empty passage. AC#2 packages/item-engine/test/validation.test.ts "requires a passage for long reading and accepts an anchored one" pins passage-missing, no-anchor, and a passing anchored item. AC#3 exam-pipeline "splits N2 into three independent banded result columns" asserts [language-knowledge, reading, listening] each maxScore 60, total 180, and the N3 result test asserts the same 3x60/180; N4/N5 blueprints keep two scoring sections and paper.test asserts paperSectionForItemType({itemType:long-reading, level:N5}) is null. AC#4 exam-pipeline "keeps the N2 shape and official minutes" asserts [language-knowledge-reading, listening], minutes [105, 50], timeLimitSeconds [6300, 3000]. AC#5 packages/item-engine/test/paper.test.ts floor tests: N3 grammar-reading 9 items is unmet at minimumItems 10 while the other two stay met, and N1 with 20 items leaves the new reading column unmet at 5 while the 40-item default meets every floor. AC#6 unchanged N5/N4: full suites green with no N4/N5 blueprint or weight edits. Workspace: server 153 pass/1 skip, desktop 448 pass/3 skip, @manobu/db 35 pass, @manobu/item-engine 29 pass, root turbo 10/10, check-types + ultracite + fallow audit clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the N3-only long-reading item type end to end (item-engine weights 20/long-reading vs 30/reading-info, required-passage and anchor validation, api-contract vocabulary, server passage generation with a type-specific 1200-char cap). N3 builds three timed sections in both modes, N2 keeps its 105+50 shape, and the D11 correction landed: N1/N2's combined test section now projects into three 60-point scoring columns (language-knowledge, reading, listening) filtered by item type, with per-column 10-item floors and 180 totals; N4/N5 keep their two-section model. Verified with item-engine 29, server 153/1, desktop 448/3, db 35 tests, plus check-types, ultracite and fallow.
<!-- SECTION:FINAL_SUMMARY:END -->
