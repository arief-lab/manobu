---
id: TASK-23.5.1
title: >-
  KanjiVG fetch script + data/kanjivg.jsonl + lookup_stroke_order MCP tool
  (TASK-23.5 AC#1+#2)
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-08 17:40'
updated_date: '2026-09-08 18:52'
labels:
  - kanji
  - datasets
  - doc2
dependencies: []
parent_task_id: TASK-23.5
priority: medium
type: feature
ordinal: 560000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 1 of TASK-23.5 (doc-2 §5.3/§2.6): new packages/japanese/scripts/fetch-kanjivg.ts downloading the pinned KanjiVG release (r20260714 main.zip, 13 MB, CC BY-SA 3.0), filtered to the 6,417 kanji present in data/kanji.json (all jlpt_waller chars covered; 89 missing grade<=10 are kyujitai whose shinjitai IS covered — main.zip not all.zip), DOCTYPE/comment header stripped, emitted as ONE data/kanjivg/kanjivg.jsonl ({c,s} per line, measured ~30.6 MB raw / ~4.5 MB gzip) instead of 6.7k loose SVGs. crates/jlpt-mcp: build.rs embeds the jsonl (same pattern as sentences.jsonl), types.rs adds StrokeOrderEntry, data.rs parses JSONL, engine.rs adds lookup_stroke_order(character) -> {svg, strokes:[{id,d}], numbers:[{n,x,y}], elementPath}, main.rs registers the tool. data/LICENSE.md gains a KanjiVG section with pinned SOURCE_SHA.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 bun run fetch:kanjivg produces data/kanjivg/kanjivg.jsonl with exactly the 6,417 corpus-covered kanji, each line parseable SVG with StrokePaths paths in stroke order + StrokeNumbers text
- [x] #2 cargo build --features vaporetto succeeds with the jsonl embedded and binary size increase stays within ~5 MB
- [x] #3 lookup_stroke_order('食') returns 9 strokes (s1..s9 with d attributes) and 9 stroke numbers matching the upstream SVG; unknown character returns empty/null gracefully
- [x] #4 data/LICENSE.md section records KanjiVG r20260714, CC BY-SA 3.0, attribution + share-alike note
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation: fetch:kanjivg produced 6,417 lines each carrying StrokePaths + StrokeNumbers groups (grep audit 6417/6417); gzip 4.2 MB. Release binary 18.13 MB vs 13.9 baseline = +4.2 MB, inside the ≤5 MB AC budget. MCP smoke on release binary: lookup_stroke_order('食') → 9 strokes (kvg:098df-s1..s9, real d path data), numbers 1..9, elementPath [食]; lookup_stroke_order('頑') → 13 strokes, elementPath [頑,元,二,儿,丿,頁,貝,目,八]; lookup_stroke_order('龘') → null (graceful miss). cargo test green on default AND --features vaporetto (golden untouched — new tool, no shape change to existing outputs). One bug found+fixed by the smoke test: attribute() substring matching returned the id for d (d=\ matches inside id=\) — fixed with boundary-anchored scan. ultracite + tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped KanjiVG stroke-order data pipeline + MCP tool. scripts/fetch-kanjivg.ts (pinned r20260714, corpus-filtered to 6,417 kanji, prolog-stripped SVGs as one JSONL {c,s}) + package.json fetch:kanjivg entry. crates/jlpt-mcp: build.rs embeds kanjivg/kanjivg.jsonl (+4.2 MB gz); data.rs parses the JSONL into kanjivg_by_character; types.rs adds StrokePath/StrokeNumber/StrokeOrderEntry; engine.rs adds lookup_stroke_order with a boundary-anchored attribute parser; main.rs registers the tool. Verified: both cargo test paths green (golden untouched), MCP smoke correct for 食 (9 strokes), 頑 (13 strokes, 頑→元+頁 decomposition), graceful null on 龘; release binary 18.13 MB (+4.2, inside budget); ultracite + tsc clean. data/LICENSE.md §9 carries the CC BY-SA 3.0 attribution; both AGENTS.md files updated.
<!-- SECTION:FINAL_SUMMARY:END -->
