---
id: TASK-173.9.19
title: 'Exam (real mode): make N4 読解 complete, so no reading work is left at N4'
status: Done
assignee: []
created_date: '2026-10-09 11:26'
updated_date: '2026-10-09 18:57'
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
ordinal: 972000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
N4 declares three 読解 大問 (packages/item-engine/src/paper.ts): 短文 大問4 x4, 中文 大問5 x4 and 情報検索 大問6 x2, and all three are the wrong skill or the wrong difficulty. 大問4 is masked-slot over Tatoeba sentences (data/reading/n4.json, TASK-173.9.6) and 大問5 is masked-slot over a stitched document (data/reading/n4-chuubun.json, TASK-173.9.15); LICENSE §19 already concedes the stitch is not a narrative and that the deciding evidence is one sentence's case frame, so both are slot recovery under a comprehension heading. 大問6 is the N5 情報検索 set re-stamped (LICENSE §11). The 白書 cannot back N4 at all: measure:reading-supply prints in-band 2035, clears floor 0, so there is no corpus route to preserve here and the authored route is the only one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 16 authored 短文 rows ship in data/reading/n4.json and 16 authored 中文 rows ship in data/reading/n4-chuubun.json, one row per 小問, inside each block's own band, one construction per store, at least CHOUBUN_MIN_INTENTS distinct ねらい per store, each with a verbatim evidence sentence.
- [x] #2 8 情報検索 rows ship over N4-level 素材 through the pinned-snapshot route of TASK-173.9.13, replacing the N5 re-stamp, with the licence and the 出典 / 編集・加工 / 取得日 obligations carried per row.
- [x] #3 Every N4 読解 block is at least four papers deep, two blind judge passes cover each new batch with keys withheld and verdicts frozen, and CI never runs a model.
- [x] #4 check:reading-n4 and check:reading-chuubun --level N4 run the shared authored screens green with the other levels byte-identical, both stores stay in check:reading-answers with no constant key position, and the picker mutation seams extend to the N4 reads with a row-identity assertion per block.
- [x] #5 Nothing is left open at N4: the holes test keeps its no-読解-hole claim, a new assertion states that no N4 読解 block is backed by a masked-slot store, and packages/japanese/AGENTS.md plus LICENSE §11/§12/§19 stop describing N4 rows as masked slots or N5 material.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 N4 読解 trains its real ねらい at all three 大問, no masked-slot or stitched row is servable at N4, and the level gate plus the holes assertions prove both from the blueprint rather than from a hand-written list.
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#2 mechanism deviation, recorded deliberately: the criterion names the pinned-snapshot route of TASK-173.9.13 with 出典 / 編集・加工 / 取得日 per row. What shipped is the AUTHORED route (8 小問 over four 書き下ろし 素材, JOUHOU_AUTHORED_BAND N4 340-470), because the owner instruction of 2026-10-09 says never fall back to a borrowed or re-stamped store at a level that can be authored. The substance the criterion asked for is met (N4-level 素材, the N5 re-stamp gone, 4 papers deep); the licence obligations are inapplicable rather than skipped, since an authored 素材 has no upstream document to attribute. data/LICENSE.md records that per file.

Verification, all on the final tree: bun x ultracite check apps packages scripts clean (638 files, exit 0); tsc --noEmit OK for packages/japanese, packages/item-engine, apps/server; apps/server 450 pass / 1 skip / 0 fail; packages/japanese 264 pass / 0 fail; all eight check:reading-* gates GREEN (tanbun, chuubun, jouhou, answers, n4, choubun, chuushou, tougou); item-engine 73 pass; bun run check:dox green; fallow dead-code --boundary-violations 0 issues.

Route refusals proven by execution, not recall: gen:reading-n4 exits 1 with 'N4 is composed as authored rows; write the store and freeze its judge record instead of generating'; gen:reading-chuubun --level N4 exits 1 with the doc-27 section 10 message; gen:reading-jouhou --level N4 exits 1 in parseLevel before any write ('--level must be N1 or N2: ... N3 大問7 and N4 大問6 compose authored 書き下ろし 素材'). git status --porcelain data/reading after the three runs showed only this task's files, so no store was clobbered.

Mutation gate: bun scripts/mutation-gate.ts --check resolves all 152 anchors. This task added four seams (jouhou-authored-band-falls-back, jouhou-depth-not-per-level, authored-band-not-fail-closed, mixed-constructions-accepted) and each is CAUGHT when run for real. check-reading-n4.ts was refactored for two cognitive-complexity findings (signer dispatch and the cross-row dedupe loop extracted), and all eight seams anchored in that file were re-run and caught. One caveat for TASK-173.9.22: two full 152-seam runs disagree (one reported 8 survivors, the next 0 survivors plus 4 UNTRUSTWORTHY exam-host-tool seams whose baseline command is green standalone in 14.6s), so the full run looks contention-sensitive and its verdicts need re-reading per seam before anyone acts on them.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
N4 読解 is authored at all three of its 大問: 16 短文 rows replace the Tatoeba masked-slot store (n4.json), 16 中文 rows replace the 中文 stitch (n4-chuubun.json, 251-321 runes over 3 paragraphs, 13 stems, keys 4/4/4/4, evidence 28-53 runes), and 8 情報検索 小問 replace the N5 re-stamp over four 書き下ろし 素材 inside JOUHOU_AUTHORED_BAND.N4 (340-470 runes). Certification: two blind AI judge passes per batch with the key withheld, verdicts frozen in the four -rejected.json records (one burned id, n4c-4, replaced by n4c-17); both passes are the author model family, so agreement is correlated error and the record says so. The three routes back are now irreversible: CHUUBUN_SOURCE, TANBUN_AUTHORED_BAND, JOUHOU_AUTHORED_BAND and the gen:* refusals each exit 1 rather than re-stamp. Proven by apps/server real-mode row-identity assertions per block (450 pass), the holes test keeping its no-読解-hole claim with a new assertion that no N4 block is masked-slot, all eight check:reading-* gates green, mutation-gate anchors resolving and every seam added here caught, and ultracite/tsc/check:dox/fallow boundaries clean. Docs updated: doc-26 (anchor corrections plus the three 大問 rows), doc-27 (new section 14 on what .19 actually shipped), packages/japanese/AGENTS.md, apps/server/AGENTS.md, LICENSE.md and the stale comments in exam-reading-holes.test.ts. Reading is not finished overall: N2 (.20) and N1 (.21) still train the wrong skill, and .22 is the closeout.
<!-- SECTION:FINAL_SUMMARY:END -->
