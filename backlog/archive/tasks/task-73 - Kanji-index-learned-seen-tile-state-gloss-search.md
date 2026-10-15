---
id: TASK-73
title: 'Kanji index: learned/seen tile state + gloss search'
status: To Do
assignee: []
created_date: '2026-09-14 05:12'
labels:
  - desktop
  - kanji
dependencies: []
priority: medium
ordinal: 510000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-on to the SCR-09 detail redesign (committed 2026-09-14): the /kanji grid shows 79+ identical tiles with no signal about what the learner already knows, and no way to find a kanji by English meaning (you must already read it to search it). Decided in the redesign conversation to ship the detail redesign first because it stabilizes the Save semantics (vocab rows mark saved immediately, undo un-marks; cards flow through saveFsrsToast) that the learned-state consumer must key on. Learned/seen needs a batch character->FSRS-state read (today's FSRS surface is per-card preview via Tauri invoke; a grid needs one query per level, probably a new lib + possibly a server or Tauri command). Search-by-gloss is cheap: client-side filter over the already-loaded kanjiListQueryOptions rows. Detail contracts live in apps/desktop/AGENTS.md SCR-09 row.
<!-- SECTION:DESCRIPTION:END -->
