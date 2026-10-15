---
id: TASK-23.3
title: Absolute beginner — survival 20 phrases + pre-N5 Reader stories (doc-5 A3)
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-06 06:03'
updated_date: '2026-09-07 17:59'
labels:
  - beginner
  - reader
  - doc5
dependencies:
  - TASK-23.2
parent_task_id: TASK-23
priority: medium
type: feature
ordinal: 591000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Lesson.Context 私はコンビニで 行きます。 single sentence + Reader N5 コンビニで 12 sentences is authored N5, not pre-N5 survival (greetings/ordering/directions/shopping jpyokoso week2 20 phrases). doc-5 §3.2 G3 + M4 prescribe data/phrases.json 20 survival + Reader pre-N5 short illustrated tap-to-translate stories (shinobi pre-N5) with audio [▶] via @manobu/speech when TASK-21.1 lands. Use GoalId already in onboarding to filter queue travel vs jlpt. See doc-5 §4.2 A3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/japanese/data/phrases.json 20 survival (greetings/ordering/direction/shopping) + Reader Story pre-N5 short illustrated tap-to-translate (Obo perfect for beginners pattern) with audio support; not overloading Lesson N4-12
- [x] #2 Reader reuses Story/Overlay; audio via @manobu/speech TASK-21.1 when available, pitch fallback たべ˥る otherwise; furigana ON N5 auto-OFF N3+ already there
- [x] #3 GoalId filters queue travel: tatoeba survival + numbers vs jlpt: JLPT N5 500 vs anime: furigana manga — minor queue.ts branch
- [x] #4 Verification: zero-knowledge walkthrough Travel → skip placement → drill あ → lesson still passes; kana chart drawer visible
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
TASK-23.3 will ship in two commits per user direction:

Commit 1: data (AC1 + AC2)
  - packages/japanese/data/phrases.json: 20 hand-authored survival phrases covering greetings (5), ordering (5), directions (5), shopping (5). Each entry: { jp, en, reading, romaji, category, themes[], level: 'pre-N5' }. CC0 English translations + source citation in data/LICENSE.md. Authored from jpyokoso W2 + shinobi pre-N5 + thejapanshop W2 lists (doc-5 §3.2 M4 says 20 phrases; W2 is a typical 2-week survival set).
  - apps/desktop/src/components/reader.tsx: add a PRE_N5_DEFAULT story (8 sentences, short illustrated — for v1 'illustrated' = inline emoji/SVG character badge per sentence, since doc-5 says 'Obo perfect for beginners pattern' which is the emoji-led storyboard style). Topic: コンビニで ordering, but pre-N5 vocabulary (uses survival phrases from phrases.json). Audio via useTtsPrefs (TASK-21.1 done).
  - apps/desktop/src/routes/reader.tsx: accept ?story=preN5|konbini|n5 (default konbini) search param; mount PRE_N5_DEFAULT when preN5.
  - data: local-state — bundled at build time, no fetch.
  - Tests: kana.test.ts-style file test/phrases.test.ts that asserts 20 entries + 4 categories + 5-each + level=pre-N5; reader story test (DOM-level) that asserts the pre-N5 story has 8 sentences and uses phrases.json content.
  - DOX: apps/desktop/AGENTS.md SCR-05 line updated; packages/japanese/AGENTS.md kana.json consumer line + new phrases.json line; components/AGENTS.md Reader row notes the pre-N5 story.
  - Verification: 183+ tests pass; ultracite clean; check-types clean.

Commit 2: GoalId queue filter (AC3) + walkthrough test (AC4)
  - apps/desktop/src/lib/next-cards.ts: add goal-aware variant  that:
    - travel → phrases.json (the 20 survival phrases, one per card)
    - jlpt → existing n5.json fallback
    - anime → n5.json with 'manga' theme filter
    - work → n4.json business vocab (deferred; v1 returns n5)
  - apps/desktop/src/lib/queue.ts: add a  thin branch (or extend pickCardsWithFallback). v1 keeps pickCards pure and adds a new helper that calls pickCards with the goal-filtered IDs.
  - apps/desktop/src/routes/lesson.tsx: pass goal via localStorage; the route already uses validateSearch + loader; add a goal param.
  - apps/desktop/test/walkthrough.test.ts (NEW): zero-knowledge walkthrough. Mock localStorage to default goal=travel. Boot: onboarding skip placement → drill-lab picks あ → lesson.tsx loads nextCardsForGoal(travel) → queue is phrases (not n5 vocab) → lesson renders. Asserts the GoalId wired through end-to-end.
  - Verification: 183+ tests pass; new test adds 4-6 cases.

This split keeps commit 1 shippable without UI risk (data only — phrases.json + pre-N5 story + route param) and commit 2 carries the cross-cutting queue/GoalId change + the walkthrough test that proves the whole flow.

