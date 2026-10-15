---
id: TASK-95
title: 'jlpt-mcp: let the advertised server version come from Cargo.toml'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-21 15:58'
updated_date: '2026-09-21 16:10'
labels:
  - mcp
  - rust
dependencies: []
priority: low
type: chore
ordinal: 776000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

Found while shipping TASK-93. The server version is written twice: `crates/jlpt-mcp/Cargo.toml` and the `#[tool_handler(name = "jlpt-vocab", version = "0.5.0")]` literal in `src/main.rs`. rmcp's macro interpolates CARGO_PKG_VERSION only when the `version` argument is omitted, so the pair drifts silently and the sidecar can answer `initialize` with a stale version. TASK-93 bumped both by hand, which fixes today but not the next bump. A wrong advertised version is the kind of detail that wastes a support session on a bundled desktop sidecar, where the user cannot inspect the binary.

Scope: make one source of truth (drop the literal, or assert equality in a test). Nothing else in the crate changes.

references: crates/jlpt-mcp/src/main.rs (tool_handler), rmcp-macros-3.1.1/src/tool_handler.rs::build_get_info
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The serverInfo version reported by initialize is derived from Cargo.toml (or a test fails on any mismatch), so a version bump cannot leave one copy stale
- [x] #2 cargo test --release passes on the default and --features vaporetto paths, and the tools/list parity assertions are untouched
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Drop the version = "0.5.0" argument from #[tool_handler] in crates/jlpt-mcp/src/main.rs: rmcp-macros build_get_info takes the (Some(name), None) arm and emits Implementation::new(name, env!("CARGO_PKG_VERSION")), so Cargo.toml becomes the only copy. 2. Prove it on the wire instead of trusting the macro: in tests/parity.rs read serverInfo.version from the initialize response and assert it equals the package version, so a future bump cannot reintroduce a stale literal unnoticed. 3. Verify: cargo test --release on the default and --features vaporetto paths, plus a live stdio initialize smoke. 4. DOX: fix the crates/jlpt-mcp/AGENTS.md sentence that describes the version literal as something to keep in sync.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Mutation check: bumped Cargo.toml to 0.5.1, cargo test --release --test parity initialize_advertises_the_package_version stayed green, which is only possible if the sidecar reads its version from the package manifest; reverted to 0.5.0 and re-ran both feature paths plus a live initialize smoke (serverInfo name jlpt-vocab, version 0.5.0).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed the version = "0.5.0" argument from #[tool_handler] in crates/jlpt-mcp/src/main.rs so the advertised serverInfo version comes from CARGO_PKG_VERSION, making Cargo.toml the only copy. Added tests/parity.rs::initialize_advertises_the_package_version asserting serverInfo.version equals env!("CARGO_PKG_VERSION") and name equals jlpt-vocab. Verified by a temporary 0.5.1 manifest bump (test still green, proving derivation) then a revert, and by cargo test --release on both paths: 22 unit + 6 parity default, 23 unit + 6 parity with --features vaporetto. tools/list behaviour untouched. crates/jlpt-mcp/AGENTS.md now states the single-source rule and forbids re-adding a literal.
<!-- SECTION:FINAL_SUMMARY:END -->
