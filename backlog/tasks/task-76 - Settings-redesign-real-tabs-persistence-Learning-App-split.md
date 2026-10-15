---
id: TASK-76
title: 'Settings redesign: real tabs, persistence, Learning/App split'
status: Done
assignee: []
created_date: '2026-09-14 09:55'
updated_date: '2026-09-14 11:47'
labels:
  - desktop
  - settings
dependencies: []
priority: medium
ordinal: 524000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Diagnosis (2026-09-14, browser-verified): the four tab pills are decorative — every section (Model/Fsrs/Correction/Voice/Privacy/About) renders unconditionally, so clicking a tab only moves the URL + aria-pressed; 'Appearance' has zero content (single theme per DESIGN.md, no toggle allowed); settings never persist (lib/settings.ts: 'v1 keeps state in memory'); copy is spec-voice (fallback chain, keychain never SQLite, 21-param dumps, UUIuC) mixing three audiences at equal weight. Plan: (1) fix layer — gate on activeTab, drop appearance from enum/schema/pills, localStorage persistence; (2) Learning tab — retention with live sentence, correction example cards, voice row + preview, level+goal in, Advanced collapsed; (3) App tab — infra panels with one desktop-only note. approved by user after suggestion review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tabs are real: sections gate on activeTab; clicking a tab changes only that tab's content
- [x] #2 Appearance tab removed (one theme, no content); route schema + pills + type updated together
- [x] #3 Settings persist across restart (localStorage interim, practice-days pattern; corrupt reads degrade to defaults)
- [x] #4 Learning tab: retention with live honest feedback sentence, correction style as example cards, voice row with preview, level + goal moved in; Advanced FSRS collapsed inside Learning
- [x] #5 App tab: model/storage/speech/cron/privacy/about; one consolidated desktop-only note, not per-section
- [x] #6 No spec-voice strings in user copy (fallback chain dump, keychain never SQLite, param lists, UUIuC); no em dash in new strings (R-02)
- [x] #7 Tests: tab gating + persistence roundtrip + source guards for deleted copy; DOX updated; fallow new-only gate stays green
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All three steps shipped in 57ed226. Tabs are real (Settings.Section gates on activeTab; browser: App click swaps content both ways; old ?tab=model deep links catch to learning). Appearance deleted from enum/pills/type. Persistence: lib/settings.ts localStorage store (validated reads, corrupt -> defaults; browser: 96% retention + Tell-first + N3 survive reload, blob exact); TtsProvider seeds+subscribes. Learning tab: honest slip-odds sentence (1 in 25 at 96%), example correction cards, voice radios + state-based preview, Level/Goal pickers over the same stores, Advanced collapsed. App tab: Answer source + ONE desktop-only note + SpeechModels/ScheduledTasks/Privacy/About. Spec-voice copy gone (source guards; em-dash audit clean for new strings). 387/387 tests, tsc+ultracite clean, fallow new-only gate passes (0 introduced; isChromeFreePath tabled cyc 10->2, dead exports demoted, useTtsPrefsContext deleted). Chrome-free frame added (← desk pill, verified lands on /dashboard). DOX: SCR-11 row rewritten, settings.ts/tts-voice/chromeFree/features rows updated.
<!-- SECTION:FINAL_SUMMARY:END -->
