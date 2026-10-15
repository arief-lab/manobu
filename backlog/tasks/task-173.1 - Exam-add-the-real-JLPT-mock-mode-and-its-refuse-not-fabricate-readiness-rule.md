---
id: TASK-173.1
title: 'Exam: add the real-JLPT-mock mode and its refuse-not-fabricate readiness rule'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-29 10:44'
updated_date: '2026-09-29 12:16'
labels: []
dependencies: []
parent_task_id: TASK-173
priority: high
type: feature
ordinal: 939000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The exam contract already carries two modes, `shortened` and `exam-conditions` (`packages/api-contract/src/exam.ts:11`), and `paperModeLabel` maps a request to those labels (`packages/item-engine/src/paper.ts:664`). Neither means "the real JLPT paper", and the generator fills any shortfall with the daily-quiz fallbacks `same-pos-pool` / `single-group-fallback` (`apps/server/src/services/exam-service.ts:1101,1136`). A real-exam mode must be a distinct contract concept that cannot be satisfied by fabricated content, or it lies about what the learner is training for.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A new mode value exists in `EXAM_MODES` and is accepted through `validatePaperRequest` end to end
- [x] #2 The mode is selectable when a learner asks /ai for a real exam, and the casual request still resolves to the existing daily behaviour
- [x] #3 In the real mode, assembly marks the paper not-ready when any 大問 block cannot be filled with authentic content, instead of applying the daily-quiz fallback
- [x] #4 The build receipt names the specific block(s) that could not be filled rather than reporting an anonymous shortfall
- [x] #5 Existing daily-quiz / exam-conditions behaviour and their tests are unchanged
- [x] #6 Until the 大問 block structure (TASK-173.4) exists, the refusal operates at the finest granularity the request model supports (section), and the block-level named refusal is delivered by TASK-173.4
- [x] #7 Real and daily papers share the SAME surfaces: launched from /ai, rendered at /exam/$examId (`apps/desktop/src/routes/ai.tsx:666-668`); daily-vs-real is carried by the request `mode` field, no new route or page
- [x] #8 The mode is chosen by the agent from the learner ask via the `startExam` tool (`apps/server/src/context.ts:210-216`), whose input carries `mode` (`apps/server/src/ask-tool.ts:75`); that input schema, `EXAM_MODES` (`packages/api-contract/src/exam.ts:11`), and the parallel `PAPER_MODES` (`packages/item-engine/src/paper.ts:17`) must all accept the new mode, since `defaultPaperMode` falls back to `shortened` (`paper.ts:616`) when mode is absent
- [x] #9 A test pins `EXAM_MODES` (`packages/api-contract/src/exam.ts:11`) and `PAPER_MODES` (`packages/item-engine/src/paper.ts:17`) to the same set, so the new mode cannot be added to one list and silently rejected by `parsePaperMode` (`paper.ts:612`) while the contract still accepts it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Add a distinct real-JLPT-mock mode and the refuse-not-fabricate readiness rule. Daily (shortened) and exam-conditions behaviour must be untouched.

