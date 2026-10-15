---
id: TASK-69
title: >-
  Lesson practice chips hardcode level N5 — useNextCards('N5') ignores the
  route's ?level param (dead prefetch + wrong-content chips; found in TASK-67
  sweep)
status: Done
assignee: []
created_date: '2026-09-10 10:26'
updated_date: '2026-09-10 10:45'
labels:
  - bug
  - frontend
  - ux
dependencies: []
priority: medium
ordinal: 529000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in the TASK-67 post-fix sweep (2026-09-10). learn/lesson.tsx has a ?level=N5..N1 search param (validateSearch + loaderDeps) and its loader correctly prefetches nextCardsQueryOptions(deps.level, deps.goal) — but lesson.tsx:410 calls useNextCards("N5", goal) with a HARDCODED level. Consequences: (1) the loader warms ['nextCards','N4',…] while the component reads ['nextCards','N5',…] — a dead prefetch on every level switch; (2) the lesson page's own level tabs change the URL but the practice chips always show N5 vocabulary — user-visible wrong content; (3) TASK-40 AC6 built the queue from the full NextCard payload (jp/reading/level) precisely so chips render real words — the level dimension was dropped at this one call site. Sole call site of useNextCards in the app (verified by grep). Small fix: thread the level. GSM per-kana event is already tracked as TASK-68; the packages/agent computed grammar import was CLEARED in this sweep (bun --compile resolves it; grammar lookup verified live on the compiled binary).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 lesson.tsx practice chips consume useNextCards(level, goal) with the route's actual ?level param (thread it via a prop from learn/lesson.tsx or Route.useSearch — implementer's choice, documented in the component JSDoc)
- [x] #2 The route loader's ensureQueryData(nextCardsQueryOptions(deps.level, deps.goal)) cache key is READ by the component — no dead prefetch (key ['nextCards', level, goal] matches)
- [x] #3 Browser-verified: /learn/lesson?level=N1&goal=jlpt shows N1-vocabulary practice chips (e.g. 嗚呼/相変わらず first entries), not N5
- [x] #4 bun run test + check-types + ultracite clean (apps/desktop)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed b0c9cad): AC1 — LessonProps.initial gains level?: N5..N1 (JSDoc records the trap); LessonRoot const level = initial?.level ?? 'N5'; useNextCards(level, goal) at the sole call site; lesson.lazy.tsx passes the route's ?level alongside goal (prop threading chosen over Route.useSearch in the component — keeps lesson.tsx route-free, matching the compound's existing initial.* pattern). AC2 — cache key ['nextCards', level, goal] now identical between loader (nextCardsQueryOptions(deps.level, deps.goal)) and component by construction; the N1 browser check below is also the prefetch-live proof (chips render from the warmed entry). AC3 — verified: ?level=N1&goal=jlpt → OL#lesson-practice contains 嗚呼 (first N1 corpus entry); ?level=N5 regression → 東/私 in corpus order (NOT the placeholder set 私/東/食べる). AC4 — turbo 9/9, tsc clean, ultracite 285 files clean. DOX: apps/desktop AGENTS lesson row records the threading.
<!-- SECTION:NOTES:END -->
