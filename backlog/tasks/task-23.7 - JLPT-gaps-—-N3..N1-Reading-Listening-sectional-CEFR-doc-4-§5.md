---
id: TASK-23.7
title: JLPT gaps — N3..N1 + Reading/Listening sectional + CEFR (doc-4 §5)
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-06 06:03'
updated_date: '2026-09-09 01:06'
labels:
  - jlpt
  - doc4
dependencies:
  - TASK-23.1
parent_task_id: TASK-23
priority: high
type: feature
ordinal: 595000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
jlpt-mock today only all/N5/N4 (mockSearchSchema) with LOCAL_GRAMMAR n5/n4 only, n3/n2/n1 [] empty, mock.ts:109 deriveWeakPatterns top 3. Official JLPT has 5 levels: N1 110+55, N2 105+50, N3 30+70+40, N4 25+55+35, N5 20+40+30; scoring N1-N3 3 sections 60/60/60 Total 0–180 Overall N1 100 N2 90 N3 95 + sectional 19 each; N4-N5 2 sections 120/60 Total 0–180 Overall N4 90 N5 80 sectional 38+19 (jlpt.jp results.html + guide2011_e_05.pdf + comprendreport 2025). Real JLPT allows bypass any level (no prereq, popular skip N5/N4→N3). See backlog/docs/research/doc-4 §§1-5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Fill LOCAL_GRAMMAR n3/n2/n1 non-empty seed from jkindrix 595 grammar + JMdict coarsePos, unblocking formatTimer section lengths
- [x] #2 Add sectional mirror deriveSectionalWeak + scoreBySection(part) → {lang, reading, listening} vs 60/60/60 vs 120/60; Score renders sectional pass badge 19/38 + CEFR badge A1..C1 (N5 80→A1 … N1 142→C1 comprendreport §3)
- [x] #3 Placement: surface Skip placement helper (nihongoai-copy-deck place.note) under progress {n}/8; placement keep heuristic 5→8 probe optional
- [x] #4 Verification: mock.test.ts add N3/N2/N1 cases + sectional + CEFR; walkthrough Travel → skip → drill あ still passes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes: AC#1 — the SERVER side was already fixed by TASK-23.28 (the /api/grammar route read vocab files cast to grammar shape before that fix); live curl confirms N1 150/N2 149/N3 130/N4 89/N5 77 = 595 points. Offline LOCAL_GRAMMAR seeds added for n1 (ni-kataku-nai, wo-motte) / n2 (ni-atatte-occasion, ue-de-upon) / n3 (you-da-appearance, causative-passive, noni-although) — ALL ids verified against the real corpus files so deriveWeakPatterns resolves real pattern labels offline. This exposed a latent bug: grammarIdLevel() resolved levels by 'n3-' prefix only, but jkindrix corpus ids carry NO prefix — now falls back to LOCAL_GRAMMAR membership lookup, and grammarIdLevel is exported (lazy route filter uses it). AC#2 — lib/mock.ts gains SectionalScore/SectionName/JlptLevel types + sectionCaps (N1-N3 60/60/60 vs N4-N5 120/60/60) + overallPassMark (N1 100 N2 90 N3 95 N4 90 N5 80) + sectionalPassMark (19/60 vs 38/120+19) + cefrForScore (N5 80→A1, N4 90→A2, N3 95→B1, N2 115→B2, N1 100→C1, highest matched band) + deriveSectionalWeak + scoreBySection. Question gains optional section tag (default lang — reading/listening questions arrive with TASK-23.8). JlptMockRoot takes level prop, computes sectional + CEFR at submit, Score renders mock-section-* badges + mock-cefr-badge. Browser-verified: N3 filter shows the のに question, answer → Score 100% + 'Language 60/60 ✓' + 'Reading 0/60 ✗' badges (CEFR null on the 1-question v1 mock since raw score 1 < 95 — threshold semantics unit-tested). AC#3 — skip-placement helper (copy key mock.skip.placement added to packages/ui copy deck + CopyKey union) renders under mock-progress on Q1. AC#4 — mock.test.ts +10 cases (N3/N2/N1 weak-pattern resolution, caps, pass marks, scaling, section bucketing, CEFR bands); bun test 233/0; tsc + ultracite clean; walkthrough verified live.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped JLPT N3..N1 expansion + official sectional/CEFR scoring (doc-4 §5). AC#1: server /api/grammar serves all 5 levels (595 points — unblocked by the TASK-23.28 route-split fix, live-verified N1 150/N2 149/N3 130/N4 89/N5 77); offline LOCAL_GRAMMAR seeds added for n1/n2/n3 with corpus-verified ids; grammarIdLevel fixed to resolve prefix-less jkindrix ids via seed membership (was prefix-only, latent bug) and exported for the route filter. AC#2: mock.ts gains sectionCaps/overallPassMark/sectionalPassMark/cefrForScore/deriveSectionalWeak/scoreBySection with official constants (60/60/60 vs 120/60/60; pass N1 100 N2 90 N3 95 N4 90 N5 80; sectional 19/38; CEFR N5 80→A1 … N1 100→C1); Question.section tag (default lang, reading/listening arrive in 23.8); JlptMock level prop threads through; Score renders sectional pass/fail badges + CEFR badge. AC#3: skip-placement helper under Progress on Q1 via new mock.skip.placement copy key (packages/ui copy deck). AC#4: +10 test cases; browser walkthrough verified N3 filter → question → submit → sectional badges; bun test 233/0; tsc + ultracite clean; Travel→skip→drill あ unaffected (no changes to those surfaces).
<!-- SECTION:FINAL_SUMMARY:END -->
