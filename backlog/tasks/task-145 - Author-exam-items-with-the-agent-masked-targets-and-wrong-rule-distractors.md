---
id: TASK-145
title: 'Author exam items with the agent: masked targets and wrong-rule distractors'
status: To Do
assignee: []
created_date: '2026-09-26 15:54'
updated_date: '2026-10-10 08:31'
labels:
  - exam
  - agent
  - acp
  - parked
dependencies: []
priority: medium
type: feature
ordinal: 910000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-21 §9 step 3, with the call direction settled by TASK-143 (the sidecar calls the agent over ACP) and the barrier defined by doc-21 §9.3 - the validator can reject a bad item, and nothing yet can tell whether authoring made the exam better.

The model's job is narrow and checkable, not "write a better question": mask the target realization so the item stops being answerable by string-match, and produce wrong-rule distractors. For 「Verb stem + ました」 the wrong options should be ません / ませんでした / ましょう, inflections of the SAME lemma, which differs only in application and is therefore unreachable by a POS or tag filter. That is the family that forces a learner to know the rule rather than spot a shared stem.

TASK-142 does the masking deterministically for patterns that name a literal, and lands first. What is left here is what code cannot do: patterns whose realization is not a literal (Noun + です is a copula, not a suffix), and distractor family 3.

Shape, from the two precedents worth taking. aionrs guards a runaway model with `max_tool_call_failure_turns`, default 3, plus a broader `max_turns` and an emergency guard, and its detector also catches consecutive all-error rounds - which is exactly the attempt budget doc-21 §9 calls missing, proven in a shipping agent. AionCore's host owns the spawn and the supervision and queues worker tasks rather than serving a request-scoped call, which is the "ask the model to do N bounded things" shape this work is.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A bounded attempt budget with an honest failure path, per doc-21 §9: a model that may re-propose forever will eventually be admitted by a validator with no limit. Shape taken from aionrs `max_tool_call_failure_turns` (default 3) with a broader `max_turns` and an emergency guard.
- [ ] #2 A pattern whose realization is not a literal is authored with a recorded masking strategy, or explicitly left unmasked and marked. Never claimed masked without a check, per TASK-142’s rule that an unverifiable mask is worse than none.
- [x] #3 Distractor family 3 exists: for a verb-anchored item the wrong options are inflections of the same lemma, asserted over an assembled paper and never on one hand-picked item.
- [ ] #4 The session lifecycle is decided and written down: a long-lived authoring session per sidecar or one per request, and what happens when the sidecar restarts mid-paper.
- [ ] #5 The latency and cost consequence is stated, including whether the deterministic items remain the default with authored ones opt-in - which doubles the item surface to maintain - and what a learner sees while a paper is being authored.
- [ ] #6 BLOCKED on TASK-144. The comparison method must exist before authored items are judged good, or a prompt change is indistinguishable from noise. No authoring starts until a hand-judged baseline is stored.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PAUSED at 1/6 by agreement, not blocked by a dependency.

AC#3 landed in 142ef05: the conjugation table moved to @manobu/japanese/conjugation and services/exam-distractors.ts assembles distractor family 3 from it. The remaining five criteria - attempt budget, non-literal mask strategy, session lifecycle, latency/cost, and the comparison - are the AGENT-AUTHORING PATH, which is a feature rather than a bug fix.

THE REASON FOR PAUSING rather than continuing. doc-23 §5's disagreement-rate method is a written method with no executable harness, so nothing can yet tell whether an authored item beats a deterministic one. Building the authoring path first means shipping a model call whose only success criterion would be "the validator accepted it" - and doc-21 §9.3 already says a model-authored item that passes the validator is unproven, not good. So the harness comes first, and this task resumes after it exists.

The pause is also the cheaper order. The authoring path adds latency, cost and nondeterminism to a surface where the hardest parts - inflections, wrong-rule variants, masking - turned out to be table work this repo already does. §9.2's boundary is about what may be INVENTED, so the model is left the sentence a verb drops into and the prose, which is a much smaller surface than the task description implied when it was written.

FIRST STEP WHEN THIS RESUMES, and it is AC#2 not AC#1: the authoring service that masks the target realization and records an honest strategy for a pattern naming no literal. The storage contract already exists - MaskStrategy carries no-literal-in-pattern / literal-absent-from-sentence / unverified-after-masking and ItemMask.literal is nullable - so "explicitly left unmasked and marked" is representable and only the path is missing. Then AC#1's bounded attempt budget, because a validator with no budget eventually admits anything, which is §9's "a guard that is not enforced is decorative".

Parked 2026-09-27 by user decision, not blocked. Reason from this session's walkthrough of the paper path: the deterministic generator already fills every slot the blueprint asks for, so agent authoring is not a prerequisite for shipping an exam. The blueprint (packages/item-engine/src/paper.ts:70-263) is compile-time constants; counts are largest-remainder allocation; stems and options are corpus-derived via SOURCE_FAMILY_BY_ITEM_TYPE. The listening section, which looked like the remaining hole, is also filled deterministically: exam-service.ts:422-427 carries a real corpus example as the spoken script, deliberately unmasked per :453. What is genuinely left is the explanation string (exam-service.ts:401 ships the literal 'server-only explanation' with explanationGenerated: true at :2069), and most of that is assembly from meaning_detailed/formation/related, which exam-corpus.ts:40-46 currently drops. Only per-distractor 'why this is wrong' prose needs judgment, and it becomes mechanical if distractors are drawn from related. Reopen if a future goal requires items the corpus cannot source.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-10 08:31
---
TASK-173.9.22 reconciliation: the 読解 conversion program — the goal that this task's note says would reopen it ('reopen if a future goal requires items the corpus cannot source') — is complete at N5-N1. No level has a 大問 whose rows are authored but not blind-certified. The program's certification is the blind judgment itself, not a comparison against a reference paper, so TASK-146's disagreement harness is not the blocker. TASK-145 remains parked: its remaining criteria (attempt budget, non-literal mask strategy, session lifecycle, latency/cost) are the AGENT-AUTHORING PATH for a general item-authoring feature, not a prerequisite for the 読解 stores shipped by TASK-173.9.16 through .21. Reopen only if a goal asks the model to author item content that no store route can produce.
---
<!-- COMMENTS:END -->
