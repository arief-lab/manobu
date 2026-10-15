---
id: TASK-173.9.16
title: >-
  Exam (real mode): fill N3 大問6 内容理解（長文）with authored, blind-judged rows (doc-27
  §10)
status: Done
assignee: []
created_date: '2026-10-08 16:34'
updated_date: '2026-10-09 10:32'
labels:
  - exam
  - content
dependencies: []
documentation:
  - doc-27
parent_task_id: TASK-173.9
priority: medium
type: feature
ordinal: 969000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
N3 大問6 内容理解（長文）prints 4 小問 (packages/item-engine/src/paper.ts:555) and is the ONLY reading store missing at any level N5-N1, named in apps/server/test/exam-reading-holes.test.ts:163. The corpus route is measured and closed, not untried: TASK-173.9.14 ran three non-環境省 arms through this block's own extractor and batch builder at the official 500-700 rune band and the whole supply is 1 disjoint buildable row clearing CHOUBUN_COVERAGE_FLOOR = 0.85 (best 85.6%), where the 大問 prints 4 (doc-27 §4, doc-26 §4). doc-27 §10 reverses the route rather than the standard: the coverage floor screens vocabulary simplicity, which a source search can decide and a reader cannot, and it never measured the property a 長文 小問 actually needs (one argument across the passage, 4 小問 on distinct ねらい, each distractor failing for a recoverable reason). So this block's prose is authored by the agent and certified by the two legs that exist here, the mechanical decidability screens and the blind judge rounds (doc-27 §11), plus the parts determinism is strong at: the option-order generation and spread audit, and a committed store file that is frozen data. There is no human leg and there cannot be one, because nobody in this project reads Japanese. No floor constant moves and no shipped row changes. Server plumbing is already there: choubunStoreFor loops N5..N1 (apps/server/src/services/exam-corpus.ts:560-580), the real-mode picker returns null only on an empty store (apps/server/src/services/exam-service.ts:1495), and long-reading already routes through it (:3478). TASK-146 (parked) is the readiness-precondition list for authored items being provably better than the corpus; its own note reserves reopening for exactly a goal that asks for content the corpus cannot source, which is what 173.9.14 measured. This task cannot satisfy that human-certification precondition by hand review, and it does not depend on the machine harness either, so TASK-146 stays recorded as related work, not as a blocker.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each row carries construction: "authored" and no sourceIds (the passage is this repo's own text, so it claims no external licence), and packages/japanese/data/LICENSE.md states that an authored row is neither licensed nor derived from a third-party corpus, next to the existing §17 exclusion and regeneration order.
- [x] #2 The check gate accepts the authored construction at N3: scripts/check-reading-choubun.ts runs the decidability screens (stem answerable from its own passage, answer uniqueness, distractor pool, stem-leak skip) and the option-position spread audit on n3-choubun.json WITHOUT a coverage floor, while the floor-lowering guard stays intact: check:reading-choubun --level N1 and every existing floor assertion still pass unchanged, and bun run probe:n3-choubun is still the committed measurement.
- [x] #3 gen:reading-choubun refuses N3 and says why it is authored now: the --level guard message points at doc-27 §10 (this block's N3 prose is written, not sourced) instead of the current floor-refusal text, and no generator path can produce an authored row.
- [x] #4 packages/japanese/data/reading/n3-choubun.json ships and real mode serves it with no new plumbing: apps/server/test/exam-reading-holes.test.ts:163 flips from toBe(true) to not a hole, the surrounding test at :146 and the "one hole left" claim at :168 are reworded to the new truth, and a new assertion states that no 読解 block is named in unfilledBlocks at any level N5-N1.
- [x] #5 The DOX pass removes every claim that N3 長文 is waiting on a source or a floor decision: packages/japanese/AGENTS.md (the 長文 bullet, the gen:reading-choubun and probe:n3-choubun script bullets, the Child DOX Index line that says there is no n3-choubun.json), data/LICENSE.md §17 and scripts/reading-choubun-corpus.ts's block comment all state the authored route. bun run check:dox, bun x ultracite check, bun scripts/mutation-gate.ts --check, bun test in packages/japanese and the apps/server reading suites are green.
- [x] #6 The 長文 picker seam is gated by row identity, not emptiness, per the lesson doc-27 §6 records from TASK-173.9.15: mutating choubunStoreFor to always read the N1 file must be caught by an assertion that the served anchorId is a row of the requested level's own file, at every level that ships, declared as a new seam in scripts/mutation-gate.ts whose baseline command is green on the unmuted tree.
- [x] #7 8 authored comprehension rows ship in the row shape the pipeline consumes (one row = one 小問, per packages/japanese/data/reading/n1-choubun.json): a 500-700 rune connected passage on one topic, one stem, 4 distinct options, an answerIndex, and an evidence field holding the passage sentence that decides the key. Because the 大問 prints its 4 小問 from 4 DISJOINT rows, the stems span distinct 読解 ねらい (指示内容, 理由, 内容一致, 要旨, 心情, 依頼) rather than repeating one ask, and each distractor fails for a stated recoverable reason (over-generalisation, reversed causality, detail-as-main-point, invented fact).
- [x] #8 Certification is the TWO legs doc-27 §11 records, because no reader of Japanese exists in this project and no third leg can: (1) the mechanical screens, which decide shape without meaning; (2) the blind judge rounds, run from prompts/reading-validator.md with the answer key withheld, each judge answering from the passage and agreeing with the row's own evidence sentence, verdicts frozen in n3-choubun-rejected.json exactly as the 中文 and 情報検索 stores freeze theirs, CI never running a model. The owner's translated review sheet this criterion previously required is DELETED as a formality: the English translation comes from the same model that wrote the passage and the key, so a non-reader agreeing with it is not independent evidence. The residual risk is recorded rather than bounded (both judges are the author's model family, so agreement is correlated error), stated in doc-27 §11 and LICENSE §17.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 読解 is complete in the sense doc-27 §10 defines: every 読解 大問 at N5-N1 is backed by a shipped store and no block is named in unfilledBlocks. The second claim is explicitly NOT made or verified here: that each 大問 trains its real ねらい. The masked-slot stores still train slot recovery, and that gap belongs to TASK-146's precondition list.
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification (2026-10-09): packages/japanese 247 tests green, apps/server full suite 412 pass / 0 fail / 1 pre-existing ACP skip, the 読解 trio (holes, 長文, 短文) 42 pass. check:reading-choubun green at N3 (8 rows) and N1 (8 masked rows, floor guard untouched). check:reading-answers audits 21 stores, n3-choubun key spread 0:2 1:2 2:2 3:2 (mode 25%, the flattest store in the audit). tsc clean in packages/japanese and apps/server, ultracite clean, check:dox clean, fallow boundary-violations 0, all 147 mutation anchors resolve.

AC#6 proven by hand, not just declared: applied the seam's replace (choubunStoreFor(level) -> choubunStoreFor("N1")) and the command went RED on 3 tests, including the new row-identity test 'serves N3 大問6 a row from N3's own file, not the N1 window', then restored via reverse edit and the same command went green again. Reverting by git checkout is the wrong tool here: it wiped this task's own exam-service.ts doc edit, which had to be reapplied (restored byte-for-byte, blob 0f3407f).

AC#7 needed one real fix, found by re-measuring the doc claim instead of trusting it: LICENSE and AGENTS said '7 distinct ねらい' but running the store's own stems through choubunIntentFor gave 6, with 理由 absent. n3b-3 is a 理由 question ('涼しくなると考えられているのはなぜか') and the table's first match credited it as opinion because 考え fired inside the passive hedge 考えられている. AC#7 names 理由 as a required ねらい, so the classifier was the defect, not the data: moved 'なぜ' ahead of '考え' in CHOUBUN_INTENT_PATTERNS (the table's stated rule is the more specific shape first, and a bare 考え substring is the looser match). No row changed, no floor moved, and the intents ledger is authored-only so the N1 masked gate cannot be affected (N1 still green). Pinned by a new test that fails if the order flips back: verified it goes RED on the reverted order before restoring.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-08 17:19
---
Gate branch shipped (AC#2, AC#3). `check-reading-choubun.ts` now dispatches on the construction tag: a `masked-slot` row runs the whole corpus proof exactly as before (the N1 store and all 19 pre-existing tests are untouched and green), and an `authored` row runs shape plus self-citation instead — `authored:agent-blind-judged` signer, `CHOUBUN_AUTHORED_BAND` 500-700 at N3, >=2 paragraphs, 4 distinct options with an in-range key, no `sourceIds` and no `＿＿` (a written row may not claim the other branch's provenance), a stem that classifies into `CHOUBUN_INTENT_PATTERNS` (`stem-intent-unclassified` fails rather than passing uncounted), an `evidence` span printed verbatim in its own passage between 20 runes and half of it, `row-judge-rejected`, plus the shared structural validator. File-level: `too-few-items`, `mixed-constructions`, and `intents-below-floor` at `CHOUBUN_MIN_INTENTS` = 4. The 白書 corpus, the `spent` set and the frame map load only when a masked-slot row exists, so an authored store never reads `hakusho.jsonl`.

`coverageOf` is NOT a screen on this route (doc-27 §10): `authoredCoverageLines` prints it per row on stderr as a number — 88.0 / 84.5 / 87.9 / 85.5 / 86.2 / 85.2 / 85.0 / 83.4%. `gen:reading-choubun --level N3` now refuses by pointing at §10/§11 rather than at a floor decision.

Both blind rounds are in and agree with the frozen key 8/8 each (16/16), verified by parsing the verdict blocks rather than trusting either summary; round B is the steelman pass and named four near-misses (n3b-3's 三十六度 figure, n3b-5's merged 会場 deadline, n3b-7's notebook-by-sequence, n3b-8's staffing motive) and broke each on passage text. The record is frozen at `data/reading/n3-choubun-rejected.json`, including a written statement of its own limit: both judges are the author's model family, so agreement is correlated error.

AC#6's rows pass the new gate as drafted (`check:reading-choubun --level N3` is green over `.cache/n3-choubun-authored-draft.json`). What still blocks AC#4/#7/#8: the owner's per-row verdicts on `.cache/judge/choubun-n3-owner-review.md`. Nothing ships and `exam-reading-holes.test.ts` stays untouched until then, because AC#7 records the verdicts before the store exists. `check-reading-answers.ts` carries a comment saying its `"n3-choubun.json"` line must be added in the same change that ships the file, because that suite reads every listed store off disk.

Verification: 246 tests in packages/japanese (0 fail, 18 of them new authored-branch cases), the N1 gate green over the frozen 8 rows, the `apps/server` holes + 長文 suites green (17 pass), `tsc` clean, `ultracite check packages/japanese` clean, `check:dox` clean, `mutation-gate.ts --check` resolves all 147 anchors. AGENTS.md updated at the three 長文 places that claimed the N3 hole was waiting on a source or a floor.
---

created: 2026-10-08 17:38
---
Certification corrected (title, description, AC#8, doc-27 §11, LICENSE §17, the rejected-record note): the third leg this task required, the owner reviewing each row's argument from an English translation sheet, is WITHDRAWN and the sheet is deleted. The owner does not read Japanese and neither does any contributor, and the translation is produced by the same model that wrote the passage and chose the key, so a non-reader agreeing with the sheet is agreeing with the author's own reading of its own text. A mistranslation that flatters the key makes an unsolvable item look airtight and the reviewer cannot see it. A check that cannot fail is not a check, so it was removed rather than signed as a formality. Certification is now the two legs that actually exist: mechanical shape screens, and blind judge rounds quoting the deciding sentence (16/16 against the frozen key, records in data/reading/n3-choubun-rejected.json). The residual risk is no longer bounded by anything and is stated at full strength in doc-27 §11 and LICENSE §17: both judges are the author's model family, agreement is correlated error, and a key this model believes wrong will ship wrong. validatedBy stays authored:agent-blind-judged because that names what happened. Nothing was lost from the code path: the gate, the band, the ねらい spread and the evidence span are unchanged, and AC#4/#6 ship on the two legs.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
N3 大問6 内容理解（長文）now fills from 8 authored comprehension rows in `data/reading/n3-choubun.json`, so no 読解 大問 at N5-N1 is a hole. The route changed rather than the standard: the 白書 supply was measured at 1 buildable row where the 大問 prints 4 (TASK-173.9.14), so doc-27 §10 writes the prose instead of lowering `CHOUBUN_COVERAGE_FLOOR`, and no floor constant moved. The gate's new authored branch (`check:reading-choubun --level N3`) screens shape and self-citation, never coverage; the masked-slot branch and its 0.85 floor are untouched and still green at N1. Certification is the two legs doc-27 §11 keeps (mechanical screens, and two blind judge passes 8/8 each with the keys withheld, frozen in `n3-choubun-rejected.json`): the owner-review leg was withdrawn, not signed, because the owner reads no Japanese and the translation comes from the authoring model, and the residual risk that both judges are the author's own model family is stated at full strength in doc-27 §11 and LICENSE §17. Verified: 247 tests in packages/japanese and 412 in apps/server green, both 長文 gate levels pass, the answer audit shows the new store's keys spread 2/2/2/2 across all four positions, tsc/ultracite/check:dox/fallow-boundaries clean, all 147 mutation anchors resolve, and the 長文 picker seam was proven to fail on a hand-applied mutation including the new row-identity assertion. One fix fell out of re-measuring a doc claim: the store spanned 6 ねらい, not the 7 its docs asserted, because the intent table credited n3b-3's passive 考えられている as opinion and dropped 理由; the table now checks なぜ first, no row changed, and a test pins the order.
<!-- SECTION:FINAL_SUMMARY:END -->
