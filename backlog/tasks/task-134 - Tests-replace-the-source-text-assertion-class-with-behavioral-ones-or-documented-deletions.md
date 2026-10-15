---
id: TASK-134
title: >-
  Tests: replace the source-text assertion class with behavioral ones (or
  documented deletions)
status: To Do
assignee:
  - '@arif'
created_date: '2026-09-26 03:03'
updated_date: '2026-09-28 14:04'
labels:
  - tests
  - chore
dependencies: []
priority: medium
type: task
ordinal: 899000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Audit 2026-09-26 found 74 assertions across 6 test files that assert on the TEXT of a source file (readFileSync of a .tsx/.ts plus expect(...).toContain). They pass on a comment, an unused variable, or a deleted function body, and they break on a harmless rename. Concentration: apps/desktop/test/exam-workspace.test.ts 31, apps/desktop/test/ai-offline.test.ts 18 (of 21 assertions total), apps/desktop/test/kanji.test.ts 12, apps/desktop/src/features/chat/chat-column.test.ts 9, apps/desktop/test/settings.test.ts 2, apps/desktop/test/walkthrough-copies.test.ts 2.

PROVEN HARM (mutation-verified): making the exam review row's Dispute action inert (() => undefined) passed all 452 desktop tests, because the suite that appears to cover it only asserts that the copy key exam.review.dispute exists in the file. That one hole is already closed by a pure seam (reviewRowActions in exam-paper-pane.tsx) with a real test; this task is for the remaining 72.

