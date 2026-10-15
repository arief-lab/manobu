---
id: TASK-81.1
title: >-
  C1 packages/acp: table-driven session translator - split updateEvent (cyclo
  27) into per-family translator modules
status: Done
assignee: []
created_date: '2026-09-20 13:11'
updated_date: '2026-09-20 14:51'
labels: []
dependencies: []
parent_task_id: TASK-81
ordinal: 697000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
updateEvent (session-translator.ts, 129 lines, 11 switch arms, CRAP 756) dispatches the ACP session-update union one-to-one. Plan: create packages/acp/src/translator/ with one module per event family (lifecycle: agent_message_chunk/agent_thought_chunk/user_message_chunk; tooling: tool_call/tool_call_update; context: available_commands/current_mode/config_option/session_info/usage/plan), each exporting (payload, ctx) => Frame[]. Replace the switch with a handler-record dispatch (const TRANSLATORS: Record<AcpUpdateKind, Translator>). Wire output must stay byte-identical on the existing fixtures - pin with a golden test over the current corpus BEFORE the split. Also foldLegacyModelMode (session-normalize.ts) + session-terminals create (probe-array loop) ride along in this cluster.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation (2026-09-20): cluster A complete, all goldens byte-identical.
- packages/acp/src/translator/ (new): lifecycle.ts / tooling.ts / context.ts + index.ts dispatch table (FAMILIES predicate->translator); session-translator.ts delegates, its 129-line 11-arm switch is gone. Wire output byte-identical (translator-golden 16/16 against pre-refactor goldens).
- session-normalize foldLegacyModelMode: decomposed into legacyOption/legacyModelOption/legacyModeOption/appendIfAbsent; shape matrix pinned by folds-golden.
- session-terminals create: decomposed into #spawnTerminal/#childEnv/#attachOutputCapture/#startPoller/#awaitExit; behavior pinned by folds-golden TerminalRegistry tests.
- updateEvent (27), create (10), foldLegacyModelMode (10), translateTooling (11) all now under the threshold; 4 suppressions deleted. fallow audit --base main: verdict PASS, 0 findings.
Gates: acp suite 78 pass, check-types 13/13, ultracite clean, bun test 9/9.
<!-- SECTION:NOTES:END -->
