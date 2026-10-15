---
id: TASK-97
title: 'jlpt-mcp: gate cargo fmt (rustfmt-clean crate + staged-rs check)'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-21 15:59'
updated_date: '2026-09-21 19:16'
labels:
  - rust
  - tooling
dependencies: []
priority: low
type: chore
ordinal: 372000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

Found while shipping TASK-93. cargo fmt --check reports diffs across roughly fifteen files in crates/jlpt-mcp (build.rs, src/data.rs, tests/parity.rs and pre-existing parts of src/main.rs), and the style actually in the files is not rustfmt output (vertically broken method chains, use serde_json with Value before json). Nothing in the repo gates Rust formatting either: the hooks run ultracite on JS/TS and fallow on the graph. The result is that agents keep appending differently-formatted code. Documenting non-use was considered and rejected: rust-analyzer formats Rust on save by default, so an un-gated crate drifts file by file with nothing catching it, which is worse than either contract.

Scope: make the crate rustfmt-clean in one formatting-only commit, gate it on staged .rs files, and write the contract down.

references: crates/AGENTS.md, crates/jlpt-mcp/AGENTS.md, .husky/
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 crates/jlpt-mcp is rustfmt-clean: cargo fmt --check passes for the whole crate, and the reformat lives in its own commit that changes no behaviour
- [x] #2 The formatting gate runs cargo fmt --check only when .rs files are staged, so JS/TS commits keep their current pre-commit speed and no Rust change can land unformatted
- [x] #3 crates/AGENTS.md records that Rust is rustfmt-gated (so a future agent stops guessing), and the formatting-only rev is added to the blame-ignore mechanism if this repo has one
- [x] #4 cargo test --release still passes on the default and --features vaporetto paths after the reformat
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Rustfmt-gate decision from TASK-93. Steps: (1) land a formatting-only commit on main: cargo fmt over crates/jlpt-mcp, nothing else in it, verified behaviour-neutral by cargo test --release on both the default and --features vaporetto paths; (2) wire the gate where this repo already gates: a check that runs cargo fmt --check only when .rs files are staged, so ultracite-only JS/TS commits are untouched; (3) record the contract in crates/AGENTS.md and, if the repo has a blame-ignore file, add the reformat rev. The reformat must not ride along with feature work, and it should be coordinated with anything else currently editing the crate.

EXECUTION PLAN (2026-09-22, reviewed with @arif before implementation)

LANDING DECISION CHANGED: the reformat lands as its own formatting-only commit on re-design, not on main. main is a strict ancestor of re-design (0 behind, 128 ahead), and re-design already edits src/main.rs (+39, the TASK-93 debug gate) and tests/parity.rs (+128). Both files sit inside the 64-hunk reformat set, so a reformat committed on main guarantees conflicts in exactly those two when the branch merges. The commit still reaches main through the normal merge, and it stays mixed with nothing.

GATE SCOPE: only crates/jlpt-mcp is rustfmt-clean. apps/desktop/src-tauri has 61 hunks of its own, so the hook must fire only on staged .rs files under crates/jlpt-mcp, otherwise every desktop commit starts failing.