RULE to apply to each: a source-text assertion becomes EITHER a behavioral assertion (render the component and assert the output, or extract a pure seam and assert it) OR a deletion plus a one-line comment naming the regression it guarded and why nothing automated covers it. It may stay ONLY when the guarded thing is genuinely unobservable at runtime (a route file's existence, a removed debug string), and then the comment must say so.

Record the audit method so the class cannot regrow quietly: scripts/mutation-gate.ts fails when a declared seam mutation survives its tests, and a cross-file duplicate-body scan is the cheap detector for copy-paste suites.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every source-text assertion in the 6 files is either replaced by a behavioral assertion, or deleted with a comment naming the regression it guarded.
- [ ] #2 The exam-workspace and ai-offline files (49 of the 74) are converted or reduced first: they carry the most assertions and the weakest per-assertion value.
- [x] #3 A mutation check proves the conversion: for at least one converted assertion, breaking the behavior makes a test fail where before it passed.
- [ ] #4 scripts/mutation-gate.ts exists, runs via a documented command, and exits non-zero when a declared seam mutation survives its tests.
- [ ] #5 The DOX records the rule: no new source-text assertion without a comment saying why the guarded thing is unobservable at runtime.
- [ ] #6 Full workspace verification stays green (bun run test, check-types, ultracite, fallow audit).
- [x] #7 apps/desktop/test/drill-machine.test.ts is in scope too: its `card machine source contracts` block (7 tests, found 2026-09-28 while doing TASK-162) is the same class and the 2026-09-26 census missed it. Done when no assertion in that file reads a `.ts`/`.tsx` source file (reading the kanji-n5.json corpus is a data assertion and stays).
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created from the 2026-09-26 test audit. Method worth keeping: mechanical detectors (cross-file duplicate test bodies; source-text assertion census) found the candidates cheaply, but two of my detectors produced false positives and were discarded rather than reported - a 'weak assertion' scan that flagged grade-loop and item-grading (both assert plenty), and a first attribution pass that reported 0 source-text tests per file because the readFileSync happens at describe scope. Every finding was then confirmed by MUTATION: break the behavior, check whether any test notices. That step is the only thing that proved the dispute hole, and it is why the task requires a mutation check as AC#3.

Per-test disposition for apps/desktop/test/drill-machine.test.ts, worked out 2026-09-28 (a starting audit, not a plan - re-read the file before acting):
- "mode is sticky via localStorage" -> DELETE, superseded: apps/desktop/test/drill-mode.test.ts calls the pure resolveMode/loadMode seam for TASK-162.
- "the debug point readout and AI-checks copy are gone" -> DELETE, a one-time migration guard already satisfied.
- "correct stamps 朱 then auto-advances after a beat" -> CONVERT to renderToStaticMarkup over CardFace at phase="correct" (the review-queue.test.tsx pattern; needs CardFace exported via __test__).
- "wrong redraws the missed strokes in shu and waits for a tap" -> CONVERT to the same render at phase="wrong": red pen + drill-card-continue.
- "intro auto-plays once per set, replay is on request" -> CONVERT half, DROP the introPlayedRef half: the once-per-set guard is stateful and no static render can see it.
- "mic chip degrades to disabled, never a fake grade" -> CONVERT to rendering ModeChip with disabled + hint; the gradePronunciation half is already real coverage in the same file.
- "chrome-free route offers the kanji deck tab (kind=kanji)" -> CONVERT to a pure seam: extract DECK_KINDS + KIND_LABELS out of routes/drill.tsx and assert by calling.
Note: the earlier describes in this file (strokeTolerance, gradeShape, kanaFold, gradePronunciation, typeFallbackChoices, the kanji-n5 deck data) already assert by calling and need nothing.

DONE 2026-09-28: apps/desktop/test/drill-machine.test.ts (the 7th file, missed by the census). Converted, not just deleted. The file is now test/drill-machine.test.tsx because the conversions render.

What replaced what:
- "correct stamps 朱" + "wrong redraws the missed strokes" + "intro auto-plays" -> four renderToStaticMarkup tests over the real CardFace / ModeChip (both now exported via __test__): the stamp appears on correct and on no other phase, RedPen draws one #c2402a path per missed stroke (asserted by count: 2 for missed=[1,3]), the tap-to-continue overlay exists on wrong and not on ready, the animating correction carries kanjivg-drawing, and the intro ghost renders exactly `visible` strokes while a ready card renders all four.
- "mode is sticky via localStorage" -> DELETED, superseded by apps/desktop/test/drill-mode.test.ts (TASK-162), which calls resolveMode/loadMode.
- "the debug point readout and AI-checks copy are gone" -> DELETED, a one-time migration guard already satisfied.
- "chrome-free route offers the kanji deck tab" -> DELETED as source text and replaced by three assertions that call: DECK_TAB_ORDER covers exactly DRILL_KINDS, every tab has a non-empty label with gojuon first, and isChromeFreePath("/drill") is true. That moved the deck vocabulary (DECK_TAB_ORDER + KIND_LABELS) into src/lib/drill-search.ts and deleted the route's private copy of the kind list, so the tab set has one owner.

AC#3 evidence (the mutation probe, the only proof that counts here): four behavior breaks applied to drill-lab.tsx one at a time - stamp gated on the wrong phase, continue overlay removed for phase wrong, RedPen mapping over an empty list, ghost guides forced on during the intro - and each one FAILED the specific converted test. Under the old source-text block all four would have passed, because every string they grepped for was still in the file. Tree restored after each probe (git diff clean apart from the __test__ export).

Deliberately left unguarded, each named in a comment at the test that dropped it: the 1s auto-advance timer, introPlayedRef once-per-set, the key={kind}:{cell}:{group} remount, the desk bar. No runtime seam for any of them; all four verified live in headless chromium the same day (tab order and labels unchanged after the vocabulary move: gojuon, dakuten, yoon, katakana, katakana-dakuten, katakana-yoon, kanji; the kanji deck still mounts).

Verification: desktop 488 pass / 0 fail, bun run test 10/10 tasks, tsc --noEmit clean, ultracite check clean on the four changed files, mutation gate --check 44/44 anchors resolve, check:dox clean. Docs: apps/desktop/AGENTS.md drill-lab row (contracts + what is unguarded) and drill-search.ts row (deck vocabulary).

STILL OPEN in this task: AC#1 names six more files (exam-workspace 31, ai-offline 18, kanji 12, chat-column 9, settings 2, walkthrough-copies 2 assertions) and AC#2 asks for the two heaviest first. Status returned to To Do. Note for whoever picks it up: apps/desktop/test/kana-chart.test.ts:170 and apps/desktop/test/route-loaders.test.ts read route source too; route-loaders is the census-over-files kind this task allows (a route file's existence and marker) but kana-chart's marker assertion is the banned class and is not in AC#1's list.
<!-- SECTION:NOTES:END -->
