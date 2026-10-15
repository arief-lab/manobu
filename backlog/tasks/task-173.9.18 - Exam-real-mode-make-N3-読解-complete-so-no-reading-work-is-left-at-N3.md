---
id: TASK-173.9.18
title: 'Exam (real mode): make N3 読解 complete, so no reading work is left at N3'
status: Done
assignee: []
created_date: '2026-10-09 11:25'
updated_date: '2026-10-09 16:00'
labels:
  - exam
  - content
dependencies:
  - TASK-173.9.17
documentation:
  - doc-27
parent_task_id: TASK-173.9
priority: medium
type: feature
ordinal: 971000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner instruction 2026-10-09 (root AGENTS.md User Preferences): 読解 must be finished at EVERY level, and finished means the block trains its real ねらい AND has depth, so a shipped store alone does not close a level. N3 declares four 読解 大問 (packages/item-engine/src/paper.ts:559-562): 短文 大問4 x4, 中文 大問5 x6, 内容理解（長文）大問6 x4 and 情報検索 大問7 x2. Two of the four are the wrong skill and one is the wrong difficulty, so this task closes all four. 大問4 and 大問5 are masked-slot 白書 rows (data/reading/n3.json, data/reading/n3-chuubun.json): blanking one noun in a paragraph trains vocabulary-in-context under a comprehension heading, which is what doc-27 §10 refuses to keep serving. 大問7 is the N5 情報検索 set re-stamped to N3, and LICENSE §11 already calls that a delivery decision rather than a difficulty claim, so N3 needs its own level-appropriate 素材. 大問6 ships 8 authored rows from TASK-173.9.16, which is only two papers deep, and with the no-fallback policy of TASK-173.9.17 depth is load-bearing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 16 authored 短文 rows ship in data/reading/n3.json and 24 authored 中文 rows ship in data/reading/n3-chuubun.json, one row per 小問, sized to each block's own band (短文 inside the server cap the 短文 family already declares, 中文 inside its 200-1200 band), each store carrying ONE construction, at least CHOUBUN_MIN_INTENTS distinct ねらい across its stems, and an evidence sentence printed verbatim in its own passage.
- [x] #2 8 情報検索 rows ship in data/reading/n3-jouhou.json over four N3-level 書き下ろし 素材 (564, 615, 629 and 649 runes, two 小問 per 素材) under the authored-table construction, provenance composed, signed authored:agent-blind-judged, sized inside JOUHOU_AUTHORED_BAND.N3, and paying the lookup contract (the answer inside the key line the stem names, no distractor inside that key, no distractor readable from a different 素材). The pinned-snapshot + sha256 + PDL route that TASK-173.9.13 opened at N2/N1 is SUPERSEDED here, because a written-down 素材 has no artifact to pin: packages/japanese/scripts/reading-jouhou-corpus.ts:554 refuses sourceIds and :563 refuses any 出典/編集・加工/取得日/licence field on an authored row, and the snapshot screens run only on the non-authored branch at packages/japanese/scripts/check-reading-jouhou.ts:202-214. The N5-origin rows move out of the served N3 file.
- [x] #3 大問6 grows from 8 rows to 16, so the block is four papers deep, and every other 読解 block at N3 is at least four papers deep (短文 16, 中文 24, 情報検索 8).
- [x] #4 Two blind judge passes per new batch, keys withheld, each judge quoting the row's own deciding sentence, verdicts frozen next to the store. CI never runs a model, and the record states its own limit: both judges are the author's model family.
- [x] #5 check:reading-tanbun --level N3 and check:reading-chuubun --level N3 run the shared authored screens green, every other level's gate is byte-for-byte unchanged, and both stores stay joined to check:reading-answers with no constant key position.
- [x] #6 Real mode serves the new rows with no fallback: a row-identity assertion per block proves the served anchor is a row of the requested level's own file, and the 長文 picker mutation seam pattern is extended to the 短文 and 中文 level reads in scripts/mutation-gate.ts.
- [x] #7 Nothing is left open at N3: apps/server/test/exam-reading-holes.test.ts keeps its no-読解-hole claim, a new assertion states that every N3 読解 block is backed by an authored or licensed real-ねらい store and not a masked-slot one, and packages/japanese/AGENTS.md plus data/LICENSE.md plus doc-27 stop describing N3 短文/中文 as 白書 windows or N3 情報検索 as N5 material.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 N3 読解 trains its real ねらい at all four 大問, no masked-slot row is servable at N3, and the level gate plus the holes assertions prove both from the blueprint rather than from a hand-written list.
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification 2026-10-09, all from disk: check:reading-tanbun/chuubun/choubun/jouhou N3 = 16/24/16/8 rows pass; check:reading-n4 24 rows; chuushou N2 9; tougou N2 16; answers audits 21 stores with no constant key position. Same four gates re-run at N5/N4/N2/N1 give the levels each gate already owns unchanged (N2 24/88, N1 24/27/8, and the N4/N5 短文・中文 stores are owned by check:reading-n4, which passes). bun test packages/japanese 264 pass / 0 fail; bun test apps/server 448 pass / 1 skip / 0 fail; bunx tsc --noEmit in packages/japanese exit 0; bun scripts/mutation-gate.ts --check = all 148 seam anchors resolve; bun run check:dox clean; fallow dead-code --boundary-violations = 0 issues.

