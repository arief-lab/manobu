---
id: TASK-23.13
title: >-
  AI ops — ACP session pool + assistants markdown + cron scheduler (doc-1 Tier
  A/B + doc-6 P0)
status: To Do
assignee: []
created_date: '2026-09-06 06:04'
labels:
  - ai
  - acp
  - cron
  - doc1
  - doc6
dependencies: []
parent_task_id: TASK-23
priority: high
type: feature
ordinal: 896000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
AionUi re-research P0 must. Today single let acp apps/server/src/index.ts switches = restart; no $sessionId pool LRU 3, no busy queue, no markdown personas assistant/*.md (sensei-prompt.ts TS constant), no per-conversation skill indicator, no scheduled Tasks. Gated on existing agent-stack-gaps Tier1 ✅ (but Tier 2.2 catalogForwarder only Partial) and doc-1 §5.2.1-2.2 Tier A/B. Doc-6 §2 P0 A/B/C. Keep Hono+Bun (no Rust/Axum/JWT).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Replace let acp singleton with Map<conversationId,AcpModelResource> LRU 3 AionUi AcpRuntime; switching agent = close_session + new getAcpModel; body.agent accepted per message
- [ ] #2 Port classifyConversationBusyError + useConversationCommandQueue auto-drain + buildSendFailureError {reconnect_agent|wait|fix_path|retry}; drive /ai errorComponent
- [ ] #3 Assistants as markdown: assistant/*.md (sensei.md verbatim from sensei-prompt.ts plus keigo etc.) loader replaces SENSEI_SYSTEM_PROMPT; GET /assistants + GET /agents installed bool dots; /ai accepts {agent?, assistant?}; header skill indicator search/exclude per conversation
- [ ] #4 Cron: packages/cron + src-tauri/src/cron.rs app_data_dir/cron/jobs.json ICronJob {cronExpr|interval|oneTime, tz via Int1 repair, keepAwake, queue protection} + ScheduledTasksPage/CreateTaskDialog presets + TaskDetailPage Run Now 15s poll + 3 defaults disabled (review nudge 8:00 continue, weekly mock Mon 09:00 newConversation, nightly weak every 360m) + 2 headless data-maintenance per doc-1 §5.2.5
<!-- AC:END -->
