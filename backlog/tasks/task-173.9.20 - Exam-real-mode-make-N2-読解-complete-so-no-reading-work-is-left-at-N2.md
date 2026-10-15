---
id: TASK-173.9.20
title: 'Exam (real mode): make N2 読解 complete, so no reading work is left at N2'
status: Done
assignee: []
created_date: '2026-10-09 11:33'
updated_date: '2026-10-10 00:18'
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
ordinal: 973000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
N2 declares five 読解 大問 (packages/item-engine/src/paper.ts:527-531): 内容理解（短文）大問10 x5, 内容理解（中文）大問11 x9, 統合理解 大問12 x2, 主張理解（長文）大問13 x3, 情報検索 大問14 x2. Measured against the shipped stores on 2026-10-09: 大問10 and 大問11 are masked-slot 白書 rows (data/reading/n2.json 24 rows, n2-chuubun.json 88 rows) and every stem in both files is 「この文章の＿＿に入る語として、最も適切なものを一つ選びなさい。」, so the two blocks carrying the most 小問 in the whole section print one vocabulary question. 大問12 is the shared-topic-pair store (n2-tougou.json 16 rows) whose stem is 「二つの文章の両方に挙げられているものはどれか。」 with single-word options, which is lookup rather than 比較・統合. Only 大問13 asks the real thing (「この文章で筆者が最も主張していることはどれか」, authored-key over a licensed 白書 paragraph) but on one 284-521 rune paragraph under a 長文 heading. 大問14 is the right construction at 3 papers deep. The owner instruction of 2026-10-09 (root AGENTS.md, User Preferences) makes a shipped store insufficient: a level is finished only when each 大問 trains its real ねらい and has depth, with no fallback to a masked-slot row. N2 holds the deepest store in the repo at 88 中文 rows and it is still the wrong skill, so this task converts rather than grows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 20 authored 短文 rows replace the 24 masked-slot rows in data/reading/n2.json and 36 authored 中文 rows replace the 88 masked-slot rows in n2-chuubun.json, one row per 小問, each inside the passage band its own corpus module declares, one construction per store, at least CHOUBUN_MIN_INTENTS distinct ねらい across each store, and every row carrying an evidence sentence printed verbatim in its own passage.
- [x] #2 12 主張理解（長文）rows ship in n2-chuushou.json over a multi-paragraph passage long enough to carry one argument, sized to the cap the server declares for the claim-understanding item type in apps/server/src/services/exam-service.ts (read before writing, not copied from the 中文 band), replacing the current single-paragraph shape. Each distractor fails for a stated recoverable reason: reversed stance, detail-as-claim, or an invented counter-position.
- [x] #3 8 統合理解 rows ship in n2-tougou.json asking 比較・統合 over two passages (the 同意点, the 相違点, or a shared premise), replacing the single-word both-mention lookup, with each distractor true in exactly one of the two passages.
- [x] #4 情報検索 grows from 6 rows to 8 through the pinned-snapshot PDL1.0 route of TASK-173.9.13: sha256 recorded, licence stated, and the 出典 plus 編集・加工 plus 取得日 obligations carried per row.
- [x] #5 Every N2 読解 block is at least four papers deep (短文 20, 中文 36, 統合 8, 主張 12, 情報検索 8), proved by a per-block depth assertion next to the row-identity assertion rather than by a count written in this task.
- [x] #6 Two blind judge passes cover every new batch with the answer key withheld, each judge quoting the row's own deciding sentence, verdicts frozen next to the store, CI never running a model, and the frozen record stating its own limit: both judges are the author model family, so agreement is correlated error.
- [x] #7 check:reading-tanbun --level N2, check:reading-chuubun --level N2, check:reading-chuushou --level N2 and check:reading-tougou --level N2 run the shared authored screens green, every other level gate is byte-for-byte unchanged, and all four stores stay joined to check:reading-answers with no constant key position.
- [x] #8 Real mode serves the new rows with no fallback and the seam proves it: a row-identity assertion per block, plus a scripts/mutation-gate.ts seam per converted N2 read whose baseline command is green on an unmuted tree.
- [x] #9 Nothing is left open at N2: apps/server/test/exam-reading-holes.test.ts keeps its no-読解-hole claim and gains an assertion that no N2 読解 block is backed by a masked-slot or shared-topic-pair store, and packages/japanese/AGENTS.md plus data/LICENSE.md plus doc-27 stop describing N2 短文/中文 as 白書 windows or N2 統合理解 as topic lookup.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 N2 読解 trains its real ねらい at every 大問, no masked-slot row is servable at N2, and the level enumeration test proves both from the blueprint rather than from a hand-written list.
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Routes and refusal guards first, proven by execution before any store is touched: TANBUN_AUTHORED_BAND.N2 plus HAKUSHO_TANBUN_LEVELS losing N2; CHUUBUN_SOURCE.N2 = authored; new CHUUSHOU_AUTHORED_BAND / TOUGOU_AUTHORED_BAND plus the authored stems and the distractor-reason enum; gen-reading-chuushou and gen-reading-tougou gain the authored refusal BEFORE their unconditional writeFileSync (gen-reading-chuushou.ts:298, gen-reading-tougou.ts:300). 2. Gate branches: check-reading-chuushou / check-reading-tougou dispatch authored rows to reading-authored-corpus (主張: one call over the multi-paragraph document; 統合: one call per document over passages[0] and passages[1], issues unioned) plus the pair screens TOUGOU_MIN/MAX_TOTAL_LENGTH and the new decidable claim screen (key printed by NEITHER document, each distractor printed by EXACTLY ONE). 3. Author the stores: 20 短文, 36 中文, 12 主張 (700-1200 runes over >=4 paragraphs, sized to MEDIUM_READING_MAX_PASSAGE_LENGTH at apps/server/src/services/exam-service.ts:162), 8 統合 pairs. 4. Grow 情報検索 6 to 8 through the pinned-snapshot PDL1.0 route (a fourth vendored 素材 with sha256, 取得日, 出典, 編集・加工). 5. Two blind judge passes per batch with keys withheld, verdicts frozen next to each store, correlated-error limit stated in each record. 6. Tests: update the ~13 files that pin an N2 construction, add band/refusal/pair-claim tests, keep every other level byte-for-byte unchanged. 7. Real mode: row-identity assertion per block plus a mutation seam per converted N2 read with a green baseline. 8. Docs: packages/japanese/AGENTS.md, data/LICENSE.md, doc-26 §4 table rows and doc-27 §10-§12.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification, all on the final tree (commit 09d30e7): bun x ultracite check clean (654 files, exit 0; three -rejected.json files needed formatting after the judge records were appended); bun run check-types 14/14 tasks successful; apps/server 458 pass / 1 skip / 0 fail; packages/japanese 301 pass / 0 fail; check:reading-{tanbun,chuubun,choubun,chuushou,tougou,jouhou} GREEN plus check:reading-answers GREEN; bun run check:dox green; fallow dead-code --boundary-violations 0 issues; bun scripts/mutation-gate.ts --check resolves all 160 anchors. The eight seams this task added each ran for real against a green baseline and was CAUGHT (scripts/mutation-gate.ts): chuushou-level-route-claims-authored-always, chuushou-paragraph-floor-dropped, chuushou-distractor-reason-spread-dropped, tougou-level-route-claims-authored-always, tougou-authored-key-printed-in-one-document-allowed, tougou-authored-distractor-exactly-one-dropped, tougou-authored-intent-spread-dropped, jouhou-passage-verbatim-screen-dropped.

