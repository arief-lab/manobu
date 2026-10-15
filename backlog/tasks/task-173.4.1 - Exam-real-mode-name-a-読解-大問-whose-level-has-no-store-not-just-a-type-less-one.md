---
id: TASK-173.4.1
title: >-
  Exam (real mode): name a 読解 大問 whose level has no store, not just a type-less
  one
status: Done
assignee: []
created_date: '2026-10-07 01:44'
updated_date: '2026-10-07 02:13'
labels: []
dependencies: []
documentation:
  - >-
    backlog/docs/doc-26 -
    Real-JLPT-paper-anatomy-per-level-大問-blocks-formats-and-pinned-official-sources.md
parent_task_id: TASK-173.4
priority: high
type: feature
ordinal: 958000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
paperUnfillableBlocks only named 大問 whose itemTypes are empty, so a reading block with a question kind but no level store was invisible: N5/N4 printed no 内容理解（中文）, N2/N1 printed no 内容理解（短文） and N3 printed no reading at all, while the receipt reported nothing about it. That read as the learner having run the level dry - the one diagnosis that is false - instead of naming the part of the paper nothing can ask. The engine cannot see the corpus, so paperUnfillableBlocks now takes an optional hasSource predicate and receiptFromState answers it from the three reading stores at the request level.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A real-mode receipt names a 読解 大問 whose level has no store: N5/N4 大問5 内容理解（中文）, N3 大問4 内容理解（短文） and 大問5 内容理解（中文）, and N2 大問10 / N1 大問8 内容理解（短文）
- [x] #2 It does not over-report: every 読解 大問 whose level HAS a store stays out of unfilledBlocks (N2/N1 内容理解（中文） and 主張理解（長文）, N5/N4 内容理解（短文）)
- [x] #3 A store that exists but is too small stays an ordinary shortfall, not a hole: proven through the receipt against a substituted store (one row, empty, and a missing file) so the boundary does not depend on draining the shipped corpus
- [x] #4 Three mutation seams catch the widened rule, its wiring and the exists-not-size boundary, doc-26 §4 plus the item-engine and server AGENTS.md record the widened meaning, and the learner-facing sentence names a 読解 hole in both modes (desktop paper-notice case)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
SHIPPED. Engine: `PaperUnfillableBlocksInput` (`packages/item-engine/src/paper.ts:1484`) adds an optional `hasSource` predicate (`:1500`) and `paperUnfillableBlocks` (`:1509`) filters `block.requested > 0 && (block.itemTypes.length === 0 || !hasSource(block))`. The default is `() => true`, so every pre-existing caller keeps the engine-only rule and `packages/item-engine/test/paper.test.ts` did not change.

Server: `READING_STORE_FOR` (`apps/server/src/services/exam-service.ts:3007`) maps `short-reading` / `medium-reading` / `claim-understanding` to their level stores, `blockHasRealSource` (`:3027`) answers for one 大問, and `receiptFromState` passes it (`:3081`). DECISION recorded in code: the predicate asks whether a source EXISTS, not whether it is big enough, so a store smaller than the 大問 小問数 stays the ordinary `shortfall` and only a level with no store at all becomes a hole.

Tests: new `apps/server/test/exam-reading-holes.test.ts` (2 describes, 5 tests) builds a real paper per level with an over-large budget (clamped to the official shape, so every 大問 of the section is requested) and asserts the named holes by `section:大問N:name`. Pinned: N5/N4 `grammar-reading:大問5:内容理解（中文）` named and no `medium-reading` landed; N3 大問4 短文 + 大問5 中文 named alongside the structural 大問6 長文 / 大問7 情報検索, with zero reading items and `refusedSections` empty; N2 大問10 短文 named while 大問11 中文 and 大問13 主張理解 are NOT; N1 大問8 短文 and 大問10 長文 named while 大問9 中文 and 大問12 主張理解 are NOT.

Seams: `paper-unfillable-blocks-ignore-store-absence` (drops the predicate) and `receipt-skips-store-absence-check` (passes `() => true`), both CAUGHT; the pre-existing `paper-unfillable-blocks-count-buildable-ones` anchor had moved with the reformat and was retargeted to the new two-term filter, then re-run and CAUGHT. `bun scripts/mutation-gate.ts --check` resolves all 125 anchors.

Docs: doc-26 §4 gained a paragraph on the two hole reasons plus the two table rows; `packages/item-engine/AGENTS.md` and `apps/server/AGENTS.md` (TASK-173.4 and TASK-173.7 bullets) record the widened meaning, the latter correcting its earlier claim that a store-less level is deliberately NOT `unfilledBlocks`; also the `exam.ts` contract comment, `context.ts` `startExam` comment and the `paper.build.unfilled` deck comment (string unchanged, so the copy snapshot is untouched).

VERIFICATION: `bun run check-types` 14/14; `bun test packages/item-engine` 68 pass / 0 fail; server suite from apps/server 356 pass / 1 skip (pre-existing warm-session skip) / 0 fail across 46 files; `bun test packages/ui` 172 pass / 0 fail; `bun x ultracite check` clean over 605 files; `bun run check:dox` exit 0; `bun x fallow dead-code --boundary-violations` exit 0.

