# TASK-27: Fix orphaned /learn/conversation route (add /learn parent route)

## Purpose
Fix the route tree smell where `/learn/conversation/$sessionId` appears as a root-level route despite having nested directory structure (`src/routes/learn/conversation/$sessionId.tsx`). Adding a proper `/learn` parent route creates an honest route hierarchy and enables shared TeacherAgent layout.

## Ownership
- Project contributor assigned to this task.

## Local Contracts
- Modifies `apps/desktop/src/routes/learn.tsx` (new file)
- Regenerates `apps/desktop/src/routeTree.gen.ts` (do not edit manually)
- Updates `apps/desktop/AGENTS.md` route audit table
- May update `apps/desktop/test/route-loaders.test.ts`

## Work Guidance
1. Create `src/routes/learn.tsx`:
   - Export a `Route` object from `createFileRoute("/learn")`
   - No `loader:` or `validateSearch:` needed (layout wrapper)
   - Component renders `<Outlet />` or directly renders children
   - Add basic layout: header with "Learn" title, optional sidebar placeholder
2. Run `bun run dev` to regenerate `routeTree.gen.ts`
3. Verify generated tree shows `/learn` as parent of `/learn/conversation/$sessionId`
4. Update `apps/desktop/AGENTS.md`:
   - Add SCR-?? row for the new `/learn` parent route (Tier 2 local-state)
   - Update SCR-01 Dashboard description if needed
5. Update regression guard if the new route requires special handling

## Verification
- `bun x ultracite check .` clean
- `bun run check-types` clean
- `bun run test` passes
- Manual inspection: `src/routes/routeTree.gen.ts` shows proper parent-child relationship

## Child DOX Index
- `apps/desktop/src/routes/learn.tsx` will appear in the `routes/` section of `apps/desktop/AGENTS.md` Child DOX Index

## Notes
- This is a refactor that preserves all existing deep links (`/learn/conversation/abc123` still works)
- Enables future `/learn/summary/$sessionId` child routes
- The parent route can host shared TeacherAgent chrome (sidebar, header)
- Follow the existing pattern: file goes in `src/routes/<name>.tsx`, import matching compound from `src/components/`, re-run `bun run dev`

## Child DOX Index
- `TASK-27.1` — Verify generated `routeTree.gen.ts` after `/learn` parent route (TASK-28)
- `TASK-27.2` — Update `apps/desktop/AGENTS.md` route audit table for `/learn` parent route (TASK-29)
- `TASK-27.3` — Add `/learn` parent route to `route-loaders.test.ts` regression guard (TASK-30)

## Skill Guidance
- `.agents/skills/tanstack-router/SKILL.md` — read before refactoring. Key points:
  - File-based routing: `createFileRoute("/learn")` in `src/routes/learn.tsx` creates a parent route automatically
  - Parent routes render `<Outlet />` to host children
  - `.lazy.tsx` pattern: keep loaders in the main file, components in `.lazy.tsx`
  - `getParentRoute: () => rootRouteImport` is implicit for file-based routes
  - `pendingComponent` and `notFoundComponent` are optional on layout routes
  - Re-run `bun run dev` to regenerate `routeTree.gen.ts` after adding a new route