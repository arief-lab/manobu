---
id: TASK-111
title: Collapse the live thinking strip and keep the shimmer as the waiting signal
status: To Do
assignee: []
created_date: '2026-09-24 04:36'
labels: []
dependencies: []
ordinal: 867000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-87 shipped the thinking strip EXPANDED during live turns (`followingStream ? "Thinking..." : "Thought"` in packages/chat-session/src/parts/acp-thinking-part.tsx:47). With agents that emit reasoning immediately (opencode: ~1s), the shimmer row (message-transcript.tsx:171-181, gated on `status === "submitted"`) is never visible and a wall of raw monospace reasoning dominates the transcript, which the user reports as "the thinking shimmer is gone" and a broken-looking chat. The user wants the quiet shimmer row back as the waiting affordance and reasoning to not grab the layout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A live turn renders the thinking strip collapsed by default (header row only); expanding it via the existing control shows the reasoning text
- [ ] #2 The shimmer "Thinking…" row still renders from submit until the first card lands, so the waiting state is visible
- [ ] #3 Replayed/history transcripts keep rendering thinking collapsed exactly as today (no regression)
- [ ] #4 Existing thinking tests (chat-card-switch.test.tsx, thinking-collapse.test.tsx) are updated to pin the new live behavior and packages/chat-session/AGENTS.md records the changed contract
<!-- AC:END -->
