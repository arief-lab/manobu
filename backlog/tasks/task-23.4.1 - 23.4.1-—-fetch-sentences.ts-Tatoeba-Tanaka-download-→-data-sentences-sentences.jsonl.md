---
id: TASK-23.4.1
title: >-
  23.4.1 — fetch-sentences.ts: Tatoeba/Tanaka download →
  data/sentences/sentences.jsonl
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-08 12:30'
updated_date: '2026-09-08 12:45'
labels:
  - datasets
  - doc2
dependencies: []
parent_task_id: TASK-23.4
ordinal: 565000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Subtask of TASK-23.4 (doc-2 §5.2 fetch layer). Create packages/japanese/scripts/fetch-sentences.ts following the fetch-vocab.ts pattern: download sentences.tar.bz2 + jpn_indices.tar.bz2 into .cache/, join by sentence_id→meaning_id, emit data/sentences/sentences.jsonl {id, jp, en, linkedWords} with attribution (Tatoeba CC BY 2.0 / Tanaka PD). Dedup jp+en pairs. Add fetch:sentences script. Update data/LICENSE.md with upstream SOURCE_URLs + SPDX.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 fetch-sentences.ts downloads sentences.tar.bz2 + jpn_indices.tar.bz2 into .cache/, emits data/sentences/sentences.jsonl {id, jp, en, linkedWords, attribution}
- [x] #2 data/LICENSE.md updated with Tatoeba CC BY 2.0 FR / Tanaka PD provenance + regeneration instructions
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
fetch-sentences.ts implemented (streaming 2-pass join, tar(1) bz2 extraction, .cache caching, --force). Produced data/sentences/sentences.jsonl: 147,705 pairs / 42.2 MB (248,793 JP sentences, ≤120 chars, deduped, linkedWords extracted from Tanaka B-lines). LICENSE.md §8 added with CC BY 2.0 FR + PD attribution; fetch:sentences script added.
<!-- SECTION:NOTES:END -->
