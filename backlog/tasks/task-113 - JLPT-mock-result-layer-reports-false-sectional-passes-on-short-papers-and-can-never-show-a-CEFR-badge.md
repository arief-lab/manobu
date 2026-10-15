---
id: TASK-113
title: >-
  JLPT mock result layer reports false sectional passes on shortened papers and
  can never show a CEFR badge
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 04:58'
updated_date: '2026-09-24 13:24'
labels: []
dependencies: []
documentation:
  - >-
    backlog/docs/feature/doc-12 -
    Chat-generated-JLPT-exams-N5..N1-a-kana-readiness-gate.md
modified_files:
  - apps/desktop/src/features/mock/jlpt-mock.tsx
  - apps/desktop/src/lib/mock.ts
  - apps/desktop/test/mock.test.ts
priority: high
type: bug
ordinal: 859000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The scored screen of /jlpt-mock claims passes the paper has not earned, and one of its two score outputs is structurally unreachable. Measured against the shipped seed (apps/desktop/src/routes/jlpt-mock.tsx:25), which carries 6 untagged (lang) items plus 2 reading plus 1 listening: computeSectional (apps/desktop/src/features/mock/jlpt-mock.tsx:283) counts correct answers per section and hands those counts to scoreBySection (apps/desktop/src/lib/mock.ts:327), which scales by ratio to the official band caps (apps/desktop/src/lib/mock.ts:238). Verified by importing the shipped module, not by reading it: a run of 2/6 lang, 1/2 reading, 1/1 listening yields { lang: 40, reading: 30, listening: 60 } against marks 38/19/19 (apps/desktop/src/lib/mock.ts:259), so SectionBadge (apps/desktop/src/features/mock/jlpt-mock.tsx:247) renders Language 40/120 ✓, Reading 30/60 ✓ and Listening 60/60 ✓ under a headline of Score 44% (4/9). One listening question is therefore worth an entire 60-point section, and a one-item section answered correctly scores its full cap. Separately, both finalize paths pass a raw correct-answer count into the CEFR lookup: cefr: cefrForScore(level, r.score) at apps/desktop/src/features/mock/jlpt-mock.tsx:628 and :661, while cefrForScore (apps/desktop/src/lib/mock.ts:270) expects a 0-180 total-points score. So cefrForScore(N5, 4) is null and cefrForScore(N5, 9) is null: the mock-cefr-badge element (apps/desktop/src/features/mock/jlpt-mock.tsx:437) can never render on a shortened paper. Neither problem is caught by the suite because apps/desktop/test/mock.test.ts:295 exercises cefrForScore directly with 0-180 inputs and nothing renders the component; the helpers are green while the UI is wrong. Fixing this ahead of any generated papers is why doc-12 (backlog/docs/feature) opens with a v0 phase: the same badges would otherwise be applied to every generated paper at scale. Scope is the result layer and the section set its arithmetic rests on. It does not add item types and does not touch the generation pipeline. It does not rewrite the official band constants for N1 to N3, which are already correct there. What it does change is the N4/N5 section set (doc-12 section 2.6, decision D11): the code scores three 60-point sections against an official two, Language Knowledge (Vocabulary/Grammar)·Reading at 120 plus Listening at 60, which is why sectionCaps (apps/desktop/src/lib/mock.ts:238) sums to 240 while overallPassMark (apps/desktop/src/lib/mock.ts:244) is a mark of 180, and why AC #7's gate has no consumer to wire into. AC #8 is that correction, so it is in scope.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A section below the viability floor renders raw counts with no band points and no pass/fail claim: with the shipped SEED (apps/desktop/src/routes/jlpt-mock.tsx:25) answered 2/6 lang, 1/2 reading, 1/1 listening, the score screen shows no Listening 60/60 ✓ and no Reading 30/60 ✓ badge.
- [x] #2 A section at or above the viability floor keeps today behavior unchanged, reporting scaled points against sectionCaps (apps/desktop/src/lib/mock.ts:238) and sectionalPassMark (apps/desktop/src/lib/mock.ts:259).
- [x] #3 The viability floor is a named constant with a regression test that fails when a one-item section is scored as a whole band, pinning the round(1/1*60) = 60 case.
- [x] #4 cefrForScore receives a 0-180 total at both call sites (apps/desktop/src/features/mock/jlpt-mock.tsx:628 and :661), and a component test asserts mock-cefr-badge (apps/desktop/src/features/mock/jlpt-mock.tsx:437) is absent on a shortened paper and present once the scaled total crosses the level threshold in apps/desktop/src/lib/mock.ts:270.
- [x] #5 The result screen names a below-floor paper as a shortened paper, in R-02 copy (no em dash, no percentage-of-official claim).
- [x] #6 New coverage is at the component level, since apps/desktop/test/mock.test.ts already passes while the UI misreports; existing pure-helper tests keep passing unchanged.
- [x] #7 The overall pass gate is applied on the result screen: overallPassMark (apps/desktop/src/lib/mock.ts:244) currently has zero consumers anywhere in apps/desktop/src, and the score view states total scaled points against the level mark alongside the sectional badges, so a paper can fail overall while every section passes and vice versa, per the two-gate rule in doc-4 section 1.4. A component test covers both outcomes, since the existing helper test (apps/desktop/test/mock.test.ts:234) asserts return values only.
- [x] #8 The section-to-total mapping follows the official scoring sections (doc-12 D11 and section 2.6): N1 to N3 score three sections of 60 points, while N4 and N5 score two, Language Knowledge (Vocabulary/Grammar)·Reading and Listening, so sectionCaps (apps/desktop/src/lib/mock.ts:238) must sum to 180 at every level instead of returning 120 + 60 + 60 = 240 for N4/N5, and sectionalPassMark (apps/desktop/src/lib/mock.ts:259) must return a mark per scoring section rather than a 19-point mark for a reading section that N4/N5 do not score separately. A component test asserts that the sectional badges sum to the headline total (overallPassMark, apps/desktop/src/lib/mock.ts:244) for an N4 and an N5 paper, and a second test pins that N1 to N3 still report three badges of 60, since present behavior there is already correct. Found while validating the result frame in doc-19 section 7.1.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
v0 result honesty: floor + CEFR wiring + two-gate + N4/N5 caps (D11). 1) Add viabilityFloor constant + lib/mock helpers for floor/overallPass, 2) fix jlpt-mock.tsx:283/628/661 to use floor, scaled totals, and total for cefrForScore, 3) wire overallPassMark into Score view, 4) correct sectionCaps/sectionalPassMark to 120+60 for N4/N5 (3 buckets raw, 2 bands scored), 5) component tests pin 1/1=60 no-badge, CEFR, two-gate both outcomes, caps sum 180. Verify mock.test + component.
<!-- SECTION:PLAN:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: arief darma
created: 2026-09-24 05:01
---
Audit 2026-09-24 (scored-surface sweep for the same defect family, requested after the two defects above were found). This unwired gate is the third case in the mock. Verified with a repository-wide search for overallPassMark across apps/desktop/src: it returns only the definition at lib/mock.ts:244, with no importers, while test/mock.test.ts:234 asserts its return values. doc-4 section 1.4 documents TWO independent gates (total >= overall mark AND every scoring section >= its sectional mark), so today the result screen implements only the sectional half and cannot tell a learner the paper was failed overall.
---

