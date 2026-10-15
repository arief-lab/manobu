---
id: TASK-79
title: Adopt shadcn chatbot-template UI + architecture for /ai chat
status: Done
assignee: []
created_date: '2026-09-15 06:58'
updated_date: '2026-09-15 15:15'
labels:
  - frontend
  - ai-chat
dependencies: []
priority: high
type: feature
ordinal: 517000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Port the good parts of https://github.com/shadcn-ui/chatbot-template (MIT) onto the existing chat stack (packages/chat-session + apps/desktop/src/routes/ai.tsx + apps/server /ai). NOT a clone: template is Next.js + Vercel AI Gateway + next-themes; manobu is Vite SPA + Tauri + Hono + local agents, one theme (DESIGN.md). The scroller/message/bubble/empty primitives already exist in @manobu/ui (same shadcn lineage). What we take: (1) the template's visual language for composer, empty-state suggestions, pinned question card, typeset markdown; (2) typed tool-part dispatch via InferUITools; (3) the ask_user human-in-the-loop questionnaire flow; (4) per-tool part components switching on part.state; (5) /ai route hardening. Split into subtasks 79.1-79.5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All subtasks Done; /ai visually matches the template's calm centered layout adapted to the sumi theme (no dark: variants, no next-themes, no em dash in copy per AGENTS.md R-02).
- [x] #2 bun run check-types + bun run check + desktop test suite green; chat-session persistence/multi-mount/exports tests still pass.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
79.1 Done (commit 31529be). 79.2/79.3 unblocked and parallelizable.

79.2 Done (commit 5681039), incl. pre-existing Picker MenuGroupContext crash fix in @manobu/ui. 79.3 remains unblocked.

79.3 Done (commit d516527). Key correction vs plan: no InferUITools-over-static-map (wire is open-ended runtime tool-<name> parts, proven by live probe); seam is ChatUIMessage + guard-based dispatch. 79.4 unblocked.

79.4 Done. Key correction vs plan: the template's no-execute client-tool + addToolOutput auto-resume is impossible over ACP (provider drops unregistered tools; MCP-prefixes wire names; isClientToolResult defeated by opencode's rawOutput wrapper; 30s proxy hostReq timeout; resume leg drops tool results). ask_user instead executes server-side with an immediate HANDOFF_UI return; the pinned QuestionCard answers via a normal next user message. ChatTools stays open (79.3 confirmed).

79.5 Done. Hardening (validateUIMessages before queue + isStepCount(5) + c.req.raw.signal abort), parts/ convention (ask-user-part moved, text-part extracted), AC5/AC1 dispatch tests, wire-contract pin (packages/acp/test/wire-contract.test.ts, verified loud), ask_user reliability: persona nudge x3 + strengthened tool description -> 2/3 bare-prompt triggers, refusal case documented in 79.5 notes. shimmer: already defined via shadcn @utility, live-verified animationName tw-shimmer. All 5 subtasks now Done. AC#2 full-suite evidence at closeout: root bun run check-types 13/13, root bun run check clean 326 files, desktop 391 tests 0 fail, chat-session 55 0 fail (persistence/multi-mount/exports included), server 58 0 fail, acp 53 0 fail.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
chatbot-template adoption complete via 79.1-79.5: visual language (centered layout, empty-state chips, typeset markdown), composer (stop, IME-safe Enter, model select), guard-based typed part dispatch, ask_user pinned-card handoff over ACP, per-tool parts/ components, /ai route hardening (structural validation, step cap, disconnect abort), provider wire-name pin. Verified: root typecheck + ultracite check clean, desktop 391 / chat-session 55 / server 58 / acp 53 tests green, live E2E on /ai (card render -> answer -> continue, sentinel-free transcript, tw-shimmer computed, mid-stream abort with queue release).
<!-- SECTION:FINAL_SUMMARY:END -->
