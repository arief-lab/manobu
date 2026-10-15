---
id: TASK-173.9.5
title: 'Exam (real mode): compose + validate N4 短文 reading from licensed Tatoeba prose'
status: Done
assignee:
  - '@arif'
created_date: '2026-10-03 14:28'
updated_date: '2026-10-10 08:31'
labels: []
dependencies:
  - TASK-173.9
documentation:
  - doc-26
parent_task_id: TASK-173.9
priority: medium
type: feature
ordinal: 956000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Goal: fill the N4 短文 block in non-real modes with authentic Japanese prose, honestly gated out of real mode. No correctly-licensed N4-N1 reading ITEM corpus exists to vendor (verified: JLPTSuccess ships items under N5 only; rbnhd/jlpt-n2-reading is non-commercial; oxkuma has no license; jlpt.jp samples are copyrighted; JaQuAD/JGLUE are CC-BY-SA but extractive, not 4-option). So compose: passages are VERBATIM Tatoeba sentences (packages/japanese/data/sentences/sentences.jsonl, CC BY 2.0) filtered to N4 vocab coverage; the question/options/key are authored, then validated offline. Load-bearing gap the task fixes: a reading-store entry is trusted and skips verification (shortReadingSourceFor sets sourcingCase: undefined at exam-service.ts:1131; satisfies byte-equals only, :2394-2420). That is safe for verbatim N5 but would launder an authored item as unquestionably real. Add a provenance field so real mode refuses composed items via the existing isRefused/refusedSections path (exam-service.ts:2088), reusing the fallback rule rather than a new reject reason. real keeps serving licensed N5 only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AC#1: CorpusShortReadingEntry (exam-corpus.ts:316) gains provenance: 'licensed' | 'composed'; a missing field defaults to 'licensed' so every existing N5 row keeps filling real mode (regression guard).
- [x] #2 AC#2: In mode 'real', a composed 短文 is refused through the SAME path as a fallback-sourced distractor (isRefused, exam-service.ts:2088), landing in catalog.refusedSections so the receipt names the section. No new ItemRejectionReason is invented.
- [x] #3 AC#3: shortened and exam-conditions modes DO fill their N4 短文 block from the composed store.
- [x] #4 AC#4: The composed store only contains items that pass an offline ingest validator: (a) exactly one option answers the question, (b) the passage is a verbatim subset of the concatenated Tatoeba source sentences, (c) length under the short-reading maxPassageLength. A deliberately-ambiguous fixture must be rejected by a real test, not by readFileSync/toContain source-text assertions (TASK-134).
- [x] #5 AC#5: mutation-gate seam proves AC#2: mutating the composed->refused mapping so composed passes in real makes the N4-real test fail.
- [x] #6 AC#6: data/LICENSE.md + packages/japanese AGENTS.md record reading/n4.json provenance (Tatoeba CC BY 2.0 per-line attribution, composed provenance, real excludes composed until validated); check:dox clean.
- [x] #7 AC#3 CLOSED VACUOUS BY TASK-173.9.22: short-reading has weight 0 in every flat mix (paper.ts:320-329), so shortened and exam-conditions papers never ask the 大問; this criterion has no surface to be met. Recorded as vacuous, not deferred.
- [x] #8 AC#4 SUPERSEDED BY TASK-173.9.22: the content this criterion names (a composed n4.json with an offline ingest validator) was authored and shipped by TASK-173.9.6, which replaced it with TASK-173.9.19's authored N4 短文 store. The validator contract lives in check:reading-tanbun; the content task is closed.
- [x] #9 AC#6 CLOSED BY TASK-173.9.22: data/LICENSE.md records per-store construction (licensed/authored/masked) for every shipped reading file, and packages/japanese/AGENTS.md documents the pipeline. The provenance record this criterion names now exists.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. exam-corpus.ts: add provenance to CorpusShortReadingEntry + default licensed. 2. exam-service.ts: CandidateSource.provenance?; set it in shortReadingSourceFor; extend isRefused with || provenance==='composed'. 3. packages/japanese/scripts/fetch-reading-n4.ts (template fetch-sentences.ts): assemble verbatim Tatoeba passages at N4 vocab coverage, author questions/options, run the ingest validator (single-answer + verbatim-subset + length), emit data/reading/n4.json provenance:composed. 4. Tests: real N4 refuses composed / shortened+exam-conditions fill / real N5 still fills; validator rejects an ambiguous fixture. 5. mutation-gate seam for AC#2. 6. DOX + LICENSE.md. 7. check-types, targeted tests, ultracite, mutation-gate --check, check:dox. Single commit on approval, no push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Honesty gate shipped (provenance -> real-mode refuse): `CorpusShortReadingEntry.provenance?` (apps/server/src/services/exam-corpus.ts:316) propagates to `CandidateSource.provenance` (apps/server/src/services/exam-service.ts:404); `shortReadingSourceFor` defaults missing provenance to `licensed` (`entry.provenance ?? "licensed"`, :1142) so the verbatim N5 store keeps filling `real` unchanged; `isRefused` gained an OR term `entry.source.provenance === "composed"` (:2106-2110), routed through TASK-173.1's existing `refusedSections` path, not a new rejection reason.
- Proofs + gate: `apps/server/test/exam-composed-reading.test.ts` (scratch `MANOBU_DATA_DIR` + `resetCorpusCache` injects a synthetic `reading/n4.json` that never ships and never gets served; asserts real-mode composed -> 0 short-reading + grammar-reading refused, licensed A/B control -> same prose fills + refuses nothing, licensed N5 real still fills); mutation seam `composed-reading-serves-in-real` (drops the composed OR term; caught). The `exam-refusal-moved-onto-daily-papers` anchor was re-pointed to the current `request.mode === "real" &&` line after the refactor (still unique, still caught); `scripts/mutation-gate.ts --check` now reports 94/94 anchors resolve.
- `real`-mode-only scope confirmed at the block table: `short-reading` is real-only (`paper.ts:320-329` weight 0 in every flat mix), so a practice paper never asks 短文 and cannot accidentally serve composed. The composed gate's only learner-visible surface is `real`.
- Still gated (not shipped): the composed `reading/n4.json` content itself. Plan step 3 (fetch-reading-n4 + ingest validator) requires the validator's semantic single-answer check to be resolved (LLM-as-judge vs hand-reviewed seed) before any real composed content lands. The mechanism gate is fully green without it, so AC#2 is provable today; AC#1's composed-fills-in-practice-modes clause is a no-op given real-only short-reading.

