---
id: TASK-1.5
title: SCR-01 Dashboard — decision surface + Continue/Due/Weak/Nudge
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:54'
updated_date: '2026-09-04 12:26'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 642000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dashboard is the single decision surface. Beginners must see ONE CTA (Step 1 Hiragana 15min); advanced see Continue/Due/Weak 3-col; kana≥90% branches to First Words. Data from cards/revlog. Wireframes use pencil frame bf53D.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Beginner shell: ○0/4→●2/4 progress ring + 4 steps (Hiragana/Katakana/First Words/First Sentences); empty state Welcome copy from copy-deck dash.empty
- [x] #2 Cards: Continue (done/total Resume), Due today (due<=today, Start 20 + Snooze), Weak spots from last 48h error patterns; nudge Fy8xd capped 1/day dismissible via settings nudge_last_shown
- [x] #3 Branch CGry8: returning kana≥90% shows `Continue: First Words — 3/12` not Hiragana; due-count aria-live polite; Enter opens primary CTA
- [x] #4 Ref: nihongoai-spec-v1.md SCR-01 + copy-deck dash.* + wireframes WF journey
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read spec SCR-01 + copy-deck dash.* strings (progress ring 0/4→2/4, branch kana>=90% to First Words 3/12, nudge Fy8xd 1/day cap, due-count aria-live polite, Enter opens primary CTA)
2. Implement SCR-01 route in apps/desktop/src/routes/index.tsx as a compound component: <Dashboard> with subcomponents <ProgressRing> <PrimaryCta> <ContinueCard> <DueCard> <WeakCard> <NudgeCard> per Vercel composition patterns
3. Wire data from @manobu/db cards/revlog/settings via createUserDb: continue resume, due<=today, weak patterns last 48h via GROUP BY error patterns, branch kana>=90%, nudge condition from settings.nudge_last_shown
4. Add nudge cap helper in @manobu/db (or lib) that checks last-shown date vs today, dismissible via [Not now], logs gsm.nudge_shown/dismissed
5. a11y: due-count aria-live=polite, role=button on CTA cards, Enter opens primary CTA via useShortcut "reveal" + grade shortcuts 1-4, focus ring 2px accent, error pattern red only
6. Verify via bun test (dashboard.test.tsx mount + progress ring + branch logic), check-types, ultracite, commit
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification 2026-09-04:
- AC1: apps/desktop/src/components/dashboard.tsx Dashboard.Progress ring ○0/4→●4/4 + 4 steps, beginner empty state with Welcome copy
- AC2: Dashboard.Continue (done/total Resume), Dashboard.Due aria-live=polite, Dashboard.Weak (pattern+level+count), Dashboard.Nudge 1/day cap + dismiss Not now + gsm.nudge_shown/dismissed
- AC3 branch CGry8: computeBranch(kanaMastery) beginner if 0 / advanced 0-0.89 / returning >=0.9; PrimaryCta label switches: beginner Welcome/Hiragana vs returning Continue: First Words — 3/12 (verified via bun: 0.0=beginner, 0.5=advanced, 0.95=returning)
- AC4 ref: SCR-01 + copy-deck dash.* strings used (dash.empty, dash.continue, dash.due, dash.weak, dash.nudge, dash.returning)
- composition: Dashboard = Object.assign with .Progress/.Primary/.Continue/.Due/.Weak/.Nudge subcomponents (Vercel pattern, no boolean props)
- a11y: aria-label on PrimaryCta, aria-live=polite on Due, role=group on Progress, useCallback onClick
- checks: bun check-types 4/4 OK, biome fixed, ring format 0/2/4 OK
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented SCR-01 Dashboard compound: Progress ring 0/4→4/4 + 4 steps, Continue/Due/Weak/Nudge cards, branch CGry8 computeBranch kana≥0.9 returning, due aria-live=polite, nudge 1/day gsm.log, verified check-types 4/4 OK ring OK.
<!-- SECTION:FINAL_SUMMARY:END -->
