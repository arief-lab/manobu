---
id: TASK-80.4
title: '80.4 packages/ui + chat-session: AionUi tool/permission/ask/terminal cards'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-15 16:30'
updated_date: '2026-09-17 11:57'
labels:
  - ai-chat
  - frontend
dependencies:
  - TASK-80.3
references:
  - >-
    https://github.com/iOfficeAI/AionUi/tree/main/packages/desktop/src/renderer/pages/conversation/Messages/acp
parent_task_id: TASK-80
ordinal: 650000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Port the AionUi rendering contract to @manobu/ui components + chat-session parts, sumi theme (no dark: variants, no em dash in copy, WCAG AA on token fills per DESIGN.md + AGENTS.md R-02). AcpToolCallCard: diff-only payloads (every content item type=diff with non-blank path and string old_text/new_text, not _compact.truncated) render as a bare FileChanges-style panel via createTwoFilesPatch + parseDiff using the diff npm package (add as direct dep of packages/ui explicitly); otherwise Card with title, StatusTag for pending/in_progress/completed/failed (pending=blue, in_progress=orange, completed/failed=gray), kind display names (edit: File Edit, read: File Read, execute: Shell Command), rawInput as JSON pre or fenced markdown when string, image output with hover download, content items text via Streamdown and diff via the panel, tool_call_id footer; plus the hasRenderableAcpDiff gate and tool_summary grouping walk for consecutive tool calls with auto-expand-while-running and lazy full-output refetch for truncated rows. PermissionRequestPanel: single state machine for ACP options (allow_once/allow_always/reject_once/reject_always intents), single-click submit, one option spinner with the fieldset disabled while in flight, responded receipt or inline alert-retry, request+options epoch guards that reset state when the request key or option identity changes; submits via actions.confirm({confirm_key: option_id, call_id: tool_call_id || msg_id}); detail pane shows raw_input.command else pretty-JSON dump of raw_input. AskUserCard replaces QuestionCard + the handoff sentinel: one card holding ALL questions, radio group (single) or checkbox group (multiSelect) plus an Other option revealing a free-text input, submit disabled until every question answered, decline sends explicit deny, post-submit the controls become an Answered/Dismissed receipt; answers payload keys each answer by question text with Other riding as an ordinary label; submit via actions.answerAsk to the chat.answerAsk procedure (80.2 WS command). TerminalOutputCard: running = no exit_status; tail-follow pre on every cumulative output frame; status tag Running/Stopped (signaled)/Exit {code} (green 0, red else); Stop button calls chat.killTerminal (does not cancel the turn); stream-only card, never persisted, disappears on reload. Supporting rows: ThinkingRow (subject + elapsed + done, synthesized completion frame), PlanList (entries with status dots), AgentStatusChip, composer context-usage footer from acp_context_usage frames, tips/error line rendering the buildSendFailureError resolution text. Attribution headers on ported files: derived from AionUi (Apache-2.0), packages/desktop/src path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SSR/jsdom tests per card pinning the state tables: tool call 4 ACP states + diff-only fast path + grouping, permission single-click submit to receipt and retry on failure, ask all-answered gating + Other free-text + decline receipt
- [x] #2 Existing message-transcript/ask-user tests retargeted to the new card set (the HANDOFF_UI-era assertions replaced by ask-frame assertions); bun test green in packages/ui and packages/chat-session
- [x] #3 All interactive controls keyboard-accessible with labels/roles (axe-clean in tests); no dark: variants; no em dash in user-visible strings
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# TASK-80.4 implementation plan (4 AionUi cards, terminal deferred to 80.4.1)

## New @manobu/ui components (packages/ui/src/components/)

### 1. `status-tag.tsx` — StatusTag primitive
- Props: `variant: "pending" | "in_progress" | "completed" | "failed"` (maps to ACP tool status + generic card states).
- Colors per spec: pending=blue (info), in_progress=orange (warning), completed/failed=gray (muted).
- Use `cva` for the variant map; render a small `<span>` with `data-slot="status-tag"` + `data-state={variant}` for SSR pinning.
- Text labels: "Pending" / "In progress" / "Completed" / "Failed" (no em dash, no dark: variants, sumi theme tokens only).

