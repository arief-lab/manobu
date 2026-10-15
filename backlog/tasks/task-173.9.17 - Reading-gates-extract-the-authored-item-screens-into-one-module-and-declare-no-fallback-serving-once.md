---
id: TASK-173.9.17
title: >-
  Reading gates: extract the authored-item screens into one module and declare
  no-fallback serving once
status: Done
assignee: []
created_date: '2026-10-09 11:24'
updated_date: '2026-10-09 12:46'
labels:
  - exam
  - content
dependencies: []
documentation:
  - doc-27
parent_task_id: TASK-173.9
priority: medium
type: chore
ordinal: 970000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-173.9.16 proved the authored route works for one block by building its screens INSIDE scripts/check-reading-choubun.ts. Finishing 読解 at every level (owner instruction 2026-10-09, recorded in root AGENTS.md User Preferences) needs the same screens at 中文, 短文 and 長文 N1, and copying that branch into three more gates is exactly the disease TASK-173.14 already documents. So this task moves the authored screens to one shared module that every reading gate imports, and it writes the serving policy that follow-up tasks depend on: a comprehension block serves authored rows ONLY, with no fallback to a masked-slot store, because falling back would print vocabulary-in-context recovery under a comprehension ねらい, which is the thing doc-27 §10 exists to stop. The consequence is stated rather than hidden: with no fallback, authored depth is load-bearing, so a drained 大問 comes up short, and the follow-up tasks size their stores at four papers deep for that reason. TASK-145 and TASK-146 (parked) set preconditions that cannot be met here because nobody in this project reads Japanese; the owner has directed authoring anyway and accepted the residual risk, so this program supersedes them as the route of record and they stay as related work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The authored screens run by check-reading-choubun.ts (that level CHOUBUN_AUTHORED_BAND, at least 2 paragraphs, exactly 4 distinct options with an in-range key, no sourceIds and no blank, a stem classifying into CHOUBUN_INTENT_PATTERNS, an evidence span printed verbatim in its own passage between CHOUBUN_MIN_EVIDENCE_RUNES and half the passage, row-judge-rejected, the shared structural validator, plus file-level CHOUBUN_MIN_INTENTS and mixed-constructions) live in ONE module that the 長文 gate imports, and fallow dupes reports no second copy of them.
- [x] #2 The module is parameterised by band, paragraph minimum, block and per-block passage cap rather than hardcoded to 長文, so the 短文 gate (100-240, TANBUN_MAX_PASSAGE_LENGTH in packages/japanese/scripts/reading-tanbun-corpus.ts:60), the 中文 gate (PASSAGE_BAND at packages/japanese/scripts/reading-chuubun-corpus.ts:152), the 主張理解 gate and the 統合理解 gate can call it in TASK-173.9.18 through TASK-173.9.21 without being edited. A 短文 or 統合 row may legitimately fail an at-least-2-paragraph screen, so that bound is a parameter and not a constant. No screen semantics change: coverageOf stays a diagnostic printed on stderr and never a gate.
- [x] #3 No behaviour change and no data moves: check:reading-choubun is green at N3 and N1 with the same stdout as before, git diff shows zero changes under packages/japanese/data/reading/, bun test in packages/japanese passes, and bun x ultracite check, bun run check:dox and fallow dead-code --boundary-violations are clean.
- [x] #4 The no-fallback policy is written once where the pickers decide it in apps/server/src/services/exam-service.ts, naming the 大問 it applies to, and a test proves a drained authored store reports a shortfall rather than serving a masked-slot row under the same heading.
- [x] #5 Docs follow: packages/japanese/AGENTS.md gate bullets name the shared module instead of describing a 長文-only branch, the boundary with TASK-173.14 is recorded in both tasks (that task owns the gate CLI and the generator write and format tails, this one owns the authored screens), and doc-27 records the no-fallback decision plus the risk acceptance that scales same-family blind judging past 8 rows.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Every reading gate reaches the authored screens through one module, the no-fallback serving policy exists once and is tested, and no shipped row or floor constant changed.
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New packages/japanese/scripts/reading-authored-corpus.ts owns the authored screens as a parameterised checker: expected signer and construction tag, passage band, paragraph minimum, option count and shape, no-sourceIds and no-blank, stem intent classifier (injected), evidence span (verbatim plus its two bounds), judge-rejection set, and the file-level intents floor and mixed-constructions rule. 2. check-reading-choubun.ts keeps its masked-slot branch untouched and imports the authored screens, passing CHOUBUN_AUTHORED_BAND, CHOUBUN_BLOCK, CHOUBUN_AUTHORED_SIGNER, choubunIntentFor, CHOUBUN_MIN_PARAGRAPHS and CHOUBUN_MIN_INTENTS, so stdout stays identical. 3. The authored screens gain their own test file that calls the module with a 中文-shaped and a 短文-shaped config (proving the parameterisation, not just the 長文 call), while every pre-existing gate test stays green unchanged. 4. apps/server/src/services/exam-service.ts: locate where each 読解 picker chooses its store and write the no-fallback rule once, with a test that a drained authored store reports the shortfall instead of serving a masked-slot row under the same heading. 5. fallow dupes for the screen families, ultracite check, check:dox, mutation-gate --check, bun test in packages/japanese and the apps/server reading suites. 6. Docs: packages/japanese/AGENTS.md gate bullets name the shared module, doc-27 records no-fallback plus the scaling risk, TASK-173.14 carries the boundary comment.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 2 (AC#4) done 2026-10-09. servableReadingRow (exam-service.ts:1334) is the one no-fallback rule; all six 読解 pickers call it at :1381/:1462/:1552/:1618/:1689/:1757. Refusing skips and continues rather than ending the walk, and a walk that finds nothing servable still returns null, so the block names its hole. The two removed per-picker type annotations (CorpusShortReadingEntry, CorpusTougouReadingEntry) are now inferred through the generic, so those imports are gone. Proved load-bearing: neutering the level comparison fails the new test and the gate seam reading-row-serves-across-level is CAUGHT; the shipped-data property stays green either way, which is the honest scope of the rule (it fires only on the defect, never on shipped rows). Docs: packages/japanese/AGENTS.md names reading-authored-corpus.ts as the owner of the authored screens and lists every parameter the 短文/中文/主張/統合 gates will pass; apps/server/AGENTS.md carries the serving rule; doc-27 §12 records no-fallback plus the ~300-row/~600-judgment scaling of §11's correlated error. Boundary with TASK-173.14 now recorded on both tasks.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-09 12:45
---
Scope boundary set 2026-10-09, recorded on both sides with TASK-173.14. This task owns the AUTHORED item screens and moved them into packages/japanese/scripts/reading-authored-corpus.ts plus the one no-fallback serving rule in apps/server/src/services/exam-service.ts. TASK-173.14 owns the per-family gate CLI tail, the generator write and biome-format tail, the corpus-module tail and the entry-builder family. Consequence proved here: fallow dupes still names the gate-CLI clone groups (check-reading-choubun.ts vs -chuubun/-chuushou/-tanbou/-tougou) and this task leaves them for 173.14; reading-authored-corpus.ts appears in zero clone groups, which is AC#1's no-second-copy property.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Authored item screens moved out of the 長文 gate into one parameterised module (packages/japanese/scripts/reading-authored-corpus.ts: band, paragraph minimum, option count, evidence bounds, injected ねらい table, judge-rejection set, MIN_INTENTS, mixed-constructions) and check-reading-choubun.ts calls it with an AuthoredConfig, so TASK-173.9.18 through TASK-173.9.21 can wire the 短文/中文/主張理解/統合理解 gates to the same screens without editing them. The no-fallback serving rule is written once (servableReadingRow, apps/server/src/services/exam-service.ts:1334) and called by all six 読解 pickers: a row stamped for another level is skipped, the walk continues, and a store with nothing servable returns null so the 大問 names its hole instead of borrowing. Verified: bun test packages/japanese 256 pass 0 fail; bun test apps/server 442 pass 1 pre-existing skip 0 fail; check:reading-choubun green at N3 (same coverage diagnostics) and N1, all 8 rows each; git diff empty under packages/japanese/data/reading/; new test/exam-reading-no-fallback.test.ts 30 pass and proven load-bearing (neutering the level check fails it, and the new seam reading-row-serves-across-level is CAUGHT, 148/148 anchors resolve); fallow dupes shows reading-authored-corpus.ts in zero clone groups and the remaining gate-CLI clone groups left to TASK-173.14 by the boundary recorded on both tasks; bun x ultracite check, bun run check:dox and fallow dead-code --boundary-violations clean. Docs: packages/japanese/AGENTS.md and apps/server/AGENTS.md describe the shared module and the serving rule, doc-27 §12 records no-fallback and the ~300-row/600-judgment scaling of §11's correlated-error risk.
<!-- SECTION:FINAL_SUMMARY:END -->
