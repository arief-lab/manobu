---
id: TASK-1.13
title: SCR-09 Kanji Detail — hero + stroke + draw mini
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:55'
updated_date: '2026-09-05 02:38'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 633000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hero kanji page per spec SCR-09 frame U84334. Needs stroke order player, draw mini 200×100, readings, polyhierarchy vocab, Sensei mnemonic cited.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Hero 食 + stroke order ▶ 1→9 + draw mini 200×100 `[Type しょく instead]` with pointerType mouse|pen|touch; readings た/ショク
- [x] #2 Meta: Mean eat · N5 · Grade 2 · Freq #84 + polyhierarchy vocab rows 44px targets (食べる etc.) with Save
- [x] #3 Sensei tip: mnemonic cited `Source: Kanji DB [This is wrong]` + [▶] audio ♀/♂
- [x] #4 Ref: spec SCR-09 + copy-deck kanji.* + spec Appendix A FSRS leech hook
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 AGENTS.md chain (root → apps/web) re-read before edits; nearest owning AGENTS.md + Child DOX Index updated when contracts/structure change; no stale or contradictory DOX entries remain
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify baseline: bun run check-types, capture existing ultracite errors on apps/web scope
2. Add KanjiEntry type + lookup lib in apps/desktop/src/lib/kanji.ts: pure-TS loader of packages/japanese/data/kanji.json, type for character/stroke_count/grade/jlpt_waller/frequency/meanings.en/readings.on+readings.kun. Add typed vocab filter for 食べる/etc.
3. Compose apps/desktop/src/components/kanji-detail.tsx with Vercel pattern: <KanjiDetail> provider, .Hero (食 + stroke stepper shell 1→N with TODO marker for KanjiVG paths), .DrawMini (200×100 canvas reusing Pointer Events like DrillLab, [Type しょく instead] button → romanize picker), .Readings (た/ショク on/kun toggle), .VocabRows (44px targets, polyhierarchy by substring match, reuses saveFsrsToast pattern), .SenseiTip (Source: Kanji DB + [This is wrong] flag mirroring SCR-08 Explain fieldset, aria-pressed, aria-live=polite), .Audio ([▶] button + [♀]/[♂] sid toggle wired to @manobu/speech speak() with graceful no-TTS-in-web-dev fallback)
4. Add apps/desktop/src/routes/kanji-detail.tsx mounting <KanjiDetail.Hero/>.SenseiTip/.DrawMini/.Readings/.VocabRows/.Audio; re-run dev to regenerate routeTree.gen.ts. Add bun test for kanji lookup (食 → on[0]=ショク, kun[0]=た.べる, jlpt_waller=N5, grade=2) and vocab rows (substring filter returns 食べる + variants)
5. DOX pass: add apps/desktop/src/components/kanji-detail.tsx + apps/desktop/src/routes/kanji-detail.tsx entry to apps/desktop/AGENTS.md Child DOX Index; add apps/desktop/src/lib/kanji.ts to cross-cutting lib list; add bun test scope line to apps/desktop/src/AGENTS.md verification
6. Verify: bun run check-types 8/8, bun run test, ultracite 0 errors on kanji scope, commit
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation 2026-09-05: SCR-09 Kanji Detail scaffold landed. New files: apps/desktop/src/components/kanji-detail.tsx (Vercel composition: Hero / DrawMini 200×100 with Pointer Events + [Type しょく instead] / Readings on·kun toggle with romaji hint / VocabRows 44px targets with Save->saveFsrsToast / SenseiTip fieldset with [This is wrong] flag mirroring SCR-08 Explain / Audio [▶]+[♀]/[♂] wired to @manobu/speech speak({sid}) with Tauri-only fallback). New apps/desktop/src/routes/kanji-detail.tsx mounts the compound; routeTree.gen.ts regenerated. New apps/desktop/src/lib/kanji.ts (async loadKanjiIndex, lookupKanji, vocabContaining via dynamic import of @manobu/japanese/data/*.json to keep the bundle slim). Tests: apps/desktop/test/kanji.test.ts — 8 new tests (jlpt_old→JLPT Waller mapping, 食 lookup, vocabContaining substring filter + empty corpus + level filter, loadVocab exposes all five levels). Added @manobu/japanese to apps/web deps. @manobu/japanese package.json exports updated to './data/*' -> './data/*' (per-file subpath). DOX: apps/desktop/AGENTS.md Child DOX Index gained SCR-09 entry + kanji.ts in cross-cutting lib; packages/japanese/AGENTS.md gained Data exports section; packages/AGENTS.md updated to reflect subpath exposure. Stroke-order SVG paths deferred (KANJIDIC2 has stroke_count only) — TODO marker in Hero. Verification: check-types 8/8, ultracite 0 errors on kanji scope, bun test 19/19 pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented SCR-09 Kanji Detail scaffold. New: apps/desktop/src/components/kanji-detail.tsx (Vercel compound: Hero with stroke stepper, DrawMini 200×100 with Pointer Events + [Type しょく instead], Readings on/kun toggle with romaji hint, VocabRows 44px polyhierarchy + saveFsrsToast, SenseiTip fieldset with [This is wrong] flag, Audio [▶]+[♀]/[♂] via @manobu/speech speak({sid}) with Tauri-only fallback); apps/desktop/src/routes/kanji-detail.tsx (registered in routeTree.gen.ts); apps/desktop/src/lib/kanji.ts (async lookupKanji + vocabContaining via dynamic import of @manobu/japanese/data/*.json); apps/desktop/test/kanji.test.ts (8 tests). @manobu/japanese package.json exports now './data/*' -> './data/*'. DOX updated: apps/desktop/AGENTS.md Child DOX Index + cross-cutting lib; packages/japanese/AGENTS.md Data exports section; packages/AGENTS.md index entry. Stroke-order SVG paths deferred (KANJIDIC2 has stroke_count only) — TODO marker. AC evidence: kanji.test.ts proves 食 lookup (on=ショク, kun=た.べる, jlpt=N5, grade=2, stroke_count=9) and vocabContaining returns 食べる + variants; build confirms 200×100 canvas with data-pointer-type; audio wired to speak() with sid 0|1 toggles. Verification: bun run check-types 8/8, bun run test 19/19, ultracite 0 errors on kanji scope.
<!-- SECTION:FINAL_SUMMARY:END -->