AC#3 narrowed while finalizing. The first draft claimed the partial-store boundary was proven end to end; it cannot be, and the attempt is recorded rather than hidden: a test that ran two real N1 papers to drain the 9-小問 中文 block was DELETED because no real paper is ready today (whole reading 大問 are holes), so `client.exam.start` answers NOT_READY and no anchors are ever spent. What replaced it: an engine-seam test in `packages/item-engine/test/paper.test.ts` ("names a 大問 only where the caller hasSource says nothing can fill it") pinning that the predicate is consulted per 大問, only ADDS holes, and defaults to sourceable; the exists-not-enough boundary itself is by construction (`blockHasRealSource` reads `length > 0`, never the 大問 小問数). The server test file carries a comment saying so at the point the deleted test stood.

BOTH RECORDED LIMITATIONS CLOSED; the earlier notes on them are superseded. (1) The partial-store boundary is proven end to end rather than by construction: apps/server/test/exam-reading-holes.test.ts substitutes the store through a scratch data root (MANOBU_DATA_DIR + __test__.resetCorpusCache), symlinking the real 154 MB tree and deliberately NOT linking the overridden reading/n1-chuubun.json, so a real N1 paper assembles against a store of any size. One row -> the 大問 stays out of unfilledBlocks, exactly one row is served, shortfall > 0, and 大問12 主張理解 (untouched by the overlay) still fills; [] and a missing file -> the 大問 IS named. Draining the shipped store remains impossible (no real paper is ready, so exam.start answers NOT_READY) and is no longer needed. (2) The learner-facing sentence is pinned for a 読解 hole in both modes: apps/desktop/test/paper-notice.test.ts now renders 言語知識（文法）・読解 大問 5 (内容理解（中文）) for a real paper and Grammar·Reading … for a practice paper, so the reading half of the hole list is asserted and not only the 語彙 half. A DOM render stays out of scope (repo-wide limit: apps/desktop has no DOM env, the same limit recorded for largeQuestionHeading in TASK-173.4 and reviewRowActions in TASK-159), and the notice branch keeps its existing mutation seam. New seam reading-store-size-not-source-existence mutates storeFor(level).length > 0 to > 100 and is CAUGHT by the substituted-store test, so "a source exists" is separated from "a source is big enough" by the gate, not only by a comment. Re-verified after these additions: check-types 14/14; item-engine 69/0; server 357 pass / 1 skip / 0 fail across 46 files; desktop 570 pass / 3 skip / 0 fail across 59 files; ultracite check clean over 592 files; mutation-gate --check 126 anchors resolve; reading-store-size-not-source-existence, paper-unfillable-blocks-ignore-store-absence, receipt-skips-store-absence-check and paper-unfillable-blocks-count-buildable-ones each CAUGHT; fallow dead-code --boundary-violations exit 0.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-07 01:54
---
Correction to the notes: the sentence "packages/item-engine/test/paper.test.ts did not change" was true when written and is not true now. Finalizing added a test there ("names a 大問 only where the caller hasSource says nothing can fill it"), which is where AC#4 is verified. The engine file itself has one new test and no changed existing test.
---

created: 2026-10-07 02:13
---
Correction to the earlier notes: they said the deleted drain test is documented where it stood. That comment was replaced by the scratch-store explanation once the boundary became testable, so the sentence is stale; the note sentence "packages/item-engine/test/paper.test.ts did not change" was already corrected in a prior comment. Both limitations are now closed rather than merely recorded.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A real-mode receipt now names a 読解 大問 whose level has no store, not only a 大問 with no question kind. paperUnfillableBlocks (packages/item-engine/src/paper.ts:1509) takes an optional hasSource predicate (interface :1484, predicate :1500, default -> true so every existing caller keeps the engine-only rule), and receiptFromState (apps/server/src/services/exam-service.ts:3081) answers it from READING_STORE_FOR (:3007) via blockHasRealSource (:3027) at the request level. The predicate asks whether a source EXISTS, so a store too small for the 大問 stays an ordinary shortfall. Pinned by apps/server/test/exam-reading-holes.test.ts (5 tests): N5/N4 大問5 内容理解（中文）, N3 大問4 短文 + 大問5 中文, N2 大問10 短文 and N1 大問8 短文 are named, while every 大問 whose store exists (N2/N1 中文 and 主張理解, N5/N4 短文) is not. Seams paper-unfillable-blocks-ignore-store-absence and receipt-skips-store-absence-check are CAUGHT, the moved anchor of paper-unfillable-blocks-count-buildable-ones was retargeted and re-run CAUGHT, and all 125 anchors resolve. Docs: doc-26 §4, packages/item-engine/AGENTS.md, apps/server/AGENTS.md (which had claimed the opposite), plus the exam.ts, context.ts and deck comments. Verified: check-types 14/14; item-engine 69/0; server 356 pass / 1 skip / 0 fail (46 files); ui 172/0; ultracite check clean over 592 files; check:dox 0; fallow boundary-violations 0. Limit recorded in the notes: the partial-store boundary cannot be exercised end to end because no real paper is ready today.
<!-- SECTION:FINAL_SUMMARY:END -->
