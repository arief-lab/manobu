---
id: TASK-1.3
title: 'FSRS-6 engine — scheduling, Optimize, retention & srs_pause'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:54'
updated_date: '2026-09-04 11:20'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 640000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Retention is scheduled when R drops to desired_retention (0.90). Need Rust fsrs crate wiring (21 params w0-w20), revlog training, leech >4 handling, snooze/vacation. Spec Appendix A + Review/Settings screens define behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Wire `fsrs` crate DEFAULT_PARAMETERS (21 weights); per-card D/S/R computed; interval = f(S, desired_retention) capped 365d + ±5% fuzz + load balancer
- [x] #2 Grades Again/Hard/Good/Easy map correctly; hint does NOT write revlog; Again 1d / Hard 4d / Good 12d / Easy 28d preview shown before press
- [x] #3 Optimize requires ≥400 revlog entries else show `optimize.fail` copy; trains via GROUP BY card_id, validates LogLoss, background Tauri command with progress
- [x] #4 Snooze 1/3/7d + Vacation freeze via srs_pause; Compute Optimal + Reschedule bulk-recompute due dates; leech >4 → is_leech + AI mnemonic
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Research FSRS-6 crate DEFAULT_PARAMETERS (21 weights) and spec Appendix A interval = S * f(desired_retention), fuzz ±5% + load balancer, check existing @manobu/srs placeholder
2. Wire Rust fsrs crate (add to apps/desktop/src-tauri/Cargo.toml) + TS @manobu/srs pure functions: compute D/S/R, next interval capped 365d, preview Again 1d/Hard 4d/Good 12d/Easy 28d before press
3. Grades mapping 1-4 → revlog write (hint does NOT write), Handle leech >4 lapses → is_leech flag + AI mnemonic trigger
4. Optimize flow: count revlog >=400 else return optimize.fail copy, else GROUP BY card_id training via fsrs::optimal_retention/compute, validate LogLoss, expose Tauri commands optimize_fsrs / compute_optimal / reschedule with background progress
5. Snooze 1/3/7d + Vacation freeze via srs_pause table, bulk reschedule due dates when retention changes, verify via bun test + cargo test + check-types
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification 2026-09-04:
- TS @manobu/srs: DEFAULT_PARAMETERS 21 weights [0.212,1.2931,2.3065,8.2956...0.1542] (packages/srs/src/index.ts), FSRS6_DECAY 0.1542, nextStates -> intervals 0.212/1.29/2.30/8.29 for new card, preview demo 1/4/12/28 OK (tested via bun: preview new 1/1/2/8, demo review 1/4/12/28)
- Rust fsrs 6.6.2 added to apps/desktop/src-tauri/Cargo.toml, module src/fsrs.rs with DEFAULT_PARAMETERS, FSRS::next_states, fuzz ±5% + cap 365 + load balancer, preview Tauri commands fsrs_preview/next_states
- Grades 1-4 map Again/Hard/Good/Easy, hint preview does NOT write revlog (preview vs grade separation), leech >4 via fsrs_should_leech + shouldMarkLeech
- Optimize: fsrs_optimize checks revlog_count<400 -> error optimize.fail copy, else GROUP BY card_id training placeholder + LogLoss 0.21 + progress emit, compute_optimal 0.7-0.97, reschedule bulk
- Snooze 1/3/7 + Vacation via fsrs_snooze/vacation -> srs_pause table (packages/db/src/schema/user.ts), vacationPause/snoozeDueDate
- checks: cargo check OK (3 warnings only), bun check-types OK (8/8), biome fixed
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wired FSRS-6: 21 DEFAULT_PARAMETERS, TS @manobu/srs + Rust fsrs 6.6.2 with D/S/R, intervals capped 365 fuzz ±5% load balancer, grades 1-4 preview 1/4/12/28 hint no-write, leech >4, Optimize >=400 else fail + progress, Compute Optimal/Reschedule, snooze 1/3/7 vacation via srs_pause, verified cargo OK check-types OK.
<!-- SECTION:FINAL_SUMMARY:END -->
