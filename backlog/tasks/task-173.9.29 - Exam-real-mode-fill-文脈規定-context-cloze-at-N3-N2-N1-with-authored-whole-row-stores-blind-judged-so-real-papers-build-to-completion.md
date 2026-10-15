---
id: TASK-173.9.29
title: >-
  Exam (real mode): fill 文脈規定 (context-cloze) at N3/N2/N1 with authored
  whole-row stores, blind-judged, so real papers build to completion
status: Done
assignee:
  - '@Buffy'
created_date: '2026-10-13 12:31'
updated_date: '2026-10-13 14:48'
labels: []
dependencies: []
parent_task_id: TASK-173.9
ordinal: 990000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The first end-to-end real-mode assembly at N3/N2/N1 (2026-10-13, live RPC probe) returned ready=false at every level, and an exam_items census localized the ENTIRE shortfall to one 大問: 文脈規定 fills 2/11 at N3, 1/7 at N2, 0/7 at N1 (PAPER_BLOCKS in packages/item-engine/src/paper.ts; every other family matched its shape exactly, and refusedSections/unfilledBlocks were empty, so this is supply exhaustion, not refusal). Cause: cloze items are derived, not stored. `clozeSourceFor` (apps/server/src/services/exam-service.ts:2523) walks the grammar corpus for an example sentence containing a same-level vocab word that survives `maskWord` as a standalone blankable token (exam-service.ts:777-778, `example = source.stimulus?.japanese` at :681) with three same-POS distractors. Its own doc states the constraint: "The exam's only real Japanese sentences are grammar examples - a `CorpusVocabEntry` carries none" (exam-service.ts:2503-2504). Measured supply: grammar examples are 450 (N1) / 447 (N2) / 390 (N3) sentences; even a lenient substring join finds only 103 distinct N1 words in 144 examples, 24 N2 words in 31 examples, 151 N3 words in 239 examples, before the token/POS/dedupe screens and pool contention with the grammar families that share the pool and spend each example once. The vocab corpus itself is abundant (3475 N1 entries) - the missing material is SENTENCES. The prepared surplus path (`sentences` table, migration 0003 for the Tatoeba/Tanaka corpus, TASK-23.4.2) has never been ingested: 0 rows. Every other 語彙/文法 大問 that ran out of derived material was solved the same way: authored whole-row per-level stores with blind-judged certification and the composed+validated honesty gate (TASK-173.9.23-.28), with the store owning serving and unvalidated rows refused in real mode. This is the last 大問 still on a derived join, and it is the only thing standing between today and ready=true real papers at N3/N2/N1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A real-mode paper assembled at N3 reports ready=true with the 文脈規定 block at 11/11, and at N2/N1 ready=true with 7/7 (measured on the ExamBuildReceipt and the exam_items census, same probes as the 2026-10-13 baseline)
- [x] #2 The N3/N2/N1 文脈規定 小問 are served whole-row from per-level authored stores under the composed+validated honesty gate: a row without `validated` is refused in real mode exactly as in the TASK-173.9.25-.28 stores
- [x] #3 Each authored 小問 is one real sentence with the answer word blanked plus four same-part-of-speech options with exactly one fitting: an offline per-level check gate proves blankability against the shipped splitter and rejects a passage that still prints the answer (`hasStemLeak` stays silent on served rows), and blind-judge certification of the keys is recorded
- [x] #4 The stores carry headroom beyond one paper: a second real-mode paper at each level with a different seed fills the block again without the cloze family appearing in `exhaustedFamilies`
- [x] #5 N4/N5 文脈規定 behavior is unchanged (derived `clozeSourceFor` path still fills its blocks) or, if those levels move to the store too, their papers still assemble ready=true
- [x] #6 DOX pass: apps/server AGENTS.md corpus/service entries describe the new store and the moved seam; mutation-gate anchors re-validated with `bun scripts/mutation-gate.ts --check`
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Row contract: new store files packages/japanese/data/reading/{n3,n2,n1}-kitei.json in the CorpusShortReadingEntry shape (exam-corpus.ts:316), passage carrying exactly one '＿＿' blank (bunshou convention, exam-bunshou.test.ts:59), four same-part-of-speech word options, Japanese 指示文 stem, evidence = the passage with the answer word restored, construction 'authored', provenance 'composed'.
2. Serving: loader kiteiStoreFor in exam-corpus.ts (N1-N3 only, drop unshapely rows like loadReadingLevel); new SourceFamily 'kitei' with anchor prefix 'kitei:' registered in the resolveAnchor attestation namespaces; picker via storeRowSourceFor (exam-service.ts:1823) with a usedKiteiPassages spend set; dispatch at the family==='cloze' arm (~exam-service.ts:3344) becomes level-aware: N3/N2/N1 go store-only, N4/N5 keep the derived clozeSourceFor path unchanged (AC#5); grammar-pool sizing (~:3021) stops counting cloze demand at store levels; context-cloze joins STORE_PASSAGE_TYPES so the blanked sentence prints whole with mask null.
3. Offline gate: scripts/check-kitei.ts + check:kitei script, mirroring check-goseikei/check-iikae: cert trio composed+validated+validatedBy 'authored:agent-blind-judged'; row id absent from the frozen {level}-kitei-rejected.json ledger; exactly one '＿＿'; 4 distinct options with answerIndex in range; answer never printed in the passage (leak); evidence reconstructs by filling the blank; every option attested as a real word in the N5-N1 vocab JSONs with a consistent POS family; answer attested at the row's own level; per-level official 文脈規定 instruction line; store floors N3 33 / N2 21 / N1 21 (3x block).
4. Author the rows (agent-authored per the no-surplus measurement): 33 N3 + 21 N2 + 21 N1, each a natural adult-register sentence whose context admits exactly one of four same-POS options.
5. Blind judge: packages/japanese/prompts/kitei-validator.md; two independent judge passes per level with withheld keys and per-pass option shuffle (doc-27 §11 pattern); rejects frozen into the ledger and re-authored under new ids; verdicts recorded under packages/japanese/.cache/judge/.
6. Tests: apps/server/test/exam-kitei.test.ts mirroring exam-hyouki.test.ts (shipped-row floors, per-level real-paper fill 11/7/7 through requestAssembleRead, MANOBU_DATA_DIR overlay proving a validated:false row is never served, second-seed headroom, N4/N5 still derived and store rows never served there); exam-cloze.test.ts updated if the dispatch change reaches it.
7. Mutation gate: new seams for the kitei picker spend, the store-vs-derived dispatch, and the honesty-gate refusal; bun scripts/mutation-gate.ts --check green.
8. Closeout: DOX updates (apps/server, packages/japanese AGENTS.md), ultracite, full turbo test + check-types, live real-mode probe at N3/N2/N1 proving ready=true, then finalization guide before checking ACs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Serving wired: kiteiStoreFor loader (exam-corpus.ts, N3/N2/N1, file naming {level}-kitei.json), kiteiSourceFor via storeRowSourceFor with usedKiteiPassages spend, level-gated dispatch in the cloze arm (KITEI_STORE_LEVELS: store-only N3/N2/N1 with NO derived fallback, join kept N4/N5), context-cloze added to STORE_PASSAGE_TYPES and STEM_CUE_ITEM_TYPES (derived cue is empty so its stem stays null), kitei: in TRUSTED_ANCHOR_NAMESPACES, paperGrammarDemand stops counting cloze slots at store levels, __test__ exports kiteiSourceFor + kiteiStoreLevels. Pins updated: exam-cloze demand arithmetic moved to N4 (9+6 before bunmi-kitei) plus a new pin proving N2 counts 0. Full apps/server suite green 688/0 pre-content.

Blank convention decided at authoring: the 2018 samples print 文脈規定 with the （　） marker, not ＿＿ (transcribed verbatim from packages/japanese/.cache: N3V.pdf l.140 問題３ 「（　）に入れるのに最もよいものを、１・２・３・４から一つえらびなさい。」, N2V.pdf l.156 問題４ and N1V.pdf l.87 問題２ both 「（　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。」; the page's blank padding is layout, so rows keep one full-width space per the goseikei precedent). Rows therefore carry one （　） in the passage and the level's verbatim line as stem; evidence = the passage with the answer substituted into （　） byte-exactly (the mechanical blankability proof AC#3 asks for), so every authored answer must slot into its sentence in its dictionary form.

Tests + seams shipped: packages/japanese/test/check-kitei.test.ts (41: every gate screen pinned by fixture incl. distractor leak; store floors, per-level stems, burned ids, family-wide passage/answer uniqueness) and apps/server/test/exam-kitei.test.ts (22: store shape, picker/anchor/spend/seenAnchors/N4-decline via __test__, real N3/N2/N1 papers land the whole 大問 byte-equal with no option in any landed sentence, band membership pinned, empty/missing store names 文脈規定 大問3 with 漢字読み non-vacuity control, one-row = shortfall, unvalidated substitute never served, AC#4 headroom: a SECOND paper per level with a different seed fills 11/7/7 again from sentences the first did not print, contentExhausted false). Six mutation seams added (kitei-serves-unjudged-row-in-real, kitei-store-never-consulted, kitei-anchor-namespace-not-trusted, kitei-falls-back-to-canned-passage, kitei-drained-store-never-named, kitei-gate-misses-option-leak); all individually ran and were CAUGHT; two stale anchors re-pinned (goseikei-falls-back-to-canned-passage, cloze-demand-excluded-from-grammar-pool). Two wiring bugs found by the own tests: resetCorpusCache never cleared kiteiCache (overlays served shipped rows), and READING_STORE_FOR lacked a context-cloze entry so a drained store read as bare shortfall, never a named hole.

THE SECOND BLOCKER (beyond 文脈規定), found by the live full-paper probe 2026-10-13: papers came back shortfall 0 / unfilledBlocks [] yet ready=false with floor-unmet on the reading band. READING_ITEM_TYPES (packages/item-engine/src/paper.ts:89) still held only ["reading-info","long-reading"] while real papers place short/medium/long-reading, claim-understanding, text-comparison and info-search; those 小問 belonged to NO scoring band, so the 読解 floor (minimumItems 10) counted 4/0/4 and validatePaper kept real papers from ready, and the banded result columns silently lost those points (same N2 57/60 class). The band widened to the seven placed types; the audit then caught star-ordering (文の組み立て) missing from LANGUAGE_KNOWLEDGE_ITEM_TYPES: each real N1/N2/N3 paper dropped exactly its 5 組み立て 小問 from the columns (band totals summed 5 short of landed items at all three levels); it joined too. Two committed pins that had documented the drop as design flipped: exam-reading-holes "names no N3 読解 大問 at all" and exam-short-reading N3 test now assert ready=true and the reading floor met, the latter also pinning the two asked 科目 floor sums equal the landed item count; paper.test.ts "routes every placed 読解 type into the 読解 band and no other" guards the property (lists pinned disjoint). New seams: reading-band-drops-placed-real-types, language-band-drops-star-ordering; both ran, both CAUGHT.

FINAL PROOF: full real papers (all blueprint sections, clamped full budgets) at 2026-10-13: N3 102/102 items ready=true, N2 107/107 ready=true, N1 108/108 ready=true; shortfall 0, unfilledBlocks [], refusedSections [], contentExhausted false; floors: language-knowledge 58/54/45 met (after star-ordering), reading 16/21/26 met, listening 28/32/37 met. Verification: apps/server 711 pass/0 fail/1 skip, packages/item-engine 81/0, packages/japanese 586/0, bun run check-types FULL TURBO green, bun run check:dox green, mutation-gate --check 216/216 anchors resolve, ultracite fix clean on all touched files.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
文脈規定 (context-cloze) at N3/N2/N1 now serves whole-row from authored blind-judged stores and full real-mode papers build to completion.

Shipped: packages/japanese/data/reading/{n3,n2,n1}-kitei.json (33/21/21 composed+validated rows, two independent blind judge passes per level, rejects frozen in the ledger); loader kiteiStoreFor + picker kiteiSourceFor with usedKiteiPassages spend and the kitei: anchor namespace; level-gated dispatch in the cloze arm (store-only at N3/N2/N1 with no derived fallback, drained store names the hole; N4/N5 keep the derived join unchanged, AC#5). Offline gate bun run check:kitei (packages/japanese/scripts/check-kitei.ts) proves blank/POS/attestation/leak/evidence screens and store floors.

Second blocker found by the live probe and fixed in-task: READING_ITEM_TYPES (packages/item-engine/src/paper.ts:89) held only the two flat-mix carriers, so every placed real 読解 小問 belonged to no scoring band and papers stayed ready=false with floor-unmet despite shortfall 0; widened to the seven placed types. Audit also caught star-ordering missing from LANGUAGE_KNOWLEDGE_ITEM_TYPES (each real paper silently lost its 5 組み立て 小問 from the 得点区分 columns). Both fixes guarded by paper.test.ts "routes every placed 読解 type into the 読解 band and no other" and flipped the two committed pins that had documented the drop as design.

Evidence: final probe N3 102/102, N2 107/107, N1 108/108 items ready=true, shortfall 0, contentExhausted false, all floors met. Tests: apps/server 711 pass/0 fail/1 skip (exam-kitei.test.ts 22 tests incl. AC#4 second-seed headroom), packages/item-engine 81/0, packages/japanese 586/0 (check-kitei.test.ts 41). Six new kitei mutation seams plus reading-band-drops-placed-real-types and language-band-drops-star-ordering, each individually run and CAUGHT; mutation-gate --check 216/216. check-types and check:dox green; ultracite clean. DOX: apps/server and packages/item-engine/japanese AGENTS.md updated.
<!-- SECTION:FINAL_SUMMARY:END -->
