---
id: TASK-98
title: >-
  src-tauri: make the Tauri crate rustfmt-clean, then widen the cargo fmt gate
  to cover it
status: Done
assignee:
  - '@arif'
created_date: '2026-09-21 19:20'
updated_date: '2026-09-22 02:48'
labels:
  - rust
  - tooling
  - desktop
dependencies: []
references:
  - apps/desktop/src-tauri/src/mcp.rs
  - .husky/pre-commit
  - .git-blame-ignore-revs
  - crates/AGENTS.md
priority: low
type: chore
ordinal: 372000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-97 gated Rust formatting for crates/jlpt-mcp only. apps/desktop/src-tauri still has 61 rustfmt hunks (verified with cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml on 2026-09-22), so the hook at .husky/pre-commit:6 deliberately excludes its path: adding it today would block every Tauri commit. The two crates are standalone (no Cargo workspace), so each needs its own manifest-path in the gate. This task closes that gap by landing the formatting-only reformat first and then widening the path, so both Rust crates in the repo are covered by the same contract. It also carries the same risk profile as the jlpt-mcp reformat: src-tauri hosts the vaporetto model wiring and the mcp.rs tests, so a reformat must be proven behaviour-neutral, not just green.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml exits 0 with no remaining diff hunks.
- [x] #2 The reformat lands as its own formatting-only commit (no logic, no renames, no dependency changes) and that rev is appended to .git-blame-ignore-revs with the same style of comment as the existing jlpt-mcp entry.
- [x] #3 Behaviour neutrality is proven by evidence, not by assertion: cargo test for src-tauri passes with the same test counts before and after, and cargo check is clean. Note from TASK-97 that binary hashing is not a valid proof here (panic-location immediates and the build-id change under a formatting-only diff).
- [x] #4 The .husky/pre-commit gate pathspec is widened to cover apps/desktop/src-tauri, and the gate is exercised in both directions: staging an unformatted .rs under src-tauri fails the commit, and a commit with no staged .rs under either Rust crate passes silently and prints nothing.
- [x] #5 crates/AGENTS.md:18 is updated to drop the "src-tauri is not clean / outside the gate" carve-out once it no longer applies, and any sibling doc that repeats that claim (crates/jlpt-mcp/AGENTS.md, root AGENTS.md fallow paragraph) is corrected in the same change.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
EXECUTION PLAN (2026-09-22, researched before implementation)

BASELINE (measured, not recalled)
- cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml: exit 0, 45 passed / 0 failed / 0 ignored in the lib target, plus two 0-test targets (the app bin and the doc test). Warm target/ (11 GB) so this was incremental.
- cargo fmt --check: 61 hunks over 10 files - src/speech/stt.rs 20, src/speech/models.rs 10, src/cron.rs 9, src/fsrs.rs 6, src/speech/tts.rs 5, src/speech/vad.rs 4, src/mcp.rs 4, src/main.rs 1, src/lib.rs 1, build.rs 1. src/speech/mod.rs, error.rs and speech/stt.rs-adjacent files are already clean.

LANDING DECISION: on re-design, not main. Same shape as the approved TASK-97 deviation: main is a strict ancestor of re-design (0 behind, 131 ahead) and re-design already edits src/mcp.rs (+175, the TASK-96 per-server env work), which carries 4 of the 61 hunks. A reformat committed on main would conflict with itself in that file on the merge. It still reaches main through the normal merge and stays formatting-only.

STEPS
1. Baseline cargo test recorded above (done).
2. cargo fmt over the crate. One default run, no rustfmt.toml, no hand-formatting.
3. Re-run cargo test and cargo check; the test counts must match the baseline exactly (45/0/0). Binary hashing is not used as evidence (TASK-97 finding).
4. Commit formatting-only: no other file in it.
5. Append that rev to .git-blame-ignore-revs with the same comment style as the jlpt-mcp entry. Enabling it stays a per-clone git config the user runs.
6. Widen .husky/pre-commit so both Rust crates are covered: one loop over the two manifest paths, still ABOVE the ultracite marker block. The gate must fire only when a .rs file under either crate is staged.
7. Exercise the gate both directions: stage an unformatted .rs under src-tauri (commit must fail), and make a non-Rust commit (must print nothing about Rust).
8. DOX: crates/AGENTS.md drops the src-tauri carve-out, apps/desktop/src-tauri/AGENTS.md Verification gains cargo fmt --check, root AGENTS.md pre-commit sentence covers both crates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation notes (2026-09-22)