1. Name the new mode. Recommend `real` in the machine enum (learner-facing wording is 173.2/173.3's job, not this id). Pending user OK on the name.
2. `packages/item-engine/src/paper.ts`: add `real` to `PAPER_MODES` (:17). Thread it through `paperModeLabel` (:664) and extend the `PaperModeLabel` union (:462) with a real-mode label. Do NOT change `parsePaperRequestMode`'s absent-default (`paper.ts:616` stays `shortened`) so casual requests keep the daily behaviour.
3. `packages/api-contract/src/exam.ts:11`: add `real` to `EXAM_MODES`. `ExamModeSchema` is derived from it, so the wire accepts it. Verify `validatePaperRequest` end-to-end accepts `real`.
4. Parity guard (AC#9): add a test asserting `EXAM_MODES` and `PAPER_MODES` are the same set, so the two lists cannot drift when a mode is added.
5. Refusal rule (AC#3/#4): in real mode, a slot filled from a daily fallback is a HOLE, not a fill. Gate on `request.mode === "real"` at the readiness decision (exam-service `fillCandidatePaper`/`assemblePaper`, around :1674 and the sourcingCase fork :745-754), so `same-pos-pool`/`single-group-fallback`-sourced items do not mark the paper ready. The paper then goes not-ready instead of degrading.
6. Receipt names the gap at the finest granularity the current request model supports: SECTION (vocabulary/grammar-reading/listening). Block-level (大問) naming arrives with 173.4; AC#6 pins this interim scope.
7. Keep daily/exam-conditions green: run the existing exam test suites unchanged (AC#5).
8. No new route: real and daily share /ai launch + /exam/$examId render, carried only by the `mode` field (AC#7); `startExam` tool input + `ask-tool` mode already carry a mode string, so accepting `real` needs no desktop change in this task.
Verify: bun test for item-engine + api-contract + server exam suites; ultracite fix; mutation-gate --check if TS anchors move.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification: apps/server 256 pass / 0 fail (36 files; routes.smoke.test.ts excluded because port 4317 is held by a dev server from an earlier session), item-engine 44 pass, ui 172 pass (paper-card now renders the real label; copy-snapshot counts raised for the new key), chat-session 272 pass, desktop 548 pass / 3 skip, check-types 14/14, ultracite clean, mutation-gate --check resolves all 68 anchors and the two new seams (exam-real-mode-refusal-disabled, exam-real-refusal-booked-as-exhaustion) plus the re-anchored exam-host-tool-mode-sells-size are all CAUGHT. Two findings worth keeping. (1) A refusal must not set TASK-148 contentExhausted: the first cut added refused families to exhaustedFamilies, which would have told a learner they ran the level dry when the paper had declined to invent options. The receipt carries the gap in its own refusedSections field and context.ts checks it BEFORE the exhaustion branch. (2) Non-vacuity needed started papers, not assembled ones: assembled-but-unopened papers serve nothing, and fallback sourcing is unreachable for an ordinary request because pass 0 declines single-group entries while demand is capped by MAX_CANDIDATES_PER_TYPE=64. The test burns STARTED daily papers until 20 of 40 vocab items are fabricated, and from that point a real paper of the same request comes up short. Favourable side effect discovered while doing it: because a refusing real paper is short, fillCandidatePaper keeps doubling the reserve and finds AUTHENTIC content deeper in the pool that a daily paper stops searching for once it is 'ready' with padding, so many real papers fill at counts a daily paper pads.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-29 12:16
---
Open, for the user: the plan recommended the machine name `real` pending approval (step 1). It is shipped as `real` and the interim learner-facing string is 'real exam paper' (`paper.mode.real`, owned by TASK-173.2/173.3). Renaming the enum value now is a bounded change: the two arrays, the db copy, the label union, and the parity test.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the third paper mode `real` and the refuse-not-fabricate readiness rule. `EXAM_MODES` (`packages/api-contract/src/exam.ts:11`), `PAPER_MODES` (`packages/item-engine/src/paper.ts:17`) and the db copy (`packages/db/src/item-store.ts:38`) accept it; the engine gives it the official section minutes like `exam-conditions` and never a smaller count, while `defaultPaperMode` still falls back to `shortened`, so a casual ask keeps daily behaviour. The rule itself is in `appendItemTypeCandidates` (`apps/server/src/services/exam-service.ts:1223`, refusal at :1365): in real mode an item whose distractors came from `same-pos-pool` or `single-group-fallback` does not fill its slot, so the paper goes not-ready instead of degrading, and the receipt names the sections it refused in a new `refusedSections` field (section granularity per AC#6 until TASK-173.4 models the 大問 blocks). `context.ts` `startExam` checks that field before the exhaustion branch, so the agent tells the learner which part cannot be asked for real rather than claiming the level ran dry. The mode reaches the wire only through the agent's `start_exam` tool, whose description now states what `real` costs; no new route, and both papers share the paper card and `/exam/$examId`. Verified: 4 new/updated tests plus the full server (256), item-engine (44), ui (172), chat-session (272) and desktop (548) suites green, check-types 14/14, and 3 mutation seams caught. Mode/label drift closed at four declaration sites (`chat-frames.ts` and `chat-session/types.ts` now derive from the contract) and pinned by `test/exam-mode-parity.test.ts`.
<!-- SECTION:FINAL_SUMMARY:END -->
