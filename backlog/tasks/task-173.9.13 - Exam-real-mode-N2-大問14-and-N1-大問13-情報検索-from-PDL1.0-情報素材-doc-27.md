---
id: TASK-173.9.13
title: 'Exam (real mode): N2 大問14 and N1 大問13 情報検索 from PDL1.0 情報素材 (doc-27)'
status: Done
assignee: []
created_date: '2026-10-08 03:15'
updated_date: '2026-10-08 09:30'
labels:
  - exam
  - content
dependencies: []
documentation:
  - doc-27
parent_task_id: TASK-173.9
priority: medium
type: feature
ordinal: 966000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-27 records the decision: every remaining 読解 hole is source-bound, not code-bound, and doc-26 §5 records the 2026-10-08 measurements behind it. The N2 大問14 and N1 大問13 (packages/item-engine/src/paper.ts:513 and :488, count 2 each) are named by apps/server/test/exam-reading-holes.test.ts:188 and :216 because the GENRE is missing, not the shape: the pinned official ねらい PDFs ask for 広告、パンフレット、情報誌、ビジネス文書などの情報素材（700字程度）while the shipped store (packages/japanese/data/reading/n5-jouhou.json, n4-jouhou.json, n3-jouhou.json) is 245-rune N5-band 案内・お知らせ tables stamped down to N3, which data/LICENSE.md §11 already states rather than hides. The 2026-10-08 extraction probe measured that pdftotext -bbox plus row and column clustering reconstructs exact fee and schedule tables for about 8 of 22 government PDFs, at roughly 5 to 8 downloads per usable 素材, with a 国民年金保険料 前納金額一覧 at 564 runes as the worked example. doc-27 verified the licensing on that family: PDL1.0 states 「数値データ、簡単な表・グラフ等は著作権による保護の対象ではありません」, so a fee or schedule table is an unprotected fact set, and 環境省's パンフレット一覧, 日本年金機構, 厚生労働省, 国税庁, 金融庁 and 出入国在留管理庁 all declare PDL1.0 or an equivalent 転載フリー rule. Ruled out on terms, so they are not to be re-probed: JNTO, 裁判所, municipal 広報 (verified CC BY-ND in 横浜市都筑区 and view-only in 渋谷区記録資料館), NHK learner news, Japan Foundation marugoto / Irodori / ひきだすにほんご, and BCCWJ. The official N1 情報素材 measures 89.1% coverage, so the genre is not hostile to the difficulty screen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/japanese/data/reading/n2-jouhou.json and n1-jouhou.json ship at least 4 rows each (2 小問 per 大問, deeper than one paper), every passage an 情報素材 of 600 to 800 runes whose table is reconstructed cell-exact from the upstream document.
- [x] #2 Every row carries the three PDL1.0 obligations doc-27 names: the 出典 credit with the exact page URL, a statement that this repo reformatted the table (編集・加工等を行ったこと, never presented as unprocessed government material), and an 取得日 stamp so dated figures such as the 令和8年 保険料 are attributable.
- [x] #3 The material is at the level's genre, 広告・パンフレット・情報誌・ビジネス文書, not a re-stamped N5 notice, and packages/japanese/data/LICENSE.md §11 keeps its refusal to widen by stamp while naming what now fills the 大問.
- [x] #4 The info-search branch (apps/server/src/services/exam-service.ts:604) prints the store's own 素材, and the existing info-search-falls-back-to-canned-passage mutation seam still kills any regression to LONG_READING_PASSAGE.
- [x] #5 apps/server/test/exam-reading-holes.test.ts:188 and :216 flip to not a hole with READING_STORE_FOR (apps/server/src/services/exam-service.ts:3306) extended, and the N5, N4 and N3 stores and their tests are unchanged.
- [x] #6 A deterministic check gate re-measures the band and the table integrity, answer readable from printed cells and no distractor readable from another document, runs no model, and blind-judge verdicts are frozen as data in the per-level -rejected.json pattern.
- [x] #7 data/LICENSE.md gains the new upstream with its license name, attribution string and 取得日 rule, the DOX pass updates the owning AGENTS.md files, and bun run check:dox plus bun x ultracite check are green.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Vendor the 情報素材: scripts/fetch-reading-jouhou.ts pins six ministry/agency artifacts (sha256 + 取得日) into data/reading/jouhou-upstream.jsonl; the only network step, never run in CI.
2. Compose the rows: scripts/gen-reading-jouhou.ts + scripts/reading-jouhou-corpus.ts render 3 素材 x 2 authored 小問 per level into data/reading/{n2,n1}-jouhou.json, stop the build on any authored unit the snapshot does not print, and spread the key across option positions.
3. Gate it deterministically, no model: scripts/check-reading-jouhou.ts re-proves per row (shape, 600-800 band, rendered units inside the snapshot, answer inside the key line with no distractor inside it, no distractor readable from another 素材, the three PDL1.0 obligations, judge-rejection record, structural validity) and file-level (>=4 rows, >=2 distinct 素材, unique ids/stems). Coverage floor deliberately absent, decidability screens in its place (doc-27 §5).
4. Blind-judge at freeze time and freeze the verdicts as data in {n2,n1}-jouhou-rejected.json.
5. Serve it: no server contract change; jouhouStoreFor finds the new files, infoSearchSourceFor prints row.passage and spends one 素材 per 小問, provenance/validated ride the candidate so composed+validated clears isRefused.
6. Flip the hole decision: READING_STORE_FOR['info-search'] = jouhouStoreFor, so blockHasRealSource no longer names 情報検索; add the info-search-store-not-consulted-for-holes seam.
7. Proofs: test/exam-info-search.test.ts composed describe + real N2/N1 papers + removed-file decline; test/exam-reading-holes.test.ts names none; exam-medium-reading.test.ts flipped from '大問14 is a hole' to the positive property.
8. Docs: LICENSE §11 refusal kept and §18 added, doc-26 §3.4/§3.5/§4, doc-27 §5/§8, and the AGENTS.md chain.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped 2026-10-08. Six composed PDL1.0 情報素材 rows per level in data/reading/{n2,n1}-jouhou.json (685-774 runes, inside the 600-800 band and JOUHOU_MAX_PASSAGE_LENGTH=800), from 国税庁 (印紙税額, 所得税の源泉徴収税額), 文部科学省 (就学支援金), 厚生労働省 (地域別最低賃金, 国民年金保険料の前納額) and 出入国在留管理庁 (在留資格); vendored snapshot at data/reading/jouhou-upstream.jsonl (agency/docUrl/fetchedAt/pageUrl/sha256/text/title). The server contract did not change: infoSearchSourceFor already read at the request's level, spent one 素材 per 小問 via catalog.usedJouhouPassages, and propagated provenance/validated, so composed rows clear the TASK-173.9.5 isRefused conjunction (exam-service.ts:2758-:2762). What did change is the hole decision: READING_STORE_FOR['info-search']=jouhouStoreFor (:3474) now answers at all five levels, so blockHasRealSource never names 情報検索; honest absence is reachable only by a missing/emptied file, proved via a MANOBU_DATA_DIR overlay and a new fifth seam info-search-store-not-consulted-for-holes.

