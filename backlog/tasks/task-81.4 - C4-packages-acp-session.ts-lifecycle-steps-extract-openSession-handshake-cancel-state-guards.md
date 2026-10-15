---
id: TASK-81.4
title: >-
  C4 packages/acp: session.ts lifecycle steps - extract #openSession handshake +
  cancel state guards
status: Done
assignee: []
created_date: '2026-09-20 13:11'
updated_date: '2026-09-21 02:11'
labels: []
dependencies: []
parent_task_id: TASK-81
ordinal: 700000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
#openSession (cyclo 21) is a spawn/initialize/MCP-negotiation/health sequence in one body. Plan: extract each step into a private method (#spawn, #initialize, #negotiateMcp, #healthCheck) with a linear orchestration body. cancel (cyclo 11) becomes guard clauses over session-state predicates. Session behavior is pinned by existing acp tests; extend with a negotiation-failure table test first.
<!-- SECTION:DESCRIPTION:END -->
