---
id: TASK-23.23
title: Doc6 WebUI — single Cloudflare Tunnel relay for remote practice (low P2)
status: To Do
assignee: []
created_date: '2026-09-06 06:10'
labels:
  - webui
  - doc6
dependencies: []
parent_task_id: TASK-23
priority: low
type: feature
ordinal: 881000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Doc-6 §1.3 Cowork from Anywhere: AionUi WebUI QR/password + LAN cross-network + Telegram/Lark/WeChat/DingTalk. Manobu is Tauri desktop offline-first localhost:4317 Hono only. Benefit for language lab is phone listen→speak while commuting via TASK-21.2 STT. Want one relay (Tauri localhost ↔ Cloudflare Tunnel opt-in) not 8 bots. Doc-6 §2 G P2 nice after team. Keep tauri allow narrow, JWT+CSRF out-of-scope per agent-stack-gaps.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add single WebUI relay opt-in (Tauri localhost ↔ Cloudflare Tunnel) when user opts in, not 8 bots
- [ ] #2 Phone listen-while-commuting → speak grading via STT works via relay; Hono+capabilities CSP narrow kept
- [ ] #3 Verification: WebUI remote listen→speak flow works opt-in, gated by Tier A pool
<!-- AC:END -->
