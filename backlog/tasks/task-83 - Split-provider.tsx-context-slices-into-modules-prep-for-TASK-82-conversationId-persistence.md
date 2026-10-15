---
id: TASK-83
title: >-
  Split provider.tsx context slices into modules - prep for TASK-82
  conversationId persistence
status: Done
assignee: []
created_date: '2026-09-21 03:31'
updated_date: '2026-09-21 03:38'
labels:
  - refactoring
  - frontend
  - chat-session
dependencies: []
ordinal: 704000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/chat-session/src/provider.tsx is the repo's top churn hotspot (fan_in 11, accelerating, 570 lines) and TASK-82 (persist conversationId) will touch its persistence + identity logic. Prep: extract the context slices into separate modules so TASK-82 lands on a smaller surface. Keep the public useChatSession/ChatSessionProvider API unchanged; one new test per extracted module if behavior-relevant. Per the vercel-composition-patterns state-context-interface split already documented in ai.tsx: state (mutable runtime values), actions (imperative handles), meta (auxiliary render data).
<!-- SECTION:DESCRIPTION:END -->
