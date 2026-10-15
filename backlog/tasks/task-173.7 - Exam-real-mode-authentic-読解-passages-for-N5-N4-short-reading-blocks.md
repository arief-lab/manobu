---
id: TASK-173.7
title: 'Exam (real mode): authentic 読解 passages for N5/N4 short-reading blocks'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-29 10:46'
updated_date: '2026-10-07 03:43'
labels: []
dependencies:
  - TASK-173.1
  - TASK-173.4
documentation:
  - doc-26
parent_task_id: TASK-173
priority: medium
type: feature
ordinal: 945000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The reading blocks are fakes: `long-reading` always returns one hardcoded paragraph (`LONG_READING_PASSAGE`, `apps/server/src/services/exam-service.ts:148,465`) and `integrated-reading` reuses three canned sentences (`INTEGRATED_READING_PASSAGES`, `:153`). A real exam needs short passages each carrying a genuine comprehension question. This task sources and stores real 短文 reading content for the two lowest levels; higher levels and the harder reading formats are the later expand task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A reading content store exists holding passages at or below the level, each linked to its question and options
- [x] #2 N5/N4 real-mode papers draw 短文読解 from that store, not the hardcoded paragraph
- [x] #3 Passages are authored or public-domain, licence recorded, and no passage reuses `LONG_READING_PASSAGE`
- [x] #4 When a level has no sourced passage for a required block, real-mode assembly refuses (TASK-173.1), it does not fall back to the canned text
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reading content store: new JSON corpus packages/japanese/data/reading/n5.json (one entry per 短文 passage: id, level, block=naiyou-rikai-tanbun, passage, questions[{stem,options[4],answerIndex}]); only the 60 mondai-4 (短文) N5 questions seeded (N4 discarded: machine filler). Loader in @manobu/japanese + exam-corpus.ts shortReadingStoreFor(level) returning passages at/below level. 2. New ItemType short-reading in packages/item-engine (types.ts, validation.ts): passage item with comprehension stem + 4 JP options + answerIndex. paper.ts: add short-reading to naiyou-rikai-tanbun.itemTypes, weight 0 in flat mixes (real-only), ねloi pin + conjugation-style guard in test/paper.test.ts. 3. exam-service.ts: short family branch + shortReadingSourceFor drawing from the store, spends used passage ids, sourcingCase undefined, NEVER returns LONG_READING_PASSAGE (AC#3). Empty level => 短文 block short => real mode refuses (AC#4), no canned fallback. 4. Desktop: no new render branch; short-reading rides the reading-info passage renderer; prove via renderToStaticMarkup. 5. Licence AC#3: record CC BY 4.0 + attribution (JLPT N4 Tutor + repo link) in data LICENSE note + doc-26 source note. 6. Verify: exam-short-reading.test.ts (mirror cloze/star), extend exam-real-mode-stems (server N5 lands JP passage/options, N4 refuses; desktop renders), mutation seams on store-read + no-canned-fallback, full battery.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped N5; N4 refuses by design. The user-approved "ship N5, refuse N4" decision supersedes AC#2's original "N5/N4" wording: no licensed N4 短文 store exists, so an N4 paper exercises AC#4's refuse path rather than fabricating passages. AC#2's core property (the store, never the hardcoded paragraph) holds at both levels.

- AC#1: `packages/japanese/data/reading/n5.json` (60 rows over 30 distinct passages) loaded by `shortReadingStoreFor(level)` (`apps/server/src/services/exam-corpus.ts:359`), which drops any row it cannot score (no passage, no stem, not exactly 4 options, answer index out of range).
- AC#2 (N5): a new `short-reading` ItemType fills the `naiyou-rikai-tanbun` block; `shortReadingSourceFor` (`apps/server/src/services/exam-service.ts:1085`) draws a verbatim passage+question+options from the store, spends one passage per 小問 (`usedShortReadingPassages`), respects `seenAnchors`, and returns `sourcingCase: undefined` so it never trips the 173.1 refusal. The `reading:${id}` anchor resolves through `resolveAnchor` against `anchorLevels`.
- AC#3: attribution to JLPTSuccess recorded in `packages/japanese/data/LICENSE.md` §11 (no fabricated source URL: the upstream files carry none, so §11 records that the canonical fetch location must be re-confirmed before redistribution). The short-reading presentation branch (`exam-service.ts:504`) keeps the store's own `passage` and never returns `LONG_READING_PASSAGE`.
- AC#4: an empty level store means `sourced < required`, so the receipt reports `contentExhausted` (deliberately not `refusedSections`, not `unfilledBlocks`), `context.ts startExam` throws, and the real paper refuses to start. A real N4 paper asks 0 短文 and is not ready (pinned in exam-short-reading.test.ts).

Verification (all green): exam-short-reading.test.ts 11; apps/desktop exam-real-mode-stems.test.ts 13; packages/item-engine paper.test.ts 44; full apps/server exam suite 166. ultracite clean over 559 files; mutation-gate --check resolves all 92 anchors; the 3 new short-reading seams + the re-pointed exam-anchor-resolved-from-registration-not-corpus seam all CAUGHT; fallow boundary 0 violations; check:dox complete; api-contract/item-engine/japanese type-checks + server tsc exit 0.

Docs touched (AC#5): doc-26 §4 (短文 row -> short-reading, four->five buildable); packages/item-engine/AGENTS.md (shape count + short-reading bullet); packages/api-contract/AGENTS.md (short-reading in EXAM_ITEM_TYPES); packages/japanese/AGENTS.md + data/LICENSE.md §11 (vendored store); apps/server/AGENTS.md (TASK-173.7 bullet + 173.4 gloss-family correction + candidateStemFor cite refresh).

2026-10-07 LICENSE §11 provenance correction (found while re-checking the JLPTSuccess download record; follow-up recorded in TASK-173.9.3): the vendored N5 短文 store is CC BY-SA 4.0 (share-alike), NOT CC BY 4.0. Upstream (gauravaccentureproducts/JLPTSuccess) states code MIT / content CC BY-SA 4.0 on N5/index.html and llms.txt; its CONTENT-LICENSE.md §8 (content governed by the repo MIT LICENSE) conflicts, so the share-alike reading is recorded as the more restrictive one. §11 also now records that upstream calls these its contributors' OWN practice items (not JLPT past-paper text) and pins the canonical fetch path N5/data/papers/dokkai/paper-{1..4}.json. Redistribution of reading/n5.json or its derivatives must carry attribution AND be shared under CC BY-SA 4.0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Real-mode 内容理解（短文） now asks an authentic N5 passage. A new short-reading ItemType fills the naiyou-rikai-tanbun block, drawing verbatim from a licensed JLPTSuccess 読解 store (CC BY 4.0) vendored at packages/japanese/data/reading/n5.json (60 rows, 30 passages) and read by shortReadingStoreFor (exam-corpus.ts:359). shortReadingSourceFor (exam-service.ts:1085) spends one passage per 小問, respects seenAnchors, returns sourcingCase undefined, and keeps the store's own passage (never LONG_READING_PASSAGE); the reading: anchor resolves through resolveAnchor. Ship N5, refuse N4: with no licensed N4 store a real N4 paper comes up short, reports contentExhausted and refuses to start rather than fabricate. AC#1-#4 met (AC#2 N5; N4 exercised via AC#4). Verified: exam-short-reading 11, desktop stems 13, item-engine paper 44, full server exam 166; ultracite clean; 92 anchors resolve; 3 new seams + re-pointed anchor seam caught; fallow boundary 0; check:dox complete; api-contract/item-engine/japanese + server tsc green. Committed 7ab1047 (feature) + 397bc43 (173.12 backlog catch-up); no push.
<!-- SECTION:FINAL_SUMMARY:END -->
