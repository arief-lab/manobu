---
id: TASK-139
title: 'Exam: the accepted focus field is dropped, and the request round-trip is lossy'
status: Done
assignee: []
created_date: '2026-09-26 06:09'
updated_date: '2026-09-26 12:57'
labels:
  - exam
  - bug
  - api
dependencies: []
priority: medium
type: bug
ordinal: 904000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The exam request contract accepts a focus field, the item engine parses it, and the server throws it away - including on the round-trip that rebuilds a request from stored state, which makes the reconstruction a DIFFERENT request from the one that was made. Found while filing the sibling catalog task.

EVIDENCE. packages/api-contract/src/exam.ts:104 declares focus on the request input (ExamFocusSchema, an array of ids capped at 100) and :116 on the stored request. packages/item-engine/src/paper.ts:469-478 carries focus through PaperRequest and :633 parses it. None of it is ever read: appendSectionCandidates selects purely by item type and allocated count. And apps/server/src/services/exam-service.ts:1285, inside requestForState, hardcodes focus: [] - so a caller that sends focus gets a 200 and a paper that ignored it, and pause, submit, the timer reconciliation and the receipt all reconstruct a request that differs from the original.

WHY IT IS A BUG AND NOT A GAP. Two things are wrong independently. First, a field the public contract accepts is silently ignored: that is a lie to the caller, and doc-14 §3 documents focus as the mechanism by which re-practice lands where it hurt (the last result weak pattern ids). Second, requestForState is a lossy round-trip: anything not written into the exam row is dropped, and nothing detects the drift.

WHAT IT IS FOR. It is the targeting hook. Once the candidate catalog reads the real corpus (the sibling task), focus is how a paper gets aimed at the learner's weak anchors instead of a level-wide rotation - so the two are complementary, and this one is small.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The request rebuilt from stored state equals the request that was made, focus included. A test stores a request carrying focus, re-derives it the way pause/submit/timers do, and compares the two. This is the actual defect and it is the first thing to land.
- [x] #2 doc-14 §3 stops describing focus as the working re-practice mechanism until the picker honours it, or the description is confirmed accurate once it does.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
RESOLVED AS TWO TASKS. AC#1 and AC#5 are done here; the targeting half moved to TASK-140 verbatim, because it could not be done before TASK-138 and would have been wasted effort after it (the picker's source is sixteen hardcoded nouns, so a selection prior over it is not demonstrable).

DONE HERE. Migration 0014 adds `exams.focus` (JSON text, NOT NULL DEFAULT '[]' - parseRequest yields [] for a request that carried none, so no null/empty distinction is needed). `createExam` writes `request.focus`; `requestForState` reads `state.focus`. `ExamForClient` omits `focus` on purpose: it is an assembly input, not a rendering fact, and nothing in the desktop reads it, so shipping it would be the doc-21 §2 defect shape. AC#1 is pinned through the public surface rather than a seam, because `ExamBuildReceipt` carries `request`: a second `makeClient` over the same database is a real restart (one service and one request map per `createExamHandlers`), and a test reusing one client would never reach the rebuild and would pass against the bug. AC#5 is doc-14 §3, which claimed focus made re-practice land where it hurt; the row now says the field is persisted and round-tripped but unread at selection time, and points at TASK-140.

Two mutation-gate seams, because a green test proves nothing until the mutation dies: `exam-request-focus-rebuild` reverts the service to `focus: []` and `exam-focus-not-persisted` reverts the store write. Both were confirmed caught before the seams were added.

Verification: check-types 14/14, root test 10/10 (db 39, server 157), ultracite clean, 10/10 mutation anchors resolve.
<!-- SECTION:NOTES:END -->
