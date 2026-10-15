---
id: TASK-159
title: 'Exam: the result card prints the same raw-only sentence twice'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 08:27'
updated_date: '2026-09-28 11:52'
labels:
  - exam
  - ux
dependencies: []
priority: low
type: bug
ordinal: 924000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA walk 2026-09-28: on a submitted shortened paper the result card reads the same sentence twice, once as the card description and once as the first line of the body.

It is literally one string, not two similar ones: `paper.result.rawOnly` = "Shortened paper: item counts only." (packages/ui/src/lib/copy.ts:308), rendered at apps/desktop/src/features/exam/exam-paper-pane.tsx:825 as a body heading (`<p className="font-medium text-sm">`) and again at :873 through `resultDescription` (defined :731, returns the key at :736) as the `CardDescription` under `CardTitle` "Result".

Commit 0984a0f (fix(exam): make the result and review surface say only what is true) rewired section labels and the explanation gate but touched neither :825 nor :731, so this is pre-existing text left behind by that pass, not a regression it introduced.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A submitted raw-only paper states the item-counts-only caveat once, and the task says which of the two render sites was kept and why
- [x] #2 The banded (non-raw-only) result path is unchanged, so the fix does not alter what a scored paper says
- [x] #3 A test pins the single occurrence rather than the exact sentence, so rewording stays cheap
- [x] #4 No new em dash in any touched user-visible string (R-02, packages/ui/test/copy-snapshot.test.ts)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Which site is kept, and why (AC#1)

Keep `resultDescription` (exam-paper-pane.tsx:731), the `CardDescription` under "Result". Delete the body heading at :825.

The header slot is where the two result paths already agree: the banded path puts its mode line there (`paper.mode.examConditions` / `paper.mode.shortened`), so a raw-only paper's caveat belongs in the same slot, and every result card reads title -> what kind of result this is -> the numbers. The :825 line is not a heading for the counts below it, it is a restatement of the mode, and it sits directly above a line that already says what the body is ("{correct}/{total} correct"). Deleting it also leaves the two views structurally parallel: `BandResultView` opens with its `font-medium text-base` "Overall x/y", so `RawResultView`'s count line takes that same treatment instead of opening with a small muted line.

## Changes

1. exam-paper-pane.tsx:825 - drop the duplicate `t("paper.result.rawOnly")` paragraph; promote the count line to `font-medium text-base` to mirror the band view.
2. `__test__` gains `resultDescription`, `RawResultView`, `BandResultView` so a test can render the two halves the real card composes (CardDescription + ResultDetails) without the whole `PaperScope` provider, which needs a QueryClient, a suspense exam query and eleven mutations.
3. New `apps/desktop/test/exam-result-copy.test.tsx`: count occurrences of `t("paper.result.rawOnly")` (the deck's own value, never a literal, so rewording stays cheap - AC#3) across the composed raw card and assert exactly 1; assert 0 in the banded composition and that the banded card still says its mode line and "Overall x/y" (AC#2).
4. Mutation seam `exam-result-raw-only-caveat-duplicated`: re-inject the caveat into the raw body line, which must make the count test fail.

## Verify

- bun test apps/desktop; bun run check-types; bun x ultracite check on touched files; bun run check:dox; bun scripts/mutation-gate.ts --check and the new seam
- browser: open one of the 5 submitted shortened papers in local.db at /exam/<id> with the sidecar up and read the Result card once. Sidecar stopped again afterwards so apps/server tests keep booting.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification: kept site = resultDescription (CardDescription), body paragraph deleted from RawResultView, count line promoted to font-medium text-base. Browser (chromium headless via vite :3001 + server :4317): exam-1df9e543 (raw-only N5) card reads 'Result' / 'Shortened paper: item counts only.' once / '0/1 correct' / 'Vocabulary 0/1'; exam-473d659f (banded N5) unchanged at 'shortened paper' + 'Overall 78/180' + both section gates, caveat 0 occurrences. Prose test is apps/desktop/test/exam-result-copy.test.ts (the plan said .tsx; createElement needs no JSX transform so .ts is the honest extension). Mutation seam exam-result-raw-only-caveat-duplicated: CAUGHT. bun scripts/mutation-gate.ts --check: 36 anchors resolve. bun test apps/desktop: 502 pass / 3 skip / 0 fail. bun run check-types: 14/14. ultracite check on the 3 touched files: clean. bun run check:dox: complete. packages/ui/test/copy-snapshot.test.ts (R-02): 12 pass. Docs: new bullet in apps/desktop/AGENTS.md after the TASK-128 result-card line.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The raw-only result card said the same string twice because the body heading in RawResultView restated what resultDescription already prints in the CardDescription slot. Kept the header site (that slot is where the banded path puts its mode line, so both result views now read title, kind of result, numbers) and deleted the body paragraph, promoting the count line to font-medium text-base to mirror BandResultView's 'Overall x/y'. Pinned by apps/desktop/test/exam-result-copy.test.ts, which counts occurrences of the deck's own t("paper.result.rawOnly") across the composed card rather than a literal sentence, plus the exam-result-raw-only-caveat-duplicated mutation seam (CAUGHT). Verified in a real browser on a submitted raw-only paper (caveat once, counts intact) and a submitted banded paper (mode line and both gates unchanged). Desktop 502 pass, check-types 14/14, ultracite clean, check:dox complete, R-02 copy guard green.
<!-- SECTION:FINAL_SUMMARY:END -->
