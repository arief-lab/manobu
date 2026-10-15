---
id: TASK-148
title: 'Exam: a retry never re-serves a question the learner has already seen'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 03:10'
updated_date: '2026-10-13 02:49'
labels:
  - exam
  - item-engine
  - storage
dependencies: []
references:
  - >-
    backlog/docs/architecture/doc-21 -
    The-exam-content-pipeline-corpus-supply-the-model-free-path-and-sense-selection.md
  - TASK-145
priority: low
type: feature
ordinal: 913000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today the dedupe that keeps a paper free of repeats lives inside one build: `usedVocabWords` and `usedGrammarIds` are fields of the per-exam candidate catalog (apps/server/src/services/exam-service.ts:559-560, created fresh at :1436) and are consulted only while that same paper is assembled (exam-service.ts:984, :1101). Nothing records what a previous paper served, so a second request at the same level re-samples the same fixed pool. Measured on the current tree: the N5 pool is 698 vocabulary entries plus 77 grammar patterns, and three consecutive N5 papers produced 89 distinct items out of 90, which is random sampling, not dealing. The overlap grows with every paper a learner sits, and by the tenth N5 paper the same word returns with the same distractors, because those come from that entry's own sense groups. The user story is exactly this: finish an N5 paper, ask for another one, and get a paper that is genuinely new.

The supply numbers bound the feature, so the shortfall path is part of the work, not a follow-up: 775 N5 anchors against a 30-item paper is roughly 25 papers of arithmetic headroom and less in practice. When the unseen pool can no longer fill the blueprint the build must say so the way TASK-138 requires of any unsourceable content (doc-21 §5: a model-free path reads the shipped JSON, and content the app cannot source is never invented). The existing in-memory per-process ledgers (`sourcingLedgers`, exam-service.ts:1412, with the note at :538 that persisting it is deferred) are the wrong precedent to copy here: a learner's history has to survive a restart.