Landed on re-design, following the approved TASK-97 precedent rather than the task's original main-first assumption: main is a strict ancestor (0 behind, 131 ahead) and re-design edits src/mcp.rs (+175, TASK-96), which carries 4 of the 61 hunks, so a main-first reformat conflicts with itself at the merge. It still reaches main through that merge and stayed formatting-only.

Reformat: 4409d50 - one default cargo fmt pass, no rustfmt.toml added. 10 files, 61 hunks (speech/stt.rs 20, speech/models.rs 10, cron.rs 9, fsrs.rs 6, speech/tts.rs 5, speech/vad.rs 4, mcp.rs 4, main.rs 1, lib.rs 1, build.rs 1); speech/mod.rs, speech/error.rs already clean. 184 insertions / 150 deletions. Every line of the `git diff -w` remainder was read: all of it is rustfmt re-wrap or use-list re-flow (the one content-shaped change is `use fsrs::{MemoryState, DEFAULT_PARAMETERS, FSRS}` - same three items, rustfmt's ordering).

Neutrality evidence: cargo test before and after is byte-identical in the counts that matter - 45 passed / 0 failed / 0 ignored in the app_lib target plus two 0-test targets, exit 0 both times. cargo check clean (exit 0). Logs: /tmp/tauri-test-baseline.log and /tmp/tauri-test-after.log. No binary-hash claim made, per the TASK-97 finding.

Gate: .husky/pre-commit now loops over crates/jlpt-mcp and apps/desktop/src-tauri, one --manifest-path each (the crates are standalone), still ABOVE the ultracite marker. Exercised three ways: the reformat commit itself printed "Checking Rust formatting (apps/desktop/src-tauri)…" and passed; staging a deliberately split call in cron.rs made the commit fail with husky code 1 and no commit created (HEAD unchanged); the docs commit that followed printed nothing about Rust.

Blame ignore: 4409d50588d59a7d05d804a2dfe7913a74d7f59f appended in the existing comment style. Enabling stays a per-clone `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

Docs: crates/AGENTS.md Work Guidance no longer carves src-tauri out, src-tauri/AGENTS.md Verification gained the fmt and test commands (with the note that a green cargo test proves the stub contracts, not the sherpa paths), root AGENTS.md now lists both crates in the pre-commit sentence. crates/jlpt-mcp/AGENTS.md:37 was left unchanged on purpose: it only asserts its own crate is clean and gated, which is still true and says nothing about src-tauri.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Both Rust crates in the repo are now under one formatting contract.

- 4409d50 style(src-tauri): one default cargo fmt pass over the 10 drifted files (61 hunks, 184+/150-), formatting only, nothing else in the commit. No rustfmt.toml added.
- 60b8441 chore(tooling): .husky/pre-commit loops over crates/jlpt-mcp and apps/desktop/src-tauri, each checked only when a .rs file under it is staged, still above the ultracite marker. .git-blame-ignore-revs gains the reformat rev. Docs: crates/AGENTS.md drops the src-tauri carve-out, src-tauri/AGENTS.md owns the commands, root AGENTS.md describes the gate as covering both crates.
- Deviation from the task's original assumption, following the approved TASK-97 precedent: the reformat landed on re-design, not main, because re-design edits src/mcp.rs (4 of the 61 hunks) and a main-first reformat would conflict with itself at the merge.

Verification: cargo fmt --check exits 0 for src-tauri (and jlpt-mcp). Behaviour neutrality proven by counts, not assertion: cargo test is 45 passed / 0 failed / 0 ignored on both the pre- and post-reformat tree, cargo check exits 0. Every line of the git diff -w remainder was read and is rustfmt re-wrap or use-list re-flow. Gate exercised live in three ways: the reformat commit printed the src-tauri check and passed, staging a deliberately unformatted call in cron.rs failed the commit with husky code 1 and no commit created, and the following non-Rust commit printed nothing about Rust.
<!-- SECTION:FINAL_SUMMARY:END -->
