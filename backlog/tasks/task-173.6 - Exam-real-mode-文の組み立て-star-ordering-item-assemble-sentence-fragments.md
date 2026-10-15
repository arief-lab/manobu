---
id: TASK-173.6
title: 'Exam (real mode): 文の組み立て star-ordering item (assemble sentence fragments)'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-29 10:45'
updated_date: '2026-09-30 08:02'
labels: []
dependencies:
  - TASK-173.1
  - TASK-173.4
documentation:
  - doc-26
parent_task_id: TASK-173
priority: medium
type: feature
ordinal: 944000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The JLPT grammar section uses two formats the app does not have. 文の組み立て gives four fragments marked ★△◇□ and asks which fragment goes in the blank; 文的な文法 asks which sentence fits between paragraph parts A/B/C/D. Neither is modelled: the grammar families today are `grammar-form` / `particle`, answered by the bare `entry.pattern` string (`apps/server/src/services/exam-service.ts:832`). The real 文法 block cannot be built without these, so this task adds the star-ordering format first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A new item type represents sentence fragments with position markers and one blank, with the answer being the marked fragment that fits
- [x] #2 Fragments are derived from a real corpus sentence split deterministically, so the assembled order reconstructs the original
- [x] #3 The desktop exam view renders the four marked fragments and captures the learner choice
- [x] #4 Assembly refuses a star item whose fragments are ambiguous (more than one reconstruction reads correctly), reusing the validator satisfaction seam
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
star-ordering (文の組み立て) real-mode item. Locked: ★ marks the blank slot in the passage (options are plain fragments, NOT marker-glued strings — surface-elimination leak); measure fill floor before enabling bun-no-bunpou-2. Slices: 1 inert plumbing (enums, MaskStrategy fragment-span, item-store whitelist, paper weight/counts 0); 2 maskFragmentSpan + tests; 3 starSourceFor + fragmentRecords + satisfies star branch (permutation attestation + 。-legality) + dispatch/prompt/presentation + paperGrammarDemand + measurement floor; 4 enable block only if floor passes; 5 defer verbatim instruction (no sample-PDF source).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped Slices 1-4 (Slice 5 deferred).

1. Plumbing: `star-ordering` added to `ITEM_TYPES` (item-engine/types.ts), `EXAM_ITEM_TYPES` (api-contract/exam.ts), MaskStrategy `fragment-span`, item-store verified whitelist + `MASK_STRATEGIES`; weight 0 in the flat mix so only `real` asks it.
2. `maskFragmentSpan` (exam-mask.ts, strategy `fragment-span`): gates `prefix+span+suffix===sentence` and single-occurrence, re-tokenizes and refuses while the fragment survives. Seam `star-mask-unverified-claim`.
3. `starSourceFor`/`starSourceForExample` (exam-service.ts): tokenize one grammar-pool example, cut a contiguous 4-fragment region (middle 1..STAR_MAX_FRAGMENT_TOKENS), drop the closing `。` into the printed suffix (doc-26 §1 rule ②), spend `usedGrammarIds` only on success, `sourcingCase: undefined`. AC#4 honesty lives in `satisfies` via `starOptionSatisfies`/`satisfiesStar` against `attestedSentenceSet` plus the `。`-legality rule, refusing `ambiguous`. Seams `star-reconstruction-not-gated`, `star-ambiguity-not-refused`.
4. Enabled `bun-no-bunpou-2` to `star-ordering` after a corpus measurement walk cleared the >=5 fill floor (clean sources N5 77 / N4 89 / N3 127 / N2 145 / N1 150). Seam `star-demand-excluded-from-grammar-pool`.

Regression caught while enabling: `paperGrammarDemand` iterates all of `ITEM_TYPES`, and `candidateCountFor(0, reserve)` returns `reserve`, so the new zero-allocation star type prepended a reserve to every SHORTENED paper's grammar pool (shifting the seed-to-anchor walk; it broke exam-sense-groups and exam-fill-retry). Fixed by gating the star term to a nonzero allocation (`family === "star" && allocation[itemType] > 0`), which leaves shortened byte-identical to HEAD. The pre-existing zero-slot grammar/cloze reserve over-provisioning was left untouched (out of scope, large blast radius).

Docs: doc-26 §1 (guidebook pp.43-44 as the confirmed 文の組み立て format source plus rule ②), §4 capability row and prose (four buildable blocks), the accepted residual (conservative attestation) and the rejected boundary-adjacency alternative, and §6 floor numbers. AGENTS one-liners added in item-engine, api-contract, server and desktop. Tests: apps/server/test/exam-star-ordering.test.ts (19 cases) plus the desktop exam-real-mode-stems star case.

Verification (all green): apps/server 320 pass / 1 skip / 0 fail, item-engine 64, db 39, desktop 559 / 3 skip; check-types 14/14; ultracite check clean; mutation-gate --check 89/89 anchors resolve; full mutation-gate all 89 caught (incl. star-mask-unverified-claim, star-reconstruction-not-gated, star-ambiguity-not-refused, star-demand-excluded-from-grammar-pool); fallow boundary-violations 0; check:dox complete. AC#1 by the fragment-span mask/passage + desktop star render, AC#2 by the split round-trip + reconstruction seam, AC#3 by the desktop exam-real-mode-stems star case, AC#4 by the attested-ambiguity refusal + its seam.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the 文の組み立て star-ordering real-mode item (Slices 1-4): a real grammar example split into four fragments that rebuild the sentence, one slot marked ★ in the passage, options are the scrambled plain fragments; masked by the verified fragment-span strategy and refused as ambiguous when a distractor also rebuilds a corpus-attested sentence. Enabled bun-no-bunpou-2 after a corpus measurement walk cleared the >=5 fill floor (N5 77 / N1 150). Slice 5 (the verbatim Japanese instruction sentence) stays deferred: no sample PDF in the repo carries it, so paperBlockInstruction prints nothing rather than a fabricated line. Verified with the apps/server, item-engine, db and desktop suites plus the full mutation gate (89 caught) and fallow boundary check (0).
<!-- SECTION:FINAL_SUMMARY:END -->
