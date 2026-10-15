---
id: TASK-26
title: TASK-27 - audit remaining subtrees under canonical-per-subtree rule
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-07 16:26'
updated_date: '2026-09-07 16:56'
labels: []
dependencies: []
ordinal: 580000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The canonical-per-subtree rule (root AGENTS.md, commit 65b5737) was piloted on apps/desktop/. The remaining subtrees (apps/server/, crates/, packages/*) need the same audit: identify the canonical doc per subtree, decide whether each AGENTS.md file is canonical / sub-canonical / thin pointer, and trim duplicates.

Per-subtree audit (one commit each, or grouped by subtree):

  1. apps/server/ (101 lines) — single AGENTS.md at apps/server/AGENTS.md. Check whether the lib/ AGENTS.md files for routes (Hono routes) duplicate content. Likely canonical-only; confirm no duplication across the 5 route files (cards.ts, chat-history.ts, jap-data.ts, learn-chat.ts, plus index.ts).

  2. crates/ (29 lines) + crates/jlpt-mcp/AGENTS.md (39 lines) — small but the jlpt-mcp AGENTS.md is the canonical for that subtree; crates/AGENTS.md should be a thin pointer (or kept as a parent index for the Rust workspace). Audit overlap.

  3. packages/acp/AGENTS.md (96 lines) — currently the only AGENTS.md for the package; check whether it has any sub-canonical duplication risk (sub-canonical for conversation-guard.ts / mcp.ts / registry.ts?).

  4. packages/agent/AGENTS.md (42 lines) — small; verify no sub-canonical needed.

  5. packages/chat-session/AGENTS.md (59 lines) — check for sub-canonical (provider.tsx + message-transcript.tsx are large).

  6. packages/config/AGENTS.md (31 lines) — probably canonical-only, just confirm.

  7. packages/db/AGENTS.md (45 lines) — same.

  8. packages/env/AGENTS.md (33 lines) — same.

  9. packages/japanese/AGENTS.md (45 lines) — same.

  10. packages/skills/AGENTS.md (30 lines) — same.

  11. packages/speech/AGENTS.md (38 lines) — note the .turbo/ inside packages/speech (TASK-21).

  12. packages/srs/AGENTS.md (35 lines) — same.

  13. packages/ui/AGENTS.md (38 lines) — same.

For each subtree the deliverable is:
  - one commit that applies the canonical/sub-canonical/thin-pointer classification
  - if duplicates exist, one commit that trims them with a pointer to the canonical
  - if the subtree is already canonical-only, a one-line note in the commit body confirming no trim needed

Pilot: apps/desktop/ reduced from 74 + 77 + 70 = 221 lines to 56 + 77 + 76 = 209 lines (with the 77 being a stable sub-canonical and 76 a stable canonical; the 56-pointer is the win). Not a huge line-count delta but the duplication risk is gone: future lib/ changes can no longer leave the table stale in two places.

This task can be split into per-subtree subtasks if desired; pick a per-commit-per-subtree cadence to keep diffs reviewable.

Out of scope: the .agents/skills/*/AGENTS.md files (tool-specific skill docs, not project DOX) and the root AGENTS.md / apps/AGENTS.md / packages/AGENTS.md (top-level role-based docs, not subtrees).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each remaining subtree (apps/server, crates, packages/*) audited under the canonical-per-subtree rule from root AGENTS.md
- [x] #2 Per-subtree classification: canonical / sub-canonical / thin pointer recorded in the task notes
- [x] #3 Duplicate content trimmed where it existed; commits show the line-count delta
- [x] #4 No new AGENTS.md files created; existing canonical docs unchanged unless duplicates were present
- [x] #5 bun x ultracite check + check-types still clean after the audit
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read every remaining AGENTS.md (13 files) and classify each as canonical / sub-canonical / thin pointer. Record the per-subtree classification in task notes (AC2).

2. For each subtree that has >1 AGENTS.md, audit for duplicate content (the failure mode the canonical-per-subtree rule prevents):
   - apps/server/ — 1 file (canonical). No audit needed.
   - crates/ — 2 files (crates/AGENTS.md + crates/jlpt-mcp/AGENTS.md). The jlpt-mcp file is the canonical for that subtree; crates/AGENTS.md is the parent workspace index pointing at jlpt-mcp. They DO have minor overlap (the 'JLPT stdio MCP server' framing, the 'data embedded gzipped' line, the 'sync to src-tauri/binaries' note, and the 'Protocol hygiene' note). Per the rule: 'crashes' is the canonical (sub-canonical one level deeper is allowed only when the sub-subtree has its own scope that does not fit cleanly in the parent). The jlpt-mcp sub-canonical has its own full Local Contracts (engine, parity test, tokenizer, build/wiring) + its own Work Guidance (golden regeneration, data shape, vaporetto pin) + its own Verification — these are sub-subtree specific and don't fit cleanly in the parent 29-line crates/AGENTS.md. Therefore:
     - crates/AGENTS.md: keep as the parent index (canonical for crates/, sub-tree root)
     - crates/jlpt-mcp/AGENTS.md: keep as sub-canonical (allowed escape hatch)
     - Trim the overlap: the jlpt-mcp Purpose one-liner can drop the 'Bundled as a Tauri sidecar' + 'Tauri lib.rs' duplication; keep its own specific contract details. Or: just drop a few redundant phrases from the jlpt-mcp file that are also in the parent.
   - packages/* — 12 files. Each is the canonical for that subtree (one AGENTS.md per package). No nested AGENTS.md inside any package. No audit needed beyond confirming each is the canonical.

3. For files that have stale 'data' content (e.g. mentions of 'TASK-22' that has since closed, references to 'v1' that became 'v2', etc), update them as part of the same commit — but only as a same-line edit, not a rewrite. (E.g. 'v1 ships an empty registry' is current for v1; the comment 'original port: TASK-1.3' is fine; the 'V3 LanguageModel' in packages/acp matches the current state.)

4. Final commit per subtree (or one grouped commit if a subtree has no trim). Pattern from the pilot:
   - If no trim needed: one commit that records the audit result (e.g. 'docs(audit): TASK-26 confirm packages/env canonical-only (no trim)')
   - If trim needed: one commit that applies the trim (e.g. 'docs(crates): trim duplicate data-shape + sync notes from crates/jlpt-mcp/AGENTS.md')

5. Group commits under a single task branch (or just sequential commits on main) — for a pure-doc audit, sequential main commits are fine.

6. After every commit: bun x ultracite check + check-types + tests stay green (markdown is not type-checked, but the JSON config in package.json may need an updated tab/order check).

7. Final summary + AC check + Done.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Per-subtree classification (AC2 — recorded before edits):

  1. apps/server/AGENTS.md
     - Role: CANONICAL (only AGENTS.md in subtree).
     - 101 lines, no nested AGENTS.md under apps/server/src/.
     - Verdict: NO TRIM. Single canonical doc, full Hono contract + Work Guidance + Verification + Child DOX Index ('None' already, points to packages/acp/AGENTS.md + src-tauri/AGENTS.md for cross-subtree contracts).

  2. crates/AGENTS.md
     - Role: CANONICAL (subtree root). Note: no workspace Cargo.toml yet — this is a 'workspace-ready' parent index.
     - 29 lines, 1 child in Child DOX Index (crates/jlpt-mcp/AGENTS.md).
     - Overlap with jlpt-mcp file: 'Rust port of the former TS engine' / '104 MB → ~5 MB' / 'data gzipped' / 'sidecar sync'. ACCEPTABLE for a parent index (the parent summarizes; the child expands). Per the rule, parent is the canonical for the crate workspace; jlpt-mcp is sub-canonical (its full Local Contracts + Work Guidance don't fit in the 29-line parent).
     - Verdict: NO TRIM on parent. Trim the jlpt-mcp file to remove the redundant parent-level framing.

  3. crates/jlpt-mcp/AGENTS.md
     - Role: SUB-CANONICAL (sub-subtree with its own scope per the canonical-per-subtree rule escape hatch).
     - 40 lines, full Local Contracts (engine + parity + tokenizer + build) + Work Guidance (golden regen + data shape + vaporetto pin) + Verification.
     - Overlap with crates/AGENTS.md: 'bundled as a Tauri sidecar' / 'data embedded gzipped from packages/japanese/data' / 'cargo build --release → target/release/jlpt-mcp' / 'synced by apps/desktop/scripts/sidecar-dev.sh' / 'Protocol hygiene: stdout = JSON-RPC'.
     - Verdict: TRIM the duplicated lines that are also in the parent index. Keep the jlpt-mcp-specific content (engine, tokenizer, vaporetto pin, parity golden).

  4. packages/acp/AGENTS.md
     - Role: CANONICAL (only AGENTS.md in subtree).
     - 96 lines. Sub-canonical escape hatch for conversation-guard.ts / mcp.ts? The files are large (5+ files in src/), but their contracts are summarized in the Child DOX Index line at the end ('key modules: ...'). A per-module sub-canonical doc would multiply the audit surface without clear gain — the contracts are already captured in code comments + the index.
     - Verdict: NO TRIM. The single canonical doc with the 'key modules' summary is the right shape for this subtree.

  5. packages/agent/AGENTS.md
     - Role: CANONICAL.
     - 43 lines. Child DOX Index lists src/subagents/index.ts.
     - Verdict: NO TRIM. Small enough to be the canonical.

  6. packages/chat-session/AGENTS.md
     - Role: CANONICAL.
     - 59 lines. Multiple subpath exports (./provider, ./message-transcript, ./fetcher, ./persistence, ./types). Could a sub-canonical doc for provider.tsx + message-transcript.tsx help? No — the contracts are exported surfaces listed under Local Contracts + Work Guidance. The single canonical already does the job.
     - Verdict: NO TRIM.

  7. packages/config/AGENTS.md
     - Role: CANONICAL.
     - 31 lines, zero-dep leaf.
     - Verdict: NO TRIM.

  8. packages/db/AGENTS.md
     - Role: CANONICAL.
     - 45 lines. The sqlite-vaporetto section is the one place the contracts live; FTS5 perf test reference is correct.
     - Verdict: NO TRIM.

  9. packages/env/AGENTS.md
     - Role: CANONICAL.
     - 33 lines.
     - Verdict: NO TRIM.

  10. packages/japanese/AGENTS.md
     - Role: CANONICAL.
     - 45 lines, updated in TASK-23.2.2 to reflect kana.json consumer list.
     - Verdict: NO TRIM (already fresh).

  11. packages/skills/AGENTS.md
     - Role: CANONICAL.
     - 31 lines.
     - Verdict: NO TRIM.

  12. packages/speech/AGENTS.md
     - Role: CANONICAL.
     - 47 lines. The 'screaming architecture' is the only AGENTS.md; .turbo/ is a Turbo cache dir, not a subtree.
     - Verdict: NO TRIM.

  13. packages/srs/AGENTS.md
     - Role: CANONICAL.
     - 36 lines.
     - Verdict: NO TRIM.

  14. packages/ui/AGENTS.md
     - Role: CANONICAL.
     - 38 lines. Child DOX Index lists components/ds/ (the DS-constrained wrappers).
     - Verdict: NO TRIM.

Net audit: 1 trim (crates/jlpt-mcp/AGENTS.md removes ~5 duplicated lines from the parent-index summary) + 13 audit-confirmation notes (no trim needed). All committed under task TASK-26.

Validation passed: bun x ultracite check (238 files) clean; bun run check-types (apps/desktop) clean; bun run test (apps/desktop) 183 pass / 2 skip / 0 fail (unchanged from TASK-23.2.2 baseline — no code touched in this audit). Cargo not re-run (no Rust code changed).

Commit: 308e3c7 docs(crates): trim duplicated parent-index content from jlpt-mcp/AGENTS.md. Pushed to origin/main (127299e..308e3c7).

AC verification (objective):
  AC1 (each remaining subtree audited): 14 files read + classified; the per-subtree classification table in the previous notes section enumerates each. apps/server/, packages/{acp,agent,chat-session,config,db,env,japanese,skills,speech,srs,ui} all confirmed canonical-only; crates/ (parent index) + crates/jlpt-mcp/ (sub-canonical) form the one parent/sub-canonical pair under the rule's escape hatch.
  AC2 (per-subtree classification recorded in task notes): done in the previous notes section.
  AC3 (duplicate content trimmed where it existed; commits show line-count delta): crates/jlpt-mcp/AGENTS.md -5 / +4 in commit 308e3c7 (parent holds workspace framing; sub-canonical holds sub-subtree-specific content).
  AC4 (no new AGENTS.md files created; existing canonical docs unchanged): verified. Only file changed was crates/jlpt-mcp/AGENTS.md (sub-canonical, had duplicates). The 13 other files were confirmed canonical-only with no trim needed.
  AC5 (bun x ultracite check + check-types still clean): both clean after the audit. 183 tests pass (unchanged).

Out of scope: the .agents/skills/*/AGENTS.md (tool-specific skill docs, not project DOX per the task description) and the root AGENTS.md + apps/AGENTS.md + packages/AGENTS.md (top-level role-based docs, not subtrees).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Audited all 13 remaining subtrees under the canonical-per-subtree rule. 12 are canonical-only (single AGENTS.md per subtree, no nested docs); crates/ + crates/jlpt-mcp/ form the one parent + sub-canonical pair (escape hatch under the rule). One trim: crates/jlpt-mcp/AGENTS.md dropped 5 duplicated parent-index lines (-5 / +4 in commit 308e3c7). Per-subtree classification recorded in task notes. 183 tests pass, ultracite + check-types clean.
<!-- SECTION:FINAL_SUMMARY:END -->
