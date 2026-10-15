---
id: TASK-79.2
title: '79.2 Template composer UI: stop button, IME-safe Enter, model select in addon'
status: Done
assignee: []
created_date: '2026-09-15 06:59'
updated_date: '2026-09-15 08:21'
labels:
  - frontend
  - ai-chat
dependencies: []
parent_task_id: TASK-79
priority: high
type: feature
ordinal: 519000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rewrite the footer form in apps/desktop/src/routes/ai.tsx (lines ~264-299) to the template's prompt-form.tsx shape: InputGroup with InputGroupTextarea (p-3.5, auto-grow), Enter submits / Shift+Enter newline / isComposing guard for Japanese IME (critical for this app), block-end addon row with the model picker moved INTO the composer (template puts ModelSelect in the addon; we keep the header pickers for persona+agent but move Model to the composer), and a busy state: while streaming the submit button becomes an outline SquareIcon stop button calling chat stop (provider must expose stop; check ChatSessionApi in packages/chat-session/src/provider.tsx, add if missing - renaming/removing fields needs all consumers updated, adding is fine per AGENTS.md). Currently ai.tsx disables submit while isSending and shows a spinner - the template's stop control is strictly better UX for long generations. Keep draft persistence (input rides the manobu:chat:v1 blob, TASK-66).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Japanese IME: composing a kana conversion with Enter does NOT submit; confirmed by driving a composition via CDP or by unit-testing the keydown handler.
- [x] #2 While streaming, the button is an accessible stop control (aria-label Stop generating) that halts output; after stop, composer re-enables with draft intact.
- [x] #3 route-loaders + chat-session exports/multi-mount/persistence tests green; new keydown behavior pinned by a test.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope add (user): the composer addon carries the CLI/agent Picker too, not just the model select.

AC1 via the unit-test path the AC allows: CDP Input.insertText commits text without a live composition session, so the isComposing guard is pinned by prompt-keydown.test.tsx (4 SSR contract tests) instead. Browser proved the rest: agent picker opens the full CLI list, atomic stop click mid-stream returns status to ready with draft intact in DOM + blob. Note: an earlier 'draft lost on stop' reading was a test artifact - the fast local agent finished before the click, the button had swapped back to Send, and the click submitted the draft (adds a second user message; not a product bug).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Template composer parity: agent (CLI) + model pickers moved into the composer's block-end addon (persona stays in the header), streaming submit button becomes an aria-labelled SquareIcon stop control with the textarea left enabled, Enter is IME-safe via the isComposing guard in onPromptKeyDown. Also fixed a pre-existing crash the move surfaced: Picker.Content rendered its Heading as Base UI Menu.GroupLabel without a Menu.Group ancestor, so opening ANY picker threw MenuGroupContext-missing into the error boundary (reproduced at HEAD with the persona picker); children now wrap in DropdownMenuGroup. Pinned by prompt-keydown.test.tsx; ui 95 + chat-session 35 + desktop 369 tests, typecheck, build, ultracite, fallow audit all green.
<!-- SECTION:FINAL_SUMMARY:END -->
