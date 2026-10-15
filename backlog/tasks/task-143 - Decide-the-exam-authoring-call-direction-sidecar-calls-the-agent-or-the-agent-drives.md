---
id: TASK-143
title: >-
  Decide the exam authoring call direction: sidecar calls the agent, or the
  agent drives
status: Done
assignee: []
created_date: '2026-09-26 15:39'
updated_date: '2026-09-26 15:55'
labels:
  - exam
  - architecture
  - acp
dependencies: []
priority: high
type: task
ordinal: 908000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-21 §9.2 names an unresolved architectural fork and this task exists to close it, because it gates all agent-authored exam work. RESOLVED 2026-09-26: sidecar calls the agent over ACP.

The question was how the sidecar reaches the model to author. The exam path is model-free by design (doc-21 §4) and the Rust corpus is agent-only (the sidecar has no MCP client; packages/agent/src/subagents/index.ts:17 says so), and neither said which direction authoring goes.

DECIDED: the sidecar calls the agent over ACP, the direction `ensureAcp` already uses for chat. The paper stays the sidecar's: it draws the blueprint, allocates the item types, chooses the anchors and the senses, and asks for prose per item. The model never decides how many items a section has.

REJECTED: the agent drives, via a host tool, the direction `next_drill_item` and `ask_user` already use. Cheaper to build, and it lets the model change a section length, at which point the blueprint, the minutes and the floors stop being the code's and doc-21 §9's opening claim is false.

EXTERNAL EVIDENCE, which agreed rather than decided. AionCore (github.com/iOfficeAI/AionCore) runs agents the same way: `aionui-runtime` owns the spawn through a builder that distinguishes long-running CLIs whose stdio the host owns from short-lived tools it merely parses, `aionui-process` supervises the subprocess, and `aionui-ai-agent` queues worker tasks rather than serving a request-scoped call. The host supervises, the model does bounded work, the host keeps the shape. Its ACP tool-output sanitization boundary is also worth copying: it strips inline base64 from tool results before they reach the WebSocket or SQLite, keeping `saved_path`. This repo solved the same class of problem differently and independently (frameContent as a table, TASK-81.5; the hub ring, TASK-80.14), which is convergent validation rather than new work.

STILL OPEN, and deliberately not decided here: whether a long-lived authoring session is kept per sidecar or created per request; whether authoring may take seconds, which means a paper stops being instant; and whether deterministic items remain the default with authored ones opt-in, which doubles the item surface to maintain. Those are the ACs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One direction is chosen and written into doc-21 §9.2 with the reason, replacing the recommendation with the decision.
- [x] #2 The decision states who owns the blueprint, the item-type allocation, the minutes and the floors, and the test that proves it. A model that can change a section length fails the suite.
- [x] #3 The AionCore pattern this decision follows is recorded rather than re-derived: the host owns the spawn and the supervision, the model does bounded work, and the host keeps the shape. AionCore runs agents exactly this way - aionui-runtime owns the spawn through a builder separating long-running CLIs whose stdio the host owns from short-lived tools it merely parses, aionui-process supervises the subprocess, aionui-ai-agent queues worker tasks rather than serving a request-scoped call. Do not copy its 24-crate decomposition: this is a single-user Tauri + Bun app and that layout is JWT, CSRF, teams, chat channels and cron.
- [x] #4 The session lifecycle, the latency tolerance, and whether authored items are opt-in are deliberately NOT decided here and are carried by the authoring task, because they are properties of authoring rather than of the call direction. Claiming them settled on a decision task is how a residue becomes a ghost.
<!-- AC:END -->