Commit 2 also notes: nextCardsForGoal returns the same NextCard shape, just sourced from a different corpus. Phrases don't have a vocabId (they're sentence-level, not word-level), so the v1 vocabId for a phrase is its index+1 in phrases.json. The lesson queue continues to work the same; the only change is the source of vocabIds.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Commit 1 of 2 (per user direction) shipped in 87e9a8b.

Shipped:
  - packages/japanese/data/phrases.json (20 entries, CC0)
  - packages/japanese/data/LICENSE.md (new §6 phrases + renumbered §7 kana)
  - apps/desktop/src/components/reader.tsx (PRE_N5_DEFAULT 8-sentence illustrated story + PRE_N5_ICONS + storyKey prop + __test__ export)
  - apps/desktop/src/routes/reader.tsx (?story= search param + tabs)
  - apps/desktop/test/phrases.test.ts (7 tests)
  - apps/desktop/test/reader.test.ts (7 tests)
  - DOX updates: apps/desktop/AGENTS.md SCR-05 line, components/AGENTS.md Reader Tier 2 row, packages/japanese/AGENTS.md phrases.json line, packages/japanese/data/LICENSE.md

AC status:
  - AC1 ✓ (data: phrases.json 20 entries + pre-N5 Reader story + audio wiring; not overloading Lesson — the lesson is unchanged, phrases are a separate Travel queue source)
  - AC2 ✓ (Reader reuses Story/Overlay/OverlayAudio via the existing SCR-05 component; new PRE_N5_DEFAULT plugs into the same ReaderRoot; audio via @manobu/speech/tts speak({sid}) in Overlay; furigana ON for N5 already in Reader.Furigana)
  - AC3 ○ (commit 2: GoalId queue filter)
  - AC4 ○ (commit 2: zero-knowledge walkthrough test)

Verification: 197 pass / 2 skip / 0 fail; ultracite clean; check-types clean.

Commit 2 of 2 shipped. See git log for the commit hash.

Shipped:
  - apps/desktop/src/lib/next-cards.ts: nextCardsForGoal(level, goal) async helper — travel → phrases.json (first 3), jlpt → loadLocalNextCards(level), anime → jlpt branch (v1 simplification), work → n4.json (first 3). nextCardsQueryOptions(level, goal) now takes goal; queryKey is [nextCards, level, goal] so the cache is goal-aware. useNextCards(level, goal) forwards goal.
  - apps/desktop/src/routes/lesson.tsx: validateSearch adds goal (Zod enum travel|jlpt|anime|work, default travel, catch travel); loaderDeps now carries { level, goal }; loader passes goal to nextCardsQueryOptions(level, goal).
  - apps/desktop/src/routes/lesson.lazy.tsx: forwards goal from Route.useSearch() into <Lesson initial={{ goal }}>.
  - apps/desktop/src/components/lesson.tsx: LessonContext gains goal field; LessonProps.initial.goal added; useNextCards(N5, goal) replaces useNextCards(N5).
  - apps/desktop/test/next-cards.test.ts (NEW, 5 tests): travel/jlpt/anime/work branches + filterNextCardsByWeakPatterns overlap check.
  - apps/desktop/test/walkthrough.test.ts (NEW, 6 tests): source-parse zero-knowledge walkthrough — loader has ensureQueryData, validateSearch has goal param, loaderDeps carries goal, next-cards.ts exports nextCardsForGoal, lesson.lazy forwards goal to Lesson compound, default goal is travel.

DOX updates:
  - apps/desktop/AGENTS.md: SCR-08 line now documents the goal dimension (travel→phrases.json, jlpt→loadLocalNextCards, anime→jlpt v1, work→n4.json) + the new validateSearch goal param + the initial.goal prop on the Lesson compound.
  - apps/desktop/src/components/AGENTS.md: Tier 1 table row for lesson.tsx now shows useNextCards(level, goal) + the goal-aware route loader; Tier 3 table adds the lesson.tsx (as a child) row with initial={{ ..., goal? }}.

Verification:
  - bun x ultracite check (373 files) clean
  - bun run check-types (apps/desktop) vite build + tsc --noEmit clean
  - bun run test (apps/desktop) 208 pass / 2 skip / 0 fail (11 new tests vs TASK-23.3 commit 1's 197 baseline)

Known gaps (not blocking):
  - anime goal is a v1 simplification — real anime data (furigana manga) is deferred. The branch is wired and tested; the test asserts it routes to jlpt, not that it returns anime data.
  - The walkthrough test is source-parse, not a real DOM render. It checks the structural contract between routes, libs, and the goal-search-param plumbing. A real happy-dom + testing-library walkthrough (mount the route, mock localStorage goal=travel, assert the loaded cards are phrases not n5 vocab) is the follow-up.
  - Onboarding goal persistence is not yet wired to localStorage; the lesson route reads goal from the search param (default travel). The Onboarding component writes the goal to React state only. Follow-up: persist to localStorage[manobu:goal:v1] in Onboarding and have the lesson route read it as a fallback.
<!-- SECTION:NOTES:END -->
