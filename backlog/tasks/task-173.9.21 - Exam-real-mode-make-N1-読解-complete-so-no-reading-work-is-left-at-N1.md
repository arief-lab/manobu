---
id: TASK-173.9.21
title: 'Exam (real mode): make N1 読解 complete, so no reading work is left at N1'
status: Done
assignee:
  - '@arif'
created_date: '2026-10-09 11:34'
updated_date: '2026-10-10 08:12'
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
ordinal: 974000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
N1 declares six 読解 大問 (packages/item-engine/src/paper.ts:501-506): 内容理解（短文）大問8 x4, 内容理解（中文）大問9 x9, 内容理解（長文）大問10 x4, 統合理解 大問11 x3, 主張理解（長文）大問12 x4, 情報検索 大問13 x2. Measured 2026-10-09: four of the six are the wrong skill. data/reading/n1.json (24 rows), n1-chuubun.json (27) and n1-choubun.json (8) are all masked-slot and every stem in all three is 「この文章の＿＿に入る語として、最も適切なものを一つ選びなさい。」, so the 大問 carrying the 長文 and the 中文 小問 print a vocabulary question. n1-tougou.json (7 rows) asks 「二つの文章の両方に挙げられているものはどれか。」 with single-word options. Only 大問12 (n1-chuushou.json, 10 authored-key rows) asks for 主張 but on one 284-rune paragraph, and 大問13 (n1-jouhou.json, 6 rows) is the right construction at 3 papers deep. N1 is where this repo has the most invested in the 白書 route: the 長文 store is the file CHOUBUN_COVERAGE_FLOOR = 0.85 was derived for, so converting it removes the only shipped masked-slot 長文 store and the floor guard has to survive on fixtures rather than on data. The owner instruction of 2026-10-09 (root AGENTS.md, User Preferences) is what makes that trade acceptable: 読解 counts as finished only when each 大問 trains its real ねらい with depth and no fallback row serves a level.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 16 authored 短文 rows replace the 24 masked-slot rows in data/reading/n1.json and 36 authored 中文 rows replace the 27 masked-slot rows in n1-chuubun.json, one row per 小問, each inside the passage band its own corpus module declares, one construction per store, at least CHOUBUN_MIN_INTENTS distinct ねらい per store, and every row carrying an evidence sentence printed verbatim in its own passage.
- [x] #2 16 authored 内容理解（長文）rows replace the 8 masked-slot rows in n1-choubun.json, in a multi-paragraph passage inside a band this level declares in CHOUBUN_AUTHORED_BAND (packages/japanese/scripts/reading-choubun-corpus.ts:128 currently holds only N3), at or above the register the official N1 長文 sample measures (doc-26) rather than the N3 500-700 window.
- [x] #3 The masked-slot 長文 proof stays falsifiable after that conversion: CHOUBUN_COVERAGE_FLOOR keeps its value and location, the masked-slot branch of the gate keeps a committed fixture row that exercises it, and check:reading-choubun --level N1 still refuses a row that breaks the corpus screens. The N1 store being authored must not silently delete the branch it was proved against.
- [x] #4 12 統合理解 rows replace the 7 shared-topic-pair rows in n1-tougou.json, asking 比較・統合 over two passages (the 同意点, the 相違点, a shared premise) with each distractor true in exactly one passage, and 16 主張理解（長文）rows replace the 10 in n1-chuushou.json over a multi-paragraph passage sized to the cap the server declares for claim-understanding.
- [x] #5 情報検索 grows from 6 rows to 8 through the pinned-snapshot PDL1.0 route of TASK-173.9.13, with sha256 recorded, licence stated and the 出典 plus 編集・加工 plus 取得日 obligations carried per row.
- [x] #6 Every N1 読解 block is at least four papers deep (短文 16, 中文 36, 長文 16, 統合 12, 主張 16, 情報検索 8), proved by a per-block depth assertion next to the row-identity assertion.
- [x] #7 Two blind judge passes cover every new batch with the answer key withheld, each judge quoting the row's own deciding sentence, verdicts frozen next to the store, CI never running a model, and the frozen record stating its own limit: both judges are the author model family, so agreement is correlated error.
- [x] #8 check:reading-tanbun --level N1, check:reading-chuubun --level N1, check:reading-chuushou --level N1, check:reading-choubun --level N1 and check:reading-tougou --level N1 are green on the new stores, every other level gate is byte-for-byte unchanged, and every store stays joined to check:reading-answers with no constant key position.
- [x] #9 Real mode serves with no fallback and the seam proves it: a row-identity assertion per block plus a scripts/mutation-gate.ts seam per converted N1 read whose baseline command is green on an unmuted tree, including the existing long-reading-store-read-wrong-level seam.
- [x] #10 Nothing is left open at N1: the holes test keeps its no-読解-hole claim and gains an assertion that no N1 読解 block is backed by a masked-slot or shared-topic-pair store, and packages/japanese/AGENTS.md plus data/LICENSE.md plus doc-27 stop describing any N1 読解 block as a 白書 window or topic lookup. The committed measurements (probe:n3-choubun, measure:reading-supply) stay as records and are labelled as history, not as the current route.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 N1 読解 trains its real ねらい at every 大問, no masked-slot row is servable at N1, and the level gate plus the holes assertions prove both from the blueprint rather than from a list this task wrote.
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Put N1 on the authored route BEFORE authoring any row: TANBUN_SOURCE.N1, CHUUBUN_SOURCE.N1, CHUSHOU_SOURCE.N1, TOUGOU_SOURCE.N1 = "authored", plus the level rows the gates read (TANBUN_AUTHORED_BAND.N1, CHOUBUN_AUTHORED_BAND.N1 at the official 1000字程度 register, CHUSHOU_AUTHORED_BAND.N1, TOUGOU_AUTHORED_BAND.N1; 中文 rides PASSAGE_BAND.authored unchanged) and the per-generator authored refusal (gen:reading-tanbun/chuubun/chuushou/tougou/choubun --level N1 exit 1) added before each unconditional writeFileSync.
2. Keep AC#3 honest: the masked-slot 長文 branch stays falsifiable with a committed fixture store + fixture corpus so check:reading-choubun --level N1 still refuses a broken windowed row after n1-choubun.json is authored, and CHOUBUN_COVERAGE_FLOOR keeps value and location.
3. Author the five N1 stores at four-paper depth: 短文 16 (n1.json), 中文 36 (n1-chuubun.json), 長文 16 (n1-choubun.json), 主張 16 (n1-chuushou.json), 統合 12 (n1-tougou.json), each single-construction, verbatim evidence, per-ねらい spread, key spread.
4. Grow 情報検索 6 to 8 through gen:reading-jouhou --level N1 on the pinned-snapshot PDL1.0 route of TASK-173.9.13 (sha256, licence, 出典/編集・加工/取得日 per row).
5. Certify: two blind key-withheld judge passes per batch, different procedures, extra round for replacements; freeze verdicts in {level}-{block}-rejected.json with the correlated-error limit stated.
6. Prove: check:reading-{tanbun,chuubun,chouubun/chuushou,choubun,tougou,answers,jouhou} per level with every other level unchanged; apps/server real-mode row-identity per block; exam-reading-holes no-hole claim plus a new no-masked-slot/no-shared-topic-pair-at-N1 assertion; one mutation seam per converted N1 read, green baseline.
7. Docs: packages/japanese/AGENTS.md, apps/server/AGENTS.md, data/LICENSE.md, doc-26 §4 rows, doc-27 §16; label probe:n3-choubun and measure:reading-supply as history.
<!-- SECTION:PLAN:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-10 08:09
---
TASK-173.9.21 complete: N1 短文/中文/長文/統合/主張 all authored at 4-paper depth (16/36/16/12/16), 情報検索 grown 6→8 on the pinned-snapshot route. All six N1 gates green at N1, 21-store answer audit clean, 162 mutation seams all caught, apps/server 461 tests green. Blind certification: 中文 certified end-to-end at 36 rows after n1m-4/n1m-24 burned, n1m-38 repaired (九千万円→千五百万円 against 四億円÷20年) and re-certified with two fresh passes + byte-identity carry proof for the two untouched rows. Correlated-error limit stated in the frozen records. Docs updated: packages/japanese/AGENTS.md, LICENSE.md §21, apps/server/AGENTS.md, doc-26 §4, doc-27 §16.
---
<!-- COMMENTS:END -->
