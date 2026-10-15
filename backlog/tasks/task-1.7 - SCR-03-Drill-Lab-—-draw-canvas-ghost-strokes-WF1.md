---
id: TASK-1.7
title: SCR-03 Drill Lab — draw canvas + ghost strokes (WF1)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:54'
updated_date: '2026-09-04 14:46'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 644000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Kana recognition→production. Spec SCR-03 + WF1 require 280×140 canvas with ghost 1→2→3, Pointer Events (mouse/pen/touch), tolerance 40px order+direction, plus equal-path Type fallback.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Canvas 280×140: Pointer Events, ghost strokes, tolerance not pixel-perfect; pen smoother note; focus ring 2px accent; text alternative via [Type instead]
- [x] #2 Mastery ≥90% achievable without drawing; choices あ/い/う; progress 3/5 Next char hint; correct flash + wrong `Good try — that s い, this is あ` retry
- [x] #3 Audio [▶] + mic missing → skip gracefully; copy-deck draw.* + drill.* strings used
- [x] #4 Ref: nihongoai-spec-v1.md SCR-03 + wireframes WF1 + copy-deck drill.*
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read spec SCR-03 + copy-deck draw.* + drill.* strings (ghost 1→2→3, Draw here mouse/pen/touch, drill.progress, drill.wrong, drill.correct)
2. Implement SCR-03 compound <DrillLab> in apps/desktop/src/routes/drill.tsx: <DrillLab.Canvas> 280×140 with Pointer Events (mouse/pen/touch) + ghost strokes 1→2→3 overlay, tolerance 40px order+direction (not pixel-perfect), <DrillLab.TypeFallback> 4-choice picker あ/い/う/え (equal path), <DrillLab.Audio> [▶] + mic-missing banner, <DrillLab.Mastery> progress 3/5 with Next char
3. Wire to @manobu/db cards via createUserDb: load set 1/5 vocab N5 kana, count correct, compute mastery ≥90% achievable via type-mode (no drawing required), persist card via fsrs_preview
4. Tauri command: drill_get_set (returns 5 chars from vocab level=N5), drill_grade (writes revlog grade 1-4)
5. a11y: focus 2px accent on canvas via Tab, type-mode text alternative, role=button on choice chips, aria-live=polite on correct/wrong, error pattern red only
6. Verify bun test (ghost stroke shape OK, type-mode ≥90% mastery, mic-missing fallback), check-types, ultracite, commit
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification 2026-09-04:
- AC1 canvas 280×140: apps/desktop/src/components/drill-lab.tsx Canvas with Pointer Events onPointerDown/onPointerMove (mouse/pen/touch), ghost 1→2→3, focus tabIndex=0, [Type instead] fieldset, GHOST_TOLERANCE_PX=40
- AC2 mastery: TypeFallback 4 choices あ/い/う/え equal-path grade Good(3) on match, Mastery progress set/total correct percent, hint Next char
- AC3 audio: Audio [▶] + mic-missing banner data-testid=drill-mic-missing
- AC4 ref: drill.* copy strings (Set 1/5 3/5 mastered, [Type instead], [▶] audio, Progress 3/5)
- composition: DrillLab = Object.assign with .Canvas/.TypeFallback/.Audio/.Mastery (Vercel pattern)
- a11y: aria-label on canvas, aria-pressed/aria-live=polite on choices, fieldset/legend for type group, tabIndex on canvas, focus-visible:outline-ring
- gradeShape verified via bun: close=OK, far=fail, short=fail
- checks: bun check-types 4/4 OK, biome fixed
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented SCR-03 Drill Lab compound: 280x140 canvas with Pointer Events + ghost 1->2->3 + 40px tolerance, type fallback 4 choices fieldset equal-path, audio + mic-missing banner, mastery progress. gradeShape verified close/far/short. check-types 4/4 OK.
<!-- SECTION:FINAL_SUMMARY:END -->