This is code-side work and is independent of agent authoring. TASK-145 would widen variety by writing new sentences around a known answer, and TASK-143 already decided that direction (sidecar calls the agent over ACP, the paper stays the sidecar's), but authoring does not remove repeats: an authored item still sits on a corpus anchor, and that anchor is what has to be remembered.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Assembling a paper at a level the learner has already sat excludes every anchor that earlier paper served, and a test proves two consecutive papers at one level share no anchor
- [x] #2 The seen record is durable across process restarts, and a test proves it by re-opening the database rather than reusing one in-memory map
- [x] #3 The exclusion is scoped per level, so sitting N5 papers cannot starve the N2 pool, and a test proves an N2 build is unaffected by N5 history
- [x] #4 When the unseen pool at a level cannot fill the blueprint the build receipt reports ready=false with a non-zero shortfall and the sections name their own shortfall, instead of re-serving a seen anchor to reach the budget
- [x] #5 Re-sitting the same exam id replays its stored items and does not re-draw, so a deliberate retake of one paper stays possible
- [x] #6 A learner-facing surface states what happened when a level runs out of unseen content, rather than silently serving a shorter or recycled paper
- [x] #7 Every item still passes validateQuestionItem (packages/item-engine/src/validation.ts:255), including items drawn from the reduced unseen pool
- [x] #8 A mutation-gate seam pins the exclusion, with an anchor that breaks the property rather than one of several redundant guards
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Durable seen record, DERIVED not duplicated. New read in packages/db/src/item-store.ts: listExamAnchors(level) = the union of items.anchors for every item composed into an exam at that level (exams.level -> exam_items -> items.anchors; packages/db/src/schema/user.ts:121,144,173). No migration: the exam rows already are the durable record, so AC#2 is free and there is no second ledger to drift out of sync with them. Two consequences to document at the read: a paper that was abandoned still served its questions, and deleting an exam forgets its anchors.
2. Exclude at sourcing. CandidateCatalogState (apps/server/src/services/exam-service.ts:530-562) gains seenAnchors, loaded once in buildCandidateCatalog (:1425). ONE shared predicate filters both family pools inside poolFor (:872) and grammarPoolFor (:909) BEFORE the slice(0, poolSize), so the seeded walk can only land on unseen entries and a nearly-served level widens rather than starving on the slice. focusSourceFor (:940) stays exempt by construction: it resolves the anchor directly, and a focus anchor is by definition one the learner already missed (TASK-140), so the learner named it.
3. Remove the repeat-on-exhaustion fallback in nextGrammarSource (:1117-1139) and return null. Its stated premise (a repeated question beats a hole) is the behaviour this task removes; the hole now reports itself through the existing ready:false + shortfall path (receiptFromState :1572).
4. Name the cause. ExamBuildReceiptSchema (packages/api-contract/src/exam.ts:212) gains contentExhausted: boolean, set from the catalog when a walk came up dry; receiptFromState defaults it false so no other receipt path changes.
5. AC#6 surface. startExplicitPaper (apps/desktop/src/routes/ai.tsx:562) never reads the assemble receipt and always says Paper ready. Route it through a new pure seam paperBuildNotice(receipt) in apps/desktop/src/lib/paper-notice.ts plus a new deck key paper.build.exhausted in packages/ui/src/lib/copy.ts (R-02 clean), pinned by copy-snapshot.test.ts and a new test/paper-notice.test.ts.
6. Tests: new apps/server/test/exam-no-repeat.test.ts on the exam-pipeline.test.ts harness (per-spec db, makeClient, reopenClient :216). AC#1 two consecutive N5 papers share no anchor; AC#2 the same after db.$client.close() + createUserDb + a fresh client; AC#3 N5 history leaves an N2 build intact; AC#4 with every anchor of a level served (fixture stores synthetic items carrying each vocabAnchorFor/grammarAnchorFor id) the receipt is ready:false with non-zero shortfall, per-section shortfall, contentExhausted:true and nothing repeated; AC#5 assembling a ready exam returns the same item ids; AC#7 every served item passes validateQuestionItem (mirror exam-gloss-ambiguity.test.ts:174).
7. AC#8: one mutation seam in scripts/mutation-gate.ts anchored on the shared unseen predicate, so breaking it breaks both families at once. Then bun scripts/mutation-gate.ts --check.
8. Bug found in the same flow, fold in: apps/server/src/context.ts:204 startExam ignores built.ready, so the agent is told to say the paper is ready when no paper exists and no card was emitted. Make it fail when ready is false so the existing examFailure text (ask-tool.ts:222) tells the learner the truth.
9. Gates: bun run test, check-types, ultracite fix, fallow dead-code --boundary-violations, check:dox, the exhaustion notice verified live in the browser at /ai, then DOX rows for apps/server, packages/db, packages/api-contract, apps/desktop, packages/ui.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Steps 1-9 of the plan are in the tree, not yet committed. The seen set is derived, not stored: `apps/server/src/services/exam-service.ts` builds the catalog with `seenAnchors: new Set(await store.listServedAnchorsForLevel(request.level))` and both `poolFor` and `grammarPoolFor` filter against it BEFORE the `poolSize` slice, so a retry cannot re-serve an anchor a served paper already carried; distractor scans pass `NO_SEEN_ANCHORS` because an option is not a question. No migration: `packages/db/src/item-store.ts` unions `exams.level -> exam_items -> items.anchors` over `SERVED_EXAM_STATUSES = ["abandoned","in_progress","submitted"]`. When the level cannot fill, `fillCandidatePaper` widens the candidate reserve (`REJECTED_CANDIDATE_RESERVE = 2`, `MAX_FILL_ATTEMPTS = 3`) and the receipt reports `contentExhausted` (`packages/api-contract/src/exam.ts`), which `apps/desktop/src/lib/paper-notice.ts` renders as "no new questions left" instead of a paper that does not exist.

The finding on the way: widening `paperGrammarDemand` made a near-dry N5 level assemble 29/30 and announce itself ready, and `startExam` (`apps/server/src/context.ts:219`) throws on `!built.ready` - so a silently short paper was a learner-facing dead end, which is why the retry exists and why a short build is now labeled with both numbers. Proved by draining one level to exhaustion in `apps/server/test/exam-no-repeat.test.ts` (5 tests) and asserting `exam.start` refuses the draft with the typed `NOT_READY`.

Two bugs found while verifying in the running app, both fixed here: (1) `examFailure` in `apps/server/src/ask-tool.ts` replied with a flat "could not be built" sentence that dropped the reason, so the agent would have told a learner to retry a level with nothing left - the message now travels and the harness instruction says to pass it on; (2) the deterministic `/exam N5` leg in `apps/desktop/src/routes/ai.tsx` never cleared the composer, so pressing Enter again asked for a second paper; a ready build now clears the draft, a short one keeps the text because editing the level is the way out.

Gates: `bun x ultracite check` clean, `bun run check-types` 14/14, `bun run check:dox` complete, `fallow dead-code --boundary-violations` 0, mutation gate 61 anchors resolve and the three new seams (`exam-seen-anchors-not-loaded`, `exam-fill-retry-disabled`, `exam-host-tool-failure-drops-reason`) each caught. Server suite 260 pass / 1 skip via `BUN_PORT=4381 bun test test/*.test.ts` from `apps/server` - an orphaned sidecar (pid 86905) still squats 4317, so the root `bun run test` fails on that port check alone, not on code. Live verification at /ai driven headlessly against the dev server with screenshots read: notice text, card section counts (10/10 x3 ready), and the empty composer 2s after the notice.

Finalization re-check 2026-10-13 against committed code (4fa6ccd, branch re-design): apps/server exam-no-repeat.test.ts 5 pass / 53 assertions / 0 fail and apps/desktop paper-notice.test.ts 8 pass / 0 fail re-run green on HEAD; the three AC#8 seams (exam-seen-anchors-not-loaded, exam-fill-retry-disabled, exam-host-tool-failure-drops-reason) are live in scripts/mutation-gate.ts:870,879,888 and mutation-gate --check resolved all 207 anchors on the TASK-153 commit (6ff6bed) hook. AC map: #1/#2/#3/#5/#7 are the exam-no-repeat tests (no-anchor overlap, db-reopen durability, level scoping, same-id replay, validator pass); #4 is the drain-to-exhaustion receipt test (ready:false, per-section shortfall, contentExhausted); #6 is paperBuildNotice + the paper.build.exhausted deck key, live-verified at /ai with screenshots.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
No-repeat retries shipped in commit 4fa6ccd: the seen set is derived from the exam rows themselves (listServedAnchorsForLevel over exams.level -> exam_items -> items.anchors, no migration, restart-durable by construction), both family pools filter it before the slice so a retry deals new anchors, an unfillable level reports contentExhausted with per-section shortfalls instead of recycling, a re-sit of the same exam id replays stored items, and paperBuildNotice tells the learner 'no new questions left' rather than serving a quiet shorter paper. All 8 ACs verified by the re-run suites plus three pinned mutation seams.
<!-- SECTION:FINAL_SUMMARY:END -->
