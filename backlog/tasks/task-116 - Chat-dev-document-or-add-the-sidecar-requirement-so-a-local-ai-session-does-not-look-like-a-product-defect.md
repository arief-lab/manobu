---
id: TASK-116
title: >-
  Chat dev: document or add the sidecar requirement so a local /ai session does
  not look like a product defect
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:05'
updated_date: '2026-09-24 14:09'
labels: []
dependencies: []
documentation:
  - backlog/docs/feature/doc-19 - UI-wireframes-the-chat-learning-surface.md
  - >-
    backlog/docs/feature/doc-12 -
    Chat-generated-JLPT-exams-N5..N1-a-kana-readiness-gate.md
priority: medium
type: chore
ordinal: 859300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The app calls same-origin `/rpc` and `/ws`, `apps/desktop/vite.config.ts` declares port `3001` and configures no proxy, and the sidecar runs separately (`bun run --hot src/index.ts` with `BUN_PORT`, dev on `:3000`). So a browser session on `/ai` fails unless the sidecar is running on `:3000` **and** `VITE_SERVER_URL` points at it, and the failure mode is an error boundary that looks identical to a real product gap. That cost time during the 2026-09-24 browser pass and is why `doc-19` §13 keeps it open: the next person should not diagnose a config gap as a product defect. `TASK-91` already documents `BUN_PORT` for sidecar dev launch, so this extends that rather than starting over. Either choice is acceptable; documenting is cheaper, proxying removes the class of bug. Whichever ships must not change production behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Either `apps/desktop/vite.config.ts` proxies `/rpc` and `/ws` to the sidecar, or the requirement (sidecar on `:3000` plus `VITE_SERVER_URL`) is documented in the developer setup and referenced from `apps/desktop/AGENTS.md`.
- [x] #2 Following only the documented steps, `bun run dev` in `apps/desktop` plus the sidecar makes `/ai` usable with no env var the docs do not name.
- [x] #3 The chosen approach does not change production behavior, and if a proxy is added it applies to dev only.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Dev sidecar requirement per doc-19 §13 and TASK-91 BUN_PORT: either vite proxy /rpc+/ws to :3000 or document sidecar+VITE_SERVER_URL in setup and apps/desktop/AGENTS.md. Choose proxy (dev-only) to remove config-gap error boundary class, keep prod untouched. Verify bun run dev + sidecar makes /ai usable without extra env.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Dev proxy for sidecar: vite.config.ts proxies /rpc -> http://127.0.0.1:3000 and /ws -> ws://127.0.0.1:3000 (dev-only, AC#3), so bun run --hot src/index.ts (BUN_PORT 3000) + bun run dev (vite 3001) makes /ai usable with no VITE_SERVER_URL (AC#2). Documented in apps/desktop/AGENTS.md (AC#1 alternative). Prod unaffected (Tauri BUN_PORT 4317 + VITE_SERVER_URL). Verified: check 438 clean, check-types 13/13, desktop 381 pass.
<!-- SECTION:FINAL_SUMMARY:END -->
