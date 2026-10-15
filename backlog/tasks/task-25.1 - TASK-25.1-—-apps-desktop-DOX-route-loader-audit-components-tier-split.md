---
id: TASK-25.1
title: 'TASK-25.1 — apps/desktop DOX: route loader audit + components tier split'
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-07 15:28'
updated_date: '2026-09-07 15:40'
labels: []
dependencies: []
parent_task_id: TASK-25
ordinal: 581000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
No code change. Make the existing TanStack convention auditable so future agents either follow it or get caught in review.

Three DOX updates:

  1. apps/desktop/AGENTS.md Child DOX Index routes/ line — append a per-route loader-status table (18 rows, columns: route path / loader: present? / uses queryOptions? / data source). Same table appears in the new components/AGENTS.md split. Drives the regression test in 25.2.

  2. apps/desktop/AGENTS.md line 49 lib/ entry — fix the stale "settings.tsx has validateSearch+loader+loaderDeps" claim (settings has none of those; just useQueryClient). Either rewrite the sentence or drop the parenthetical.

  3. apps/desktop/src/components/AGENTS.md (new file, ~30 lines) — group the SCR compounds by data-fetching tier so the convention is visible without reading each file:
    - data-driven: lesson (useNextCards via lib/next-cards.ts), jlpt-mock + review (useCardsDue + usePersistCards + useGradeCard via lib/cards.ts), settings (lib/tauri-queries.ts)
    - local-state: dashboard (mock data inline), reader (Furigana/RomajiChip toggles), listen-type (input + shake), roleplay (saved counter + level), conjugate (input + grading), drill-lab (mastery index)
    - props-driven (initial={} from route): drill, kanji-detail, roleplay, jlpt-mock root, listen root — these read from route initial props; route is responsible for any async fetch via loader
    - lesson gets a special note: the route loader is currently a degenerate lessonQueryOptions = Promise.resolve({ level }) — flagged as a TODO; the real data path is via useNextCards() inside the component, not the loader

  This is the spec the 25.2 refactor works against.

No code, no test changes, no verification beyond bun x ultracite check apps/desktop/src (markdown files lint clean). Commit message describes the audit as the source.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 apps/desktop/AGENTS.md routes/ line has the per-route loader-status table (or a pointer to it)
- [x] #2 apps/desktop/AGENTS.md line 49 no longer claims settings.tsx has a loader
- [x] #3 apps/desktop/src/components/AGENTS.md (new file) groups SCR compounds by data-fetching tier with a row per component
- [x] #4 bun x ultracite check apps/desktop clean
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Audit confirmed 4/18 routes have loader, 1/13 components uses useQuery. New apps/desktop/src/components/AGENTS.md adds the tier split (Tier 1 async-wired, Tier 2 local-state, Tier 3 props-driven). apps/desktop/src/AGENTS.md routes/ line replaced with a per-route audit table (18 rows, columns: validateSearch/loader/loaderDeps/data source) + TODO markers on lesson/kanji-detail/settings for TASK-25.2. No code change. bun run check-types 0 errors, bun x ultracite check apps/desktop clean (85 files). Commit 757eb2b on main.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the per-route TanStack loader audit table to apps/desktop/src/AGENTS.md (line 50 routes/ entry) - replaces the stale settings.tsx has-validateSearch+loader+loaderDeps claim with an accurate 18-row audit (validateSearch / loader / loaderDeps / data source columns) marking TODO for lesson (degenerate loader), kanji-detail (hand-rolled lib/kanji.ts), and settings (Tauri invokes inside component). Created apps/desktop/src/components/AGENTS.md grouping all 19 SCR compounds by data-fetching tier: Tier 1 async-wired (lesson / jlpt-mock / review-queue / settings), Tier 2 local-state (dashboard / reader / listen-type / roleplay / conjugate / drill-lab / onboarding / ask-sensei/widget), Tier 3 props-driven (drill-lab / kanji-detail / listen-type / roleplay / jlpt-mock as a child). Documents Tier 0 (hand-rolled async data in components) as the convention being consolidated away from. Verification: bun run check-types 0 errors, bun x ultracite check apps/desktop clean. Commit 757eb2b on main. No code change.
<!-- SECTION:FINAL_SUMMARY:END -->
