---
id: TASK-123
title: >-
  Items: the item engine (QuestionItem, difficulty and selection, anchoring
  validator, grading contract)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:06'
updated_date: '2026-09-24 18:37'
labels: []
dependencies:
  - TASK-122
references:
  - 'crates/jlpt-mcp/src/main.rs:128'
  - 'crates/jlpt-mcp/src/main.rs:272'
  - 'packages/item-engine/src/validation.ts:189'
documentation:
  - >-
    backlog/docs/feature/doc-16 -
    JLPT-item-engine-shared-question-items-difficulty-grading-and-storage.md
  - >-
    backlog/docs/feature/doc-15 -
    Chat-learning-loop-casual-chat-drill-sets-exam-handoff.md
priority: high
type: feature
ordinal: 865000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
This is the shared engine `doc-16` §1 names: one item shape, one validator and one grading contract behind drill sets, generated papers and the post-paper review. `doc-16` §6 is the part that cannot be skipped, because item generation is where a plausible-looking question with two correct answers comes from. Anchoring is corpus-checked: every item carries `anchors` resolved against the real corpus, and the validator vetoes `ambiguous`, wrong-level, duplicate-option, non-corpus-distractor, stem-leak and missing-listening-script cases by name. New MCP tools must not collide with the 16 existing public tools or break the crate golden-parity test (`crates/AGENTS.md`); `drill_candidates` (drill sets) is distinct from `exam_candidates`/`exam_blueprint` (papers, `doc-14` §10), is public rather than a debug tool (`crates/jlpt-mcp/src/main.rs:128`), and is registered at `crates/jlpt-mcp/src/main.rs:272`. `doc-16` §7 splits grading so the code grades and the agent explains: the key never enters the transcript, and a grade mapping shared by three surfaces lives in one pure function tested once. Selection follows `doc-16` §5: a 40/40/20 mix with a per-type cap, so cheap kana-cell items cannot dominate an expensive reading item.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One test per rejection reason: an item with zero anchors, a missing anchor, a wrong-level anchor, a duplicate option, a non-corpus distractor, a stem leak or a missing listening script is rejected.
- [x] #2 Ambiguity: the two-option fixture is rejected, and a wrong-form-sibling distractor is accepted only for the intended item.
- [x] #3 The 40/40/20 mix holds over a 20-item run, a due card outranks a new item of the same level, and a fixed seed is deterministic.
- [x] #4 A grammar item has no `fsrs_vocab_id` and writes no grade; a word item writes exactly one revlog row per attempt; a double submit writes none.
- [x] #5 `drill_candidates` (or its equivalent) is added without colliding with the existing tools, stays out of `DEBUG_TOOLS`, and the crate's golden-parity test passes.
- [x] #6 The grade mapping exists once, as a pure function, and is tested once rather than per consumer.
- [x] #7 Any new MCP tool ships with `cargo test` in `crates/jlpt-mcp` green.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add pure @manobu/item-engine package with canonical QuestionItem/item-type contracts. 2. Implement named-reason validation with injected corpus/option evidence, including ambiguity and listening/script checks. 3. Implement deterministic 40/40/20 selection with due precedence, caller-supplied per-type cap and explicit shortfall. 4. Implement the single attempt-to-FSRS grade mapper using caller-classified response quality, with no invented timing thresholds. 5. Make packages/db consume canonical types and expose whether answerDrillItem recorded or replayed the first pick. 6. Add one transactional server item-grading path so attempt, card transition and revlog commit once; test grammar/no grade, word/one revlog and double-submit/no extra write. 7. Add public key-free drill_candidates to crates/jlpt-mcp with deterministic corpus output and catalog/parity tests. 8. Update DOX and run TS/Rust tests, lint, typecheck, Fallow and build gates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification: item-engine 14 tests; DB 28 tests; server 115 pass + 1 skip including concurrent/paused replay, level-local cards and transactional rollback; Ultracite 460 clean; root typecheck 14/14; DB/server builds pass; cargo default 22+7 and vaporetto 23+7 pass; Fallow audit passes with 0 introduced issues. Live MCP smoke passed opencode before the aggregate timeout, isolated kilo (543.7s), and updated-release antigravity; Kilo's jlpt-mcp child spawned.

Review hardening: BEGIN IMMEDIATE plus per-handle serialization makes concurrent/paused retries no-ops; card identity is (level,vocab_id); validator enforces answer provenance and FSRS item type; Rust selector serializes only the capped candidates and pins seeded anchors/no-key output.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added @manobu/item-engine with named validation, deterministic 40/40/20 selection and one grade mapper; wired DB/server exactly-once item grading; added public deterministic key-free drill_candidates (17 tools, v0.6.0). Verified across 14 engine tests, 28 DB tests, 115 server passes, both Rust feature matrices, production builds, live MCP smokes, root lint/typecheck and Fallow.
<!-- SECTION:FINAL_SUMMARY:END -->
