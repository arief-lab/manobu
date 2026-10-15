---
id: TASK-172
title: 'Exam: a resource 404s during the paper flow'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-29 06:41'
updated_date: '2026-09-29 09:23'
labels:
  - desktop
  - exam
dependencies: []
references:
  - >-
    backlog/docs/qa/doc-25 -
    QA-pass-2026-09-29-desktop-surfaces-exam-flow-discoverability.md
priority: low
type: bug
ordinal: 937000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA pass doc-25 (finding D8). During an end-to-end exam run (build via /ai, start, answer three sections, submit, view the scored result) the browser console logged one "Failed to load resource: 404 (Not Found)". Cosmetic but it means the surface requests something that is missing. Refs: apps/desktop/src/routes/exam/\$examId.tsx, apps/desktop/src/features/exam/exam-paper-pane.tsx.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The 404 is identified (which request) and either the missing asset is provided or the request is removed.
- [x] #2 A full exam run logs zero console errors.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Root cause: the 404 is POST /rpc/chat/slashCommands for the exam conversation. The exam route ($examId.tsx) always sets open=, so resolveConversationKnown is true on mount and useSlashCommands fires, but the ACP session id is only persisted inside the first turn (context.ts:386 via runTurn), never at row creation (exam-service.ts:2471). A turn-less stored conversation => storedSessionId null => chat-rpc.ts:724 throws NOT_FOUND (404). Server behavior is pinned (chat-e2e.test.ts:982 + contract) so it stays. Fix: give slashCommands its own stricter gate resolveSlashSnapshotReady(messages) in provider.tsx, true only once a card a live agent session emits exists (text/thinking/plan/tool/permission/terminal/usage/ask). Excludes user_created (emitted pre-session at chat-rpc.ts:470), paper/drill_item (server-built), error/retry_notice. listMessages keeps conversationKnown (a row with no messages returns 200). Coverage: provider-initial.test.ts new describe; verify seams still resolve.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification evidence:
- Direct-nav driver (/tmp/qa/driver-172d.ts) against vite preview :3010 on stored exam conversation exam-21ecaa2b-... (acp_session_id empty, exactly the pre-fix 404 source): POSTs to /rpc/chat/* are only getConversation + listMessages; slashCommands POST fired? false; 4xx/failed: (none); console errors: (none); RESULT rendered (screenshot /tmp/qa/172-exam-full.png shows the paper chat + result + answer review).
- Unit coverage: packages/chat-session/src/provider-initial.test.ts new describe resolveSlashSnapshotReady (TASK-172), 6 tests (empty, paper, user_created, error+retry_notice, agent-card allowlist, mixed). 24/24 pass in that file.
- Mutation seam chat-slash-snapshot-fires-on-a-sessionless-transcript is caught (bun scripts/mutation-gate.ts chat-slash-snapshot-fires-on-a-sessionless-transcript).
- Gates: bun run check-types 14/14; ultracite check on 4 changed files clean; bun test in packages/chat-session 272/272; apps/desktop 545 pass/3 skip; bun run check:dox complete; bun x fallow dead-code --boundary-violations 0 issues; bun scripts/mutation-gate.ts --check all 66 anchors resolve.
- favicon: added apps/desktop/public/favicon.ico (copied from src-tauri/icons/icon.ico); Chrome's automatic /favicon.ico fetch was the second 404 the QA observation may have counted. No <link rel=icon> needed; SVG-link form does not suppress the legacy .ico probe.
- Docs: packages/chat-session/AGENTS.md conversation-known-gate bullet rewritten to document the TASK-172 split (listMessages keeps resolveConversationKnown; slashCommands now uses resolveSlashSnapshotReady). apps/desktop/AGENTS.md gained a Static assets bullet naming public/ and the favicon.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Two 404s behind the exam-flow console error, both closed.

1. POST /rpc/chat/slashCommands: the exam route always sets open=, so the shared resolveConversationKnown gate let the slash snapshot fire on mount against a conversation the server created but never ran a turn on. The ACP session id is persisted only inside the first turn (context.ts:386 via runTurn), never at row creation (exam-service.ts:2471), so chat-rpc.ts:724 threw NOT_FOUND (404). Server behavior is pinned (chat-e2e.test.ts:982 + the api-contract NOT_FOUND declaration), so the fix is client-side: a new resolveSlashSnapshotReady(messages) gate in packages/chat-session/src/provider-initial.ts returns true only once the transcript holds a card a live agent session emits (text/thinking/plan/tool/permission/terminal/usage/ask); user_created (emitted pre-session at chat-rpc.ts:470), paper/drill_item (server-published) and error/retry_notice are deliberately excluded. provider.tsx now passes it to useSlashCommands; meta.conversationKnown still feeds listMessages (a stored row with no session answers 200 with an empty list). New describe in provider-initial.test.ts (6 tests) + new mutation seam chat-slash-snapshot-fires-on-a-sessionless-transcript pin the gate.

2. GET /favicon.ico: Chrome auto-fetches it on every page load; the web build had no public/ dir and no icon, so the request 404'd. apps/desktop/public/favicon.ico added (copied from src-tauri/icons/icon.ico).

Browser verification: direct-nav driver against vite preview :3010 on stored exam conversation exam-21ecaa2b-... (empty acp_session_id, the pre-fix 404 source) now logs only getConversation + listMessages, no slashCommands POST, zero 4xx/failed, zero console errors, and the paper renders (screenshot /tmp/qa/172-exam-full.png).

Docs: packages/chat-session/AGENTS.md conversation-known-gate bullet rewritten to document the split; apps/desktop/AGENTS.md gained a Static assets bullet naming public/ and the favicon.

Gates: check-types 14/14; ultracite check clean; chat-session 272/272; desktop 545 pass/3 skip; mutation-gate --check 66/66 anchors resolve; new seam caught; check:dox complete; fallow boundary-violations 0.
<!-- SECTION:FINAL_SUMMARY:END -->
