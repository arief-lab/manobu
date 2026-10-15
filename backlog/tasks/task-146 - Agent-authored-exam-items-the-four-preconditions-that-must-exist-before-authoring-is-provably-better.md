---
id: TASK-146
title: >-
  Agent-authored exam items: the four preconditions that must exist before
  authoring is provably better
status: To Do
assignee: []
created_date: '2026-09-27 16:08'
updated_date: '2026-10-10 08:31'
labels:
  - exam
  - agent
  - testing
  - parked
dependencies:
  - TASK-145
priority: medium
type: task
ordinal: 911000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Not the authoring feature. This is the readiness list that makes authoring falsifiable, so that a prompt change can be told apart from noise. TASK-145 stays blocked on this rather than on TASK-144: 144 stored a baseline, but doc-23 section 5's disagreement-rate method is prose, not a runnable comparison. Verified 2026-09-27: the string 'disagreement' appears in doc-23 and the task files and in no .ts file, and scripts/ holds only dox-index-check, mutation-gate, parity-golden and voice-sweep.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A mechanical reject oracle exists, distinct from the shape validator. validateQuestionItem (packages/item-engine/src/validation.ts:255) proves structure and cannot see that two options are the same meaning. Add the sense-group collision check the TASK-142 rule already implies: reject an item when any option is in the target's own sense group, reusing senseGroupsOf (apps/server/src/services/exam-corpus.ts) as exam-sense-groups.test.ts already does.
- [ ] #2 A bounded attempt budget with an honest failure path, mirroring the repo's only existing convention: packages/chat-session/src/chat-engine/retry-policy.ts plus 'let budgetLeft = 0' (apps/desktop use-chat-engine.ts:318), decrement-and-stop, refilled only by a fresh send. Default 3. On exhaustion the item is NOT authored and the deterministic generator serves it, and the fallback is logged, since silent fallbacks are forbidden (apps/server/AGENTS.md).
- [ ] #3 An executable disagreement-rate harness exists as a script, not a section of prose. Given a stored baseline paper and a candidate paper, it reports per-criterion pass/FAIL/flagged counts and can report that the candidate got WORSE. Criteria are doc-23's C1-C5. Widens TASK-144's ten-item sample to at least 30 judged items, since 144's own notes say TASK-145 inherits the ten-item limit.
- [ ] #4 The human certification step is defined: who confirms a flagged gloss, and what a 'certified' marker means. TASK-144 recorded that an agent can FLAG a problem with evidence and not CERTIFY a gloss, so a flagged item must not reach a learner unmarked. Storage for the marker is decided here.
- [ ] #5 All four are reachable from one command and wired into scripts/mutation-gate.ts, so a removed guard fails a test. Per root AGENTS.md a budget check is a high-value seam and needs a declared mutation with an exact anchor.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope found during the 2026-09-27 investigation, and it changes the value of the whole list: the exam generator ignores data the rest of the product already uses. The shipped grammar corpus carries related, formation and meaning_detailed on every point (measured: 595 points across N1-N5, all 595 have meaning_detailed, formation and examples; 550 have at least 2 related points; 1,484 related refs and 0 unresolvable). crates/jlpt-mcp/src/types.rs:151,157 models them and packages/ui/src/components/tool-call-card.tsx:394 renders meaning_detailed. apps/server/src/services/exam-corpus.ts:40-46 declares only examples/id/level/meaning_en/pattern, so the EXAM path cannot see a curated contrast set that already exists. related is the wrong-rule neighbour list TASK-145's description asks an agent to produce: desu-polite-copula relates to da-plain-copula, deshita-past-polite-copula and dewa-arimasen-negative-polite-copula. Consume it and a large part of the authoring motivation may be a data-plumbing fix rather than a model call. Caveat: all 595 points are review_status draft with sources 'General Japanese grammar knowledge', so related is authored-but-unreviewed, which is why the certification criterion stays on this list.

Parked 2026-09-27 by user decision. Its premise failed the same walkthrough that parked TASK-145: these four preconditions (bounded model call, rejecting oracle, disagreement harness, human certification sample) exist to answer whether AGENT-AUTHORED items beat corpus items. The paper path turned out to need no authored items, so the question is not the blocking one. Evidence: the blueprint is compile-time constants (packages/item-engine/src/paper.ts:70-263), stems and options are corpus-derived via SOURCE_FAMILY_BY_ITEM_TYPE, and the listening section is filled deterministically too (apps/server/src/services/exam-service.ts:422-427). Depends on a parked task, so it inherits that state. Reopen only if a future goal asks the model for item content the corpus cannot source.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-10 08:31
---
TASK-173.9.22 reconciliation: AC#4 (human certification step) is closed by the owner's decision recorded in doc-27 §11, which ships the AI blind-judgment as the certification with no human leg, and accepts the residual risk at program scale. AC#3 (disagreement-rate harness) is now moot: the 読解 program certified its rows directly through two blind passes with byte-identity carry, not by beating a stored reference paper. AC#1 (reject oracle) remains applicable to every route that can produce an option clash and stays open as a general invariant. AC#5 (mutation-gate wiring) is done for the reading gates: 162 seams including the two new N1 seams are in scripts/mutation-gate.ts and pass. TASK-173.9.5 and TASK-173.9.6 are closed in this task's pass. TASK-145 stays parked with its note updated to point at TASK-173.9.22.
---
<!-- COMMENTS:END -->
