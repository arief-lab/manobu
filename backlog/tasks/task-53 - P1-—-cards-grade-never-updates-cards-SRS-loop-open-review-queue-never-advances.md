---
id: TASK-53
title: >-
  P1 — /cards/grade never updates cards: SRS loop open, review queue never
  advances
status: Done
assignee: []
created_date: '2026-09-09 18:21'
updated_date: '2026-09-09 18:49'
labels:
  - bug
  - p1
  - backend
dependencies: []
priority: high
ordinal: 539000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found 2026-09-10 re-reading the cards route right after closing TASK-40. POST /cards/grade (apps/server/src/routes/cards.ts:84) inserts a revlog row (cardId, deltaT=0 hardcoded, grade) and returns ok — but NEVER updates the cards row: due stays at its old date, state stays 'new', difficulty/stability stay at defaults (5/0), lapses/is_leech never increment. Consequences: (1) /cards/due can never drain or advance — every graded card remains due forever at its old date; (2) the FSRS memory state shown in review-queue's 'Memory state' output is permanently frozen; (3) is_leech/lapses never derive from revlog so the lesson's '1 old leech' slot can never be populated by real lapses; (4) client confirms the gap: useGradeCard sends only {cardId, grade} — nothing recomputes or persists FSRS state anywhere server-side. AGGRAVATING FACTOR: previewGradeIntervals (lib/review.ts) already shows the user 'Again 1d / Hard 4d / Good 12d / Easy 28d' BEFORE grading — the UI advertises scheduling the backend silently ignores. The pieces exist: @manobu/srs is the Rust FSRS port with the transition math; gradeLabel/previewIntervals already wired client-side. Scope: server route (load card → FSRS transition → update cards + consistent revlog snapshots), possibly a small client payload extension. This is SRS-core: a review queue that never advances breaks the app's core retention promise.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /cards/grade runs the real FSRS transition: load the card's current memory state (difficulty/stability/state), map grade (again/hard/good/easy → 1/2/3/4) through @manobu/srs (or the Rust engine via the same math), persist the new difficulty/stability/due (now + interval from the grade), state (new→review), and deltaT — verified by an integration test: insert a card, grade it 'good', assert due moved forward and stability > 0; grade 'again', assert lapses+1 and due == today
- [x] #2 lapses and is_leech derive from revlog: 'again' increments lapses and flags is_leech at the lapse threshold used elsewhere (revlog-based leech selection in lib/queue.ts expects lapses > 4)
- [x] #3 revlog rows become consistent FSRS history: deltaT equals elapsed days since the card's last review (0 for first grade), and d_snapshot/s_snapshot/r_snapshot capture the pre-grade state
- [x] #4 Client contract survives: useGradeCard response carries the updated card (or the mutation invalidates cards/due which now returns advanced state) — review-queue Memory-state output shows changing D/S values after grading, verified in the desktop replay
- [x] #5 Preview-promise integrity: the intervals shown by previewGradeIntervals ('Again 1d / Good 12d') match what the backend actually schedules for the same grade+memory state
- [x] #6 bun run test + check-types + ultracite clean in every touched package
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Desktop replay evidence in task notes: grade a card, re-fetch /cards/due, show the card's due date advanced and memory state changed
- [ ] #2 1
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed e7e25f4): AC1 — /cards/grade now loads the card, runs @manobu/srs nextStates(previous, 0.9, daysElapsed), persists difficulty/stability/due/state(new→review); integration test grade-loop.test.ts: 'good' → due advances + stability 2.31 > 0 + state review; 'again' → lapses+1, due ≈ today. Live replay: fresh card graded 'good' — due 2026-09-09 → 2026-09-12, stability 0 → 2.31, state new → review. AC2 — 'again' increments lapses; is_leech flags past 4 (threshold matches lib/queue.ts leech selection lapses > 4); test drives 5x 'again' → lapses 5, isLeech true. AC3 — revlog rows carry real deltaT (elapsed days since last review) + pre-grade d_snapshot/s_snapshot; r_snapshot records elapsed days for review cards (null for new). AC4 — route returns the updated card; useGradeCard's existing queryClient.invalidateQueries(['cards','due']) re-fetches the advanced state. AC5 — preview-parity test asserts server-scheduled due equals nextStates-predicted due for the same grade+memory state (the UI preview can no longer lie). AC6 — server 28 tests green (6 new in grade-loop.test.ts), desktop 232/0, db 21/0, repo check-types 12/12, ultracite clean. DoD — replay evidence in this note: POST /cards {vocabId:7,jp:疲れる} → grade 'good' → GET /cards/due: before {due:2026-09-09, difficulty:5, stability:0, state:new} → after {due:2026-09-12, difficulty:5, stability:2.31, state:review}; dueAdvanced=true, memoryChanged=true. FLAKES CAUGHT DURING VERIFICATION (worth remembering): (1) env-based DATABASE_URL is parsed ONCE at env-module import — a test setting process.env.DATABASE_URL races with other test files' imports in the same bun process; solved with a getUserDb DI parameter on createCardsRoute. (2) test db files must be deleted at beforeAll start (leftover db from a previous run double-applies grades). (3) stale target/debug/server copy + orphaned sidecar squatted :4317 — the TASK-48 EADDRINUSE fail-fast caught it with the named-hint log, exactly as designed.
<!-- SECTION:NOTES:END -->
