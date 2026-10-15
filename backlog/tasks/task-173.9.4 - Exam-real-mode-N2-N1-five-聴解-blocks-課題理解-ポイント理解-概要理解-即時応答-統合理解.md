---
id: TASK-173.9.4
title: >-
  Exam (real mode): N3/N2/N1 聴解 stores, all five 大問 per level
  (課題理解/ポイント理解/概要理解/即時応答/聴解統合理解, N3 also 発話表現)
status: Done
assignee: []
created_date: '2026-10-03 11:27'
updated_date: '2026-10-12 11:48'
labels: []
dependencies:
  - TASK-173.8
parent_task_id: TASK-173.9
priority: low
ordinal: 955000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Umbrella for the last 聴解 gap: TASK-173.8.1 shipped N4/N5 (four listening-* item types, stores + gates + serving, commits e4b031c + b8a203b). What remains is 聴解 content at N3/N2/N1. The four bottom-level blocks already have item types and per-block stores; N3 reuses them directly (paper.ts:775-779: 課題理解 6, ポイント理解 6, 概要理解 3, 発話表現 4, 即時応答 9), while N2 (paper.ts:745-749: 5/6/5/12/4) and N1 (paper.ts:715-719: 6/7/6/14/4) need TWO NEW item shapes: gaiyou-rikai 概要理解 (paper.ts:342, itemTypes: []) and choukai-tougou-rikai 聴解統合理解 (paper.ts:338-341, itemTypes: []). Neither shape fits the 173.8.1 one-scenario/one-question/four-options mold unchanged: 概要理解 prints no per-小問 question, and the real 統合理解 reads ONE long 対話 that several 小問 are asked on, so both shapes must be MEASURED from the official sample papers before a store is written (doc-26 §3.2-3.5). Supply fact established 2026-10-12: JLPTSuccess ships NO listening corpus beyond N5 (packages/japanese/.cache/jlptsuccess holds only n4-paper-7.json and n5-paper-7.json; upstream N5/data/listening.json is the only listening file), so every upper-level row is AUTHORED ONLY, exactly like the N4 stores (LICENSE §30). N2/N1 print NO 発話表現 and N4/N5 print NO 概要理解 (paper.test.ts:1221-1237 absence matrix). Audio playback is TASK-173.8.2 and does NOT gate this work: stores ship ahead of the voice, the 173.8.1 precedent. Slices: 173.9.4.1 N3, 173.9.4.2 N2, 173.9.4.3 N1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 N3/N2/N1 聴解: each level's real paper fills ALL its 聴解 大問 to the official 小問数 (N3 6/6/3/4/9, N2 5/6/5/12/4, N1 6/7/6/14/4, paper.ts:775-779/:745-749/:715-719) from per-block per-level stores, or refuses naming every hole (TASK-173.1), with a drained store naming the 大問
- [x] #2 概要理解 and 聴解統合理解 item shapes are MEASURED from the official sample papers and recorded in doc-26 before any store row is written; no shape is invented from recall (the 173.9 line's standing rule)
- [x] #3 Every upper-level row is composed (zero vendorable listening supply above N5, fact stated in the description) and ships only on the 173.8.1 certification protocol: deterministic gate + TWO independent blind agent passes with keys withheld, each pass joined to ITS OWN per-packet key-letter sidecar (LICENSE §30), burns recorded in {level}-{stem}-rejected.json ledgers
- [x] #4 The four listening-* per-block gates grow N3/N2/N1 lines in KNOWN_LEVELS, the rune bands (check-listening-shared.ts:101-110) and MIN_ROWS; the new shapes get their own gate scripts; store-shipped-but-not-checked stays live
- [x] #5 TTS gating is NOT part of this task: audio ships under TASK-173.8.2; a shipped store whose level has no audio yet simply is not playable yet (the N4/N5 state today)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All three slices shipped: 173.9.4.1 N3 (15067c9), 173.9.4.2 N2 (bb5679f, LICENSE §32), 173.9.4.3 N1 (5fbcdb5, LICENSE §33). exam-listening.test.ts now pins real papers filling every 聴解 大問 at N1/N2/N3/N4/N5 to the official 小問数 with drained-store holes and unjudged-row refusals; both new shapes (概要理解 monologue, 聴解統合理解 pair) were measured off the pinned official PDFs before any row was written (doc-26 §4); every upper-level row is composed and certified on the two-blind-pass protocol with burn ledgers.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The 聴解 line is full: N5-N1 each fill every 聴解 大問 their blueprint prints from per-block per-level stores (N5 licensed+authored, N4/N3/N2/N1 authored-only), served by the five item types plus the two measured new shapes, all gates/green, seams caught, LICENSE §29-§33 owning the provenance. Audio remains TASK-173.8.2 and was never part of this task's scope (AC#5).
<!-- SECTION:FINAL_SUMMARY:END -->
