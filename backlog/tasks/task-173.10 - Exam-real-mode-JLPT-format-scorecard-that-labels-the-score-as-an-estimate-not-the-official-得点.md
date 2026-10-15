---
id: TASK-173.10
title: >-
  Exam (real mode): JLPT-format scorecard that labels the score as an estimate,
  not the official 得点
status: Done
assignee:
  - '@arif'
created_date: '2026-09-29 10:46'
updated_date: '2026-10-13 16:21'
labels: []
dependencies:
  - TASK-173.1
parent_task_id: TASK-173
priority: medium
type: feature
ordinal: 948000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The real mode only becomes exam-ready preparation once the learner sees a result in the shape they will get on exam day. The band structure and pass marks are already correct in `PAPER_BLUEPRINTS` (`packages/item-engine/src/paper.ts:70-263`), but `computeResult` derives a section score as `Math.round((correct / entries.length) * section.cap)` (`apps/server/src/services/exam-service.ts:2227`), a linear mapping, whereas the real JLPT publishes IRT-scaled bands. This task renders the result in the official section layout and states plainly that the score is an estimate, so the app never implies it predicts the JLPT scaled 得点.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The result pane shows the JLPT section layout with per-band score and the pass/floor status already modelled in the blueprint
- [ ] #2 The score is explicitly labelled an estimate; no copy claims it is the official scaled 得点 or a pass prediction
- [ ] #3 The existing linear `computeResult` may back the estimate, but the estimate wording is verified against the label a learner reads
- [x] #4 A browser pass renders a real-mode result with correct bands and the estimate disclaimer visible
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Desktop presentation + copy only; no server/contract change (band data already on the wire via ExamBandSectionResultSchema, exam.ts:568).
1. Copy deck (packages/ui/src/lib/copy.ts): add 5 keys no em dash - paper.result.estimate, .overall, .markValue, .reachesMark, .belowMark.
2. BandResultView (exam-paper-pane.tsx:865): band-only estimate <p data-testid=exam-result-estimate> first child; overall line + verdict + section right span move to deck copy (mark {floor}); leave examScoringSectionLabelForMode untouched; RawResultView/resultDescription unchanged.
3. Tests: copy-snapshot (PAPER_KEYS 12->17, prefix count 14->19, append strings); exam-result-copy (estimate==1 band/==0 raw, mark floor present, no literal 'Not passed', + mode:real band fixture through BandResultView for AC#4a).
4. Mutation seam exam-result-estimate-dropped (scripts/mutation-gate.ts).
5. Docs bullet apps/desktop/AGENTS.md; re-run check:dox.
AC#4: real papers don't assemble ready yet (173.5-173.9), so prove (a) mode:real band fixture via seam render and (b) live banded shortened result in browser.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented (desktop presentation + copy only, no server/contract change):
- copy.ts: +5 keys belowMark/estimate/markValue/overall/reachesMark (alphabetical, no em dash).
- BandResultView: estimate disclaimer <p data-testid=exam-result-estimate> as first child; overall line + verdict + each section right span now deck copy, each band prints its floor via mark {passMark}; verdicts reframed Reaches/Below the mark (no official-sounding Pass/Not passed); section-name call untouched; RawResultView/resultDescription unchanged.
- AC#1: per-band score + floor (markValue uses section.passMark 19/38) + pass/fail status present.
- AC#2: estimate disclaimer on band, never on raw (test asserts occurrences==1 band /==0 raw); no copy claims official 得点/pass prediction.
- AC#3: linear computeResult (exam-service.ts:3244) unchanged, wording verified against learner-facing label via the deck.
- AC#4a (deterministic): mode:real N5 fixture rendered through the REAL BandResultView shows 言語知識（文字・語彙・文法）・読解 + 聴解 + estimate + mark 38/mark 19. AC#4b live browser note: real papers do not assemble satable yet (173.5-173.9), so a live real-mode result is unreachable; same component renders live for a banded shortened/exam-conditions paper.
Evidence: check-types 14/14 (incl vite build); ui 172/172; desktop suite green; copy-snapshot counts 17/19; mutation seam exam-result-estimate-dropped CAUGHT; mutation-gate --check 93 anchors resolve; check:dox clean; ultracite clean.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-13 16:21
---
Live browser pass of the real-mode result pane run 2026-10-13 (the leg AC#4 named and 4b deferred). Real N3 paper exam-47ac9e2e-8726-46b7-a698-bccd4df89601 (mode real, label real-paper-banded) assembled ready=true shortfall=0 against the running dev server, then driven end to end in headless chromium through the shipped UI: Start the paper -> Submit section (x2) -> Submit paper. Result pane rendered BandResultView live: three bands 言語知識（文字・語彙・文法）/読解/聴解 each 0/60 mark 19, Overall 0/180, data-testid=exam-result-estimate present exactly once (DOM count 1), no exam-raw-result. Second scored paper exam-42087302-426e-46b2-b510-a63bfb4365fe (24 answers via exam.answer RPC) rendered Overall 7/180 with 言語知識 7/60, disclaimer still once. Screenshots /tmp/manobu-verify/01-ready 02-in-progress 03-result 04-result-scored.png. Two new findings surfaced by the pass, outside this task's scope: (1) PaperHeader (apps/desktop/src/features/exam/exam-paper-pane.tsx:210-214) and resultDescription (:845-857) branch binary on mode/label, so a real paper reads 'exam conditions' in the header and 'shortened paper' on its own result card even though the deck key paper.mode.real exists (packages/ui/src/lib/copy.ts:368); (2) data/n3.json:507 carries a mojibake reading 'Uӣ[い' for 賛成 (should be さんせい), committed since 07884a2, which reached the paper as a distractor.
---
<!-- COMMENTS:END -->
