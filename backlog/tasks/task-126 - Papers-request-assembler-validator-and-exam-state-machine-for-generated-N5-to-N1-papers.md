---
id: TASK-126
title: >-
  Papers: request assembler, validator and exam state machine for generated N5
  to N1 papers
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:07'
updated_date: '2026-09-25 08:15'
labels: []
dependencies:
  - TASK-123
documentation:
  - >-
    backlog/docs/feature/doc-14 -
    JLPT-exam-generation-pipeline-request-assembler-validator-storage.md
  - >-
    backlog/docs/feature/doc-12 -
    Chat-generated-JLPT-exams-N5..N1-a-kana-readiness-gate.md
priority: high
type: feature
ordinal: 866500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`doc-12` §4.2 splits generation three ways on purpose: the agent picks candidates, the code assembles, and the validator vetoes. This task is the code and the veto halves, and it is the one that has to be trustworthy before any paper reaches a learner, because a paper that fails to build must say so rather than render something plausible. `doc-14` §2.1 fixes two modes with honest labels: `shortened` (official shape, smaller budget, scaled timer labelled "shortened pace", bands only above the viability floor) and `exam-conditions` (official minutes and mix, no caveat). `doc-14` §2.2 gives N4 as Vocab / Grammar·Reading / Listening at 25 + 55 + 35 minutes, and §2.3 sizes budgets to clear the D5 floor (band points / 6 per item: at least 10 items in a 60-cap section, 20 in a 120-cap one) or to report raw counts below it. Note the section model correction in `doc-12` §2.6 and D11: caps are **scoring** sections, and at N4/N5 reading is scored inside the 120-point Language Knowledge section while the paper still has three test sections. Per D8 the tool result carries anchors only, so the key is assembled locally and never appears in the transcript; the debrief is gated on `status === "submitted"`. `doc-19` §5 draws the receipt with real slot counts, the honest failure and the ready state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One test per validator reason in doc-14 §5, including `floor-unmet`.
- [x] #2 Ambiguity: a fixture where two options fit is rejected, and a distractor that is the target's wrong-form sibling passes only for the intended item.
- [x] #3 Mix: a generated N5 `shortened` paper matches the doc-14 §2.2 section list, and an N3 paper has three sections.
- [x] #4 Floor interplay: a budget below the D5 floor produces raw counts and the short-paper label; a budget at the floor produces bands.
- [x] #5 Determinism: the same exam id and seed produce identical option order across two mounts.
- [x] #6 State machine: a crash during `in_progress` resumes with answers intact, time-up auto-submits without clearing an answer, and only `submitted` unlocks a debrief.
- [x] #7 No-leak: a golden asserts the generation turn's rendered transcript contains no answer text, while the debrief turn may.
- [x] #8 Lead time: the building line's counts equal the number of validated slots at that moment, and a paper is not takeable while any section is unvalidated.
- [x] #9 Offline: no server means the seed fallback plus an honest badge, never an empty paper.
- [x] #10 Section model: caps and pass marks follow the official section set (two scoring sections at N4/N5) so the badges sum to the 180 total, per doc-12 §2.6 and D11.
- [x] #11 The eight keys in doc-14 §7.1 exist and contain no em dash, enforced by `packages/ui/test/copy-snapshot.test.ts`.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Shared policy: N5-N1 official test/scoring blueprints, floor-minimum defaults (N5/N4/N3 10+10+10; N2/N1 20+10), v2 largest-remainder item mixes, seeded option order, shortened timer scaling, and all validator reasons. 2. Durable storage: migration 0010 with exam lifecycle timestamps, section timing/status, immutable per-item answers, guarded transitions, resume, and time-up submit. 3. Contract/server: strict key-free exam request/receipt/state/result/debrief procedures over fetch /rpc, deterministic server-owned assembly, real validated-slot counts, and a persisted paper frame after commit. 4. Client surfaces: paper fold/card, key-free projections, offline seed projection/badge, and the eight doc-14 copy keys plus offline labels. 5. Verification: focused suites, root typecheck/lint, desktop build, voice/diff checks, then backlog finalization.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the shared N5-N1 paper policy, migration 0010 exam lifecycle/answers/section timing, strict exam contract and fetch procedures, deterministic server-owned assembly, persisted key-free paper frames, chat-session paper fold/card, and desktop offline seed projection/badge. Settled defaults are floor-minimum: N5/N4/N3 10+10+10 and N2/N1 20+10; shortened timers use half-pace scaling at the floor and official minutes for exam-conditions. Verification: root bun run check-types passed; root bun run check passed; server build passed; item-engine 27 pass; DB 34 pass; server 145 pass/1 skip; chat-session 245 pass; UI 26 pass; desktop 417 pass/3 skip; desktop build passed; git diff --check passed; voice sweep found no new rendered em dashes. fallow audit --base main remains non-clean with 16 dead-code and 36 complexity findings, including accumulated branch findings; no unused dependencies or boundary violations.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented TASK-126 end to end: shared N5-N1 paper policy and validator, floor-aware deterministic assembly, migration 0010 exam lifecycle/answers/section timing, strict key-free exam contract and /rpc procedures, persisted paper frames, chat-session paper card, and desktop offline seed fallback. Verified with root typecheck/lint, server build, item-engine 27 pass, DB 34 pass, server 145 pass/1 skip, chat-session 245 pass, UI 26 pass, desktop 417 pass/3 skip, desktop build, diff check, and voice sweep. fallow audit remains non-clean with accumulated dead-code/complexity findings.
<!-- SECTION:FINAL_SUMMARY:END -->