author: arief darma
created: 2026-09-24 05:01
---
Same sweep, other surfaces checked and CLEAN: review queue (desiredRetention stays 0-1 from routes/review.tsx:97 through lib/review.ts:44 into packages/srs previewIntervals, converted once for display at features/mock/review-queue.tsx:69); settings retention slider (features/settings/settings.tsx:137 display and :138 write-back both divide or multiply by 100 correctly); listen-type similarityPercent (0-100 from lib/deinflect.ts:584, displayed as a percentage at features/listen-type/listen-type.tsx:354); shadowScore (0-1 from lib/shadow.ts against SHADOW_GRADE_THRESHOLD 0.8, display at listen-type.tsx:425); drill (raw counts only, features/drill/drill-lab.tsx:1340 and :1350); reader (no percentages in the feature). LATENT TRAP outside this task's scope: particleScore (apps/desktop/src/lib/roleplay.ts:45) caps at 3 while the composer divides by required.length (apps/desktop/src/features/roleplay/roleplay.tsx:545), and the fallback set has 5 entries (lib/roleplay.ts:48); unreachable today because all six scene lines declare at most 2 particles (apps/desktop/src/lib/roleplay-scenes.ts:70 through :149), but the next scene with 4+ required particles renders 3/5 beside five lit chips.
---

