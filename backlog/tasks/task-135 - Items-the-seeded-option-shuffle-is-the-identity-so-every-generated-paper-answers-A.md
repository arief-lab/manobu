---
id: TASK-135
title: >-
  Items: the seeded option shuffle is the identity, so every generated paper
  answers A
status: Done
assignee:
  - '@arif'
created_date: '2026-09-26 03:58'
updated_date: '2026-09-26 05:07'
labels:
  - bug
  - items
  - exam
dependencies: []
priority: high
type: bug
ordinal: 900000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the TASK-133 rendered-frames pass (2026-09-26), and it is not cosmetic: every generated paper puts the correct answer in slot A, so a learner taking two or three papers learns to always pick A and the generated-exam premise collapses.

EVIDENCE. A seeded N5 paper was read through the item store: all 30 items carry answerIndex 0, and every rendered review row ticks "A.". The seeded option shuffle that should prevent this is a no-op.

ROOT CAUSE. packages/item-engine/src/paper.ts:679 hashString is a djb2-style accumulator, and deterministicOptionOrder (:687) builds its sort key as `${examId}\0${seed}\0${itemId}\0${index}` — the discriminating index is the LAST character. In this hash the final character's code is the lowest-order term, so for any prefix the four keys come out as consecutive integers in index order: hash(prefix+"0")=411561244, +1=...245, +2=...246, +3=...247. Sorting by that hash is the identity permutation, the tiebreaker never fires, and shuffleQuestionItemOptions (:701) returns the options untouched with answerIndex still 0. Nothing about the exam id, seed or item id can change the order, so the "seeded shuffle" is not weakly seeded, it is absent.

CONTRACTS THIS BREAKS. doc-14 §4 "Option order | seeded shuffle; identical for a given exam id" and doc-16 §3 "Determinism is per item, so the same paper renders identically ... a drill set can draw the same item at a different option order via its own seedPart". Both docs currently describe an ordering that does not happen. It also makes the key-hiding work pointless in practice: the key is not in the payload, but the pattern is.

NOT A SURFACE-TEXT FIX. Do not work around this in the server's candidate generator or the client projection: the defect is in the shared engine's ordering primitive, and the drill path uses the same one, so a paper-side patch would leave the drill and exam surfaces disagreeing about what "seeded" means.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The ordering primitive actually depends on the item: across one assembled paper the answer index is not constant, and two items with different ids get different option orders. A test asserts the distribution over a paper rather than one hand-picked item, so a regression to the identity fails loudly.
- [x] #2 Determinism is preserved and pinned: the same exam id + seed reproduces byte-identical option order, and two different seeds over the same items produce different orders. The existing TS parity golden (crates/jlpt-mcp tests/parity.rs parity_with_ts_engine) and the drill path's own seedPart ordering both stay green.
- [x] #3 The root cause is documented where it lives: packages/item-engine/AGENTS.md records why the index cannot be the last character of the hash input, so the next edit does not reintroduce it.
- [x] #4 doc-14 §4 and doc-16 §3 stop claiming a per-item seeded order until the code delivers one, or are corrected to match the fixed behavior. Whichever way it lands, the docs and the code agree.
- [x] #5 The fix is registered as a seam in scripts/mutation-gate.ts, so a future edit that turns the shuffle back into the identity fails the gate.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Replace the hash-sort ordering with a real seeded permutation: hash the item identity (exam id, seed, item id) once into a well-mixed 32-bit seed, then Fisher-Yates with a small deterministic PRNG, so the order depends on the item instead of on the option index. Keep the single-option and zero-option edges behaving as before. 2. Give hashString an avalanche finalizer so adjacent seeds and exam ids do not produce adjacent PRNG seeds, and check that nothing else depends on its exact output. 3. Test the distribution, not one item: across an assembled paper the answer index is not constant, two items with different ids get different orders, and the same exam id plus seed reproduces the order exactly while a different seed changes it. 4. Check the blast radius: the drill path's own seedPart ordering, the paper assembler, and the Rust parity golden (crates/jlpt-mcp tests/parity.rs) which mirrors TS behavior. 5. Register the fix as a mutation-gate seam (force the identity and require the gate to fail), record the root cause in packages/item-engine/AGENTS.md, and settle the doc-14 §4 / doc-16 §3 claims through the CLI. 6. Full workspace verification, then finalize.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
FIX. deterministicOptionOrder no longer sorts hash keys. It hashes the item identity ONCE (examId\0seed\0itemId) through hashString and drives a Fisher-Yates with seededRandom (mulberry32), so the permutation depends on the exam id, the request seed and the item id. hashString itself moved to Math.imul int32 arithmetic (the old hash*33 % 2^31-1 grew past 2^53 on a realistic id and was one multiply from Infinity) and gained an fmix32 avalanche, because without it ids differing in one character give adjacent seeds and a per-item order degrades into a global one.

