---
id: TASK-133
title: 'Docs: capture rendered frames back into doc-19 for the surfaces that now exist'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:26'
updated_date: '2026-09-26 03:51'
labels: []
dependencies:
  - TASK-125
  - TASK-127
  - TASK-128
documentation:
  - backlog/docs/feature/doc-19 - UI-wireframes-the-chat-learning-surface.md
  - >-
    backlog/docs/feature/doc-12 -
    Chat-generated-JLPT-exams-N5..N1-a-kana-readiness-gate.md
priority: low
type: chore
ordinal: 869500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`doc-19` §13 keeps this open and `doc-19` §12.1 records what the 2026-09-24 browser pass could and could not cover. The ASCII frames are exact about shape but cannot show spacing, elevation or the type scale, and five surfaces had nothing rendered to compare against, so §2.2 and §3 to §6 and §8 stay unvalidated. Once the drill card, the checkpoint, the confirm card, the workspace and the review exist, screenshot each against its frame and attach it with alt text, then correct any frame the running surface contradicts rather than adjusting the screenshot to match the drawing. The surfaces that already exist (`/ai`, `/jlpt-mock`, `/dashboard`, `/settings`, `/drill`) were checked on 2026-09-24 and are recorded in §12.1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each surface in doc-19 §1's inventory has either an attached screenshot with alt text or a recorded reason it could not be captured.
- [x] #2 Every frame the running surface contradicts is corrected in doc-19, with the correction noted in §12 rather than silently redrawn.
- [x] #3 The copy keys named in §11 are checked against the running strings, and any string that renders without a key is recorded as a spec bug.
- [x] #4 doc-19's status line and revision log record the pass.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Boot the dev stack for real: the sidecar on :3000 (BUN_PORT, a temp DATABASE_URL so the learner's data is untouched) plus vite on :3001, which now proxies /rpc and /ws (TASK-116 closed the env-var gap doc-19 §13 complained about). 2. Seed a real exam through the sidecar's own RPC surface (request, assemble, start, answer every item, submit) so /exam/$examId renders the workspace, the submitted result and the review phase without fabricating UI state. 3. Capture each drivable surface with a real browser screenshot plus alt text, and compare it against its frame: a frame the running surface contradicts is corrected in the frame and the correction is noted in §12, never the other way round. 4. Drive the drill card through the real WS surface (chat.startDrill parks an item, the row persists, the history fold renders the card); the ask/confirm card needs a live agent that calls ask_user, so if it cannot be driven, record that precise reason per AC#1 rather than leaving it silent. 5. Check every copy key named in §11 against the running strings and record any string that renders without a key as a spec bug. 6. Update the status line and the revision log, then finalize the task.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Audit method (so the next pass is cheaper): boot the sidecar on :3000 against a throwaway DATABASE_URL and vite on :3001, then seed state through the sidecar's OWN procedures (exam.request/assemble/start/answer/submit over /rpc, chat.startDrill over the WS) so nothing on a captured surface is hand-written into the database. Two environment gotchas cost real time and belong in the developer setup: apps/desktop/.env pins VITE_SERVER_URL to the Tauri port 4317, which silently overrides the TASK-116 vite proxy, so a browser session must launch vite with VITE_SERVER_URL=http://127.0.0.1:3000; and vite binds [::1]:3001 only, so the browser must use localhost, not 127.0.0.1.

AC#1: six of the nine §1 inventory rows are captured as screenshots under backlog/docs/feature/img/ with one line of alt text each in §12.2, and the three that are not carry a stated reason. The kana checkpoint reason is stronger than "unbuilt": the component branch exists (jlpt-mock.tsx:635) but the only mount passes neither the checkpoint nor the source prop (routes/jlpt-mock.tsx:220), so the surface is unreachable in the running app, which is why all five §4 frames are still unvalidated.

AC#2: five frames redrawn from the screenshots (§6.1, §6.3, §7.1, §7.2, §8), every redraw verified at the doc's 78-display-column convention (all 28 frames in the doc now check out), each correction also noted in its own section rather than only in §12.2. The largest corrections: §6.1's chips are status words and not navigation, §7.1 promised three things the pane does not render (sectional marks, a CEFR line, a pause summary), and §8's row is a disclosure that opens onto the options with the correct one ticked, which the old frame never drew.

AC#3: all 57 keys named in §11 exist in the deck, so the table's claim holds. Two shapes recorded instead: exam.review.sendToDesk and paper.debrief.weak render only when an item was answered wrong, and two frame controls had no key and no render at all (§7.1's send-the-weak-N button, §8's Explain button), so both frames no longer draw them. The §2.1 keyless-strings row is unchanged and still true.

AC#4: the status line is now draft v3 and §12.2 is the dated pass; §13's open item is closed with the three residual reasons.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Captured the rendered frames doc-19 §13 asked for and corrected every frame the running surface contradicted. Six of the nine §1 inventory rows are now screenshots with alt text (workspace shortened / exam-conditions / narrow, banded + failing + raw-only results, the 30-row review, a real parked drill card), all seeded through the sidecar's own RPC and WS procedures against a throwaway database. Five frames were redrawn at the 78-column convention and each correction noted in its own section. Four findings are recorded as defects rather than drawing errors, the important one being that every generated paper's correct answer is option A: hashString + deterministicOptionOrder append the option index as the hash's last character, so the hash order is the identity order for any prefix and the seeded shuffle never reorders (all 30 items in a seeded paper carry answerIndex 0). Three surfaces stay uncaptured with stated reasons; the kana checkpoint has no mount at all, which is why its five frames remain unvalidated.
<!-- SECTION:FINAL_SUMMARY:END -->
