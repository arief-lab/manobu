---
id: TASK-81
title: >-
  Refactor the 20 complexity-suppressed functions (fallow audit) - table-driven
  dispatch, folder-ized reducer, card subcomponents
status: Done
assignee: []
created_date: '2026-09-20 13:10'
updated_date: '2026-09-21 03:25'
labels:
  - refactoring
  - backend
  - frontend
dependencies: []
priority: medium
type: feature
ordinal: 696000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every suppressed function either drops below the fallow threshold or is explicitly re-accepted with a fresh one-sentence reason; no new findings
- [x] #2 Golden-frame test coverage added BEFORE refactoring for clusters A+B so CRAP drops and fold behavior is pinned
- [x] #3 Wire contracts unchanged: ACP translator output frames byte-identical on the existing fixture corpus; chat reducer TMessage snapshots unchanged
- [x] #4 Public exports unchanged (transformFrame/deriveStatus contract consumers untouched); folder-ization re-exports through the same module paths
- [x] #5 fallow audit --base main shows 0 findings without the removed suppressions; full gates green (check-types, ultracite, bun test 9/9)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Analysis (2026-09-20, post 82d8e01 fallow gate): the 20 suppressed functions cluster into 6 patterns; refactoring strategy per cluster:

C1 TRANSLATOR (worst first): acp session-translator.ts updateEvent - cyclo 27, CRAP 756, 11 switch arms over the ACP session-update union, each arm independent. Table-driven dispatch: per-family translator modules + Record<KIND, Translator>. Also session-normalize foldLegacyModelMode + session-terminals create (probe chain -> probe array). New subfolder: packages/acp/src/translator/.

C2 REDUCER: chat-session chat-engine.ts is a 752-line single file mixing union types, 9 fold* functions, dispatch plumbing, and status rules. Folder-ize to src/chat-engine/ with index.ts preserving the public API; extract the shared replace:true/append merge into one applyFold; deriveStatus becomes an ordered rule list. Covers 4 of the 20.

C3 UI CARDS: 3 ACP cards render state machines inline (cyclo 20/15/12). Extract per-state subcomponents; parent becomes a thin switch. Coverage-first (CRAP drops with tests).

C4 LIFECYCLE: session.ts #openSession (spawn/init/MCP-negotiation/health in one body) -> private step methods; cancel -> state predicates.

C5 SINGLETONS: frameContent (content-block union walk -> per-kind table), ai.tsx ChatRoute guards, message-transcript dispatch arrow -> <ChatCardSwitch>.

C6 ACCEPTED: fake-agent + mcp-smoke drivers - linear e2e fixtures; refactoring hurts debuggability. Keep suppressions, mark accepted-by-design in DOX.

Sequencing principle: tests BEFORE refactors (fallow's own add-tests path drops CRAP for the 10-13 cyclo band, possibly without refactoring); wire contracts byte-identical (golden fixtures); public export paths unchanged. Directory answer: NO new top-level directories - one folder-ization (chat-engine/) + one subfolder (acp/translator/); everything else extracts in place.
<!-- SECTION:NOTES:END -->