GATE SHIPPED (promotion, not just refusal): AC#2 was EXTENDED beyond 'refuse every composed' to 'refuse composed UNLESS validated'. isRefused composed branch is now `provenance==='composed' && !validated` (apps/server/src/services/exam-service.ts:2115-2123); CorpusShortReadingEntry gained `validated?/sourceIds?/validatedBy?` threaded to CandidateSource. A composed 短文 enters real only once the app's OWN agent-spawn capability (packages/acp SessionController/DirectCliSession over agy --print, AionCore model, NOT a reintroduced AI SDK) falsifies its key offline. exam-composed-reading.test.ts now asserts the three-state A/B (composed+unvalidated refuses / composed+validated serves / licensed serves) + N5 regression. Two seams caught: composed-reading-serves-in-real (drops the branch) and composed-reading-forgives-unvalidated (drops the !validated term). Verified: check-types 14/14, 17 exam tests pass, ultracite clean, mutation-gate --check 95/95 anchors, check:dox clean. Committed 7ecc3f3 on re-design, fast-forward merged to main (no push).

DEFERRED (task stays In Progress, gate is not content): AC#4 NOT met - no composed packages/japanese/data/reading/n4.json ships, no packages/japanese/scripts/fetch-reading-n4.ts, and NO validator agent. The validator's semantic single-answer check is the next build: spawn it through the app's own agent capability (packages/acp DirectCliSession over agy --print / runSingleShot), NOT a new AI SDK client, and NOT a hand-frozen validated:true. AC#6 NOT met - data/LICENSE.md + packages/japanese/AGENTS.md cannot record reading/n4.json provenance until that file exists (check:dox is green only because nothing new shipped to document). AC#3 is VACUOUS, not failed: short-reading is real-only (paper.ts:320-329 weight 0 in every flat mix), so a shortened/exam-conditions paper never asks 短文 and the 'practice fills composed' clause has no surface. Net: real N4 still serves ZERO composed reading; this session shipped the mechanism that will gate it, nothing learner-facing.

SPLIT: the content half moved to TASK-173.9.6 (single-sentence composed N4 短文 + separate judge + check:reading-n4). 173.9.5 is now the MECHANISM task only. Its remaining unchecked ACs are the content ACs, now owned by 173.9.6: AC#3 (practice fills) is VACUOUS (short-reading real-only, paper.ts:320) and AC#4/AC#6 (composed store content + LICENSE for it) belong to 173.9.6. The gate itself (AC#1/#2/#5) is done and shipped at 7ecc3f3. Do not close 173.9.5 as Done while its AC#4/#6 are unchecked and unmet here.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-10 08:31
---
TASK-173.9.22 closeout: the mechanism this task shipped (provenance gate, mutation seams) is pinned. Its three open criteria are reconciled: AC#3 vacuous (short-reading real-only), AC#4 superseded (content authored by TASK-173.9.6, then replaced by TASK-173.9.19), AC#6 met (LICENSE.md records per-store construction). No criterion points at work that still exists.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
HONEST STATE: mechanism shipped, content NOT. This session built the composed-短文 HONESTY/PROMOTION GATE (AC#1/#2/#5, extended AC#2 to 'refuse unless validated') + the 3-state test + 2 mutation seams; committed 7ecc3f3 on re-design, fast-forward merged to main, no push. NOT done (stays In Progress): AC#4 the composed packages/japanese/data/reading/n4.json content + packages/japanese/scripts/fetch-reading-n4.ts + the validator AGENT (spawn via packages/acp over agy --print, not a new AI SDK); AC#6 the LICENSE.md/japanese-AGENTS section (no file to document yet). AC#3 vacuous (short-reading real-only). Net: a real N4 paper serves ZERO composed reading today - nothing new is learner-facing; the gate that will let validated composed content land is what shipped. NEXT: author verbatim-Tatoeba N4 passages + a judge agent to falsify keys, freeze n4.json validated:true, then LICENSE + check:dox.
<!-- SECTION:FINAL_SUMMARY:END -->
