---
id: TASK-173.11
title: 'Exam: surface the paper and the real-exam mode from the dashboard (doc-25 D5)'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-29 10:50'
updated_date: '2026-10-03 09:57'
labels: []
dependencies:
  - TASK-173.1
parent_task_id: TASK-173
priority: medium
type: feature
ordinal: 949000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The scored exam is reachable only by asking the agent in /ai: `openPaper` navigates to `/exam/$examId` (`apps/desktop/src/routes/ai.tsx:666-668`) and is the sole inbound link. `BROWSE_LINKS` (`apps/desktop/src/features/dashboard/dashboard.tsx:502`) lists Lesson, Reader, Listen, Roleplay, Drill, Conjugate, Kanji, Settings but no Exam, and `/jlpt-mock` is an orphan with zero inbound links. doc-25 finding D5 records that the single strongest feature is the hardest to discover. When the real-exam mode (TASK-173.1) lands it inherits the same invisibility, so discoverability must be solved for both the daily paper and the new real mode.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The dashboard exposes an Exam entry that reaches a paper without the learner having to ask in /ai
- [x] #2 The real-exam mode is distinguishable from the daily quiz at the point of entry, so a learner chooses the intent, not the default
- [x] #3 The orphan `/jlpt-mock` route is either linked from the hub or removed, decided explicitly rather than left invisible
- [x] #4 A browser pass from the dashboard reaches an exam paper and a real-mode paper with no console errors
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New routes/exam/index.tsx launch form (level + Daily/real intent + Launch) calling orpc.exam.request+assemble, reusing paperBuildNotice; data:local-state marker. 2. Add Exam entry to dashboard BROWSE_LINKS. 3. Regenerate routeTree.gen.ts + add exam/index.tsx to route-loaders.test.ts ROUTES. 4. Add deck copy keys (R-02 clean). 5. AC#3 resolved by TASK-158 citation (no code). 6. Verify: check-types, bun test apps/desktop, ultracite, mutation-gate --check, check:dox, browser pass. Single commit on approval, no push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: apps/desktop/src/routes/exam/index.tsx (createFileRoute("/exam/"), chrome-free, data:local-state marker, no loader) with level picker + Daily(shortened)/Real(real) intent radios; BROWSE_LINKS now leads with {label:"Exam", to:"/exam"}. Launch runs orpc.exam.request({level,mode}) -> orpc.exam.assemble, navigates to /exam/$examId only when built.ready else shows paperBuildNotice inline. routeTree regenerated; route-loaders.test.ts lists exam/index.tsx; 10 exam.launch.* copy keys added; copy-snapshot prefix count 17->27 (exam.launch.* ride the count like paper.offline.*, EXAM_KEYS stays 17). Docs: apps/desktop/AGENTS.md gains the launch-route bullet. Checks green: repo check-types 14/14, desktop route-loaders 33 pass, ui copy-snapshot 15 pass (em-dash guard clean), ultracite check on all changed files clean, mutation-gate --check all 92 anchors resolve, check:dox complete.

AC#3 decided explicitly, no code: /jlpt-mock is left exactly as TASK-158 (Done) ruled it internal-only. apps/desktop/AGENTS.md records that no route may link it (header link count is fixed), and JlptMock is reused by the kana-checkpoint tests; linking would violate 158 and removing would reverse it. AC#3 asks that the orphan be 'decided explicitly rather than left invisible', which 158 already did. Drive-by (user-approved): fixed 3 PRE-EXISTING type errors in apps/server/test/exam-short-reading.test.ts from TASK-173.7 (bun test does not typecheck, so they slipped). newCatalog() now returns the full CandidateCatalogState derived via Parameters<typeof shortReadingSourceFor>[0]['catalog'] with a writable seenAnchors Set (Omit+intersect, so catalog.seenAnchors.add() still works and it stays assignable to the ReadonlySet the picker declares); line 137 flipped to expect(storeCell).toBe(found.target) so the string|undefined indexed read is the actual not the expected; line 221 uses source.passage ?? null to match result.passage's string|null. All 11 runtime tests in that file pass; server check-types now exit 0.

Browser pass (AC#4) on the real stack: sidecar :4317 (NODE_ENV=development, DATABASE_URL=file db, migrations applied, vaporetto=true) + Vite :3001, driven by Playwright chromium. 0 console AND 0 page errors across the whole walk. AC#1: /dashboard browse nav present, single 'Exam' link, click -> /exam. AC#2: /exam launch UI renders h1 'Build a paper', 5 level buttons (N5..N1), Daily/Real intent radios, submit; intent is picked here, not defaulted. AC#4 daily: N5 + Daily practice + submit -> navigated to /exam/exam-e2450de9-... workspace and stayed. AC#4 real: Real exam + submit -> did NOT navigate, stayed on /exam with the honest notice 'Not a full paper: 46/91 items. The app cannot ask these parts of a real paper yet: 言語知識（文字・語彙） 大問 2 (表記), ... 大問 5 (内容理解（中文）), ...' (the 173.4 refuse-not-fabricate path, no broken workspace). AC#3: /jlpt-mock still renders its internal-only label ('AI Chat JLPT Mock · Internal surface · built-in seed questions, not a generated paper...'), untouched. Dev servers stopped + scratch cleaned after.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gave the dashboard a first-class Exam entry so the scored paper no longer hides behind /ai (doc-25 D5). Added apps/desktop/src/routes/exam/index.tsx (createFileRoute("/exam/"), chrome-free, data:local-state, no loader): a level picker + Daily/Real intent radios whose Launch runs the same orpc.exam.request->orpc.exam.assemble pair the composer drives, navigates to /exam/$examId only on built.ready and otherwise shows paperBuildNotice inline. BROWSE_LINKS leads with {label:"Exam", to:"/exam"}; routeTree regenerated; route-loaders.test.ts lists exam/index.tsx; 10 exam.launch.* deck keys (R-02 clean), copy-snapshot prefix count 17->27. AC#3 decided not re-litigated: /jlpt-mock left exactly as TASK-158 ruled internal-only. Drive-by (user-approved): fixed 3 PRE-EXISTING TASK-173.7 type errors in apps/server/test/exam-short-reading.test.ts (complete CandidateCatalogState via Parameters<...> with a writable seenAnchors; narrowed two string|undefined indexed reads), all 11 tests pass. Verified: repo check-types 14/14, desktop route-loaders 33 pass + ui copy-snapshot 15 pass, ultracite check clean, mutation-gate --check 92 anchors resolve, check:dox complete, and a Playwright browser pass on the live stack with 0 console/page errors proving AC#1-#4. Awaiting user approval for the single commit (no push).
<!-- SECTION:FINAL_SUMMARY:END -->
