---
id: TASK-57
title: >-
  Ask Sensei floating panel crashes on open — MessageTranscript mounted without
  MessageScroller.Provider (pre-existing TASK-32.2 bug, surfaced by TASK-35 rail
  work)
status: Done
assignee: []
created_date: '2026-09-10 03:42'
updated_date: '2026-09-10 03:55'
labels:
  - bug
  - frontend
dependencies: []
priority: high
ordinal: 536000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during TASK-35 (browser pass, 2026-09-10): MessageTranscript (packages/chat-session/src/message-transcript.tsx:55) mounts the MessageScroller compound (root/viewport/content) but NOT its Provider; the scroll hook throws 'useMessageScroller must be used within a MessageScroller'. Every working consumer wraps it externally — ai.tsx:111 wraps its whole surface, the new rail.tsx wraps it (that fix shipped with TASK-35). ask-sensei/panel.tsx (the floating widget panel, TASK-32.2) does NOT wrap it — clicking the launcher FAB on / or /settings throws and hits the error boundary. Repro: bun run dev (apps/desktop), open /, click the pink sparkles FAB bottom-right → 'Something went wrong'. One-file fix: wrap the panel content in MessageScroller.Provider (it can share the outer div), or move the wrap into MessageTranscript itself if the compound is never used provider-less (check ai.tsx + chat-history consumers first — moving it into the transcript is the cutover if true).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ask-sensei/panel.tsx renders MessageTranscript inside MessageScroller.Provider (same wrap as ai.tsx and ask-sensei/rail.tsx)
- [x] #2 Browser-verified: open / (non-learn route), click the Ask Sensei FAB, panel opens with transcript + composer, no error boundary
- [x] #3 bun run test + check-types + ultracite clean (apps/desktop)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 75ccaa5): AC1 satisfied via cutover — MessageTranscript (packages/chat-session/src/message-transcript.tsx) now OWNS its MessageScroller.Provider; panel.tsx + dev.chat-history.tsx (second bare consumer found) render it without any wrap; ai.tsx + rail.tsx redundant wraps removed. BONUS defect found + fixed during browser verify: widget.tsx open-state had NO ChatSessionProvider at all — TASK-30 (Sep 8) stripped it as a dead VITE_DEBUG ref, so every FAB open threw 'useChatSession must be used within ChatSessionProvider' BEFORE the scroller error even hit. Re-added provider-per-instance. AC2 verified: FAB on / opens panel, transcript + composer render, message send streams, no error boundary; /dev/chat-history + /ai clean. AC3: 9/9 tasks, ultracite 282 files, tsc clean.
<!-- SECTION:NOTES:END -->