created: 2026-09-24 09:39
---
TASK-113 comment (doc-19 validation, 2026-09-24). While checking the result wireframe in doc-19 against the shipped helpers, the badge arithmetic turned out not to close: sectionCaps (lib/mock.ts:238) sums to 240 (lang 120 + reading 60 + listening 60) for N4 and N5, sectionalPassMark (lib/mock.ts:259) rates those badges against 38/19/19, and overallPassMark (lib/mock.ts:244) is a pass mark of 180. The first draft of the frame had Reading at 22/60 marked fail, which is impossible against a mark of 19; the frame is fixed, and the roll-up question is now AC #8 rather than a drawing detail. Same family as the two defects already in AC #1 to #3: numbers that render plausibly without a defined relationship to the official shape.
---

created: 2026-09-24 11:22
---
AC #8 is now a settled rule rather than an open question. Two decisions were written into the docs today, both from source rather than preference.

**D11: the section set is wrong, not the arithmetic** (`doc-12` §2.6, new; `doc-12` §7 decision row; `doc-19` §7.1 redrawn).

The official model allocates 180 points at every level but *not* the same number of scoring sections (`jlpt.jp/e/guideline/results.html`, echoed by the AATJ JLPT guide):
- N1, N2, N3: three scoring sections, Language Knowledge (Vocabulary/Grammar) / Reading / Listening, 60 + 60 + 60 = 180.
- N4, N5: **two** scoring sections, "Language Knowledge (Vocabulary/Grammar)·Reading" 0 to 120 and "Listening" 0 to 60 = 180. Sectional minimums 38 of 120 and 19 of 60.

`sectionCaps` (`apps/desktop/src/lib/mock.ts:238`) returns `{ lang: 120, reading: 60, listening: 60 }` for N4/N5, which sums to 240: it invents a Reading scoring section that N4/N5 do not have, splitting the 120-point combined section in two. `sectionalPassMark` (`:259`) inherits it, returning a 19-point mark for a section that is not scored separately.

So the fix for AC #8 is the correct section set, not a coefficient: at N4/N5 fold the `reading` bucket into `lang` for banding (three test sections become two scoring sections), caps become 120 + 60, marks become 38 of 120 and 19 of 60, and the badges add to the 180 that `overallPassMark` (`:244`) is stated in. That is also the mechanical reason AC #7's gate has no consumer to wire into. **N1 to N3 are already correct and must not change.** The §7.1 frame in `doc-19` is the target shape: `Language Knowledge·Reading 72/120 ✓`, `Listening 30/60 ✓`, `Overall 102/180 pass mark 90 ✓`.

Note the deliberate distinction a builder can get wrong: below the D5 viability floor the raw counts stay three buckets (test sections), because a raw count needs no cap to be true; above the floor the bands are two (scoring sections). Carrying three buckets into the banded view reintroduces this bug.

**D12: `drill-coverage` ships with the v1.5 deck extension, not before** (`doc-12` §7, §9; `doc-13` §6, §10). Adjacent to this task only in that both are kana/result-layer sequencing; recorded here so the reasoning is in one place. D2's three named admission sources are unchanged; v1 admits through `checkpoint` and `skip`, and the resolver refuses `drill-coverage` explicitly rather than telling a learner they failed a gate that was never offered.

AC #8 itself is left exactly as written: it is still an accurate statement of the defect in the current code.
---

created: 2026-09-24 11:28
---
Follow-up on the comment above: AC #8's test clause is now reworded, so the closing line there ("left exactly as written") no longer holds. The defect statement in its opening sentence is unchanged and still accurate for the current code; what changed is the test clause, which used to ask for a test pinning that the headline total is NOT the sum of the badges. That would have pinned the bug, since D11 settles that at N4/N5 the badges sum to 180. AC #8 now asks for the opposite assertion: a component test that the sectional badges sum to the headline (overallPassMark, apps/desktop/src/lib/mock.ts:244) for an N4 and an N5 paper, plus a second test pinning that N1 to N3 still report three badges of 60. Acceptance criteria #1 to #7 are byte-identical to before, all eight are unchecked, and the title, status and priority are untouched.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed result layer: viability floor (VIABILITY_DIVISOR 6 → 10/20, isSectionViable), N4/N5 caps 120/60/0 (D11, sum 180), sectionalPassMark reading 0 at N4/N5, computeRawCounts + computeSectional folding reading into lang for bands, Score renders raw counts + shortened label below floor else scaled badges (2 for N4/N5, 3 for N1-N3) + overall 180 pass/fail (two-gate) + CEFR on totalScaled. Wired buildScoredResult in jlpt-mock.tsx:283/628/661. Verified: apps/desktop 376 pass, check 472 files clean, check-types 13/13.
<!-- SECTION:FINAL_SUMMARY:END -->
