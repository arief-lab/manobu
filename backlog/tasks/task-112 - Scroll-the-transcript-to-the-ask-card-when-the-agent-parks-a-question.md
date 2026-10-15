---
id: TASK-112
title: Scroll the transcript to the ask card when the agent parks a question
status: To Do
assignee: []
created_date: '2026-09-24 04:37'
labels: []
dependencies: []
ordinal: 865000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When the ask card lands on a live /ai turn, the MessageScroller does not follow it: a live repro (2026-09-24) showed the Submit/Decline row stranded at the top of the viewport with dead space below while the tool-call JSON filled the view above, so the learner may never notice the questionnaire is waiting for an answer (the turn is blocked on it; deriveStatus treats a parked ask as streaming). The transcript renders through `<MessageScroller>` in packages/chat-session/src/message-transcript.tsx.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When a NEW ask card lands in a live transcript, the scroller follows it to the end so the card is visible
- [ ] #2 If the learner has scrolled up to read older turns, the ask landing does not yank them to the bottom; the existing scroll-to-end affordance still works
- [ ] #3 Streaming text and other card families keep their current autoscroll behavior (no regression)
- [ ] #4 Behavior is verified in the running app (drive a live ask park and screenshot) and the contract note lands in packages/chat-session/AGENTS.md
<!-- AC:END -->
