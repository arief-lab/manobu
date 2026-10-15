---
id: TASK-173.9.9
title: >-
  Exam (real mode): measure the 令和7年版 白書 supply before widening the 中文 corpus
  again
status: Done
assignee: []
created_date: '2026-10-07 07:22'
updated_date: '2026-10-07 09:06'
labels: []
dependencies: []
parent_task_id: TASK-173.9
priority: medium
ordinal: 961000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-173.9.8 reached the eligible-supply ceiling exactly at 171 pinned pages: the stores sit at 25/71/22 and a rejection can no longer be refilled, so LICENSE §13 names widening the page set as the ONLY deepening path. The 令和7年版 環境白書 now exists on env.go.jp with the same per-section HTML tree as the pinned r06/r05 (probed: r07/html/hj25010101.html returns 200), and other ministries (総務省 情報通信白書, 厚労省 白書) may add register variety, though several went PDF-only in recent years. This task MEASURES that supply before any store or judge work: fetch the r07 pages through the existing decode scoring and prose filters, re-measure the in-band paragraph count (currently 1330) and the per-level clearing counts at the shared COVERAGE_FLOOR (currently N3 33 / N2 103 / N1 29), and record the ministry HTML availability check. Deliverable is the measurement and a ship/dont-ship decision; regenerating the stores and running the freeze-time blind judge families is a separate follow-up.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 fetch-hakusho.ts pins the 令和7年版 narrative pages (same PDL1.0 attribution, same decode scoring and short-page exclusion, year field r07), the original 171 pages stay pinned FIRST so every existing corpus line and store row keeps its prefix, and hakusho.jsonl regenerates deterministically
- [x] #2 The widened corpus is measured and the numbers recorded in the task notes: total paragraphs, in-band (200-1200 rune) count vs the current 1330, and per-level clearing counts at COVERAGE_FLOOR vs the current N3 33 / N2 103 / N1 29
- [x] #3 The HTML availability of 総務省 情報通信白書 and 厚労省 白書 is checked and recorded as a named fact per ministry (per-section HTML URL, or PDF-only), without building PDF extraction machinery
- [x] #4 The task states the decision: whether the measured supply justifies a store regeneration + both-family blind-judge pass as a follow-up task, and the follow-up is named or created only with user approval
- [x] #5 No composed store changes in this task: data/reading/{n3,n2,n1}-chuubun.json and their rejected records stay byte-identical; check:reading-chuubun stays green at all three levels
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Enumerate the 令和7年版 section-page tree from env.go.jp (r07/html/hj25*.html hrefs from the TOC pages), excluding front-matter/boilerplate pages.
2. Append r07 entries to PAGES in scripts/fetch-hakusho.ts (ids r07-*, year r07) AFTER the r05 block so the 171 pinned pages stay the prefix; re-run fetch:hakusho (network, cached per page).
3. Prove the prefix property: hakusho.jsonl diff is append-only (existing 3768 lines byte-identical at head).
4. Measure: in-band (200-1200 rune) paragraph count vs 1330, and per-level clearing counts at COVERAGE_FLOOR vs N3 33 / N2 103 / N1 29 — via a probe importing the shared screens from scripts/reading-chuubun-corpus.ts, NOT by regenerating stores.
5. Check 情報通信白書 (総務省) and 厚労省 白書 for per-section HTML availability; record the named fact per ministry, no PDF machinery.
6. Record the ship/don't-ship decision in the task notes; stores and judge records untouched (AC#5: check:reading-chuubun still green at all three levels).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Probe built and validated BEFORE r07 landed: scripts/measure-reading-supply.ts (wired as measure:reading-supply, no network) reproduces the TASK-173.9.8 recorded numbers exactly on the current corpus — in-band 1330, clears N3 33 / N2 103 / N1 29, and generator supply 25/71/22, proving the supply ceiling equals the shipped stores. AC#3 ministry facts recorded: (a) 厚労省 厚生労働白書 — PDF-only in the recent editions, the ministry index ends around 令和2/3年版 with /content/*.pdf links and no per-section HTML; (b) 総務省・デジタル庁 情報通信白書 — an HTML web/e-book edition EXISTS and 令和7/8年版 are listed at soumu.go.jp/johotsusintokei/whitepaper/ja/, but the section tree is JS-driven so static curl enumeration cannot list section pages — adapting the fetcher to it is its own probe, NOT available as a 10-minute check; (c) env.go.jp r07 tree is a clean mirror of r06 (hj25*, 93 narrative pages, same per-section HTML). r07 fetch surfaced a real fetcher bug: the ministry throttles BURST traffic with HTTP 200 + a near-empty page, which the decode guard read as mojibake, and the first repair attempt dropped ~26 GOOD pages (verified hj25030101: 38 prose paragraphs, 7.5k runes, score would be fine) — reverted. fetch-hakusho.ts now retries each page 4x with backoff (refuse-and-RETRY: only a page low on every attempt is genuinely short) and fetches in batches of 4 preserving pinned-page order. Background retry loop is running against the per-IP cooldown.

