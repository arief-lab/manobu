---
id: TASK-32.2
title: Reduce web bundle and fix ineffective cron dynamic import
status: Done
assignee:
  - '@arif'
created_date: '2026-09-08 01:35'
updated_date: '2026-09-08 03:13'
labels:
  - frontend
  - performance
dependencies: []
references:
  - apps/desktop/src/lib/cron.ts
  - apps/desktop/src/lib/cron-dispatch.ts
  - apps/desktop/vite.config.ts
parent_task_id: TASK-32
priority: medium
type: task
ordinal: 575000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Vite build warns that the index chunk is 1013 kB minified (309 kB gzip) with statically bundled form-options 63 kB, schemas 92 kB, and n4 dictionary 112 kB. Rolldown also reports INEFFECTIVE_DYNAMIC_IMPORT because lib/cron.ts is both statically imported by settings.tsx and dynamically imported by lib/cron-dispatch.ts, so code-splitting cannot move it. The large first-load chunk hurts desktop startup and web dev load.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Index chunk drops below the 500 kB warning or a documented code-split keeps first-load JS under it
- [x] #2 Level dictionaries and heavy schemas load lazily instead of landing in the index chunk
- [x] #3 No INEFFECTIVE_DYNAMIC_IMPORT warning for lib/cron.ts in vite build output
- [x] #4 All routes still load and bun run test plus route-loaders guard pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Fix INEFFECTIVE_DYNAMIC_IMPORT: lib/cron-dispatch.ts statically imports cronHistory/cronReportResult AND dynamically imports cronList — make all cron.ts imports static in cron-dispatch.ts (the dynamic import was pointless; cron.ts already lands in the index chunk via settings-scheduled-tasks.tsx). 2. Index chunk is ~1MB because __root.tsx mounts AskSenseiWidget globally, which statically imports @manobu/chat-session/message-transcript → streamdown → parse5/micromark/shiki (~400kB min). Split ask-sensei/widget.tsx into a launcher shell + React.lazy()-loaded panel (and make MessageTranscript import lazy at the widget boundary) so streamdown + its parser cluster move into a lazy chunk loaded only when the widget opens. 3. n4.json/phrases.json are already dynamic imports in next-cards.ts (own chunks) — verify they stay out of index. 4. Verify: vite build shows no INEFFECTIVE_DYNAMIC_IMPORT, index < 500kB or documented split, bun run test + route-loaders guard + check-types + ultracite clean.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: index chunk was 1013kB because __root.tsx mounts AskSenseiWidget globally, which statically imported @manobu/chat-session/message-transcript → streamdown → parse5/micromark/shiki (~575kB min). Split ask-sensei/widget.tsx into a light launcher + React.lazy panel.tsx; the parser cluster now lives in a 575kB lazy chunk loaded only when the widget opens. INEFFECTIVE_DYNAMIC_IMPORT fixed by making cron-dispatch.ts import cronList statically (the dynamic import was pointless — cron.ts is statically imported by settings-scheduled-tasks.tsx anyway). n4.json (112kB) + schemas (93kB) + form-options (62kB) were already separate chunks (dynamic imports in next-cards.ts / static but router-code-split) — verified still out of index. Verified: vite build index chunk 357kB (gzip 114kB) < 500kB, no INEFFECTIVE_DYNAMIC_IMPORT, bun run check-types 0 errors, bun x ultracite check clean (256 files), apps/desktop bun run test 212 pass / 0 fail, packages/chat-session bun test 23 pass / 0 fail.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Reduced the desktop index chunk from 1013kB to 357kB minified (gzip 309kB → 114kB): the global AskSensei widget statically pulled streamdown's markdown parser cluster (parse5/micromark/shiki, ~575kB) into first-load JS, so widget.tsx now keeps only the launcher button in the index chunk and React.lazy-loads panel.tsx (ChatSessionProvider + MessageTranscript + composer) when the widget opens. Fixed the INEFFECTIVE_DYNAMIC_IMPORT warning by importing cronList statically in cron-dispatch.ts (it already sat in the index chunk via settings-scheduled-tasks.tsx, so the dynamic import could never split). Level dictionaries (n4 112kB) and heavy schemas (93kB) confirmed already isolated in their own lazy chunks. Verified with vite build (no chunk warning above 500kB except the documented lazy transcript chunk, no INEFFECTIVE_DYNAMIC_IMPORT), bun run check-types (0 errors), bun x ultracite check (clean), bun run test in apps/desktop (212 pass/0 fail incl. route-loaders guard) and packages/chat-session (23 pass/0 fail).
<!-- SECTION:FINAL_SUMMARY:END -->
