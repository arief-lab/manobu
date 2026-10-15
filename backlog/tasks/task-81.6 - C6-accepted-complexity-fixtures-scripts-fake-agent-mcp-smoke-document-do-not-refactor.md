---
id: TASK-81.6
title: >-
  C6 accepted-complexity fixtures/scripts: fake-agent + mcp-smoke - document, do
  not refactor
status: Done
assignee: []
created_date: '2026-09-20 13:12'
updated_date: '2026-09-21 03:25'
labels: []
dependencies: []
parent_task_id: TASK-81
ordinal: 702000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
fake-agent.ts handle/handleTurn and mcp-smoke.mjs drain/approvePermission/main are linear e2e drivers whose branching mirrors the agent/script surface; splitting them hurts debuggability for zero production value. Plan: keep the suppressions, rewrite each one-sentence reason to say accepted-by-design, and record the decision in the DOX (apps/server AGENTS.md smoke entry + packages/acp AGENTS.md fixture entry) so future audits inherit the verdict instead of re-flagging.
<!-- SECTION:DESCRIPTION:END -->
