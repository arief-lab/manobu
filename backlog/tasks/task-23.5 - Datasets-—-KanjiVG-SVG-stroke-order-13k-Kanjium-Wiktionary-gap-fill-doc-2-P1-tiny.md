---
id: TASK-23.5
title: >-
  Datasets — KanjiVG SVG stroke order 13k + Kanjium Wiktionary gap-fill (doc-2
  P1/tiny)
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-06 06:03'
updated_date: '2026-09-08 20:24'
labels:
  - kanji
  - datasets
  - doc2
dependencies: []
parent_task_id: TASK-23
priority: medium
type: feature
ordinal: 593000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
KanjiVG 13k SVG 109×109 M/C/S ordered StrokePaths + StrokeNumbers is the stroke source drill-lab ghost 1→2→3 + KanjiDetail hero stepper need (currently TODO KanjiVG ingestion). Kanjium 124k already in data/pitch-accent.json but Wiktionary 12.8k gap-fill via jkindrix pitch-accent-wiktionary.json post-2022 is missing. doc-2 §§2.6-2.7 & §5.3-5.4.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/japanese/scripts/fetch-kanjivg.ts curls kanjivg-YYYYMMDD-main.zip → data/kanjivg/<unicode>.svg (or gzipped kanjivg.jsonl) with SOURCE_SHA + CC BY-SA 3.0 note in data/LICENSE.md
- [x] #2 crates/jlpt-mcp/src/engine.rs new lookup_stroke_order(character) → {svg, strokeCount, strokes:[{id,d}], numbers:[{n,x,y}], elementPath:[radical,element…]} parsing kvg:id + StrokeNumbers
- [x] #3 apps/desktop KanjiVG.tsx 109×109 viewBox 0 0 109 109 stroke-dasharray animation; DrillLab ghost draws next stroke faintly; pen recommended note
- [x] #4 packages/japanese/scripts/fetch-kanji-pitch.ts also overlays pitch-accent-wiktionary.json by word+reading (prefer Kanjium on conflict, provenance source)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data: new packages/japanese/scripts/fetch-kanjivg.ts — downloads the pinned KanjiVG release (r20260714 kanjivg-20260714-main.zip, 13 MB, CC BY-SA 3.0), keeps only the 6,417 kanji that appear in data/kanji.json (probe: all JLPT_waller chars covered; 89 missing grade<=10 are kyujitai whose shinjitai IS covered), strips the XML DOCTYPE/comment header, emits data/kanjivg/kanjivg.jsonl ({c, s} per line, ~4.5 MB gzipped-measured 30.6 MB raw) — single file, not 6.7k loose SVGs. Add section 9 to data/LICENSE.md (SOURCE_SHA pinned, CC BY-SA 3.0 attribution) and a fetch:kanjivg script entry.
2. Pitch gap-fill (AC#4): extend scripts/fetch-kanji-pitch.ts to also download pitch-accent-wiktionary.json (12,788 entries, zero (word,reading) overlap with Kanjium — verified) and merge into data/pitch-accent.json entries with source: 'kanjium'|'wiktionary', Kanjium preferred on conflict; refresh metadata block.
3. MCP: crates/jlpt-mcp build.rs adds kanjivg.jsonl (gzip embed, ~4.5 MB est — inside the sidecar budget, matches sentences.jsonl precedent); types.rs adds StrokeOrderEntry; data.rs parses the JSONL; engine.rs adds lookup_stroke_order(character) -> {svg, strokes, numbers, elementPath} parsing kvg:id + StrokeNumbers groups; main.rs registers the tool; pitch entries gain an optional source field (tool output shape change -> regenerate tests/golden.json in the same commit per crates/jlpt-mcp/AGENTS.md).
4. UI: apps/desktop new lib/kanjivg.ts fetch wrapper (GET /kanji/stroke?character=), server route in apps/server/src/routes/jap-data.ts serving parsed stroke data from data/kanjivg/kanjivg.jsonl (desktop does not bundle the corpus); new components/kanjivg.tsx — 109x109 viewBox SVG, stroke-dasharray CSS animation driven by the existing Hero stepper step state; wire into kanji-detail Hero (replace the TODO placeholder) and expose next-stroke ghost for DrillLab.Canvas.
5. Verification: bun run check-types + check; cargo test -p jlpt-mcp (both feature paths, regenerated golden); live MCP smoke pipe; bun test in apps/desktop for the new component/route tests; manual visual check of stroke animation on /kanji/detail.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Split into 3 slices 2026-09-08 (user-approved structure): TASK-23.5.3 pitch gap-fill (start — tiny, warms the data-contract pipeline), TASK-23.5.1 KanjiVG fetch+data+MCP tool, TASK-23.5.2 UI animation (depends on 23.5.1). Order chosen so the parity-golden regeneration workflow is exercised on the smallest change first.

Slice 0 (TASK-23.5.3, AC#4) done: wiktionary pitch gap-fill merged, source provenance shipped, golden regenerated. Remaining: 23.5.1 (KanjiVG fetch+data+MCP tool → AC#1+#2), 23.5.2 (UI animation → AC#3).

Slice 1 (TASK-23.5.1, AC#1+#2+#3+#4-license) done: KanjiVG data + lookup_stroke_order shipped, +4.2 MB binary. Remaining: 23.5.2 (UI animation → AC#3 UI half).

Slice 2 (TASK-23.5.2, AC#3) done: UI animation + Hero + DrillLab ghost shipped and browser-verified. All three 23.5.x slices complete — TASK-23.5 acceptance criteria fully delivered.

Verification roll-up from the three slices, each with objective evidence: AC#1 fetch-kanjivg.ts (pinned r20260714, CC BY-SA 3.0 in LICENSE.md §9, 6,417 corpus kanji + 208 kana after 23.5.2 scope improvement) — TASK-23.5.1. AC#2 lookup_stroke_order in engine.rs (embedded gz jsonl, binary within sidecar budget, parity golden regenerated both feature paths) — TASK-23.5.1. AC#3 KanjiVg component + Hero stepper + DrillLab ghost, browser-verified on /kanji/detail (食 1→9 animation with wraparound + synced counter) and /learn/drill (あ ghost inside 280×140 canvas); route /api/kanji/stroke streams the 21 MB JSONL without full-parse; bun test 216/0, tsc + ultracite clean — TASK-23.5.2. AC#4 fetch-kanji-pitch.ts merges 124,011 Kanjium + 12,788 Wiktionary = 136,799 with source provenance, Kanjium preferred, cargo test green on default + vaporetto — TASK-23.5.3. Note: desktop route URL is /api/kanji/stroke (server mounts jap-data under /api); pre-existing lib/kanji.ts /kanji 404 tracked as TASK-23.28.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped the KanjiVG stroke-order + Wiktionary pitch-gap-fill datasets task via three completed slices (23.5.1/2/3), refs d9ff9f4-adjacent 23.5.1 commit and b3897ca. Data: packages/japanese/scripts/fetch-kanjivg.ts pinning KanjiVG r20260714 (CC BY-SA 3.0, LICENSE.md §9) into a single 4.2 MB gz data/kanjivg/kanjivg.jsonl covering 6,417 corpus kanji + 208 kana; fetch-kanji-pitch.ts now overlays 12,788 Wiktionary entries onto the 124,011 Kanjium base (136,799 total, source provenance, Kanjium preferred). MCP: lookup_stroke_order embedded + exposed in jlpt-mcp with regenerated parity goldens (default + vaporetto). Desktop: /api/kanji/stroke streaming route, Tier-1 kanjivg query layer, KanjiVg 109×109 dasharray animation wired into kanji-detail Hero (browser-verified: 食 animates 1→9 with wraparound), DrillLab faint-ghost underlay for draw drills (kana included). Bundle never imports the corpus. Verified: browser (hero + drill), bun test 216/0, tsc/ultracite clean, cargo parity green. Follow-up spawned: TASK-23.28 (High, /kanji URL-prefix bug surfacing 23.5.2).
<!-- SECTION:FINAL_SUMMARY:END -->
