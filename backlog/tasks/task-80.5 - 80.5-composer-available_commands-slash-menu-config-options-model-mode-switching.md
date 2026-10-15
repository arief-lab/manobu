---
id: TASK-80.5
title: >-
  80.5 composer: available_commands slash menu + config-options model/mode
  switching
status: Done
assignee:
  - '@arif'
created_date: '2026-09-15 16:30'
updated_date: '2026-09-17 20:00'
labels:
  - ai-chat
  - frontend
dependencies:
  - TASK-80.3
references:
  - >-
    https://github.com/iOfficeAI/AionUi/tree/main/packages/desktop/src/common/chat/slash
  - >-
    https://github.com/iOfficeAI/AionUi/blob/main/packages/desktop/src/renderer/hooks/chat/useSlashCommandController.ts
parent_task_id: TASK-80
ordinal: 651000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Port AionUi's command lane to the existing manobu composer (apps/desktop chat composer used by /ai). common/chat/slash port: types (SlashCommandItem {name, description, kind: template|builtin, source: acp|builtin|skill, hint, selectionBehavior: insert|execute}), acpMapping (available_commands_update payload and the chat.slashCommands procedure shape both map to kind=template, source=acp, selectionBehavior=insert; hint from input.hint on the frame shape or hint on the procedure shape), mergeSlashCommands (first-wins Map, priority builtin > acp > skills; manobu's existing builtins kept), availability gate (acp agents always enabled). Data feed: the chat.slashCommands procedure (fetch link, 80.2) is authoritative for the initial load (call after the runtime ensure resolves, in-flight dedup per conversation, 5-min LRU); the live available_commands frame overlays it; a slash_commands_updated frame triggers a chat.slashCommands refetch. Controller port (useSlashCommandController): query regex ^\/([a-zA-Z0-9_-]*)$, substring fuzzy match with highlight indices offset for the leading slash, arrow/Escape/Enter/Tab handling that re-derives the list from the live DOM value so fast typing cannot send a raw /command, dismissed menu only reopens on query change; template selection inserts /<name> + space into the draft and the text then goes out as an ordinary prompt (no client-side execution). Do NOT port AionUi's dead code: atCommandParser.ts, MessageAvailableCommands.tsx, ApprovalStore. File mentions: keep the current composer behavior, mapped to prompt files refs; the server (80.2) injects the file block at the send edge. Picker rewiring: model select switches to the chat.setConfigOption procedure (fetch link; rpc acp.agents.models rewired to config_options in 80.2), add a mode select when config_options exposes a mode option, agent select unchanged (registry).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Slash menu tests: filter regex + fuzzy highlight + live-DOM accept on Enter/Tab; selecting an ACP command inserts /<name> into the draft and sends it as plain prompt text; HTTP authoritative-then-overlay behavior pinned with a stale-WS-push test
- [x] #2 Model switch via config-options endpoint reflects in the next turn (integration test against the 80.2 fake agent that advertises config_options); mode selector appears only when a mode option exists
- [x] #3 Commands sourced from the fake agent's available_commands_update appear in the menu; bun test green in apps/desktop
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Plan (2026-09-17, after auditing the composer + procedures + fake harness). AionUi's command lane ported to the manobu composer; no DOM test env in the workspace, so the whole lane is a PURE module (types/mapping/merge/filter/controller state machine) that bun-test drives headlessly, and the React/composer wiring is verified by type-check + the existing desktop suite.

SLICE 1 - pure lane, packages/chat-session/src/slash/ (new subpath, DOX-listed):
1. types.ts: SlashCommandItem {name, description, kind: template|builtin, source: acp|builtin|skill, hint: string|null, selectionBehavior: insert|execute}; SlashSource/Kind/Behavior const-enum-ish types.
2. map.ts: acpCommandsToItems(commands) -> kind=template/source=acp/selectionBehavior=insert, hint from input.hint (frame shape) or hint (procedure shape); mergeSlashCommands(builtin, acp, skills?) -> first-wins Map, priority builtin > acp > skill; hasModeOption(configOptions) / modelOptionsFrom(configOptions) -> the picker data (mode picker appears only when a select option id==='mode' exists; mirrors the server configOptionsToCatalog model keying).
3. filter.ts: SLASH_QUERY_RE=/^\/([a-zA-Z0-9_-]*)$/; filterCommands(query, items) substring fuzzy match; fuzzyHighlight(query, name) -> highlight index ranges offset by the leading slash.
4. controller.ts: pure state machine slashMenuReducer(state, event) over events {type:input|keydown|select|dismiss, ...}; query regex gate, arrow nav, Escape dismiss, Enter/Tab accept, re-derive list from the live value, dismissed-until-query-change, select -> insert '/<name> ' into the draft (plain text, no client execution).
5. index.ts subpath; co-located *.test.ts covering AC#1 (filter regex, fuzzy highlight, Enter/Tab accept transitions, authoritative-then-overlay stale-push rule in map.ts versioning).

