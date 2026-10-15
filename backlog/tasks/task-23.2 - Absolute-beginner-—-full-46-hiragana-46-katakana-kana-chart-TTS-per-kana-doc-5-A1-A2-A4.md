---
id: TASK-23.2
title: >-
  Absolute beginner — full 46 hiragana + 46 katakana + kana chart + TTS per kana
  (doc-5 A1/A2/A4)
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-06 06:03'
updated_date: '2026-09-07 18:03'
labels:
  - beginner
  - kana
  - doc5
dependencies: []
parent_task_id: TASK-23
priority: high
type: feature
ordinal: 590000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Internet consensus (thejapanshop W2 + jpyokoso St.1 1-2w + shinobi 5-7d recognition 2-4w writing) demands 46+46 kana before kanji, week-on/week-on not 92 at once. Manobu ships 5 of 92: onboarding.tsx:192 HIRAGANA_BASIC 5 + drill-lab.tsx:144 choices 4; Dashboard STEPS lists Katakana but no katakana drill in repo. doc-5 §2.1 → §4 A1/A2/A4 prescribe: full gojūon あ→ん 46 + dakuten が ざ だ ば + yōon きゃ + katakana ア→ン 46 with mnemonic map し→tsunami き→key, KanaChart drawer 46+46 with シ/ツ ソ/ン look-alike callout, and wiring TASK-21.1 TTS speak({speed 0.8/1.0, sid ♀/♂}) to DrillLab.Audio [▶] so each kana is heard. Keep 5-char placement skip heuristic but DrillLab spans 46. See backlog/docs/research/doc-5 §§2-4.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/japanese/data/kana.json 46+46+diacritics (CC0 source, source citation) consumed by DrillLab initial.chars; Placement diagnostic either keeps 5 or expands to 8 probe but DrillLab always spans 46
- [x] #2 Katakana DrillLab same Canvas+gradeShape 40px tolerance order+direction + TypeFallback mastery≥90% without drawing; look-alike overlay for シ/ツ ソ/ン
- [x] #3 KanaChart drawer (46+46) with copy-to-input into ListenType Input romaji→kana, not a tour (nihonGO! tour overwhelmed), beside DrillLab.Canvas
- [x] #4 DrillLab.Audio [▶] wired to @manobu/speech speak task tts (TASK-21.1) with 0.8×/1× toggle already in ListenType; romaji gated behind RomajiChip OFF per doc-5 §3.2 G4
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope split on 2026-09-07: AC1+AC4 (hiragana 46 + DrillLab 46-span + DrillLab.Audio TTS) split into TASK-23.2.1; AC2+AC3 (katakana drill + KanaChart drawer + look-alike overlay) split into TASK-23.2.2 (depends on 23.2.1). DOX updates for packages/japanese + apps/desktop belong in each subtask commit, not this split.
<!-- SECTION:NOTES:END -->
