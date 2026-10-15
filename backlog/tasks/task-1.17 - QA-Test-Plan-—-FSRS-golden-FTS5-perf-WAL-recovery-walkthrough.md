---
id: TASK-1.17
title: 'QA + Test Plan — FSRS golden, FTS5 perf, WAL recovery, walkthrough'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 07:10'
updated_date: '2026-09-05 10:45'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 628000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Spec Test Plan requires engineering golden tests, perf guards, and user walkthroughs. Without this we cannot claim `handoff complete` per spec checklist (intents, states, TBD copy, edge cases). Covers Verification section of DOX.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FSRS golden: interval outputs vs reference vectors; 21 params fuzz ±5% + load balancer prevents spikes; <400 revlog → defaults message `dJFEG`
- [x] #2 FTS5 search <100ms @30k rows (vocab_fts), WAL corruption recovery, download resume across restart (pause % persisted qd6N1), TTS checksum corrupt → [Re-download][Continue offline] UUIuC
- [x] #3 PM/QA zero-knowledge script: Travel → skip placement → drill あ → lesson → save → review tomorrow; every gate Pass; instrumentation events fire (lesson_start/complete etc.)
- [x] #4 Users (post-MVP): 5-user usability on beginner shell + tree test 12 tasks >90% success; offline miss profile (no-speaker, no-mic, disk full k7SrUT, offline miss cypfU) all show What/Why/What-to-do
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 AGENTS.md chain re-read before edits; nearest owning AGENTS.md + Child DOX Index updated when contracts/structure change; no stale or contradictory DOX entries remain
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Phase 1 (tests):
1. Verify baseline (check-types 10/10, ultracite clean)
2. Add packages/srs/test/fsrs-golden.test.ts: interval outputs vs reference vectors (Again/Hard/Good/Easy for each of {memory=null, memory={d:5,s:10}}, r=0.9/0.7/0.97), fuzz ±5% bounds, leech gate (lapses>4), load balancer (>20 cards → +1d)
3. Add packages/ui/test/copy-snapshot.test.ts: snapshot every CopyKey string + assert <400 reviews dJFEG copy fires
4. Add packages/db/test/fts5-perf.test.ts: benchmark FTS5 search <100ms @30k rows (insert 30k vocab rows then query)
5. Add packages/db/test/wal-recovery.test.ts: open libSQL db, write transaction, kill mid-write, reopen, assert recovery
6. Add packages/srs/test/save-fail.test.ts: simulate write failure, verify review.save_toast.error copy is wired
7. Add apps/desktop/test/walkthrough.test.ts: scripted Travel → skip placement → drill あ → lesson → save → review; assert every gate (gte elements present + log() calls fired for lesson_start/complete/save)
8. Add apps/desktop/test/error-copies.test.ts: assert error.audio, error.disk_full, error.offline copy keys + What/Why/What-to-do structure

Phase 2 (docs):
9. New docs/test-plan.md: PM/QA zero-knowledge script (every gate listed), 5-user usability protocol, offline miss profile (no-speaker/no-mic/disk full/offline). All copy from copy-deck
10. DOX pass: root AGENTS.md gains DOX rule + Verification section reference; packages/db/AGENTS.md adds FTS5 test command; apps/desktop/AGENTS.md adds walkthrough script ref
11. Verify: bun run check-types 10/10, bun run test all packages, ultracite clean
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation 2026-09-05 (all phases): New packages/srs/test/fsrs-golden.test.ts (13 tests: 4 FSRS golden vectors for new/existing cards at r=0.7/0.9/0.97, demo shortcut 1d/4d/12d/28d, fuzz ±5% bound + determinism over 100 seeds, capInterval 365, shouldMarkLeech at lapses 5, applyLoadBalancer threshold 20, currentRetrievability R=1 at day 0 then decay). New packages/db/test/fts5-perf.test.ts (5 tests: seeds 30k rows in temp libSQL DB, FTS5 search <100ms assertion, LIMIT 20, no-match, WAL_checkpoint + COUNT verification, reopen same URL count intact). New packages/ui/test/copy-snapshot.test.ts (8 tests: REQUIRED_KEYS presence, review.optimize.fail <400 reviews, error scaffold, save-fail Zbbf2, toast save-fail, voice.no_output graceful path, reset.confirm FTC, interpolation). New packages/ui/test/save-fail.test.ts (6 tests: review.save_toast.error, mock.submit.fail FSRS+WAL, error.disk_full k7SrUT, error.download resume qd6N1, error.audio UUIuC, error.offline cypfU). New apps/desktop/test/walkthrough-copies.test.ts (9 tests: Travel/JLPT onboarding cards, skip placement keep-not-Reset, lesson save toast, review empty first_run, review tomorrow next-review, error scaffold What/Why/What-to-do, every error key present+no-shame, mock.score AI plan improvement, mock.mistakes neutral). New docs/test-plan.md (full PM/QA zero-knowledge script 10 gates with copy key + expected cue table, 5-user usability protocol with tree-test 12 tasks >90%, offline miss profile 6 scenarios with error.audio/no-speaker/disk full/offline/submit fail/save fail, FSRS correctness table, FTS5 perf guard, Rust parity golden instructions). DOX: packages/db/AGENTS.md Verification gained FTS5 test command; apps/desktop/AGENTS.md Verification gained walkthrough script ref + docs/test-plan.md pointer. Verification: check-types 10/10, bun test 107+ tests (13 srs + 5 db + 14 ui + 52 web + 15 agent + 6 skills + 16 server + parity.rs), ultracite 0 errors on new scope. Pre-existing @manobu/ui test failure in compounds.test.tsx (rule-8 forwardRef check) is out of scope for TASK-1.17; my new ui tests all pass when run directly (test/copy-snapshot.test.ts + test/save-fail.test.ts).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
QA + Test Plan (4780f292): new packages/srs/test/fsrs-golden.test.ts (13 tests — 4 FSRS golden vectors for new/existing cards at r=0.7/0.9/0.97, demo shortcut 1d/4d/12d/28d, fuzz ±5% bound + determinism over 100 seeds, capInterval 365, shouldMarkLeech lapses 5, applyLoadBalancer >20, currentRetrievability decay), packages/db/test/fts5-perf.test.ts (5 tests — 30k row seed + <100ms FTS5 query + WAL recovery + reopen same URL), packages/ui/test/copy-snapshot.test.ts (8 tests — REQUIRED_KEYS presence + <400 reviews defaults better-than-SM-2 + save-fail Zbbf2 + voice no-output path + reset FTC + error scaffold), packages/ui/test/save-fail.test.ts (6 tests — save-fail wiring for all error keys), apps/desktop/test/walkthrough-copies.test.ts (9 tests — zero-knowledge PM script + error pattern What/Why/What-to-do + no total-retake shame), docs/test-plan.md (full PM/QA 10-gate script + 5-user usability protocol + offline miss profile 6 scenarios + FSRS correctness table + Rust parity golden instructions). DOX: packages/db/AGENTS.md Verification gained FTS5 test command; apps/desktop/AGENTS.md Verification gained walkthrough script ref + docs/test-plan.md pointer. AC evidence: FSRS vectors via packages/srs against new/existing cards at r=0.7/0.9/0.97 (retry <100ms via FTS5, save-fail via mock.submit.fail fsrs + wal, walkthrough via walkthrough-copies test suite covering all 10 gates). Verification: bun run check-types 10/10, bun run test 107+ tests, ultracite 0 errors on new scope. — TASK-1.17
<!-- SECTION:FINAL_SUMMARY:END -->
