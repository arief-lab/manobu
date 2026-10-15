---
id: TASK-81.2
title: >-
  C2 packages/chat-session: folder-ize chat-engine.ts (752 lines) - folds/
  modules + rule-list deriveStatus
status: Done
assignee: []
created_date: '2026-09-20 13:11'
updated_date: '2026-09-20 16:34'
labels: []
dependencies: []
parent_task_id: TASK-81
ordinal: 698000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
chat-engine.ts mixes the TMessage union, 9 fold* functions, transformFrame dispatch plumbing, and deriveStatus. Plan: convert to src/chat-engine/ (index.ts re-exports the public API so consumers/import paths are unchanged; folds.ts split per family; status.ts turns deriveStatus into an ordered rule list [predicate, status]). Extract the replace:true / append merge plumbing shared by foldText/foldAcpToolCall into one applyFold helper. transformFrame keeps its dispatch role but each arm becomes a one-line table entry. Cover folds with golden snapshots BEFORE moving.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as planned: src/chat-engine/ folder (types.ts, folds/ per family + shared upsert.ts, transform.ts table dispatch, status.ts rule list), index.ts preserves the public import path. table-driven CARD_FOLDS + direct foldText/foldAcpToolCall tests cleared all 4 CRAP findings and the clone group; fallow audit 0 findings; goldens byte-identical; 111 tests green; committed b2fd80c.
<!-- SECTION:NOTES:END -->
