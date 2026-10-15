---
id: TASK-23.2.1
title: TASK-23.2.1 — Hiragana 46 kana data + DrillLab 46-span + DrillLab.Audio TTS
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-07 12:48'
updated_date: '2026-09-07 13:14'
labels: []
dependencies: []
parent_task_id: TASK-23.2
ordinal: 584000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Lay the kana foundation: full gojuon (46 hiragana + dakuten + yoon) data file, DrillLab spans the full 46 instead of the current 5, and DrillLab.Audio is wired to @manobu/speech/tts with the 0.8x / 1x toggle already used by ListenType.

Scope:
  - packages/japanese/data/kana.json: 46+46 hiragana+katakana arrays, plus diacritics (dakuten, yoon). CC0 / source-cited per data/LICENSE.md convention. Each entry: char, romaji, rowIndex (a-row..wa-row), columnIndex (a..n), kind (gojuon|dakuten|yoon|katakana|katakana-dakuten|katakana-yoon), mnemonic (English association per doc-5 A2 - shi->tsunami, ki->key, etc).
  - packages/japanese/src/types.ts: KanaEntry type, exported alongside existing types.
  - apps/desktop/src/components/drill-lab.tsx: DrillChar type extended with kind + mnemonic; DrillLabRoot consumes the kana.json via @manobu/japanese/data/kana.json (already exposed by the package exports map).
  - DrillLab.Audio: replace the current placeholder romaji string with the actual kana char; reuse the 0.8/1x speed toggle pattern from ListenType.Audio. The current DrillLab.Audio speaks current.romaji (Latin chars) - bug; should speak current.char.
  - apps/desktop/src/lib/romaji.ts: extend the BASIC map with dakuten/yoon entries so ListenType.Input can also accept romaji for が ざ だ ば etc.

Out of scope (moved to 23.2.2): Katakana DrillLab, KanaChart drawer, look-alike overlay.

Keep this small: one data file, one DrillLab.Audio fix + speed toggle, one DrillLab 46-span, one romaji.ts extension. AC1+AC4 satisfied. AC2+AC3 deferred to 23.2.2.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/japanese/data/kana.json shipped with 46 hiragana + diacritics (dakuten + yoon); shape documented in packages/japanese/AGENTS.md
- [x] #2 DrillLab spans the full 46 hiragana (initial.chars.length === 46)
- [x] #3 DrillLab.Audio [play] speaks current.char (kana), not current.romaji
- [x] #4 DrillLab.Audio has a 0.8x / 1x speed toggle mirroring ListenType.Audio (data-speed attrs on the buttons)
- [x] #5 apps/desktop/src/lib/romaji.ts BASIC map covers the same 46 + diacritics (so ListenType accepts が / ぎゃ / etc)
- [x] #6 packages/japanese/AGENTS.md updated with the kana data shape + source citation
- [x] #7 apps/desktop/AGENTS.md + apps/desktop/src/AGENTS.md updated to reflect DrillLab 46-span + Audio speed toggle
- [x] #8 apps/desktop/test gains a kana dataset shape test (matches the DrillChar extension without breaking existing tests)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification: bun run check-types (apps/desktop) 0 errors; bun run test 148 pass / 0 fail; bun x ultracite check apps/desktop clean. kana.json sanity (python3): 208 entries, 0 duplicates per script, hiragana+katakana gojuon each 46. DrillLab route header now 'Set 1/46'. DrillLab.Audio speaks current.char (was the placeholder-bug current.romaji) with 0.8x/1x speed toggle. Commit c7ac721 on main.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built packages/japanese/data/kana.json (208 entries: 46+46 gojuon + 25+25 dakuten + 33+33 yoon; CC0 mnemonics). Extended DrillChar with optional kind + mnemonic. DrillLab.Audio now speaks the kana itself (fixed the current.romaji placeholder bug) with a 0.8x/1x speed toggle mirroring ListenType.Audio, and shows the mnemonic under the row. drill.tsx consumes the kana.json and DrillLab now spans the full 46 hiragana gojuon. romaji.ts BASIC map extended with 20 dakuten + 33 yoon entries; isValidKana now accepts both scripts. New test/kana.test.ts covers the 46+46 guarantee, dakuten/yoon presence, (char,romaji) uniqueness per script, and the legacy DrillChar backward compat. DOX pass on packages/japanese/AGENTS.md, apps/desktop/AGENTS.md, apps/desktop/src/AGENTS.md. Verification: bun run check-types 0 errors (apps/desktop), bun run test 148 pass / 0 fail, bun x ultracite check apps/desktop clean. Commit c7ac721 on main.
<!-- SECTION:FINAL_SUMMARY:END -->
