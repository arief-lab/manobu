---
id: TASK-158
title: 'Mock: /jlpt-mock is a maintained seed surface no learner can reach'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 08:27'
updated_date: '2026-09-28 11:18'
labels:
  - desktop
  - mock
  - ux
dependencies: []
priority: low
ordinal: 923000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA walk 2026-09-28 flagged /jlpt-mock as orphaned legacy. Checking the premise corrected it, and the ticket has to carry the correction.

What is true: nothing in the app links to it. The only header link is `const links = [{ label: "AI Chat", to: "/ai" }]` (apps/desktop/src/shared/header.tsx:11), and the other mentions are a comment (header.tsx:6) plus the generated routeTree. It renders hardcoded data with no server call: `const SEED: readonly Question[] = [` (apps/desktop/src/routes/jlpt-mock.tsx:27) with `prompt: "これは本__。"` (:29).

What is NOT true: that it is dead or slated for removal. It carries its own honesty badge (`data-testid="mock-seed-fallback"` at jlpt-mock.tsx:197), apps/desktop/AGENTS.md:43 documents it as the built-in seed surface rather than the generated-paper workspace, apps/desktop/src/features/AGENTS.md lists `mock/` as a Tier-1 wired feature, and TASK-62 (To Do) plans to add a weakness bridge to its scored screen. So it is unlinked but live and scheduled for more work.

