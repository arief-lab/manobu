---
id: TASK-18.5
title: 'QA: weak-pattern → quiz wiring and anchored generation tests'
status: Done
assignee: []
created_date: '2026-09-05 12:12'
updated_date: '2026-09-05 18:04'
labels: []
dependencies: []
parent_task_id: TASK-18
priority: medium
type: feature
ordinal: 607000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Need to wire lib/mock.ts:11 deriveWeakPatterns top-3 into nextCards filter so weak grammar/vocab drives generation, and add tests that generated nextCards are anchored and FSRS-correct. Currently deriveWeakPatterns is only used in jlpt-mock display, not in queue generation. Tests must ensure no hallucinated vocab and FSRS intervals are sane.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 deriveWeakPatterns output is used to filter nextCards query (e.g., search_vocab(weakPattern, level)) and verified by an integration test
- [x] #2 Add bun test in apps/desktop/test/ai-queue.test.ts asserting nextCards vocabIds exist in content.db and intervals from previewIntervals are within 1..365
- [x] #3 Add walkthrough assertion that a weak "te-form" pattern generates a te-form card in conjugate lab
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verify: check-types 10/10, ultracite 208 clean, apps/web bun test 62/62 (5 new in ai-queue.test.ts + 1 in walkthrough-copies). queue.ts: added NextCardLike + filterNextCardsByWeakPatterns (pure substring jp+reading+level, never throws). mock.ts: exposed resolveGrammarLevel for queue level pinning. new weak-pattern-queue.ts: buildWeakPatternQueue(mistakes, candidates) → { cards, weak }, derives weak patterns + filters + falls back when no match. tests: ai-queue.test.ts asserts vocabIds in N5 corpus, previewIntervals 1..365, filter logic, buildWeakPatternQueue no-filter and fallback. walkthrough-copies.test.ts adds te-form weak pattern → conjugate lab (classify たべる → たべて + classify のむ → のんで).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
QA weak-pattern → quiz wiring + anchored generation tests: queue.ts added NextCardLike + filterNextCardsByWeakPatterns (pure substring across jp+reading+level, no mutation, no throw); mock.ts exposed resolveGrammarLevel; new lib/weak-pattern-queue.ts with buildWeakPatternQueue(mistakes, candidates) → { cards, weak } (derives weak via deriveWeakPatterns, filters via filterNextCardsByWeakPatterns, falls back to candidates when no match, never throws). Tests: apps/desktop/test/ai-queue.test.ts (5) asserts vocabIds in N5 corpus, previewIntervals 1..365 for all 4 grades, filter logic, buildWeakPatternQueue no-filter, fallback. apps/desktop/test/walkthrough-copies.test.ts adds weak 'ta-form' pattern → conjugate lab loop (classify たべる → たべて + classify のむ → のんで). DOX: apps/web AGENTS + src AGENTS updated. Verified check-types 10/10, ultracite 208 clean, apps/web bun test 62/62.
<!-- SECTION:FINAL_SUMMARY:END -->
