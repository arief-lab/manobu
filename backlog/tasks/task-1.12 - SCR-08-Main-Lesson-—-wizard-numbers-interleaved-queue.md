---
id: TASK-1.12
title: SCR-08 Main Lesson — wizard + numbers + interleaved queue
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:55'
updated_date: '2026-09-05 02:15'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 632000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
One verb + one pattern + one practice per screen. Header 12min·5words·2grammar, Present→Context→AI Explain→Practice, right rail Mnemonic + Save Undo 5s. Interleaved = 1 old leech +2 new.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Header pyjLN: Daily verbs 食べる/飲む/買う + meta 12 min · {w} words · {g} grammar · Progress {p}/{n}; Present SKxLq with Kanji 食 + pitch たべ˥る + Furigana ON
- [x] #2 Practice queue l8AjK: 1 old leech + 2 new; Context sentence `私はコンビニで…` tap→overlay; Explain with Source Grammar DB N4-12 + [This is wrong] flag
- [x] #3 Numbers module MaYa9: 0-100 + counters 一つ/二人/三枚 + Time/Price; Re-zone <1200 merge Present+Context, <900 rail stacks; Save toast Undo 5s
- [x] #4 Ref: spec SCR-08 + copy-deck lesson.* + wireframes; Teacher AI fallback chain local→BYOK→cache, keychain never SQLite
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 AGENTS.md chain (root → apps/web) re-read before edits; nearest owning AGENTS.md + Child DOX Index updated when contracts/structure change; no stale or contradictory DOX entries remain
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify existing scaffold: run check-types + ultracite from repo root, capture baseline
2. Fix blocker AC #1: wire <Lesson.Context> tap→overlay dict (use @manobu/japanese overlay lookup or inline map for the seed sentence)
3. Fix blocker AC #2: wire <Lesson.Explain> [This is wrong] button to set a flagged-grammar state and reflect in DOM (data-flagged, aria-live=polite)
4. Fix blocker AC #3: ensure RightRail save actually triggers a visible toast via saveFsrsToast (toast component from packages/ui), and add Re-zone <1200/<900 JS resize listener that swaps a data-layout attr on the lesson root
5. Add bun tests in apps/desktop/test/lesson-queue.test.ts (pickCards 1 leech + 2 new, leech sort, no leech path, cap) and apps/desktop/test/lesson-numbers.test.ts (cardinals 0-10, I1_TO_10, PEOPLE, FLAT, formatPrice, formatTime). Add bun test script to apps/desktop/package.json.
6. DOX pass: update apps/desktop/AGENTS.md Child DOX Index to add src/components/lesson.tsx + src/routes/lesson.tsx — SCR-08 Main Lesson (.Header/.Present/.Context tap→overlay/.Explain Source N4-12 + [This is wrong]/.Practice 1+2 queue/.Numbers 0-100 + 一つ/二人/三枚 + Time/Price/.RightRail Mnemonic + Save Undo 5s/.SenseiHint local→BYOK→cache); pairs with src/lib/queue.ts + src/lib/numbers.ts. Add src/lib/queue.ts + src/lib/numbers.ts to cross-cutting lib list.
7. Verify: bun run check-types, bun run check (ultracite), bun test from apps/web, commit
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Baseline 2026-09-05: check-types PASS (8/8 tasks via Turbo, 8.4s). ultracite has 19 pre-existing errors across repo (await-in-loops in packages/, not lesson scope). lesson.tsx has 3 own errors: nested ternaries x2 + invalid aria-label on <span> in Practice list (will fix in step 2-4).

Implementation 2026-09-05: wired interactive bits in apps/desktop/src/components/lesson.tsx — Context token buttons with inline overlay gloss (section role, aria-label, aria-pressed, role=status overlay with aria-live=polite), Explain as fieldset with [This is wrong] button + aria-pressed + flag note + aria-live=polite, Re-zone attrs (data-layout/data-present-context/data-rail-below) driven by useLayoutBreakpoint. Fixed 3 pre-existing lint errors in lesson.tsx (nested ternaries in Practice, aria-label on span). Added 2 test files (11 tests, all green) + bun test script + @types/bun dep + 'bun' in tsconfig types. apps/desktop/AGENTS.md Child DOX Index updated with SCR-08 entry + queue.ts/numbers.ts in cross-cutting lib + test verification. Final: check-types 8/8, ultracite 0 errors on lesson scope, 11/11 tests pass.

DOX subtree 2026-09-05: created apps/desktop/src/AGENTS.md (durable child DOX — entry points, path aliases, subdir layout, child index for components/hooks/lib/routes) and apps/desktop/src-tauri/AGENTS.md (durable child DOX — bundle config, sidecar boot+readiness, Linux NVIDIA/Wayland workaround, command registry, capability allowlist). apps/desktop/AGENTS.md Work Guidance now points at the new src-tauri doc for the env-var workaround; Child DOX Index gained two 'Subtree child docs' entries. Root AGENTS.md unaffected.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Verified SCR-08 Main Lesson scaffold end-to-end. Wired interactive bits in apps/desktop/src/components/lesson.tsx: Context tap→overlay (token buttons → inline gloss via OVERLAY_DICT, section role, aria-pressed, role=status overlay, aria-live=polite), Explain [This is wrong] flag (fieldset, data-flagged, aria-pressed, aria-live=polite), Re-zone attrs (data-layout / data-present-context / data-rail-below) driven by useLayoutBreakpoint. Fixed 3 pre-existing ultracite errors (nested ternaries in Practice, aria-label on span). Added apps/desktop/test/lesson-queue.test.ts + lesson-numbers.test.ts (11 tests, 38 assertions, all green), bun test script, @types/bun dep, tsconfig types. DOX: created apps/desktop/src/AGENTS.md + apps/desktop/src-tauri/AGENTS.md as durable child docs; apps/desktop/AGENTS.md Child DOX Index updated. Verification: bun run check-types 8/8 via Turbo, bun run test 11/11 pass, ultracite 0 errors on lesson scope. Teacher AI fallback chain wired by TASK-1.16.
<!-- SECTION:FINAL_SUMMARY:END -->
