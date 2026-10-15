---
id: TASK-25
title: TASK-25  apps/desktop frontend TanStack consistency (DOX + refactor)
status: Done
assignee: []
created_date: '2026-09-07 15:27'
updated_date: '2026-09-07 16:01'
labels: []
dependencies: []
ordinal: 583000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Audit (this conversation, 2026-09-07) found that apps/desktop/src is half-using TanStack Router + Query: the wiring is correct (main.tsx QueryClientProvider + RouterProvider, __root.tsx RouterAppContext, lib/next-cards.ts + lib/cards.ts + lib/tauri-queries.ts model the right pattern), but only 4 of 18 routes have loader: (lesson, review, jlpt-mock, ai) and only 1 of 13 components uses useQuery (settings.tsx, and only for useQueryClient). The rest hand-roll useState + useEffect for data, or inline-fetch in the component. This means SSR-style guarantees, hierarchical query keys, offlineFirst caching, and the pending/error routes from src/AGENTS.md:21 are missing from most surfaces.

Two-part scope:

  (a) DOX: capture the rule in machine-checkable form so future agents either follow it or get caught in review. Stale line in apps/desktop/src/AGENTS.md:49 still claims settings.tsx has a loader (it does not). Add a per-route loader-status table so the convention is auditable without grepping every file.

  (b) Refactor: walk the 14 routes + 12 components that hand-roll data fetching and convert them to queryOptions + useQuery / useMutation, with loader + ensureQueryData in the route. PRESERVE behavior - this is a structural change, not a feature change. Verification = bun run test stays green for every existing test (kana, walkthrough-copies, tts-surfaces, stt-stream, etc.); bun run check-types stays 0 errors.

Out of scope: SCR compounds that are purely local-state (DrillLab.Mastery, Roleplay.Save, Reader.RomajiChip, ListenType.Banner state) - those useState calls are correct and should NOT become useQuery. The refactor only touches compounds that actually fetch async data.

Tracks 2 subtasks:
  - TASK-26.1 DOX + audit table (no code change, low risk, ships first)
  - TASK-26.2 route + component refactor (medium risk, depends on 26.1 for the spec)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 apps/desktop/src AGENTS.md line 21 + 49 reflect the actual route loader distribution (no stale "settings has loader" claim)
- [x] #2 A per-route loader-status table is committed in apps/desktop/AGENTS.md listing all 18 routes + their loader/useQuery status
- [x] #3 apps/desktop/src/components/ AGENTS.md (new file) groups SCR compounds by data-fetching tier: data-driven / local-state / props-driven
- [x] #4 Refactor: 14 routes + components that hand-roll async data now go through queryOptions + loader + useQuery, matching the pattern in lib/next-cards.ts and lib/cards.ts
- [x] #5 bun run check-types + bun run test + bun x ultracite check apps/desktop all green after the refactor
- [x] #6 A regression test asserts every route file either has loader: or an opt-out comment /* data: local-state */ so the convention is machine-checkable
<!-- AC:END -->