AC#2 was rewritten before checking: the task was opened assuming the TASK-173.9.13 pinned-snapshot + PDL route, but a 書き下ろし 素材 has no fetched artifact to pin, so that route cannot serve N3. What shipped is the authored-table construction, and the gate makes the substitution non-quiet: reading-jouhou-corpus.ts:554 pushes authored-row-cites-a-document for any sourceIds and :563 pushes authored-row-claims-an-attribution for any sourceCredit/editedCredit/sourceUrl/acquiredAt/license field, while the snapshot and obligation screens run only on the non-authored branch (check-reading-jouhou.ts:202-214). So an N3 row cannot claim a licence it does not have, which is the property AC#2 was reaching for.

AC#5 read "every other level's gate is byte-for-byte unchanged". The stores at N5/N4/N2/N1 are byte-for-byte unchanged (git status touches only the four n3* files plus their -rejected records). The two checker scripts WERE changed this task, but only structurally: the masked-row and store-context blocks were extracted into maskedRowIssues/storeContextFor/repeatIssuesFor to clear the ultracite cognitive-complexity errors that block .husky/pre-commit, so the pre-commit hook could run. Verdicts at every level are identical before and after, proven by re-running the gates at every level.

Two mutation-gate anchors were stale after that extraction and were rewritten to span the whole property rather than one defense: chuubun-any-signer-accepted now anchors the full isAuthored/AUTHORED_SIGNER/CHUUBUN_SIGNER chain, and chuubun-construction-not-from-level-corpus now anchors the whole constructionForLevel function. Both re-verified as CAUGHT by an individual run, not just anchor resolution. fallow audit --base main still exits 1 on this branch (54 complexity findings, 50 clone groups), inherited from the five near-identical check-reading-*.ts gates that branch already carries; not introduced by this task and not fixed here.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
N3 読解 now trains its real ねらい at all four 大問 and nothing at N3 is a masked-slot or a re-stamped other-level store. What shipped: 16 authored 短文 (data/reading/n3.json, 122-142 runes, 13 distinct ねらい stems), 24 authored 中文 (n3-chuubun.json, 285-409 runes, 17 stems), 大問6 grown from 8 to 16 authored 長文 (n3-choubun.json, 514-658 runes, 4-6 paragraphs), and 8 情報検索 rows (n3-jouhou.json) over four written-down N3 素材 of 564-649 runes replacing the N5 set re-stamped to N3. All four carry the authored construction only, never mixed with a corpus construction, and the two blind judge passes with the keys withheld returned zero rejections (the verdict files sit next to each store), with the correlated-error limit stated because both judges are qoder/general-purpose. Verified by: the eight check:reading-* gates green (N3 16/24/16/8), check:reading-answers auditing 21 stores with no constant key position, apps/server 448 tests green including exam-reading-holes.test.ts backing every 大問 the N3 blueprint prints and exam-reading-no-fallback.test.ts proving a row never serves at a level other than its own, packages/japanese 264 tests green, mutation-gate --check resolving all 148 anchors with the two rewritten chuubun seams confirmed caught, bunx tsc --noEmit and check:dox clean, fallow boundary violations 0. Docs brought in line: packages/japanese/AGENTS.md, data/LICENSE.md §16/§20, doc-26 §4/§6 and a new doc-27 §13 recording the shipped N3 route and the risk it accepts. N4, N2 and N1 still have 読解 gaps and stay owned by TASK-173.9.19/.20/.21, with .22 as the closeout.
<!-- SECTION:FINAL_SUMMARY:END -->
