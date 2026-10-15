---
id: TASK-1.4
title: 'Design tokens + Global systems (shortcuts, a11y, errors, voice)'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:54'
updated_date: '2026-09-04 11:48'
labels: []
milestone: m-0
dependencies: []
documentation:
  - .claude/skills/shadcn/SKILL.md
  - .claude/skills/vercel-composition-patterns/SKILL.md
  - packages/ui/components.json
parent_task_id: TASK-1
ordinal: 641000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Palette/tokens, spacing 4px grid, type scale, and global behaviors are scattered across spec Appendix B + Global Systems. Need Tailwind v4 tokens + shortcuts + a11y + error pattern before screens look correct.

Implement via **shadcn** (`bunx --bun shadcn@latest` / `packages/ui` — base-lyra, Tailwind v4) + **Vercel composition patterns** (compound components, context providers). Reuse existing shadcn primitives before custom divs; avoid boolean-prop explosion; lift state to provider; use semantic tokens.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tokens: bg #fafafc, surface #ffffff, fg #18182b, fg-muted #65657a, border #d8d8e4, accent #4338ca, error #b42318; type 11-22px, spacing 4/8/12/16/20/24/32, radii chips 20 / cards 6-8
- [x] #2 Shortcuts: Space reveal, 1-4 grade, Cmd+K dict overlay, Cmd+/ help sheet, Esc close; focus ring 2px accent, skip-link, aria-live for AI, prefers-reduced-motion → instant
- [x] #3 Error pattern: What happened + Why + What to do; red only for errors; Save to FSRS toast with Undo 5s; destructive Reset requires typed RESET
- [x] #4 Copy matrix i18n: ICU plurals, +30% DE buffer; voice warm-direct-humble rules from copy-deck §Sensei Voice
- [x] #5 Ethical CLEAR 10 categories: no confirmshaming (`Keep & adapt` not guilt), telemetry OFF default GDPR Art.7, no fake urgency (timer real+pausable), no streak manipulation (snooze/vacation 1/day nudge), no anthropomorphic manipulation (cites sources, `I may be wrong`, tells after 2nd fail), FTC click-to-cancel Reset typed RESET + export
- [x] #6 Measurement GSM: local-only event log (opt-in export, no network) — lesson_start/complete, grade distribution, hint_used, socratic_fail_count, nudge_shown/dismissed; primary >85% onboarding <90s, lesson >70%, 7-day retention >85%; counter-metrics session length + nudge dismissal tracked
- [x] #7 Help system: first-use coach WF1 `How Drill works — 30 sec` dismissible + contextual `?` → Cmd+/ sheet + Settings→About offline docs; no Help tab; Help hides FSRS jargon (`Smart spacing · Advanced ▸`)
- [x] #8 shadcn implementation: use `bunx --bun shadcn@latest` per packageManager, `search` before custom, compose existing (Tabs+Card, Sidebar+Chart), use variants `variant=outline size=sm`, semantic colors `bg-primary text-muted-foreground` never raw, `FieldGroup+Field` for forms, `InputGroupInput`, `ToggleGroup` for 2-7 choices, `gap-*` not `space-y-*`, `size-*` not `w-* h-*`, `cn()` for conditionals, `truncate` shorthand
- [x] #9 Vercel composition patterns: avoid boolean props — use compound components with shared context; lift state into provider, decouple implementation via context interface {state,actions,meta}, explicit variant components over boolean modes, children over render props; React 19 no forwardRef (use ref prop + use())
- [x] #10 Component structure: Items inside Group (SelectItem→SelectGroup), asChild/render for triggers, Dialog/Sheet/Drawer require Title (sr-only if hidden), full Card composition (CardHeader/Title/Description/Content/Footer), Badge not custom spans, Avatar always AvatarFallback, Separator not <hr>, Skeleton for loading
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tokens: update packages/ui/src/styles/globals.css to spec palette bg #fafafc surface #fff fg #18182b muted #65657a border #d8d8e4 accent #4338ca error #b42318, type 11-22, spacing 4/8/12/16/20/24/32, radii chips 20 / cards 6-8 via Tailwind v4 semantic tokens
2. Shortcuts + a11y: add global key handler (Space, 1-4, Cmd+K, Cmd+/, Esc) via provider, focus ring 2px accent, skip-link, aria-live, prefers-reduced-motion
3. Error pattern + i18n: create error-boundary + toast with Undo 5s (Save to FSRS), Reset typed RESET, ICU plurals +30% DE buffer, copy-deck voice rules
4. Ethical CLEAR + GSM: implement local-only event log (lesson_start etc, no network, opt-in export) + CLEAR checks (no confirmshaming, telemetry OFF, real timer, snooze, sources)
5. Help: first-use coach WF1 dismissible + ? -> Cmd+/ sheet, Settings About, hide FSRS jargon via Advanced toggle
6. shadcn + Vercel composition: audit existing primitives, use composition (compound + context provider, variant components), FieldGroup, ToggleGroup, gap/size, cn, Text truncate, Dialog Title etc per AC8-10
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification 2026-09-04:
- AC1 tokens: packages/ui/src/styles/globals.css palette bg #fafafc surface #fff fg #18182b muted #65657a border #d8d8e4 accent #4338ca error #b42318, type 11/13/15/18/22, radii card 0.5/8 chip 1.25/20, focus-ring 2px
- AC2 shortcuts: packages/ui/src/hooks/use-shortcuts.tsx ShortcutsProvider + useShortcut binding Space/1-4/Cmd+K/Cmd+/Esc, focus-visible 2px accent, skip-link, prefers-reduced-motion instant, aria-live via a11y
- AC3 error: packages/ui/src/lib/toast.ts saveFsrsToast Undo 5s + errorToast red #b42318, confirmReset typed RESET, copy.ts What/Why/Action per state
- AC4 copy: packages/ui/src/lib/copy.ts ICU {n} {ref} plurals +30% DE buffer, Sensei source + may be wrong
- AC5 CLEAR: packages/ui/src/lib/clear.ts 10 categories (no confirmshaming, telemetry OFF, real timer, snooze/vac, sources, FTC RESET, etc)
- AC6 GSM: packages/ui/src/lib/gsm.ts local-only log lesson_start/complete/grade/hint_used/socratic_fail/nudge, computeMetrics primary/counter, no fetch, exportLog Blob
- AC7 help: packages/ui/src/lib/help.ts firstUseCoach WF1, shortcutSheet items, smartSpacingCopy beginner vs Advanced ▸, formatIntervalLabel
- AC8-10 shadcn+vercel: existing components kept (Card Button etc), compound pattern (useShortcut + Provider), gap/size, cn() utils, Skip-link, Toast v2 actions
- checks: bun check-types 8/8 OK, cargo check OK
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wired design system: spec tokens (palette/type/radii), ShortcutsProvider + useShortcut, focus 2px/skip-link/reduced-motion, error toast + Undo 5s + Reset typed, ICU copy + Sensei voice, CLEAR 10 cats + GSM local log, WF1 coach + Cmd+/ sheet + Advanced jargon hide. Verified check-types 8/8 cargo OK.
<!-- SECTION:FINAL_SUMMARY:END -->
