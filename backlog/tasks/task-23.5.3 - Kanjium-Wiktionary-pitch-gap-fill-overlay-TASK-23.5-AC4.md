---
id: TASK-23.5.3
title: Kanjium Wiktionary pitch gap-fill overlay (TASK-23.5 AC#4)
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-08 17:40'
updated_date: '2026-09-08 18:23'
labels:
  - datasets
  - pitch-accent
  - doc2
dependencies: []
parent_task_id: TASK-23.5
priority: medium
type: feature
ordinal: 562000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 0 of TASK-23.5 (doc-2 §5.4/§2.7): extend packages/japanese/scripts/fetch-kanji-pitch.ts to also download jkindrix pitch-accent-wiktionary.json (12,788 entries, Kaikki.org CC BY-SA 4.0) and merge into data/pitch-accent.json entries keyed by (word, reading) — verified ZERO overlap with the Kanjium 124,011 set (upstream already deduped), so the merge is a pure additive union; still set source: 'kanjium'|'wiktionary' per entry and prefer Kanjium on any future conflict. Metadata block refreshed (count, sources, coverage_date). Contract: PitchAccentEntry gains an optional source field -> types.rs serde + tool output shape change -> regenerate crates/jlpt-mcp tests/golden.json in the same commit (crates/jlpt-mcp/AGENTS.md rule).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 bun run fetch:kanji-pitch merges both sources: entries = 124,011 Kanjium + 12,788 Wiktionary = 136,799, each entry carries source field
- [x] #2 jq sanity: every wiktionary-sourced entry has word+reading+pitch_positions+source=wiktionary; no (word,reading) duplicates within the merged file
- [x] #3 cargo test -p jlpt-mcp passes on default AND --features vaporetto with the regenerated tests/golden.json
- [x] #4 data/LICENSE.md section 4 notes the Wiktionary/Kaikki provenance addition
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extend scripts/fetch-kanji-pitch.ts: fetch pitch-accent-wiktionary.json (same BASE jkindrix raw URL), merge additively into pitch-accent entries — map both sources to a common shape {word, reading, pitch_positions, mora_count, source}, Kanjium first then append Wiktionary entries not already present by (word,reading) key, source field 'kanjium'|'wiktionary'. Refresh metadata (count 136,799, both sources + licenses, coverage_date per-source).
2. crates/jlpt-mcp/src/types.rs: PitchAccentEntry + optional source field (camelCase output 'source', snake_case alias) — optional keeps deserialization tolerant.
3. Regenerate tests/golden.json (tool output now includes source on pitch tools only), verify cargo test on default + --features vaporetto.
4. data/LICENSE.md §4: add Wiktionary (Kaikki.org, CC BY-SA 4.0) provenance line.
5. Verify: jq duplicate-key check on merged file; cargo test; live MCP smoke of lookup_pitch_accent.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation: bun run fetch:kanji-pitch idempotent (124,008 kanjium + 12,788 wiktionary = 136,796; 3 upstream kanjium self-dup rows deduped — βカロテン ships ×4 upstream; 0 wiktionary overlaps); jq duplicate-key check = 0. cargo test passes on default AND --features vaporetto with regenerated golden. Live MCP smoke: lookup_pitch_accent('AIDS') → source:wiktionary row with description え↓ーず atamadaka; stderr shows pitch 136796 loaded. bun x ultracite check clean after fix; bun run check-types clean. kanji.json byte-identical to previous commit (fetch script still writes it unchanged).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extended fetch-kanji-pitch.ts to merge the jkindrix Wiktionary pitch gap-fill (12,788 entries, kaikki.org CC BY-SA 4.0) into data/pitch-accent.json as a pure additive union over Kanjium (124,008 after deduping 3 upstream self-duplicate rows) with per-entry source provenance (kanjium|wiktionary) and refreshed metadata. PitchAccentEntry gained an optional source field in crates/jlpt-mcp (serde default + skip_serializing_if). Contract impact handled: parity golden pitch keys regenerated from the live binary (はし hit-set widened 5→6 by the wiktionary はし row). Verified: idempotent fetch, zero (word,reading) duplicates via jq, cargo test green on default AND --features vaporetto, live MCP smoke returning wiktionary-sourced entries with descriptions, ultracite + tsc clean. data/LICENSE.md §4 records the Kaikki.org/Wiktionary provenance; both AGENTS.md files updated.
<!-- SECTION:FINAL_SUMMARY:END -->
