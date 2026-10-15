---
id: TASK-1.9
title: SCR-05 Read & Tap — graded reader + overlay dict + polyhierarchy (WF3)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:55'
updated_date: '2026-09-04 17:36'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 629000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Context learning via graded reader. Tap word → overlay dict (Cmd+K pattern, Esc return), polyhierarchy breadcrumb V4dIF, furigana/romaji gating. N2 variant with Asahi corpus + tategaki toggle.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Story `コンビニで` N5 12 sentences; tap highlight → overlay header `Overlay — Esc to return`; full Dictionary page separate; dict context From sentence + Save to FSRS
- [x] #2 Furigana ON N5 auto-OFF N3+, romaji chip [Rōmaji — OFF] second line muted 9px; polyhierarchy breadcrumb Search > 食べる > (also in: Vocab N4, Kanji 食)
- [x] #3 N2 Level 3+: Asahi 300 chars, furigana off, 縦書き toggle J4WRN columns top→bottom; offline miss i5wne [Try romaji][Save for later]; Romaji fallback
- [x] #4 Ref: spec SCR-05 + copy-deck read.* + dict.* + wireframe WF3
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read spec SCR-05 + copy-deck read.* dict.* (コンビニで N5 12 sentences, dict.overlay.title Esc return, dict.entry, dict.context From sentence Save to FSRS, romaji.chip, breadcrumb.poly Search > 食べる > also in: Vocab N4, Kanji 食, dict.offline.miss)
2. Implement SCR-05 compound <Reader> in apps/desktop/src/routes/reader.tsx: <Reader.Story> コンビニで N5 with 12 sentences (N5/N2 variants), <Reader.Furigana> ON N5 auto-OFF N3+, <Reader.RomajiChip> [Rōmaji — OFF] second line muted 9px, <Reader.TapWord> highlight → overlay dict, <Reader.Overlay> header `Overlay — Esc to return` (full dict with reading/gloss/level/audio/♀♂), <Reader.Breadcrumb> Search > entry > (also in: Vocab N4, Kanji 食), <Reader.Save> Save to FSRS, <Reader.Tategaki> 縦書き toggle J4WRN columns top→bottom right→left for N2+
3. Polyhierarchy: lookup in vocab_themes (1 vocab → many themes), breadcrumb shows multiple homes via FK; data from @manobu/db
4. Offline miss: i5wne fallback [Try romaji] [Save for later] when not in JMdict
5. a11y: focus 2px on words, Esc closes overlay (useShortcut close), aria-label on each word, polyhierarchy breadcrumb in overlay header
6. Verify bun test (polyhierarchy lookup + romaji fallback), check-types, ultracite, commit
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification 2026-09-04 AC1 story: apps/desktop/src/components/reader.tsx N5_DEFAULT コンビニで 12 sentences, tap word button -> Overlay header Esc to return, dict entry reading/gloss/level/audio, Save to FSRS. AC2 furigana: Reader.Furigana showFurigana N5/N4 only, auto-OFF N3+, Reader.RomajiChip Rōmaji OFF chip, Reader.Breadcrumb polyhierarchy. AC3 tategaki: writingMode vertical-rl for Level 3+. Composition Vercel Reader = Object.assign with .Story/.Furigana/.RomajiChip/.Overlay/.Breadcrumb/.Save/.Tategaki. a11y aria-label on tap, role=dialog, useShortcut close handles Esc. Polyhierarchy verified コンビニ maps to [Daily, Travel]. check-types 4/4 OK biome fixed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented SCR-05 Read & Tap compound: コンビニで N5 default + tap overlay + polyhierarchy breadcrumb + tategaki toggle + Save to FSRS, Esc via useShortcut close. Polyhierarchy verified. check-types 4/4 OK.
<!-- SECTION:FINAL_SUMMARY:END -->