Route refusals proven by execution: gen:reading-tanbun --level N2, gen:reading-chuubun --level N2, gen:reading-chuushou --level N2 and gen:reading-tougou --level N2 each exit 1 before any write, so no regeneration can print masked rows over judged prose; gen:reading-jouhou --level N2 still WRITES the file, because 情報検索 is the one N2 大問 that stays on the licensed route on purpose.

Depth moved from a hand-written list to the blueprint: apps/server/test/exam-reading-holes.test.ts asserts block.indicativeCount * 4 rows per 読解 block for N2 (5), N3 (4) and N4 (3), plus that no N2 読解 block is backed by a masked-slot or shared-topic-pair store. Real mode asserts row identity per block, so a picker that always reads one level can no longer pass.

Two screens had to be block-local rather than shared, because those 大問 fix their stem: 主張理解 needs all three CHUSHOU_DISTRACTOR_REASONS classes across the store with detail-as-claim proving its option occurs verbatim (packages/japanese/scripts/reading-chuushou-corpus.ts), and 統合理解 inverts the lookup contract so the key is printed by NEITHER document and each distractor by EXACTLY ONE (packages/japanese/scripts/reading-tougou-corpus.ts, authoredPairClaimIssues).

Judge record honesty: the -rejected.json files keep the withdrawals as history. The hand-typed n2j-inshi-3/n2j-kyuugaku-3 were removed once gen-reading-jouhou.ts became the only writer of that file, and n2m-27 was rewritten by the author (its passage claimed 日数も変わらない and then reported a one-week delay) and re-certified in round B rather than burned, because nothing a judge refused is a burn. Burned ids are permanent: n2s-7/n2s-14/n2s-19 stay refused and the replacements ship as n2s-21/n2s-22/n2s-23.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
N2 読解 trains its real ねらい at four 大問 and stays on its licensed route at the fifth. 20 短文 (140-174 runes, 13 stems, keys 8/5/5/2), 36 中文 (250-319 runes over 3-5 paragraphs, 21 stems, keys 12/10/7/7), 12 主張理解 argument rows (700-753 runes over 5-6 paragraphs) and 8 統合理解 pairs (203-246 per document, 422-491 for the pair, 3 stems covering 一致/不一致/shared 前提) replaced the masked-slot 短文/中文 stores, the one-paragraph authored-key 主張 window and the shared-topic-pair lookup, all signed authored:agent-blind-judged with a verbatim evidence span. Every store is exactly four papers of its own 大問, derived from the blueprint in the holes test. 情報検索 grew 6 to 8 on the pinned-snapshot PDL1.0 route (the 工事請負契約書 table of the already-pinned 国税庁 No.7140 page), because a 素材 there is a document this repo may not write. Supply was never the reason for the conversion and the task records that: 149 floor-clearing 白書 paragraphs and 88 emitted 中文 rows, 9.8 papers, still trained slot recovery. Certification is two blind judge passes per batch with the key withheld, frozen beside each store; pass B refused n2s-7/n2s-14/n2s-19 (burned, replaced by n2s-21/n2s-22/n2s-23 and re-certified), and n2m-27 was rewritten by the author and re-certified rather than burned. Both passes are the author model family, so every record states that agreement is correlated error and there is no human leg. Proven by apps/server 458 pass with per-block row identity, packages/japanese 301 pass, six check:reading-* gates plus check:reading-answers green, the four gen:* refusals, eight new mutation seams each caught on a green baseline, and ultracite/tsc 14:14/check:dox/fallow boundaries clean. Docs: doc-26 §4 (five table rows), doc-27 (new §15), packages/japanese/AGENTS.md, apps/server/AGENTS.md, LICENSE.md §18/§20 and the stale headers of four exam test files. Reading is not finished overall: N1 (.21) still ships masked 白書 nouns at 短文/中文/長文 plus the authored-key 主張 and shared-topic 統合 stores, then .22 is the closeout.
<!-- SECTION:FINAL_SUMMARY:END -->
