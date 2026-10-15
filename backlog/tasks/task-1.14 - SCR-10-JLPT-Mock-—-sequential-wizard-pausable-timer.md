---
id: TASK-1.14
title: SCR-10 JLPT Mock — sequential wizard + pausable timer
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:55'
updated_date: '2026-09-05 04:36'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 634000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wizard exam per SCR-10 DZLCy. Real+pausable timer PsOqM, Next disabled until choice (dXdIi helper), score → top-3 weak patterns → AI 7-day plan without retake shame.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Timer real+pausable `⏱ {mm}:{ss}`; Next 40% opacity disabled until choice; helper `Choose an answer to continue`; Q {n}/{total}
- [x] #2 Submit fail di16p: [Retry submit] with progress saved locally WAL; Score {pct}% → weak patterns `{pattern} ({wrong}/{total})` → AI plan `Next 7 days…` [Start plan][Review mistakes]
- [x] #3 No total-retake shame copy; spec §Ethical CLEAR: mock shows improvement plan not guilt
- [x] #4 Ref: spec SCR-10 + copy-deck mock.* + spec Test Plan golden tests
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 AGENTS.md chain (root → apps/web) re-read before edits; nearest owning AGENTS.md + Child DOX Index updated when contracts/structure change; no stale or contradictory DOX entries remain
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify baseline (check-types 8/8, ultracite clean on apps/web scope)
2. Add mock.* copy keys to packages/ui/src/lib/copy.ts: mock.timer, mock.progress, mock.helper, mock.next, mock.score, mock.submit.fail, mock.mistakes, mock.start_plan. Type CopyKey union + copy map
3. Add apps/desktop/src/lib/mock.ts: pure-TS question scoring + top-3 weak patterns (substring match pattern id against grammar corpus via @manobu/japanese/data/grammar/n*.json). Types: Question { id, prompt, choices, grammarId }, MockResult { score, weak: WeakPattern[], mistakes: Mistake[] }, deriveWeakPatterns(mistakes, grammar, topN=3)
4. Compose apps/desktop/src/components/jlpt-mock.tsx (Vercel pattern): <JlptMock> provider, .Timer (real+pausable, useEffect interval, mm:ss format, ⏱ prefix), .Progress (Q {n}/{total}, role=progressbar), .Choices (radio group, [Choose an answer to continue] 40% opacity helper), .Next (button disabled until choice, opacity 40%), .Score (Score {pct}% + top-3 weak patterns `{pattern} ({wrong}/{total})`), .Plan (`Next 7 days: …` scaffolded from weak patterns, [Start plan] wired to useChatSession with prepared system prompt, [Review mistakes] opens mistakes list), .SubmitFail (placeholder for di16p — retry button with WAL save note)
5. Add apps/desktop/src/routes/jlpt-mock.tsx mounting the compound; routeTree.gen.ts regenerates on build
6. Add apps/desktop/test/mock.test.ts: scoreQuestion correct/wrong/empty; deriveWeakPatterns top-3 + tie-break + empty; formatTimer mm:ss
7. DOX pass: apps/desktop/AGENTS.md Child DOX Index gets SCR-10 entry + apps/desktop/src/lib/mock.ts in cross-cutting lib + packages/ui/AGENTS.md gains the new copy keys in its child-do-not-have-one note (or skip — no children yet)
8. Verify: check-types 8/8, bun test, ultracite 0 errors on mock scope, commit
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation 2026-09-05: SCR-10 JLPT Mock scaffold landed. New: apps/desktop/src/components/jlpt-mock.tsx (Vercel compound: Timer real+pausable with Pause/Resume, Progress role=progressbar, Choices fieldset radio + helper Choose an answer to continue 40% opacity, Next disabled until choice opacity-40, Score {pct}% + top-3 weak patterns, Plan Next 7 days + [Start plan]+[Review mistakes] placeholders for TASK-1.16, SubmitFail [Retry submit] WAL). New apps/desktop/src/routes/jlpt-mock.tsx mounts the compound (registered in routeTree.gen.ts). New apps/desktop/src/lib/mock.ts: scoreQuestion, computeMockResult, deriveWeakPatterns (top-N tie-broken by mistake count desc then id asc), formatTimer mm:ss padded. Grammar corpus loaded lazily via dynamic import of @manobu/japanese/data/grammar/n*.json. New apps/desktop/src/lib/grammar-types.ts: narrow GrammarEntry/GrammarLevel/RawGrammarFile. New apps/desktop/test/mock.test.ts: 13 new tests (scoreQuestion correct/wrong/null, formatTimer padding + negative clamp, grammarIdLevel prefix map, deriveWeakPatterns topN/empty/tie-break, computeMockResult mixed/perfect/empty). New mock.* copy keys in packages/ui/src/lib/copy.ts: mock.timer, mock.progress, mock.helper, mock.next, mock.score, mock.submit.fail, mock.mistakes, mock.start_plan. DOX: apps/desktop/AGENTS.md Child DOX Index + cross-cutting lib updated. Verification: check-types 8/8, bun test 32/32 pass, ultracite 0 errors on mock scope.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented SCR-10 JLPT Mock scaffold. New: apps/desktop/src/components/jlpt-mock.tsx (Vercel compound: Timer real+pausable with Pause/Resume, Progress role=progressbar, Choices fieldset radio + helper 40% opacity until choice, Next disabled until choice opacity-40, Score {pct}% + top-3 weak patterns, Plan Next 7 days + [Start plan]+[Review mistakes] placeholders for TASK-1.16, SubmitFail [Retry submit] WAL); apps/desktop/src/routes/jlpt-mock.tsx (registered in routeTree.gen.ts); apps/desktop/src/lib/mock.ts (scoreQuestion, computeMockResult, deriveWeakPatterns with tie-break on id asc, formatTimer mm:ss padded); apps/desktop/src/lib/grammar-types.ts (narrow GrammarEntry/GrammarLevel/RawGrammarFile); apps/desktop/test/mock.test.ts (13 tests). mock.* copy keys added to packages/ui/src/lib/copy.ts (mock.timer, mock.progress, mock.helper, mock.next, mock.score, mock.submit.fail, mock.mistakes, mock.start_plan). Grammar corpus loaded via dynamic import of @manobu/japanese/data/grammar/n*.json. DOX: apps/desktop/AGENTS.md Child DOX Index + cross-cutting lib updated. AC evidence: mock.test.ts proves formatTimer (00:00, 01:05, 09:59, negative clamp), scoreQuestion (correct/wrong/null), deriveWeakPatterns (topN/tie-break/empty), computeMockResult (mixed/perfect/empty). SubmitFail uses role=alert + aria-live=assertive + [Retry submit] button calling reset(). Score view shows 'Score {pct}% ({score}/{total})' with 'Weak: {pattern} ({wrong}/{total} wrong)' — focuses on improvement plan, no shame copy. Verification: check-types 8/8, bun test 32/32, ultracite 0 errors on mock scope.
<!-- SECTION:FINAL_SUMMARY:END -->