Deviation from AC#6 as written, recorded in doc-27 5: this block ships NO coverage floor. The 情報素材 genre measures 89.1% under the difficulty instrument, so a floor would screen nothing that the decidability screens do not already prove (answer printed in the table; the answer inside the key line the stem names; no distractor in that key line; no distractor readable from a DIFFERENT shipped 素材). Those four are check-reading-jouhou.ts, deterministic and model-free. Judge verdicts are frozen as data in {n2,n1}-jouhou-rejected.json (12/12 PASS across two independent families, zero rejections) and were taken BEFORE the authored option-order spread, which is disclosed rather than hidden; both composed stores joined check:reading-answers (now 19 stores) which enforces 'no constant key position' (n2 and n1 mode 33%, licensed n5/n4/n3 25%).

Bug found and fixed while working (per standing instruction): apps/server/test/exam-medium-reading.test.ts still asserted N2 大問14 is a named 情報検索 hole, which 173.9.13 makes false. It now asserts the positive property instead (holes.has(14) is false, exactly 2 info-search 小問 land, each passage byte-equal to a jouhouStoreFor('N2') row and distinct per 小問) so the test fails loudly if the block silently reverts to the canned passage. Test renamed to 'names the 大問 it still cannot ask, and none of the 読解 大問 it can'. Second fix: JouhouStoreRow.provenance was pinned to the literal 'composed', which made the gate's own wrong-provenance rejection screen unrepresentable in check-reading-jouhou.test.ts:97 (TS2322); widened to 'composed' | 'licensed' with the reason in the comment, since that interface is the shape of a file on disk the gate must be able to reject. DOX pass: apps/server/AGENTS.md (new 173.9.13 bullet plus three corrections inside the 173.9.7 bullet), packages/item-engine/AGENTS.md (line 22 storeless-claim list and line 29 per-level fill), packages/japanese/AGENTS.md, data/LICENSE.md 18, doc-26 (5 replacements), doc-27 (5 shipped paragraph, 8 item 2 DONE). Verification: check-reading-jouhou N2/N1 'all 6 rows pass'; check-reading-answers 19 stores no constant key position; fetch:reading-jouhou offline run reproduced jouhou-upstream.jsonl byte-identically (sha256 f142ce5f); gen:reading-jouhou regeneration byte-identical both levels; japanese 213 pass; item-engine 73 pass; server 404 pass 0 fail 1 skip; check-types 14/14; check:dox green; ultracite check 642 files clean.

