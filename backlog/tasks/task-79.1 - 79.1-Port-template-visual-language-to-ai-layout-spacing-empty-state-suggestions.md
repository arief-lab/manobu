---
id: TASK-79.1
title: >-
  79.1 Port template visual language to /ai (layout, spacing, empty state,
  suggestions)
status: Done
assignee: []
created_date: '2026-09-15 06:59'
updated_date: '2026-09-15 07:27'
labels:
  - frontend
  - ai-chat
dependencies: []
parent_task_id: TASK-79
priority: high
type: feature
ordinal: 518000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Adopt the template's look without its stack. From components/chat.tsx + app/page.tsx: centered max-w-2xl column, gap-6 message rhythm, generous px-6 py-6 scroller padding, Empty state with Suggestions chips (variant=outline size=sm buttons that sendMessage on click). Map to manobu: keep the existing header (session dot + picker trio stays; template has none of that), but restyle transcript spacing in packages/chat-session/src/message-transcript.tsx (currently max-w-3xl px-4 gap defaults), and replace the bare Empty in that file with a suggestions row: 2-4 Japanese-learning starter prompts (persona-aware later; hardcode for now, e.g. 'Hiragana practice', 'What does 食 mean?'). Copy rules: sumi theme only, no dark: variants, no em dash in user-visible strings (AGENTS.md R-02: use · or :). Do not import react-markdown/typeset; Streamdown stays the markdown renderer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Desktop + narrow viewport: transcript column, thinking indicator, and suggestion chips visually match the template's calm centered rhythm; verified with browser screenshots at 1440 and 480 widths.
- [x] #2 Starter chip sends its prompt and streams a reply (reuse actions.onSubmit path; no new state machine).
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified in headless browser: empty state centered at 1440 and 480 (chips wrap); chip click sends prompt, transcript shows user bubble + bare Thinking row; /dev/chat-history serves 200 (no chips, readOnly unaffected). Lint fix during review: noJsxPropsBind forced extracting SuggestionChip with useCallback.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Adopted the template's visual language on /ai without its stack: centered max-w-2xl column rhythm across header/transcript/composer, vertically-centered Empty state with optional starter chips (ChatSuggestion + SuggestionChip in message-transcript.tsx; content passed call-site from ai.tsx per chat-session contract), thinking indicator demoted from empty bubble to bare muted shimmer row. Streamdown, sumi theme, and the picker trio untouched. Pinned by transcript-suggestions.test.tsx (2 SSR contract tests); chat-session 31 + desktop 369 tests green, tsc + ultracite clean.
<!-- SECTION:FINAL_SUMMARY:END -->