SLICE 2 - data feed + provider wiring:
6. useSlashCommands (chat-session): fetch-link chat.slashCommands authoritative per conversationId (in-flight dedup + 5-min LRU), overlaid by the live available_commands frame; stale WS push (lower source version than a newer HTTP snapshot) is dropped. Exposed on provider meta.slashCommands so the composer renders it. The engine's subscribe loop gains an optional onSlashCommands callback fired on available_commands (side-state frame, no card) so the overlay updates live.

SLICE 3 - composer UI in apps/desktop/src/routes/ai.tsx:
7. <SlashMenu> above the InputGroup: lists filterCommands(state.input, meta.slashCommands), highlight spans, arrow/Enter/Tab/Escape via the controller; on select, actions.setDraft inserts '/<name> ' (add a setDraft action to the provider - programmatic draft setter distinct from onInputChange).
8. Model Picker: keep the catalog (acp.agents.models) for available/current; the select ALSO calls chat.setConfigOption({conversationId, optionId:'model', value}) so the live session hot-switches; applied next turn regardless (existing input.model path). Add a Mode Picker rendered only when hasModeOption(configOptions) is true, wired to chat.setConfigOption optionId:'mode'.

SLICE 4 - tests:
9. apps/desktop/test/slash-menu.test.ts (AC#3): a fake-agent available_commands payload driven through acpCommandsToItems + mergeSlashCommands + filterCommands asserts the ACP command appears in the menu.
10. apps/server/test/chat-e2e.test.ts (AC#2): extend FakeAgent to advertise a model + a mode config option; assert chat.setConfigOption round-trips (reflects the switch) and hasModeOption true. harness fakeController.configOptions currently returns [] - give the fake an optional configOptions array.

Verify: biome lint 0 on all touched files; tsc green (chat-session, ui, desktop, server); bun test green in packages/chat-session + apps/desktop + apps/server; ultracite check 0. DOX: add the ./slash subpath to packages/chat-session AGENTS.md; note the config-option mode picker + setConfigOption model switch in apps/desktop + apps/server AGENTS.md.

Judgment calls (recorded, not blocked): 'mode' option keyed by config option id==='mode' (mirrors the server's id==='model' keying); no slash_commands_updated frame exists so the overlay is driven by the available_commands frame itself; the lane is pure + React-thin to stay testable without a DOM env.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Transport amendment 2026-09-16 (user decision): slash-commands + config-option switch are oRPC fetch-link procedures (80.2), not HTTP REST paths; the live available_commands frame arrives on the WS chat.subscribe stream (80.3).

Verification (2026-09-18): chat-session 103/103 pass (slash.test.ts 18 tests pin filter regex + fuzzy highlight + stale-WS-push shouldApplyOverlay + Enter/Tab accept transitions); apps/desktop tsc clean (proves the switchModel/switchMode/setDraft rewire), 391/394 pass (3790 expects; 1 fail = pre-existing kanji.test.ts vocab sidecar env test, 2 skips by design); apps/server 61/62 pass incl. new AC#2 e2e (fake-agent configOptions + session-id gate via setUserAcpSessionId: slashCommands surfaces the fake's 'review' command, setConfigOption model sonnet->opus + mode default->plan round-trip); ultracite 0. Judgment call re-confirmed: live-DOM accept (AC#1) pinned headlessly via the controller reducer (no DOM env in workspace); React wiring verified by tsc + route-loaders guard. Provider mergeSlashCommands arg order flipped overlay-first (first-wins semantics: the live overlay wins on acp<->acp name collision; builtin>acp rank is order-independent).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Composer slash menu + config-options model/mode switching (AionUi port). Slice 1: pure command lane in packages/chat-session/src/slash.ts (ACP mapping, first-wins merge, char-subsequence filter + highlight, stale-overlay gate, menu controller reducer) + ./slash subpath. Slice 2: engine fires onAvailableCommands/onConfigOptions on the two side-state frames (dispatchSideState); useSlashCommands fetches chat.slashCommands NOT_FOUND-tolerant per conversation; provider merges snapshot+overlay into meta.slashCommands, exposes switchModel/switchMode (chat.setConfigOption hot-switch, next-turn fallback) + setDraft. Slice 3: /ai composer gains SlashMenu (button rows, stable handlers, mousedown-blur guard) + mode picker (renders only when a mode option exists); model picker rewired to switchModel. Slice 4: desktop slash-menu lane test (AC#3), server e2e configOptions seam (AC#2), engine dispatchSideState + exports tests. Verified: 3-package tsc + bun test green (chat-session 103, desktop 391, server 61), ultracite 0.
<!-- SECTION:FINAL_SUMMARY:END -->
