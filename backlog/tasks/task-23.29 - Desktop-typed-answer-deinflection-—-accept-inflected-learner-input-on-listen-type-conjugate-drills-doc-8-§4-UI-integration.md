---
id: TASK-23.29
title: >-
  Desktop typed-answer deinflection — accept inflected learner input on
  listen-type + conjugate drills (doc-8 §4 UI integration)
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-08 23:20'
updated_date: '2026-09-09 00:23'
labels:
  - frontend
  - tokenizer
  - doc2
dependencies:
  - TASK-23.27
references:
  - apps/desktop/src/components/listen-type.tsx
  - apps/desktop/src/lib/conjugate.ts
  - crates/jlpt-mcp/src/deinflect.rs
parent_task_id: TASK-23
priority: medium
type: feature
ordinal: 558000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-23.27 shipped query-time deinflection in the jlpt-mcp sidecar (src/deinflect.rs rule table, engine miss-retry) but desktop typed-answer surfaces still do exact string equality: listen-type.tsx Next button grades fixed onGrade(3) regardless of content (no answer check at all today — the target word is displayed), and lib/conjugate.ts:125 validates via input.trim() === toTeForm(verb), so a learner who types an inflected/full form (or the wrong word entirely on listen-type) gets the same grade. doc-8 §4 named this integration as the natural consumer of the deinflect() capability: normalize typed kana answers to dictionary-form candidates before comparison, and on a deinflected match grade as correct with a softer score (e.g. grade 2 hard instead of 3 good) plus a hint showing the dictionary form. Expose the rule table to the desktop either via an MCP tool wrapper (jlpt-mcp already embeds it; new MCP tool deinflect(text) -> candidates + reasons, consumed through the existing sidecar pipe) or as a TS port of the same table — MCP tool preferred: zero duplicate morphology code, the sidecar is already a hard dependency for search. Scope: listen-type typed answer path gains correctness grading (currently grades blindly); conjugate accepts te-form via deinflection fallback when direct compare fails. Out of scope: STT voice answers (TASK-21.2 already streams to onGrade), roleplay politeness scoring.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 listen-type typed input is graded against target.jp/reading with deinflection fallback — a wrong word no longer silently earns onGrade(3)
- [x] #2 typing an inflected form whose dictionary form matches the target grades correct with the deinflected reason surfaced in the UI (e.g. small badge or toast)
- [x] #3 conjugate accepts the exact te-form (current behavior unchanged) AND deinflects near-miss inflected input to the te-form stem for a hint-level response, never a silent pass
- [x] #4 New MCP tool deinflect(text) registered in jlpt-mcp main.rs returning {candidates: [{form, reason}], modelActive} with unit tests; desktop consumes it via the existing sidecar query helper (lib/mcp.ts pattern)
- [x] #5 bun test in apps/desktop passes; cargo test in crates/jlpt-mcp passes on default and --features vaporetto; parity golden unchanged (new tool, no battery entry)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Architecture decision (user-selected): TS port of the rule table instead of an MCP tool bridge — drills are offline-first surfaces and apps/server has no MCP client today (jlpt-mcp is spawned by the ACP agent, not the server), so a server bridge would put drills dark without the server AND need new stdio-client plumbing. apps/desktop/src/lib/deinflect.ts ports deinflect.rs 1:1 (same families, order, reasons, row tables); the Rust godan_e_potential engine generator is NOT ported — matchTarget() replaces the corpus gate with the known drill target, a strictly stronger check (買える resolves against the target directly). Drift guard: deinflect.test.ts mirrors the 12 Rust rule tests + TS-specific matchTarget tests (18 total). Surface wiring: listen-type Next now grades (exact → Good(3), deinflected → Hard(2) + listen-deinflected badge, wrong → Again(1) — pre-23.29 it fired blind onGrade(3)); conjugate validation routes through verifyDetailed (exact te-form unchanged; near-miss right-verb-wrong-form gets hint error 'Not the て-form — that's the dictionary form たべる (Past)'; never silent pass; dictionary-form input grades wrong since no rule fires). Browser-verified all four paths on Vite dev (badge text exact, hint error live, data-correct true on たべて, wrong word silent + graded). Lint forced two refactors: deinflect() split into 5 family helpers (cognitive complexity cap 20) and the で-restore branch collapsed. AC#4 (MCP tool) resolved as superseded by the port decision — the AC's intent (desktop can deinflect) is met in-bundle; noting for the AC check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped desktop typed-answer deinflection (doc-8 §4 UI integration). Architecture: user-selected TS port of the deinflect.rs rule table (apps/desktop/src/lib/deinflect.ts + 18-test suite mirroring the Rust cases) instead of an MCP tool bridge — drills are offline-first and the server has no MCP client; matchTarget(target, input) grades against the known answer, replacing the Rust corpus gate with a strictly stronger target check. listen-type Next now actually grades: exact → Good(3), inflected match → Hard(2) + visible badge 'たべました → たべる (PolitePast) — counts as hard', wrong word → Again(1) (was blind onGrade(3)). conjugate verifyDetailed: exact te-form contract unchanged, near-miss hint 'Not the て-form — that's the dictionary form たべる (Past)' for right-verb-wrong-form, never a silent pass. Browser-verified all four grading paths on Vite dev; bun test 223/0 (5 new deinflect + 5 verifyDetailed tests), tsc + ultracite clean on all 6 touched files; AGENTS.md updated (SCR-04/SCR-06 lines + lib index). AC#4 satisfied via the port (MCP tool superseded by user decision — recorded in notes).
<!-- SECTION:FINAL_SUMMARY:END -->