Mutation evidence: `bun scripts/mutation-gate.ts info-search` ran the five declared seams and all 5 were caught, including info-search-store-not-consulted-for-holes (its first execution). Each seam's baseline command is green before mutating, so the verdicts are trustworthy; `--check` afterwards resolves all 143 anchors and packages/db/src/item-store.ts carries no diff.

Correction to the note above: the no-coverage-floor decision is NOT a deviation from AC#6, which as written asks only for the deterministic band + table-integrity + answerable + no-cross-document-distractor gate, no model, and frozen judge verdicts. It is a deviation from the coverage-floor PATTERN the sibling reading blocks (長文/中文) use, recorded in doc-27 §5. Wording fixed here so the record does not overstate a gap.

Third bug, found during this finalization pass: bare `bun run check:reading-jouhou` defaulted to N2 only, so the one-shot CLI re-measured one of the two shipped stores while printing a whole-gate verdict (the test seam at test/check-reading-jouhou.test.ts:277 did cover both, so nothing was unproven in `bun test`, only in the operator-facing run). Fixed: with no --level the script now loops N1 and N2 and prefixes every issue with its level; --level still narrows to one. Verified: bare run prints 'N1: all 6 rows pass' and 'N2: all 6 rows pass' exit 0; --level N1 exit 0; --level N3 rejected exit 1. Docs follow: packages/japanese/AGENTS.md gate line and LICENSE 'Regenerating' block (two invocations collapsed into one).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
N2 大問14 and N1 大問13 情報検索 fill from composed PDL1.0 情報素材 instead of staying named holes. data/reading/{n2,n1}-jouhou.json ship 6 rows each (3 ministry 素材 × 2 authored 小問): 国税庁 印紙税額一覧表 and 所得税速算表 plus a 文部科学省 就学支援金 Q&A at N2, 厚生労働省 地域別最低賃金 全国一覧 and 国民年金 前納額 notice plus 出入国在留管理庁 在留資格 Q&A at N1, all re-sourced from the vendored sha256-pinned snapshot data/reading/jouhou-upstream.jsonl. The server contract is unchanged (infoSearchSourceFor already read at the request's level and rode provenance/validated, so composed+validated clears the 173.9.5 refusal); the hole decision changed, via READING_STORE_FOR['info-search']. Verification: `check:reading-jouhou` re-measures both stores offline with no model (band 685-774 / 739-749 inside 600-800, every rendered unit inside the snapshot, answer inside the key line with no distractor inside it, no distractor readable from another 素材, the three PDL1.0 obligations, judge-rejection record, structural validity) - 'N1 and N2: all 6 rows pass'; blind-judge verdicts frozen in {n2,n1}-jouhou-rejected.json (2 families × 6 PASS per level, 0 ambiguous, 0 unanswerable, no burned rows); `bun scripts/mutation-gate.ts info-search` = all 5 seams caught incl. the new info-search-store-not-consulted-for-holes; server 30 pass / 0 fail across exam-info-search + exam-reading-holes + exam-medium-reading; item-engine 73 pass; japanese jouhou tests 24 pass and its check-types clean; check:reading-answers 19 stores with no constant key position; check:dox complete; ultracite check 642 files clean. Bugs fixed in passing: the stale 大問14-is-a-hole assertion in exam-medium-reading.test.ts, JouhouStoreRow.provenance pinned too narrow to represent the gate's own rejection, and the gate CLI defaulting to N2 only. Docs: apps/server, packages/item-engine and packages/japanese AGENTS.md, LICENSE §11 (refusal kept) + §18 (new), doc-26 §3.4/§3.5/§4, doc-27 §5/§8.
<!-- SECTION:FINAL_SUMMARY:END -->
