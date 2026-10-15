---
id: TASK-54
title: >-
  Deinflection coverage gaps — verb 〜なかった, potentials 行ける/できる, chained rules +
  early-return bug (TS + Rust parity)
status: Done
assignee: []
created_date: '2026-09-09 20:37'
updated_date: '2026-09-09 21:24'
labels:
  - bug
  - frontend
  - tokenizer
  - p1
dependencies: []
priority: high
ordinal: 538000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found 2026-09-10 while verifying TASK-41's grading fixes — a conjugation coverage sweep of the 10ten-inspired deinflection feature (TASK-23.27/23.29, Done) showed 23/30 forms pass, 7 miss across 5 verbs × 6 inflections: ALL verb past-negatives (食べなかった, 行かなかった, 見なかった, しなかった, 来なかった) and both irregular potentials (行ける, できる). Root causes in BOTH implementations (TS apps/desktop/src/lib/deinflect.ts + Rust crates/jlpt-mcp/src/deinflect.rs, symmetric code): (1) the 〜なかった rule handles only ADJECTIVES (ku-stem → 〜い, AdjectivePastNegative) and EARLY-RETURNS without pushing any verb candidates — so verb past-negatives produce empty candidate lists; (2) potential 行ける/できる: 行ける should hit GODAN_E_ROW (け→く) but the ichidan drop-る branch claims ける first, produces 行け which fails corpus POS validation, and the candidate dies; できる (する's irregular potential) has no special case; (3) no chained/transitive deinflection — 行かなかった needs two stacked rules (なかった→ない→行か→行く). Impact: a learner typing a CORRECT past-negative gets graded Again(1) on listen-type and search_vocab misses — a correctness gap in exactly the feature built to prevent that. Proof probes (bun -e, 2026-09-10): deinflect('行かなかった') → [], deinflect('行ける') → [], deinflect('食べなかった') → []; passing: 食べました→PolitePast, 見ない→Negative, 飲んで→Te, 食べた→Past. Note: conjugate.ts verifyDetailed has its own 23.29 layer which may mask some of these on the conjugate surface — the sweep above used matchTarget directly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Verb past-negative 〜なかった deinflects: 食べなかった→食べる, 行かなかった→行く, 見なかった→見る, しなかった→する (both matchTarget and deinflect() return the dictionary form with a PastNegative-style reason); the adjective なかった branch stops early-returning without candidates when the stem is a verb negative stem (行かな → also push 行く path)
- [x] #2 Potential forms deinflect: 行ける→行く (godan e-row must win over the ichidan drop-る branch for e-row stems), できる→する (irregular potential special case), 食べられる→食べる stays passing; corpus POS validation must not reject valid potentials (test asserts non-empty candidates for 行ける/できる)
- [x] #3 Chained deinflection or explicitly documented single-step scope: either the rule engine iterates candidates transitively (行かなかった → 行かな → 行か → 行く with accumulated reason PastNegative) or the supported-depth limit is documented in code + tests assert exactly which forms are out of scope
- [x] #4 TS/Rust parity: every new rule added to apps/desktop/src/lib/deinflect.ts gets the identical rule in crates/jlpt-mcp/src/deinflect.rs and vice versa — the shared 30-form conjugation sweep (5 verbs × 6 inflections incl. the 7 current misses) passes identically against both implementations; the sweep is checked into the repo as a test (both sides) so parity cannot drift
- [x] #5 Regression gates: the 30-form sweep + existing deinflect tests + conjugate verifyDetailed tests pass; grading a correct past-negative in listen-type no longer grades Again(1) — verified by a matchTarget unit test (食べなかった vs 食べる → deinflected, not wrong)
- [x] #6 bun run test + check-types + ultracite clean (apps/desktop); cargo test green (crates/jlpt-mcp)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 7c89230): AC1 — verb 〜なかった rule added (pushPastNegativeVerbCandidates): godan a-row (行か → 行く), irregular (し → する, こ → くる), ichidan (食べ → 食べる), reason PastNegative; adjective ku-stem branch unchanged. All 5 verb past-negatives now deinflect. AC2 — bare-godan-potential rule (行ける → 行く, 買える → 買う, 泳げる → 泳ぐ) pushes BOTH ichidan-dictionary and godan-u candidates (ambiguous without corpus; matchTarget identity-skip + engine corpus validation disambiguate); できる → する special case; 食べられる stays passing. The 行ける root cause: NO family claimed bare e-row+る (godan_e_potential existed only Rust-side, engine-gated) — TS never emitted the candidate at all. AC3 — single-step scope kept and documented (rule-table comment + sweep defines the boundary; 食べさせられた-class double inflections remain out of scope). AC4 — parity enforced by CONJUGATION_SWEEP (TS export) + conjugation_sweep_30_forms (Rust test), same 5×6 table; porting exposed a pre-existing Rust gap — the 〜て/〜た families omitted irregular candidates (して → する missing) — fixed, sweep green both sides (30/30). AC5 — matchTarget + conjugate verifyDetailed skip identity candidates (bare-potential pushes the input's own dict form; without the skip, 食べる answered to a te-form prompt graded 'deinflected' instead of wrong — existing test caught it during development). 食べなかった vs 食べる unit-asserted deinflected. AC6 — desktop 232/0, repo check-types 12/12 + test 9/9, ultracite clean (complexity refactors: two extracted helpers under the 20-budget), cargo test 21+3 green both feature configs. DOX: apps/desktop AGENTS listen-type bullet + crates/jlpt-mcp AGENTS tokenizer section record the parity contract (change one side, change both).
<!-- SECTION:NOTES:END -->
