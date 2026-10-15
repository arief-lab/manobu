---
id: TASK-23.5.2
title: >-
  KanjiVG UI — stroke animation component + Hero wiring + DrillLab ghost
  (TASK-23.5 AC#3)
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-08 17:40'
updated_date: '2026-09-08 20:09'
labels:
  - kanji
  - frontend
  - doc2
dependencies:
  - TASK-23.5.1
parent_task_id: TASK-23.5
priority: medium
type: feature
ordinal: 561000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 2 of TASK-23.5 (doc-2 §5.3): new apps/desktop/src/components/kanjivg.tsx — 109x109 viewBox SVG component that renders StrokePaths in stroke order with stroke-dasharray CSS animation driven by the existing kanji-detail Hero stepper step state (replacing the current TODO placeholder note 'Stroke paths pending KanjiVG ingestion'); exposes next-stroke path for DrillLab.Canvas ghost drawing. Desktop fetches stroke data via a thin lib/kanjivg.ts wrapper over a new server route GET /kanji/stroke?character= in apps/server/src/routes/jap-data.ts (server reads data/kanjivg/kanjivg.jsonl from disk — desktop does NOT bundle the corpus, per lib/kanji.ts server-boundary convention). Pen-recommended hint preserved from spec.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 kanji-detail Hero renders the KanjiVG SVG and the play button animates strokes 1..N sequentially (visual verification on /kanji/detail); step counter matches drawn strokes
- [x] #2 GET /kanji/stroke?character=食 returns parsed stroke data (strokes+numbers); desktop bundle does not import kanjivg.jsonl (no size regression)
- [x] #3 DrillLab.Canvas ghost mode draws the next stroke faintly behind the user's strokes
- [x] #4 bun run check-types + check + bun test in apps/desktop pass; route-loaders test still green if a loader is added
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Server: apps/server/src/routes/jap-data.ts adds GET /kanji/stroke?character= reading data/kanjivg/kanjivg.jsonl from disk (same DATA_DIR pattern), parses {c,s} lines, extracts strokes/numbers/elementPath server-side (same parsing logic shape as engine.rs), 404 on miss; zod-validated single char.
2. Desktop: lib/kanjivg.ts fetch wrapper (VITE_SERVER_URL pattern from lib/kanji.ts) + kanjivgQueryOptions/useKanjiStrokes in kanjivg-queries.ts (TanStack tier-1 convention); route loader for /kanji/detail extended via ensureQueryData if needed per route-loaders test.
3. UI: components/kanjivg.tsx — SVG viewBox 0 0 109 109, renders strokes with pathLength=1 + stroke-dasharray CSS animation; visible strokes = step count (controlled by Hero stepper state); component follows Object.assign(Root,{Sub}) + Tier contract.
4. Hero: replace TODO placeholder note with KanjiVG render; play button steps 1..N; step counter wired to visible strokes; keep pen note.
5. DrillLab: ghost mode draws next stroke's d faintly (stroke opacity) behind user canvas input.
6. Verify: check-types + ultracite + bun test in desktop; browser visual verification on /kanji/detail; route-loaders test green; no kanjivg.jsonl import in desktop bundle (grep guard via existing route-loaders-style test if applicable).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation: browser-verified on Vite dev + API server. Hero: /kanji/detail?character=食 renders KanjiVg SVG, play button steps strokes 1→9 with dasharray draw animation (counts verified: 1→2→…→9→wrap 0), step counter matches (9/9, 0/9), pen note replaces TODO. DrillLab /learn/drill: あ ghost underlay inside the 280×140 canvas (fixed an overflow — SVG needed explicit h/w + preserveAspectRatio), 3 strokes rendered faint, numeric-fallback text swaps to shape hint. bun test 216 pass/0 fail; route-loaders green; tsc + ultracite clean on all touched files; no kanjivg.jsonl import in desktop bundle (only comments reference it). Server route live-verified: 食 → 9 strokes, 頑 → 13 + elementPath, 龘 → 404. BUG FOUND during verification: JS indexOf(fromIndex) returns ABSOLUTE index — at = searchFrom + rel double-counted (Rust tag[from..].find is slice-relative, so the Rust version is correct); fixed to at = rel with an explanatory comment. Pre-existing finding (out of scope, flagged): lib/kanji.ts builds /kanji URLs without the /api prefix — /kanji 404s live, so existing KanjiDetail readings/vocab silently fall back. Also extended fetch-kanjivg.ts to include the 208 kana (all covered upstream) so the drill ghost works — corpus now 6,625 lines, still 4.2 MB gz.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped the KanjiVG UI slice. Server: GET /api/kanji/stroke in jap-data.ts (streaming readline over the 21 MB JSONL, server-side stroke/number/element-path parsing with a boundary-anchored attribute scanner, 404 on miss). Desktop: lib/kanjivg.ts + kanjivg-queries.ts (Tier 1 TanStack), components/kanjivg.tsx (pathLength=1 + dashoffset keyframe animation), Hero wiring replacing the TODO placeholder, DrillLab.Canvas faint SVG ghost underlay (kana included — fetch filter extended to kana.json's 208 chars, all covered upstream). Verified in-browser: 食 hero animates 1→9 with wraparound and synced counter; drill あ ghost renders inside the canvas; bun test 216/0; tsc + ultracite clean; desktop bundle has no corpus import. Two bugs found+fixed during verification: (1) JS indexOf absolute-index double-count in attribute() (Rust twin unaffected — different find semantics); (2) ghost SVG overflow for lack of explicit dimensions. Pre-existing /kanji-vs-/api/kanji 404 in lib/kanji.ts flagged for a follow-up task.
<!-- SECTION:FINAL_SUMMARY:END -->