The defect is therefore an inventory contradiction, not dead code: the app maintains a second exam surface that a learner can only reach by typing a URL, while the generated paper at /exam/$examId is the primary one. Someone has to decide which is true.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The task states, and the nearest AGENTS.md records, whether /jlpt-mock is a reachable surface or an internal-only one
- [ ] #2 If reachable: it is reachable from the app, not only from the address bar, and the entry point says what it is for
- [x] #3 If not reachable: TASK-62 is re-scoped or closed, because planned work cannot sit on an unlinked surface
- [x] #4 The two exam surfaces are distinguished in copy so a learner is not left guessing which one is the real paper
- [x] #5 apps/desktop/AGENTS.md:43 and the features Tier-1 row are updated to match the decision
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Decision (AC#1)

/jlpt-mock is an INTERNAL-ONLY surface: a seed/demo harness for the JlptMock wizard Card family and the built-in offline paper fallback. It is NOT a learner surface and gets no entry point. Research that settles it:

- `JlptMock` has exactly ONE consumer in the tree: `routes/jlpt-mock.tsx`. The wizard family (`features/mock/jlpt-mock.tsx`, `kana-checkpoint-result.tsx`, `lib/mock.ts`) closes over itself; only `features/mock/review-queue.tsx` feeds a real surface (`/review`).
- The learner's paper is `/exam/$examId`, generated from the shipped corpus, with server scoring, sections, debrief and review. A second paper built from 9 hand-typed questions (`SEED` at jlpt-mock.tsx:27) cannot coexist with it as a peer: a learner who found both could not tell which score meant anything.
- So the fix is to name what already is true, not to add a link. AC#2 (reachable) is therefore NOT the chosen branch.

## Changes

1. jlpt-mock.tsx header copy: the subtitle reads like a feature pitch ("Sequential wizard · real+pausable timer · score + weak patterns"). Replace it with a line that says what the data is and which surface is the real paper (AC#4). R-02 applies: no em dash.
2. apps/desktop/AGENTS.md:43: record the decision in the same breath as the existing seed-surface sentence (AC#1, AC#5).
3. apps/desktop/src/features/AGENTS.md `mock/` Tier-1 row: say the family serves an unlinked internal route, so a future reader does not read "Tier-1 wired" as "learner-facing" (AC#5).
4. TASK-62 (AC#3): re-scope rather than close. Its user value (score -> weak pattern -> matching practice surface) is real, but it cannot sit on a surface no learner reaches, and its own AC#3 asks for a browser pass ("score a mock and follow a bridge link") that is unperformable from the app. Re-target it at the submitted paper's review surface, where the weak anchors are the learner's actual misses.

## Left alone

- The route, its loader, the SEED corpus, the wizard and its tests: all stay. Internal-only is not deleted; it is labelled.
- `shared/header.tsx` gets no new link (that would be the AC#2 branch, rejected).

## Bug found while reading, reported not fixed here

`Plan`'s two buttons (jlpt-mock.tsx:686-699) are no-op markers: `startPlan` and `reviewMistakes` only `window.console.info`. That is the inert-button shape the mutation gate exists for. It is on an unreachable surface, and wiring it is TASK-62's feature work, so it is out of 158's scope; it moves with TASK-62's re-scope.

## Verify

- bun test apps/desktop; bun run check-types; bun x ultracite check on touched files; bun run check:dox
- browser: load /jlpt-mock and read the header, confirm the copy states what the surface is

## Correction after research (changes step 4)

TASK-62 is CLOSED as superseded, not re-scoped. The weakness bridge it asks for already ships on the surface that matters: `sendToDesk` (apps/desktop/src/features/exam/exam-paper-scope.tsx:403) takes the submitted paper's own debrief misses (`debrief.items.filter(item => item.correct === false)`, :405), dedupes their anchors (:406) and calls `chat.startDrill` with them (:413). The control is rendered and live: `exam-paper-pane.tsx:713-722` shows the `exam.review.sendToDesk` button, disabled while the request is in flight, only when the paper actually has a wrong answer. So re-targeting TASK-62 would rebuild an existing feature; the only thing its plan added over what exists is per-pattern links to /learn/conjugate and /learn/listen, which the anchor-driven desk drill already covers from real misses.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#2 is left UNCHECKED on purpose: it is conditional on the reachable branch, which the decision rejected. No entry point was added anywhere.

Shipped: the route header now reads "Internal surface · built-in seed questions, not a generated paper. The scored exam is the one the server assembles at /exam." (jlpt-mock.tsx:192); apps/desktop/AGENTS.md records the decision next to the TASK-126 seed-surface line; the features Tier-1 `mock/` row says INTERNAL-ONLY and that `JlptMock` has exactly one consumer.

TASK-62 closed as superseded (retitle + notes + final summary, its own ACs left unchecked because they were never implemented as written).

Bug found and fixed while reading the seed: q2 (jlpt-mock.tsx:41) offered "は" under BOTH `a` and `b` with `correctId: "b"`, so picking the other copy of the right answer was scored wrong. `b` is now "に" and the key is `a`. Nothing guarded this, so `SEED` is exported and test/jlpt-mock-seed.test.ts pins five properties over the data the wizard renders (unique ids, correctId among choiceIds, a string per option, no answer text twice, the correct text unique). Mutation seam mock-seed-offers-the-same-answer-twice, CAUGHT.

Validation: apps/desktop 498 pass / 3 skip / 0 fail; check-types 14/14; ultracite clean on touched files; check:dox complete; mutation-gate --check 35/35 anchors. Browser: /jlpt-mock renders the new header with zero RPC requests, which is the point of the surface (no server needed).

Still open on this surface, deliberately not touched: Plan's "Start plan" and "Review mistakes" buttons (jlpt-mock.tsx:686-699) are no-op `window.console.info` markers. They are inert controls on an internal route; wiring them is feature work that TASK-62's closure now leaves unowned.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Decided and recorded: /jlpt-mock is an internal-only seed harness, not a learner surface, so it gets no entry point and no planned learner work. Evidence: JlptMock has exactly one consumer (the route), the learner's scored paper is the generated one at /exam, and the weakness bridge TASK-62 wanted already ships there (exam-paper-scope.tsx:403 sendToDesk -> chat.startDrill on the debrief's own misses), so TASK-62 is closed as superseded. Copy on the route now says what it is (verified in a browser render). Docs updated in apps/desktop/AGENTS.md and the features Tier-1 row. Also fixed a real seed defect found while reading: q2 offered the correct string twice and scored the other copy wrong, now pinned by test/jlpt-mock-seed.test.ts plus a mutation seam.
<!-- SECTION:FINAL_SUMMARY:END -->
