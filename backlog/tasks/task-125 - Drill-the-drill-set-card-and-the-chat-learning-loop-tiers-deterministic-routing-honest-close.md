---
id: TASK-125
title: >-
  Drill: the drill-set card and the chat learning loop (tiers, deterministic
  routing, honest close)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:07'
updated_date: '2026-09-25 05:13'
labels: []
dependencies:
  - TASK-121
  - TASK-124
documentation:
  - >-
    backlog/docs/feature/doc-15 -
    Chat-learning-loop-casual-chat-drill-sets-exam-handoff.md
  - >-
    backlog/docs/feature/doc-16 -
    JLPT-item-engine-shared-question-items-difficulty-grading-and-storage.md
  - backlog/docs/feature/doc-19 - UI-wireframes-the-chat-learning-surface.md
priority: high
type: feature
ordinal: 867000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
This is tier 2 of `doc-15`: the chat stays a conversation, and a drill set is a card inside it rather than a route swap. `doc-15` §2 states the rule that shapes everything else: the chat must never quiz unprompted, so an item appears only after an accepted offer (see the intent task). `doc-15` §5 models the card on the existing host-MCP `ask_user` flow, and `doc-19` §3 draws its four states: pending, answered with the settled verdict, suspended, and the summary. Three containment rules matter. The key never enters the transcript, so the request frame carries prompt and options only and the key is resolved app-side after the pick. The host drill call must not render a raw JSON tool-call card, which is the `TASK-110` assertion extended to this tool name. And the verdict renders before any agent prose, with a wrong pick always showing the explanation affordance. `doc-15` §6 closes honestly: counts equal `drill_attempts`, a non-FSRS item writes no grade, and a non-FSRS item's interval is never invented. `doc-19` §3.4's summary offers exactly one next step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Routing: explicit commands beat signals, a model proposal never starts a session without an accepted offer, and every tier is reachable by a test.
- [x] #2 A pending item renders interactive; after the pick it renders the settled state with both the picked and the correct option; a replay from stored rows shows the same settled state with no interactive controls.
- [x] #3 Key containment: a golden asserts the item frame in the transcript carries no `correctIndex`, and the resolution carrying the key appears only after the pick.
- [x] #4 The host drill call does not render a JSON tool-call card, extending the `TASK-110` assertion to this tool name.
- [x] #5 Verdict ordering: the verdict renders before any agent prose, and a wrong pick always shows the explanation affordance.
- [x] #6 Adaptation: two consecutive misses on one anchor inserts a worked example then a near-neighbour item, and a later correct answer re-queues the missed item exactly once.
- [x] #7 Bounded and honest: a session ends at its declared length, `stop` ends it early with the real counts, counts equal `drill_attempts`, and a non-FSRS item writes no grade.
- [x] #8 Degradation: no server or no item available yields an honest "no item right now" line and keeps tier 1 working, and flattening the model entirely still allows explicit sessions.
- [x] #9 The thirteen keys in doc-15 §6.1 exist and contain no em dash, enforced by `packages/ui/test/copy-snapshot.test.ts`.
- [x] #10 The drill card and the ask card share one transcript card width token, decided in this task, so the chat column does not render two competing measures (`doc-19` §13).
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a key-free drill host-call wire contract and generalize the ACP parked-host-call seam while preserving ask_user compatibility. 2. Register next_drill_item beside ask_user and add a server drill bridge that owns the singleton TASK-124 lifecycle, session ownership, draw/settle/pause/resume/end, and post-pick verdict resolution. 3. Add explicit drill start/session wiring from the existing intent path and a stored-item batch provider with honest unavailable degradation; do not let the browser grade or access answer keys. 4. Persist/replay semantic drill frames with pending/finish/error lifecycle, suppress host-tool JSON, and publish the verdict before agent prose. 5. Add the shared drill card and chat-session adapter, stretched width token, pending/answered/suspended/summary/unavailable states, and the thirteen R-02 copy keys. 6. Add routing, key-containment, verdict-ordering, adaptation, bounded-summary, degradation, SSR/WS, copy, and regression tests; update ACP/server/chat-session/desktop/UI DOX and run all gates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation: root bun run check clean; root bun run check-types passed all 14 workspaces; server 138 pass/1 skip; ACP 145 pass; chat-session 243 pass; UI 157 pass; DB 29 pass; desktop 438 pass/3 skip; item-engine 14 pass. Added migration 0009 for durable skip/adaptation state. Fallow audit still reports pre-existing/complexity/dead-code findings in the accumulated branch; no TASK-125 commit created yet.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the host-MCP next_drill_item drill loop: key-free ACP/persisted semantic frames, direct model-free starts, local answer/skip/stop settlement with next/summary publication, adaptation pair plus one-time requeue, honest degradation/counters, route confirmation gating, and shared chat/UI card states. Added migration 0009 and WS/SSR/replay/key/ordering/adaptation/copy regressions.
<!-- SECTION:FINAL_SUMMARY:END -->