WHY A SORT COULD NOT WORK. In a djb2-style accumulator the final character's code is the lowest-order term, so four keys that differ only in their last character come out as consecutive integers in index order: hash(prefix+"0")=411561244, then 245, 246, 247. Sorting by that is the identity for ANY prefix, which is why no exam id, seed or item id could change the order. A permutation has to come from a generator, not from ordering keys.

TWO TESTS THAT WERE PASSING BECAUSE OF THE BUG, both fixed here rather than worked around:
1. paper.test.ts "shuffles options deterministically without mutating the item" asserted only that two mounts agree and that options[answerIndex] is the answer. All three hold for the identity permutation. It now also asserts the options are still a permutation of the original set, and three new tests cover the distribution (all four slots carry the answer somewhere across 24 items, none carries all of them), two items under one exam and seed getting different orders, and same-seed reproducibility against a different seed.
2. exam-pipeline.test.ts answered selectedIndex 0 for every item and asserted perfect scores. That only produced 180/180 because every answer sat in slot A. Both walks (answerEveryItem and the gates helper) now read the key from the item store, which is where the test can legitimately get it: the client projection hides answerIndex on purpose, and guessing 0 was the bug's fingerprint.

VERIFICATION. End to end through the sidecar, two seeds: answerIndex distribution 0:8 1:9 2:6 3:7 and 0:9 1:9 2:4 3:8, so 22 and 21 of 30 answers are off slot A and the seed changes the spread; the client item keys are unchanged and still carry no answerIndex. Rust parity green (parity_with_ts_engine 7/7, so the MCP surface is unaffected). Root Turbo 10/10, 14/14 check-types, ultracite clean, fallow verdict pass (0 dead code, 0 introduced complexity or duplication), mutation gate 7/7 with two new shuffle seams.

SELECTION.TS IS NOT DEGENERATE, BUT IT IS THE SAME TRAP. packages/item-engine/src/selection.ts carries its own copy of the old hashString and its own sort over `${seed}\0new\0${id}`. It behaves today only because item ids differ mid-string (drill-n5-1-... vs drill-n5-10-...), not in the final character; probed, its order is well spread. Left unchanged and recorded in the package AGENTS.md, because changing it is not this task and its current behavior is correct.

The bitwise suppression in paper.ts is scoped to hashString and seededRandom with a reason: a 32-bit avalanche and a 32-bit PRNG are bitwise by definition, and the float-only alternative is what produced this bug.

CORRECTION to the note above about selection.ts. I wrote that its sort "is NOT degenerate today only because item ids differ mid-string". That is wrong twice over. Probed with real id families, the sort IS the identity for ids that differ only in their final character (paper-<hex digest>, card-101) and only looks shuffled for drill-pool ids, which differ mid-string. And the reason it has no effect today is not id shape at all: selectItems has ZERO callers - the ./selection subpath is exported from package.json and nothing imports it, not apps/server, not another package, and not even a test outside its own file. packages/item-engine/AGENTS.md now says so.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the seeded option shuffle. deterministicOptionOrder now hashes the item identity once and runs a seeded Fisher-Yates instead of sorting four hash keys that differed only in their last character, which in a djb2-style accumulator made the order ascending by option index for every item: the identity, so every generated paper answered A. hashString moved to int32 Math.imul arithmetic with an fmix32 avalanche. Two tests were passing because of the bug and are now honest: the shuffle test asserted only determinism (which the identity also satisfies) and the exam-pipeline walks answered index 0 everywhere and scored a perfect paper for the same reason; both read the key from the store now. Verified end to end through the sidecar (22 and 21 of 30 answers off slot A across two seeds, key still hidden from the client), Rust parity 7/7, root 10/10, check-types, ultracite, fallow pass, and the mutation gate at 7/7 with two new shuffle seams that fail if the order is ever pinned or the swap undone.
<!-- SECTION:FINAL_SUMMARY:END -->
