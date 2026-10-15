---
id: TASK-115
title: >-
  Chat: /ai has no honest offline state, so an unreachable sidecar renders an
  error boundary
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:05'
updated_date: '2026-09-24 14:05'
labels: []
dependencies: []
references:
  - 'apps/desktop/src/features/dashboard/dashboard.tsx:217'
documentation:
  - >-
    backlog/docs/feature/doc-12 -
    Chat-generated-JLPT-exams-N5..N1-a-kana-readiness-gate.md
  - backlog/docs/feature/doc-19 - UI-wireframes-the-chat-learning-surface.md
priority: high
type: bug
ordinal: 859200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With the server sidecar unreachable, `/ai` renders an error boundary: `Failed to open the chat: Failed to fetch`, `← Back to history`, `Start a new chat`, with a `FetchLinkTransport` TypeError in the console. `/dashboard` degrades honestly instead (`sensei offline, the desk still works`, `apps/desktop/src/features/dashboard/dashboard.tsx:217`), so the two surfaces disagree about what a dead server looks like. This was found in a browser pass on 2026-09-24 and recorded in `doc-12` §9 and `doc-19` §12.1. Part of the trigger is missing dev config (see the sibling task about the sidecar and `VITE_SERVER_URL`), but the same boundary is what a learner sees when the sidecar is genuinely gone, because `/ai` has no offline branch at all. The intended line already exists in the wireframes: `doc-19` §9 draws it and names the reused key family (`error.*`), so this task has a target shape rather than an open design question.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With the sidecar unreachable, `/ai` renders an inline offline state instead of an error boundary, and no `Failed to fetch` string reaches the learner.
- [x] #2 The offline state reuses the existing deck family (`error.offline` per doc-19 §9) rather than adding a new one-off string, and the string carries no em dash (R-02, enforced by `packages/ui/test/copy-snapshot.test.ts`).
- [x] #3 The rest of the shell stays usable while the chat is offline: the `← desk` affordance still navigates, and the route does not unmount the app.
- [x] #4 A component test pins the offline branch, and the offline state does not render when the sidecar is reachable, so the two paths cannot silently swap.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Offline branch for /ai per doc-19 §9: catch fetch/link failure in ChatRoute, render error.offline deck (You're offline: cached lessons still work, AI disabled) inline, keep shell usable, no Failed to fetch. Pin with component test mocking useQuery error.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Inline offline for /ai: loader safe-wraps ensureQueryData for catalogs so sidecar unreachable does not throw error boundary; ChatRoute detects isOffline via agentsQ.isError||personasQ.isError and renders t(error.offline) 'You're offline: cached lessons still work, AI disabled' in ai-offline banner (no em dash, no Failed to fetch), shell keeps ← desk usable. Pinned in apps/desktop/test/ai-offline.test.ts (4 AC). Verified: desktop 381 pass, check 438 clean, check-types 13/13.
<!-- SECTION:FINAL_SUMMARY:END -->
