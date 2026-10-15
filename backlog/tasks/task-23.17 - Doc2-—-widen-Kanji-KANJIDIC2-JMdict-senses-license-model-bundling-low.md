---
id: TASK-23.17
title: Doc2 — widen Kanji/KANJIDIC2 + JMdict senses + license/model bundling (low)
status: To Do
assignee: []
created_date: '2026-09-06 06:07'
labels:
  - kanji
  - datasets
  - doc2
dependencies: []
parent_task_id: TASK-23
priority: low
type: feature
ordinal: 888000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Doc-2 §2.2/§2.1 notes: KANJIDIC2 13,108 fields grade G1-G10, freq, radical classical/nelson_c, dic_number nelson_c/n/halpern_njecd/heisig…, query_code skip/sh_desc/four_corner/deroo currently flattened to grade/freq/radical only in kanji.json via jkindrix; JMdict senses flattened to string meaning dedup ≤8 + coarsePos ≤3 but sense[].field/misc/dialect lost. License: with-model artifacts add BSD-3 (MODEL_LICENSES.md) alongside CC BY-SA 4.0 share-alike. Binary size: sentences 250k×100B 25MB gz2-3MB, KanjiVG 13k×2KB 26MB gz6MB — keep path-based model not embedded for sidecar ~5MB opt-level z lto strip. See doc-2 §4 table and §6 risks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Expose KANJIDIC2 rich indices in kanji.json + src/types.rs KanjiEntry: dic_number + query_code (skip/four_corner/deroo) for Text grammar didactic How to look up unknown kanji; update build.rs + golden.json together
- [ ] #2 MCP lookup_kanji returns grade/freq/radical + dic refs; search uses vaporetto tags 名詞… filtering
- [ ] #3 JMdict senses: optionally surface sense[].field/misc/dialect in MCP search_vocab when answering Is this keigo vs kōgo?; keep flattened string for backward parity
- [ ] #4 License: MODEL_LICENSES.md BSD-3 + data/LICENSE.md CC BY-SA per upstream SHA; model path-based app_data_dir/vaporetto/ not embedded for ~5MB sidecar discipline
<!-- AC:END -->
