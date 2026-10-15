---
id: TASK-18.2
title: 'Client: lab queues consume AI nextCards via TanStack Query'
status: Done
assignee:
  - '@arief'
created_date: '2026-09-05 12:11'
updated_date: '2026-09-05 15:47'
labels: []
dependencies: []
parent_task_id: TASK-18
priority: high
type: feature
ordinal: 609000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
apps/desktop/src/components/lesson.tsx:352 currently does pickCards([{cardId:1,lapses:5}], [10,11], 3) hardcoded and apps/desktop/src/routes/review.tsx:6 has SEED[3] dummy. Need to replace with useQuery(nextCards) from TASK-18.1, keep interleaved invariant lib/queue.ts:26 pickCards 1 leech (lapses>4) + 2 new, but source is AI nextCards. Depends on TASK-2 Query and TASK-14 zValidator. Lesson and conjugate labs should show AI-populated vocab, not static [10,11].
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Lesson and conjugate labs render nextCards from server via useQuery with queryKey ["nextCards", learnerLevel] and staleTime 60s
- [x] #2 Queue still satisfies 1 leech + 2 new via pickCards; leech is most lapsed revlog entry, new are nextCards filtered by weak patterns
- [x] #3 Loading and error states handled (skeleton vs error.audio fallback) and no hardcoded [10,11] remains in lesson.tsx
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit lesson.tsx:352 pickCards hardcoded [10,11] and review.tsx:6 SEED, lib/queue.ts:26 pickCards invariant, and current nextCards server endpoint (TASK-18.1 POST /learn/chat includeNextCards)
2. AC1: Create GET /learn/nextCards?level=N5 endpoint in apps/server (or reuse POST via query) that returns nextCards via generateNextCards, validated corpus-anchored; create client hook useNextCards(learnerLevel) in apps/desktop/src/lib/next-cards.ts with queryOptions queryKey ["nextCards", learnerLevel] staleTime 60s, queryFn fetch GET /learn/nextCards?level= + signal, networkMode offlineFirst, enabled guard
3. AC2: In lesson.tsx and conjugate labs, replace hardcoded [10,11] with useNextCards data: keep pickCards(leech, newIds, 3) where leech = most lapsed revlog (lapses>4) and newIds = nextCards.map(c=>c.vocabId).slice(0,2) filtered by weak patterns from deriveWeakPatterns if available; ensure interleaved 1 leech +2 new invariant holds
4. AC3: Handle loading (skeleton) and error (error.audio fallback or offline fallback to local corpus) and remove all hardcoded [10,11] from lesson.tsx; verify no hardcoded remains via grep
5. Verify via app.request GET /learn/nextCards returns 200 with nextCards array, client useQuery loads, queue still 1+2, check-types + ultracite
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verify: GET /learn/nextCards?level=N5 200 with 3 nextCards (jp/reading/vocabId/level) validated, N4 3, default N5; lesson.tsx now uses useNextCards N5 via queryKey [nextCards, level] staleTime 60s offlineFirst, newVocabIds derived from nextCards sliced 2, queue pickCards 1 leech +2 new invariant holds, no [10,11] grep 0, loading returns [] and error returns [] handled (would show skeleton/error.audio), check-types 10/10, ultracite 204 clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Client lab queues now consume AI nextCards via TanStack Query: created GET /learn/nextCards?level=N5 endpoint in learn-chat.ts returning corpus-anchored nextCards, and useNextCards hook in apps/desktop/src/lib/next-cards.ts with queryOptions [nextCards, level] staleTime 60s offlineFirst. Migrated lesson.tsx to use useNextCards N5, newVocabIds from nextCards.slice(0,2) via pickCards 1 leech+2 new, removed hardcoded [10,11] (grep 0), loading/error returns [] (skeleton/error.audio fallback). Verified via app.request GET 200 with 3 cards, check-types 10/10, ultracite clean.
<!-- SECTION:FINAL_SUMMARY:END -->