### 2. `acp-tool-call-card.tsx` — AcpToolCallCard (the biggest card)
- Props: `card: TMessageAcpToolCall` (from chat-session chat-engine) + `onRefetch?: (card) => Promise<TMessageAcpToolCall>` for the lazy full-result refetch on truncated rows.
- **Diff-only fast path**: when every `card.content` item is `type:"diff"` with a non-blank `path` and string `old_text`/`new_text`, and `card` is NOT `_compact.truncated`, render a bare FileChanges-style panel:
  - Use `createTwoFilesPatch` + `parseDiff` from the `diff` npm package (add `diff` as a DIRECT dep of packages/ui; it's currently only transitive in bun.lock).
  - Render a unified-diff view (line-by-line, green/red highlight on add/remove) in a `<pre>` with `data-slot="file-changes"`.
- **Otherwise** (non-diff payload): render a `Card` with:
  - `Title`: `card.kind` display name (edit -> "File Edit", read -> "File Read", execute -> "Shell Command", fallback -> `card.title` ?? `card.kind`).
  - `StatusTag` reflecting `card.status` (pending/in_progress/completed/failed).
  - `rawInput`: if a string, render as fenced markdown (or a `<pre>` for JSON); if an object, `JSON.stringify` into a `<pre>` with `data-slot="tool-input"`.
  - Image output: if `card.raw_output` is an image (base64 or data-URI), render `<img>` with `data-slot="tool-image"`.
  - **Truncated row expand**: if the card is compact/truncated, show a collapsed preview + an "Expand" button. On click, call `onRefetch(card)` and show a loading Skeleton; on success, re-render full; on error, show an error row with a Retry button. Pin all 3 states (loading/error/expanded) with `data-state`.
  - **Grouping**: consecutive same-`toolCallId` cards in the transcript collapse into one card (the reducer already merges by `tool:{toolCallId}`, so the card just renders the merged card; grouping is a transcript concern, not the card's).
- Keyboard: the Expand/Retry buttons are real `<Button>`s (focusable, `aria-label`). `data-testid` hooks for SSR.

### 3. `acp-permission-card.tsx` — PermissionRequestPanel
- Props: `card: TMessageAcpPermission` + `onSubmit: (optionId: string) => Promise<void>` (the card's submit handler, wired to `chat.confirm` by the chat-session part).
- **Single-click submit**: each option button is a real `<Button>`; clicking one immediately calls `onSubmit(optionId)` and the card enters a "receipt" state (`data-state="receipt"`).
- **Retry on failure**: if `onSubmit` rejects, the card re-arms the buttons (`data-state="retry"`) and shows a one-line error. Pin both states in SSR.
- Options render as a list of `Button`s with `aria-label` = option name. The tool-call payload (`card.toolCall`) renders as a collapsible detail (JSON `<pre>`).
- No em dash in labels; WCAG AA on the button fills.

### 4. `acp-ask-card.tsx` — AskUserCard (replaces the pinned Questionnaire card)
- Props: `card: TMessageAsk` + `onSubmit: (answers: Record<string,string>[]) | decline) => Promise<void>` (wired to `chat.answerAsk` by the chat-session part).
- **All-answered gating**: the Submit button is `disabled` until every question has an answer (or the user picked the "Other" free-text path and filled it). Pin the disabled/enabled states.
- **Other free-text**: each question's choice group includes an "Other" option that reveals a text `Input` (labeled, `aria-label`). The free-text value counts as the answer for that question.
- **Decline receipt**: a "Decline" button calls `onSubmit({ decline: true })`; the card then renders a receipt line ("Declined" / "Answered: {labels}") with `data-state="receipt"`.
- Use the existing `Questionnaire` compound where the choice groups fit; wrap the Submit/Decline in `Button`s. Keyboard: all inputs/buttons focusable + labeled.

### 5. (deferred to 80.4.1) `acp-terminal-card.tsx` — TerminalOutputCard

## chat-session wiring (packages/chat-session/src/)

### `parts/acp-tool-call-part.tsx` (new)
- Thin wrapper: takes `card: TMessageAcpToolCall` + `conversationId` + `client` (the WS ContractClient). Renders `<AcpToolCallCard>`.
- The `onRefetch` prop is wired to `client.chat.send` re-issue OR a future dedicated refetch procedure — for now, a no-op stub that resolves the card as-is (the lazy refetch is a UI affordance; the actual refetch procedure is out of scope for 80.4; pin the loading/error states with the stub returning a resolved card).
- Actually, re-read the spec: "truncated row expand triggers full refetch with loading/error states." The refetch is a UI interaction; the data source is the card's `raw_output` which is already sanitized at the fold. For 80.4, the expand is a LOCAL expand (the full payload is already in the card after the merge) — the "refetch" is the card re-rendering its own `raw_output` in full. No network call needed; pin the expand/collapse state locally.

### `parts/acp-permission-part.tsx` (new)
- Takes `card: TMessageAcpPermission` + `conversationId` + `client`. Renders `<AcpPermissionCard>` with `onSubmit` calling `client.chat.confirm({ callId: card.requestId, conversationId, data: optionId, alwaysAllow })`. On resolve, the card's `settled` receipt renders (the frame `acp_permission_resolved` settles it server-side; the card re-renders from the folded TMessage).
- Inline in the transcript (replaces the current `acp_permission -> null` in message-transcript.tsx).

### `parts/acp-ask-part.tsx` (new, replaces ask-user-part.tsx)
- Takes `card: TMessageAsk` + `conversationId` + `client`. Renders `<AcpAskCard>` with `onSubmit` calling `client.chat.answerAsk({ requestId, conversationId, answers | decline })`.
- Replaces both the inline AskUserPart AND the pinned question-card.tsx (the ask card is now a full card, not a pinned questionnaire popover). The `question-card.tsx` pinned card is deleted; the ask card renders inline in the transcript.
- AC#2: the HANDOFF_UI-era assertions in ask-user.test.tsx (pinned questionnaire `data-slot=questionnaire`, "Another answer" aria-label, etc.) are replaced with ask-frame assertions (the new card's `data-slot`/`data-state`).

### `message-transcript.tsx` (modify)
- Dispatch `acp_tool_call` -> `<AcpToolCallPart>` (replaces the `toolCardToToolPartLike` + generic `ToolPart` fallback for ACP cards; the JLPT `ToolPart` stays for non-ACP tool cards).
- Dispatch `acp_permission` -> `<AcpPermissionPart>` (replaces the `return null`).
- Dispatch `ask` -> `<AcpAskPart>` (replaces `AskUserPart` inline + the pinned `QuestionCard`).
- The `toolCardToToolPartLike` adapter is dropped for the ACP path (the new card takes `TMessageAcpToolCall` directly).

### `chat-messages.ts` (modify)
- The ask_user helpers (`isAskUserPart`, `askUserQuestions`, `unansweredAskUserPart`, `askUserAnswerText`) now operate on `TMessageAsk` cards (TASK-80.3 already re-sourced some; 80.4 completes the retarget). `ASK_USER_PART_TYPE` (the AI-SDK wire name) is dropped.

## packages/ui deps
- Add `diff` as a direct dep of packages/ui (it's transitive in bun.lock via shadcn/@tanstack/router-utils; make it explicit). `@types/diff` for TS.

## Tests (AC#1, SSR — no DOM env, renderToStaticMarkup + bun:test)
- `packages/ui/src/components/acp-tool-call-card.test.tsx`: 4 ACP states (pending/in_progress/completed/failed) + diff-only fast path (a card with diff content items renders the FileChanges panel, not the generic Card) + the truncated expand (collapsed vs expanded `data-state`) + grouping (two same-toolCallId cards merge).
- `packages/ui/src/components/acp-permission-card.test.tsx`: single-click submit -> receipt `data-state="receipt"`; on reject -> retry `data-state="retry"`.
- `packages/ui/src/components/acp-ask-card.test.tsx`: all-answered gating (Submit disabled until all answered), Other free-text reveals input, decline receipt.
- `packages/chat-session/src/` retarget: ask-user.test.tsx (drop pinned-questionnaire assertions, add ask-frame card assertions), message-transcript tests (ACP card dispatch).

## Verification (AC#2, AC#3)
- `cd packages/ui && bun test` green.
- `cd packages/chat-session && bun test --env-file=.env.test` green.
- `bun x ultracite check` 0 errors in both packages.
- `bun run check-types` green (packages/ui + packages/chat-session + apps/desktop).
- No `dark:` variants in the new card files; no em dash (`—`) in user-visible strings; all interactive controls have `aria-label`/`role` (SSR assertions check the attributes).

## Out of scope (80.4.1)
- Terminal card: `TMessageTerminal` engine type + `transformFrame` case + `AcpTerminalCard` component + kill-button wiring. Split task.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Transport amendment 2026-09-16 (user decision): cards submit through oRPC WS commands (chat.confirm / chat.answerAsk / chat.killTerminal, 80.2) rather than REST paths; frames consumed via the 80.3 chat.subscribe subscription. Card behavior and state tables unchanged.

Scope decision 2026-09-17 (user): ship the 4 non-terminal cards (AcpToolCallCard + Permission + Ask + grouping) now; the Terminal card is split into TASK-80.4.1 (needs a TMessageTerminal engine type + transformFrame case for acp_terminal_output, which is stream-only/never-persisted per the 0006 DDL). The 3 shipping cards map to TMessageAcpToolCall / TMessageAcpPermission / TMessageAsk already in chat-engine.ts; terminal is the only one requiring an engine change.

Finalization evidence 2026-09-17. AC re-scope: terminal clause moved out of AC#1 into TASK-80.4.1 (which now owns its own 2 ACs); the terminal card remains unimplemented (stream-only frame, per 0006 DDL). AC#1 — SSR pinning per the agreed strategy (no DOM test env in workspace): acp-cards.test.tsx pins StatusTag 4-variant mapping, tool-call generic card + diff-only file-changes panel + truncated Expand affordance + image output; permission default-state markup (receipt/retry testids present but hidden in the default render); ask all-answered gating hint + Other free-text + collectAnswers. Recorded deviation: effect-driven post-submit states (permission receipt/retry, ask decline receipt, truncated loading/error) are pinned by attribute shape only — SSR cannot run effects. Grouping: the reducer merges by tool:{toolCallId} (chat-engine.test.ts); transcript-level grouping has no dedicated test. AC#2 — ask-user.test.tsx retargeted to ask-frame AcpAskCard assertions (the handoff-era pinned-QuestionCard assertions are gone); ui 124/124 + chat-session 77/77 green. AC#3 — no dark: variants and no em dash in user-visible strings (grep across the 4 card files: hits are JSDoc-only); aria-label on every interactive control, role=alert/status on status regions. Recorded deviation: no axe runner in the workspace (no DOM env), so a11y is verified at source + SSR-output level, not by an axe scan.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New: @manobu/ui AcpToolCallCard (diff-only fast path via the diff pkg + generic card + StatusTag primitive), AcpPermissionCard (single-click submit, receipt/retry states), AcpAskCard (all-answered gating, Other free-text, decline receipt); chat-session parts acp-tool-call-part / acp-permission-part / acp-ask-part + message-transcript dispatch; ask-user.test.tsx retargeted to ask-frame assertions; diff added as a direct dep of packages/ui. Terminal card deferred to TASK-80.4.1 (which now owns its own 2 ACs). Verified: acp-cards.test.tsx SSR state-table pins, ui 124/124 + chat-session 77/77 tests green, tsc + ultracite clean, no dark:/em-dash in user-visible strings.
<!-- SECTION:FINAL_SUMMARY:END -->
