---
id: TASK-144
title: >-
  Hand-judge a baseline exam set, so authored items can be compared against
  something
status: Done
assignee: []
created_date: '2026-09-26 15:39'
updated_date: '2026-09-27 02:20'
labels:
  - exam
  - quality
dependencies: []
priority: high
type: task
ordinal: 909000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-21 §9.3 draws a distinction that is easy to skip and impossible to recover: the validator catching a bad item is bar 1, and being able to tell whether authoring made the exam better is bar 2. Bar 1 is met - `stem-leak` rejected the kana-surface entries (91 of 400 sampled N5 entries had `word === reading`), and the filter it prompted turned out to be rejecting 388 to exclude 91. Bar 2 has no artifact at all.

Without it, a change to the authoring prompt is indistinguishable from noise, and "the exam got better" is unfalsifiable. That is the same lesson the mutation gate exists for, applied to prose: a passing test is not evidence until you have watched the thing you care about break.

This is a judgement task, not an engineering one, and it is the cheapest of everything on the exam track: the deterministic items landed in TASK-138 are the baseline, and judging them needs no new code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A baseline set of deterministic items is judged by hand against named criteria: is the answer unique, is the answer derivable from what is shown, is the item level-appropriate, are the distractors plausible, is the prompt unambiguous. The criteria are written down before the judging starts.
- [x] #2 The judged set is stored with the paper that produced it, so the baseline is reproducible rather than a memory.
- [x] #3 At least one item class is recorded as FAILING the criteria, because a baseline with no failures cannot distinguish an improvement.
- [x] #4 The comparison method for authored items is written down and executable: same criteria, same paper, both sets judged, with the disagreement rate reported rather than a summary verdict.
- [x] #5 doc-21 §9.3 is updated to name the baseline and the method, and the two bars are checked separately in the task that opens agent authoring.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DONE, 5/5, and the baseline found a defect that no test could. Recorded in doc-23 (backlog/docs/analysis/).

THE FINDING. All three `word-in-context` items in the sample have MORE THAN ONE CORRECT OPTION. "Choose the meaning of 暇." offers spare time / leisure / free time / time (it takes to do something), and the marked answer is spare time - so a learner who answers "leisure" is right and is marked wrong. Same for 一日 (one day / all day / the whole day) and 一人 (one person / being single).

The cause is the distractor family this project chose. doc-21 §7 approach 4 recommends the entry's own other senses, on the grounds that they are "the most plausible wrong answer available" and cannot be wrong about part of speech. The second half holds. The first is FALSE: they are other correct senses, and on a bare gloss question that makes the item AMBIGUOUS rather than hard. Since 86-90% of entries are multi-sense, this affects most of that item type.

So §7 is corrected in a new §7.1: the family is not dropped - it is still the cheapest plausible pool - but it belongs to the CONTEXTED item types, where a sentence makes one sense right and the others wrong. A bare gloss question has nothing to disambiguate with, so its distractors must come from other WORDS with the same-POS filter. That is a TASK-138 change, and it is the most valuable thing this exercise produced.

TWO MORE DEFECT CLASSES, recorded because a baseline with no failures cannot distinguish an improvement. (a) Two item TYPES can spend the same grammar anchor: the sample's particle and reading-info items share `grammar:masu-polite-verb`, the same sentence and the same answer, so the paper asks one question twice. TASK-138 spends a vocabulary WORD once per paper but nothing stops two types from spending the same grammar POINT. (b) The listening prompt says "phrase" while the options are whole sentences.

A SURPRISE WORTH RECORDING. The ます item's four options are ません / ませんでした / ました / ます - inflections of the SAME verb, which is exactly distractor family 3, the family §9.1 says no tag filter can produce. They are there because the N5 grammar list happens to contain those four points, not because anything selected for it. Family 3 is already half-present BY ACCIDENT, so selecting for it deliberately is an improvement rather than new work.

ON WHO JUDGED IT, because the task said "hand-judge" and that is not entirely true. C2 (derivability) is fully mechanical - it is the items.mask record. C1, C3, C4 and C5 were judged by an agent reasoning over the corpus data and the Japanese, which is enough to FLAG a problem with evidence and not enough to CERTIFY a gloss. Every judgement in doc-23 is marked pass, FAIL or `flagged`, and the flagged ones name what a native speaker or a teacher has to confirm. In particular I can show that the corpus lists all four 暇 glosses on one entry; I cannot certify which the app should accept. Nothing is presented as a human verdict.

AC#4's method is written and is deliberately not a summary verdict: report the DISAGREEMENT RATE per criterion, so an authored set that fails 3/3 on C1 like the baseline has demonstrated nothing, and a mechanical criterion stays mechanical so an authored item cannot be credited for it. It also has to be able to say an authored set got worse.

AC#2: the sample is N5 / shortened / seed baseline-n5-v1 / vocabulary + grammar-reading + listening at 4/4/2, ten items, ready with zero shortfall, and TASK-140's persistence means the same paper rebuilds from that seed and level.

AC#3: three defect classes, listed above.

THE LIMIT THAT INHERITS: ten items is a sample, not a distribution. Every claim is "in these ten items", and TASK-145 inherits that limit unless it widens the sample. That is stated in doc-23 §5 rather than left implicit.
<!-- SECTION:NOTES:END -->
