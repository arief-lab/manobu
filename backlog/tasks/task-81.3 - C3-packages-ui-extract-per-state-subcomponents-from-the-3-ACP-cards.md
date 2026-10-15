---
id: TASK-81.3
title: 'C3 packages/ui: extract per-state subcomponents from the 3 ACP cards'
status: Done
assignee: []
created_date: '2026-09-20 13:11'
updated_date: '2026-09-20 20:08'
labels: []
dependencies: []
parent_task_id: TASK-81
ordinal: 699000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
AcpToolCallCard (cyclo 20), AcpTerminalCard (15), AcpPermissionCard (12) each render a state machine inline. Plan: split per lifecycle state (tool-call: pending/running/completed; terminal: running/exited/killed; permission: option-kind rows) into sibling subcomponent files in the same folder; the parent keeps the public export and becomes a thin state switch. Add rendering tests per state before splitting (CRAP drops with coverage).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-81.3 complete (2026-09-21): 3 parents -> thin state switches; per-state render branches extracted to sibling modules (acp-tool-call-states.tsx + tool-call-shared.ts, acp-terminal-states.tsx, acp-permission-states.tsx). kill/expand interactions -> useTerminalKill/useToolCallExpand hooks. 3 fallow complexity suppressions deleted (tool-call 20, terminal 15, permission 12 - all now under threshold without them); state-table SSR tests added BEFORE splitting (11 new pins). Public import surface unchanged (types/helpers re-exported from parents). fallow audit 0 findings; gates green.
<!-- SECTION:NOTES:END -->
