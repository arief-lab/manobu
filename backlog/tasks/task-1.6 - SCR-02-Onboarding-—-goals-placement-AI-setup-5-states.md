---
id: TASK-1.6
title: SCR-02 Onboarding — goals + placement + AI setup 5 states
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:54'
updated_date: '2026-09-04 13:58'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 643000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Onboarding maps goal→curriculum without JLPT jargon (4 cards) + adaptive placement quiz + AI setup that never blocks drills. Copy-deck goal.* + spec SCR-02 define 5 AI states and error banners.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Goal cards: Travel/JLPT/Anime/Work with preview line + Recommended chip; switch dialog pfQAB shows Keep 42/Add 18/SRS preserved with `Keep & adapt` primary
- [x] #2 Placement: adaptive skip kana if あ-お correct, Skip placement always visible, >3s shows skeleton iZL4O + Try again
- [x] #3 AI setup 5 states: local found ✓ / CLI missing (GB + disk check + pause/resume qd6N1) / BYOK 51-char invalid inline / quota→local banner / offline→FAQ cache; drills never blocked
- [x] #4 Errors: download resume persisted %, disk full k7SrUT [Free space][Continue offline], keychain/mic permission → [Open System Settings]
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read spec SCR-02 + copy-deck goal.* (Travel/JLPT/Anime/Work), onboard.* strings, Recommended chip on Travel, switch dialog pfQAB with Keep/Add/SRS
2. Implement SCR-02 compound <Onboarding> in apps/desktop/src/routes/onboarding.tsx with subcomponents: <Goals> (4 goal cards + Recommended chip), <GoalSwitchDialog> (Keep 42/Add 18/SRS preserved, Keep & adapt primary), <Placement> (adaptive skip kana if あ-お correct, Skip always visible, >3s skeleton iZL4O + Try again), <AiSetup> (5 states: local-found/cli-missing/byok/quota/offline), <Errors> (download-resume %, disk-full k7SrUT, permission)
3. AI 5 states: create AiSetupState discriminated union; local-found -> green check + Use local; cli-missing -> GB size + disk check + pause/resume; byok -> 51-char paste inline Retest; quota -> banner Switch to local; offline -> FAQ cache Continue offline; drills never blocked (no AI gate)
4. Error pattern: download resume at % persisted (qd6N1), disk full [Free space][Continue offline] k7SrUT, keychain/mic permission [Open System Settings] q1Ghb0; reuse errorToast red #b42318, copy.ts strings
5. a11y: skip placement visible focus, recommended chip, switch dialog TrapFocus, recommended goal as primary CTA via useShortcut reveal, error pattern red only
6. Verify bun test (placement skip logic, ai 5 state machine), check-types, ultracite, commit
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification 2026-09-04:
- AC1 goals: apps/desktop/src/components/onboarding.tsx GOAL_CARDS 4 (travel/jlpt/anime/work) with preview + Recommended chip on travel, GoalSwitchDialog with Keep/Add/SRS + Keep & adapt primary
- AC2 placement: HIRAGANA_BASIC あ/い/う/え/お + skipHiragana derived from answers === romajiFor, Skip button always visible, Try again -> setTimeout 3000 -> loading skeleton iZL4O
- AC3 AI 5 states: AiSetupState discriminated union (local-found/cli-missing/byok/quota/offline), each rendered with copy-deck strings, drills never blocked (no AI gate)
- AC4 errors: qd6N1 download resume %, k7SrUT disk full, q1Ghb0 permission via errorToast red #b42318
- composition: Onboarding = Object.assign with .Goals/.Placement/.AiSetup/.GoalSwitchDialog (Vercel pattern)
- a11y: aria-pressed on goal cards, role=button + tabIndex, aria-label on input, aria-label on dialog
- checks: bun check-types 4/4 OK, biome fixed, GOAL_CARDS 4 + travel recommended + romaji a/o OK
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented SCR-02 Onboarding compound: 4 goals + Recommended travel, GoalSwitchDialog Keep/Add/SRS, adaptive placement skip kana on あ-お correct + skeleton iZL4O 3s, AI 5-state machine (local/cli-missing/byok/quota/offline), drills never blocked, error pattern qd6N1/k7SrUT/q1Ghb0. Verified check-types 4/4.
<!-- SECTION:FINAL_SUMMARY:END -->
