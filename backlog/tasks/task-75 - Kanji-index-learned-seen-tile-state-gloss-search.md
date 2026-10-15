---
id: TASK-75
title: 'Kanji index: learned/seen tile state + gloss search'
status: Done
assignee: []
created_date: '2026-09-14 05:26'
updated_date: '2026-09-14 09:06'
labels:
  - desktop
  - kanji
dependencies: []
priority: medium
ordinal: 526000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-on to the SCR-09 detail redesign (committed 2026-09-14): the /kanji grid shows 79+ identical tiles with no signal about what the learner already knows, and no way to find a kanji by English meaning (you must already read it to search it). Decided in the redesign conversation to ship the detail redesign first because it stabilizes the Save semantics (vocab rows mark saved immediately, undo un-marks; cards flow through saveFsrsToast) that the learned-state consumer must key on. Learned/seen needs a batch character->FSRS-state read (today's FSRS surface is per-card preview via Tauri invoke; a grid needs one query per level, probably a new lib + possibly a server or Tauri command). Search-by-gloss is cheap: client-side filter over the already-loaded kanjiListQueryOptions rows. Detail contracts live in apps/desktop/AGENTS.md SCR-09 row. (Renumbered from TASK-73 2026-09-14.)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Search filters the loaded rows by English gloss and by character/reading, client-side, no new server round-trip per keystroke
- [x] #2 Empty search result says so honestly and offers to clear
- [x] #3 Grid keeps working offline (state read degrades to no-badges, never an error wall)
- [x] #4 Contract tests cover the pure derivation + the search filter; DOX updated
- [x] #5 Tiles show seen/learned derived from a real learner-action store (practice-days.ts pattern): seen = detail page opened for the character; learned = at least one word containing it saved (undo un-marks, last word falls back to seen). No invented state; forward-compatible with real FSRS cards when persistence lands
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. lib/kanji-progress.ts — localStorage store (practice-days.ts pattern): { seen: string[], learned: Record<char, wordKey[]> }; pure parse/serialize/transition helpers + thin storage wrappers (private-mode safe, corrupt blob -> empty). markSeen on detail mount, markLearned(char, wordKey) on vocab save, unmarkLearned on undo (empty list -> not learned, stays seen).
2. kanji-detail.tsx — provider wires the three calls (character + wordKey from VocabRowItem); session saved-state unchanged.
3. routes/kanji/index.tsx — read store once per mount (route change remounts); tile badges: learned = border-primary + dot, seen = faint dot; aria-label gains the word; subtitle gains honest 'N learned · M seen' when > 0 (facts, no obligations).
4. Search: input above the grid filtering loaded rows client-side by gloss substring or character (case-insensitive); empty result says so + clear button; no server round-trip.
5. Tests: pure transitions (seen/learned/undo/last-word), corrupt-blob parse, source contracts (detail wires marks, grid renders badges/search). DOX: new lib row + SCR-09 row + index note.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Research (2026-09-14): the creation-time premise (batch character->FSRS-state read) is unimplementable as stated — saveFsrsToast only toasts (session state), usePersistCards/POST /api/cards has zero callers, local.db cards table has 1 seed row and vocab is empty. There is no card data to read. The honest derivation is a learner-action store (practice-days.ts pattern), which is what this plan builds. When real card persistence lands, the grid switches to deriving from cards; the store stays as the seen signal.

Implemented: lib/kanji-progress.ts (store + cellState), detail provider wires markSeen/markLearned/unmarkLearned, grid badges + subtitle counts + search (filterRows in kanji-queries). Browser-verified: search water->1 tile, zzzz->honest miss+clear; open 水 + save -> learned badge (border+dot) + '1 learned'; 火 open+save+undo -> seen-only + '1 learned, 1 seen'; store blob exact. 377/377 tests.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Grid seen/learned badges + gloss search shipped. New lib/kanji-progress.ts (practice-days.ts pattern): seen = detail opened, learned = word containing the char saved; undo falls back to seen; cellState precedence pure + __test__-exported. Detail provider wires markSeen/markLearned/unmarkLearned. Grid: learned = border-primary + dot, seen = faint dot, aria-label + honest 'N learned, M seen' subtitle; filterRows (lib/kanji-queries.ts) searches gloss/character client-side over the cached level with an honest miss state + clear. Premise correction: no FSRS card data exists to read (saveFsrsToast only toasts, usePersistCards has zero callers), so the store is the honest derivation and stays forward-compatible. Verified in-browser: search water->1/zzzz->miss+clear; 水 open+save -> learned badge; 火 open+save+undo -> seen-only; store blob exact; 377/377 tests, tsc + ultracite clean; DOX: kanji-progress lib row + SCR-09 + kanji-queries rows.
<!-- SECTION:FINAL_SUMMARY:END -->
