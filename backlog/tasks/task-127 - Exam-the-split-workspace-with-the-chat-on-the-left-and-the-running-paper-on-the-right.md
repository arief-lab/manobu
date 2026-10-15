---
id: TASK-127
title: >-
  Exam: the split workspace with the chat on the left and the running paper on
  the right
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:07'
updated_date: '2026-09-25 11:04'
labels: []
dependencies:
  - TASK-126
documentation:
  - >-
    backlog/docs/feature/doc-17 -
    Exam-workspace-chat-on-the-left-the-running-paper-on-the-right.md
  - backlog/docs/feature/doc-19 - UI-wireframes-the-chat-learning-surface.md
  - >-
    backlog/docs/feature/doc-14 -
    JLPT-exam-generation-pipeline-request-assembler-validator-storage.md
priority: high
type: feature
ordinal: 867500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`doc-12` §4.4 puts a generated paper in a split workspace rather than reusing the single-surface wizard route, so generation, running and the debrief stay one conversation. `doc-17` §2 fixes the layout contract (the paper column keeps a minimum measure of `minmax(360px, 32%)` and the chat collapses to an icon rail below the breakpoint, never the reverse). `doc-17` §3 lists the mounting traps that break silently: exactly one `ChatSessionProvider` on the route, the floating AskSensei launcher must not mount here (one provider, no draft-blob race), and `isChromeFreePath` needs a prefix branch because a parameterised route can never match by equality. `doc-17` §4 is the leak the split introduces: in `exam-conditions` the composer pauses with an explanatory line rather than letting the learner chat mid-timer, while `shortened` keeps it live so asking a question is allowed. `doc-17` §6 keeps every answer surface hidden until submit. `doc-19` §6 draws both modes, the narrow window, submit and abandon, and the resume-after-reload case.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Layout: the paper column keeps its minimum measure at the breakpoint, collapsing the chat gives the paper the full width, and the preference survives reload.
- [x] #2 Mounting: exactly one `ChatSessionProvider` renders on the route, the AskSensei launcher does not render here (assert the hide list), and an unknown exam id is a route error rather than an empty workspace.
- [x] #3 Chat continuity: the left column opens the paper's own conversation, and the card lands back in the workspace when opened from chat history.
- [x] #4 Composer gating: live in `shortened`, paused with its line in `exam-conditions`, live again immediately after submit, and the paused state still permits abandon.
- [x] #5 No leak: a golden asserts the running transcript and the pre-submit pane contain no `answerIndex` and no answer text.
- [x] #6 Timer: thresholds announce at 5 minutes, 1 minute and time up, the clock does not announce every second, time-up auto-submits the section without clearing an answer, and `exam-conditions` records pauses that the result then shows. The visible clock keeps updating silently while announcements are threshold-only.
- [x] #7 Sections: one active section at a time, a section cannot be re-entered while a later one is active, and the transition persists.
- [x] #8 Resume: quitting mid-section resumes into the same section with answers intact and a stopped clock, including across an app relaunch.
- [x] #9 End states: submit unlocks the composer and posts the debrief in the same thread; abandon records no score and is never shown as a zero.
- [x] #10 Keyboard: the paper column takes focus when a section activates; number or letter keys select an option and `Enter` advances; the option group is a real radio group (`fieldset` + `legend`, as `Choices` already is at `apps/desktop/src/features/mock/jlpt-mock.tsx:175`); and `Escape` never silently leaves a running paper.
- [x] #11 The collapse toggle is a real button carrying `aria-pressed`, and toggling it does not move focus out of the paper mid-answer.
- [x] #12 Text on any solid fill clears WCAG AA 4.5:1, and the app ships the one sumi/kibari/ai/shu theme with no `dark:` variant (DESIGN.md).
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extend the exam contract, schema, and store with durable pause/resume, abandon, section time-up, and pause accounting required by TASK-127. 2. Add the typed desktop exam query/mutation layer and share the writable chat-column composition without duplicating ChatSessionProvider. 3. Build the chrome-free /exam/ split workspace with PaperScope, key-free running paper, composer gating, persisted collapse preference, keyboard controls, and honest end states. 4. Thread paper-card navigation from chat history into the workspace and add focused contract, store, route, and UI tests. 5. Run affected typechecks, tests, lint, builds, and browser verification; update the owning DOX records.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added migration 0011 and strict exam contract fields for durable pause state, remaining section time, pause/resume/abandon procedures, and result pause totals. Refactored service lifecycle writes through immediate transactions, made time-up advance only the active section, and kept abandoned exams result-free. Verification: @manobu/api-contract, @manobu/db, and apps/server typechecks pass; DB item-store 13/13 and server exam-pipeline 9/9 pass.

Completed the chrome-free /exam/$examId split workspace, shared ChatColumn composition, key-free paper UI, durable per-section clocks and pause/resume/abandon lifecycle, threshold-only timer announcements, persisted collapse preference, and submitted/abandoned end states. Browser walkthrough covered start, answer, keyboard selection/advance, pause plus reload with stopped clock, wide/narrow layout, composer gating/unlock, submit/result, abandon confirmation, unknown id, and history-to-paper navigation with no console errors. Validation: desktop 432 pass/3 skip; chat-session 249 pass; UI 168 pass; DB 34 pass; server 147 pass/1 skip; root check, 16-package typecheck, desktop/server builds, and git diff --check pass. Scoped TASK-127 fallow dead-code is clean; the branch-wide audit remains at the known 16 dead-code, 36 complexity, and 3 duplication findings outside the new TASK-127 files.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the generated-paper split workspace at /exam/$examId with one chat provider, a shared writable chat column, durable section clocks and lifecycle controls, key-free keyboard-accessible paper states, persisted chat collapse, and honest submit/abandon results. Verified with full affected test suites, root lint/typecheck/builds, and a browser click-through.
<!-- SECTION:FINAL_SUMMARY:END -->
