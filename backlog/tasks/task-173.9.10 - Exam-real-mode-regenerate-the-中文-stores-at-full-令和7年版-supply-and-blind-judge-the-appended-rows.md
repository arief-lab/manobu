---
id: TASK-173.9.10
title: >-
  Exam (real mode): regenerate the 中文 stores at full 令和7年版 supply and
  blind-judge the appended rows
status: Done
assignee: []
created_date: '2026-10-07 09:13'
updated_date: '2026-10-07 10:15'
labels: []
dependencies: []
parent_task_id: TASK-173.9
ordinal: 962000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-173.9.9 measured the generator supply at 32/89/27 over the widened 250-page corpus, while the shipped stores are frozen at 25/71/22: the first widening since launch where the stores sit BELOW their ceiling (+7 N3 / +18 N2 / +5 N1 potential rows). Regenerate the three 中文 stores at the new supply counts, run the both-family freeze-time blind judge (opencode/big-pickle + opencode/space-bunny-free, key withheld, prompts/reading-validator.md) over every appended row, freeze verdicts into {level}-chuubun-rejected.json, and replace any rejected row by regeneration + judging its replacement until every shipped row carries both PASS verdicts. The existing 25/71/22 rows stay a byte-identical prefix. No floor loosening: the emitted count is the eligible supply, not a --count promise.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The regenerated stores carry the frozen 25/71/22 rows as a byte-identical prefix and grow to the emitted supply at counts 32/89/27
- [x] #2 Every appended (and replacement) row is judged blind by BOTH families with the key withheld, and the verdicts are frozen as data in {level}-chuubun-rejected.json; a row rejected by either family is replaced by regeneration and its replacement judged before it enters the store
- [x] #3 check:reading-chuubun green at N3/N2/N1 over the final stores, check:reading-answers green, and a re-run of gen:reading-chuubun is byte-identical
- [x] #4 LICENSE §13 and packages/japanese/AGENTS.md reflect the new store depths (papers per level) and this judge pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Snapshot the frozen stores; regenerate each level at counts 32/89/27; prove the first 25/71/22 rows are byte-identical and list the appended row ids per level.
2. Write per-row judge item files INSIDE the repo (passage + stem + options, key withheld) in the format used by prompts/reading-validator.md.
3. Run both families (opencode/big-pickle, opencode/space-bunny-free) over every appended row; record verdicts.
4. Freeze rejections (either family) into data/reading/{level}-chuubun-rejected.json; regenerate so rejected rows are replaced by deeper corpus walk; judge the replacements; repeat until every shipped row has both PASS verdicts.
5. Verify: re-run gen byte-identical; check:reading-chuubun green N3/N2/N1; check:reading-answers green; check-types; ultracite.
6. Doc pass: LICENSE §13 new counts/depth + judge-pass result, packages/japanese/AGENTS.md store bullets; then commit feat(readings) + docs(backlog).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Regeneration found and fixed a real generator gap: the r07 paragraph r07-1-1-4-17 prints 一つ in the slot the generator picked, and the FIXED 中文 stem also prints 一つ, so the emitted row failed the gate structural:stem-leak (item-engine treats the stem as leak evidence for reading items; the generator ran that screen only in the gate, not in buildEntry). Fix: buildEntry now skips a slot whose surface occurs in CHUUBUN_STEM - it only skips rows the gate would refuse, so the frozen 25/71/22 prefix is provably unaffected (re-verified: all three stores byte-identical at head). Supply unchanged: 32/89/27 emitted, gates green at all three levels. gen tests 6/6. Appended rows for judging: 7 N3 + 18 N2 + 5 N1 = 30 (ids in /tmp/added-*.txt).

BLIND-JUDGE PASS (both families, 30 appended rows, keys withheld in .key sidecars): 58/60 verdicts agreed with the shipped key. n2c-r07-1-2-1-5 rejected by BOTH families: big-pickle AMBIGUOUS (slot 「＿＿の2030年」 defends 勝負 and ゴール), space-bunny-free PASS-but-keyed-4 vs shipped key 1 - the same both-disagree shape as n1c-r05-1-3-1-7 in the 173.9.8 pass. Verdicts frozen as 2 entries per family into {level}-chuubun-rejected.json (N3 7/7 both PASS, N1 5/5 both PASS, N2 18 judged / 1 rejected). First judge attempt failed twice operationally: concurrent opencode loops hit a SQLite "database is locked" and the child ate the while-read stdin - rerun serial with </dev/null and a verdict-present resume rule. Regeneration after the N2 rejection: supply exhausted, no replacement exists, N2 emits 88 (NOT 89) - final shipped 32/88/27, prefix still byte-identical (md5-verified across a third regeneration run). Mutation gate: new seam chuubun-stem-leak-slot-skipped added (anchor resolves, all 127 OK); the generator test is proven non-vacuous by hand-mutating the screen away (6 pass 1 fail). LICENSE screen-admits re-measured on the 250-page corpus: N2 2347/2403 (97.7%), N1 975/991 (99.1%). Doc pass complete: LICENSE 13 store counts + regeneration narrative + judge result, AGENTS.md store/gen bullets + Verification counts.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Refilled the 中文 stores against the 令和7年版 supply: regenerated at 32/89/27, blind-judged all 30 appended rows with both families (big-pickle + space-bunny-free, key withheld), froze the verdicts into the three {level}-chuubun-rejected.json files. One N2 row rejected by BOTH families (n2c-r07-1-2-1-5: 「＿＿の2030年」 defends both 勝負 and ゴール; the second family keyed it 4 against the shipped 1) and its replacement does not exist (post-rejection supply is 88), so the stores shipped at 32/88/27 - N3 5.3 of 6 小問, N2 9.8 of 9, N1 3.0 of 9 - with the frozen 25/71/22 prefix proven byte-identical. The regeneration also caught a generator/gate gap: the fixed stem prints 一つ so a 一つ slot is an answer inside the question (structural:stem-leak); buildEntry now skips such slots, pinned by a non-vacuous test (hand-mutation: screen removed -> 1 fail) and by a new mutation-gate seam chuubun-stem-leak-slot-skipped (all 127 anchors resolve). Evidence: check:reading-chuubun green 32/88/27; check:reading-answers green; third regeneration byte-identical (md5 -c); bun test 86/86; ultracite + tsc clean; check:dox complete; LICENSE §13 numbers re-measured (screen admits N2 2347/2403, N1 975/991).
<!-- SECTION:FINAL_SUMMARY:END -->