STEPS
1. Baseline cargo test --release on the default and vaporetto paths, before touching formatting.
2. cargo fmt over the crate (6 of 8 .rs files: engine.rs 15 hunks, main.rs 14, tests/parity.rs 13, deinflect.rs 10, data.rs 10, build.rs 2).
3. Re-run both test paths and compare against the baseline.
4. Commit formatting-only; no other file in it.
5. Create .git-blame-ignore-revs holding that rev (the repo had no blame-ignore mechanism, so this half of AC#3 becomes a new file rather than an edit). core.blame.ignoreRevsFile is the user's to set: the agent does not modify git config.
6. Append the cargo fmt --check gate to .husky/pre-commit OUTSIDE the ultracite marker block, so an ultracite re-init cannot erase it.
7. DOX: crates/AGENTS.md records the contract, crates/jlpt-mcp/AGENTS.md records the verification command, and the root AGENTS.md sentence that describes the pre-commit hook as ultracite-only gets the Rust gate added.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision (2026-09-21, @arif): gate cargo fmt rather than document non-use. Reason: rust-analyzer formats on save by default, so the un-gated path drifts file by file with nothing catching it, which is worse than either contract. Landing constraint from the same discussion: the reformat commit goes on main alone, not mixed into the re-design branch work, because it touches every Rust file in the crate.

## Implementation notes (2026-09-22)

Landing changed from the recorded constraint, with @arif's approval: the reformat is its own commit on re-design (3a6c873), not on main. main is a strict ancestor of re-design (0 behind, 128 ahead) and re-design already edits src/main.rs (+39, TASK-93 gate) and tests/parity.rs (+128), both inside the 64-hunk reformat set, so a reformat on main would have produced conflicts in exactly those two files. It still reaches main through the normal merge and stays formatting-only.

Reformat: one default cargo fmt run, no rustfmt.toml added. 6 of the 9 .rs files changed (build.rs 12, src/data.rs, src/deinflect.rs, src/engine.rs, src/main.rs, tests/parity.rs); src/tokenize.rs, src/types.rs and examples/gen-cache.rs were already clean. Every non-whitespace delta under 'git diff -w' is rustfmt's own re-wrap or use re-flow.

Behaviour proof, beyond the tests: builds are deterministic here (touching a source file and rebuilding reproduced the same hash), and the HEAD vs formatted binaries differ by 109 bytes out of 19 MB with IDENTICAL section sizes (text 19014224, data 43352, bss 3616). The byte runs are the 20-byte build-id plus single/paired bytes at a 24-byte stride inside .text, i.e. line/column immediates for panic locations. So a hash comparison cannot be a neutrality proof for this crate; the parity golden plus the identical test counts is the real evidence.

Gate design: appended ABOVE the ultracite marker block in .husky/pre-commit so an ultracite re-init does not erase it, and scoped with a pathspec to crates/jlpt-mcp. apps/desktop/src-tauri carries 61 of its own rustfmt hunks and is intentionally outside the gate; widening it there requires a formatting-only commit for that crate first (crates/AGENTS.md says so).

Gate tested both ways: staging an unformatted .rs under the crate made the commit fail with husky pre-commit code 1 and no commit was created; the docs commit that followed shows no "Checking Rust formatting" line, so a non-Rust commit pays nothing.

Blame ignore: the repo had no mechanism, so .git-blame-ignore-revs is new and lists 3a6c873. Enabling it is a git config change, which the agent does not make: each clone runs 'git config blame.ignoreRevsFile .git-blame-ignore-revs'.

Docs: crates/AGENTS.md Work Guidance carries the contract, crates/jlpt-mcp/AGENTS.md Verification carries the command, root AGENTS.md now describes the pre-commit hook as ultracite plus the scoped cargo fmt gate (and notes that fallow audit --base materializes ~200 MB tmpfs checkouts of this repo, which is what filled the 8 GB box).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
crates/jlpt-mcp is rustfmt-clean and stays that way.

- 3a6c873 style(jlpt-mcp): one default cargo fmt pass over the 6 drifted files (64 hunks), formatting only, nothing else in the commit.
- aa93a25 chore(tooling): .husky/pre-commit runs cargo fmt --check for crates/jlpt-mcp, but only when a .rs file under that crate is staged; the block sits above the ultracite marker so a re-init cannot delete it. apps/desktop/src-tauri (61 hunks of its own) is deliberately outside the gate.
- Docs: crates/AGENTS.md owns the contract, crates/jlpt-mcp/AGENTS.md owns the verification command, root AGENTS.md now lists the Rust gate next to ultracite. New .git-blame-ignore-revs holds the reformat rev; enabling it is a per-clone git config the user runs.
- Deviation approved during execution: the reformat landed on re-design rather than main, because re-design already edits two of the six reformatted files and a main-first reformat would conflict with itself.

Verification: cargo fmt --check clean for the crate. cargo test --release matches the pre-reformat baseline exactly on both feature paths (22 unit + 6 parity default, 23 unit + 6 parity vaporetto). Neutrality backed by a byte-level check: HEAD and formatted binaries are identical in every section size and differ in 109 bytes of 19 MB (build-id plus panic-location immediates). Gate proven in both directions: an unformatted staged .rs made the commit fail with husky code 1, and the following non-Rust commit never invoked cargo at all.
<!-- SECTION:FINAL_SUMMARY:END -->