Short-page exclusions for r07 are curl-VERIFIED (prose-paragraph count on the live page), not guard-guesses: r07-2-4-6 (138 kana, 3 paras), r07-2-4-7 (146, 2), r07-3-4-3 (130, 3), r07-3-1-3 (199, 3 — one char below the 200 guard, stable across 10 retry rounds so real content, genuinely sparse). Pinned r07 set now 89 pages. The earlier ~26-page burst loss was throttle, verified and reverted; a refused page is only dropped after a live prose check.

FINAL MEASUREMENT (widened corpus, re-verified 2026-10-07; supersedes the mid-run "89 pages" note): pinned set is 250 pages — r06 84 + r05 87 + r07 79. The 14 dropped r07 candidates are curl-VERIFIED sparse pages (each <=4 prose paragraphs): r07-2-4-6, r07-2-4-7, r07-3-1-3, r07-3-2-3, r07-3-3-1, r07-3-4-1, r07-3-4-3, r07-3-4-4, r07-3-4-6, r07-3-4-7, r07-3-4-8, r07-3-5-6, r07-3-6-1, r07-3-6-9. Prefix proven: the first 3768 corpus lines are byte-identical to HEAD, widening is append-only.
- Corpus: 5663 paragraphs (was 3768); in-band 200-1200 runes: 2035 (was 1330).
- Clears COVERAGE_FLOOR: N3 46 (was 33), N2 149 (was 103), N1 41 (was 29).
- Generator supply (bun run measure:reading-supply, no --count cap): N3 32 (was 25), N2 89 (was 71), N1 27 (was 22).
- AC#5 evidence: all six store/rejection files byte-identical (git diff empty); check:reading-chuubun green 25/71/22 rows at the three levels; ultracite + tsc clean on the changed scripts.
DECISION: SHIP. Supply grew at every level and the shipped stores now sit BELOW their measured ceiling for the first time (+7 N3 / +18 N2 / +5 N1 potential rows). Follow-up (NOT created, needs user approval): regenerate the three 中文 stores at the new counts and run the both-family blind judge on the appended rows only, freezing verdicts into {level}-chuubun-rejected.json. Doc pass done: LICENSE 13 (corpus/stats/supply narrative/Regenerating), packages/japanese/AGENTS.md (corpus, store, fetch:hakusho retry, measure:reading-supply, Verification), fetch-hakusho.ts header + PAGES comment.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Measured the 令和7年版 widening before touching any store. Pinned 79 r07 pages (93 candidates minus 14 curl-VERIFIED sparse pages) into fetch-hakusho.ts behind the untouched 171-page prefix, fixing a real burst-throttle bug: env.go.jp answers bursts with HTTP 200 near-empty pages the decode guard refused as mojibake, so the fetcher now retries 4x with backoff in batches of 4. Regenerated hakusho.jsonl (3768 -> 5663 paragraphs; first 3768 lines byte-identical, append-only proven by diff). New deterministic probe measure:reading-supply.ts (wired as measure:reading-supply) was validated on the old corpus (reproduced 1330 / 33-103-29 / 25-71-22 exactly) then measured the widened one: in-band 2035, clears 46/149/41, generator supply 32/89/27. DECISION: SHIP - the stores sit below their ceiling for the first time (+7/+18/+5 potential rows); regeneration + both-family blind-judge follow-up named in notes, NOT created pending user approval. Evidence: check:reading-chuubun green 25/71/22 at all three levels; store/rejection files byte-identical (AC#5); ultracite + tsc clean; mutation-gate anchors resolve; doc pass done (LICENSE §13, package AGENTS.md, script header). Commits a705e77 + 7c41bbd.
<!-- SECTION:FINAL_SUMMARY:END -->
