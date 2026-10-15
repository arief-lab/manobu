---
id: TASK-142
title: >-
  Exam: mask the target realization so a grammar item needs Japanese (doc-21
  §9.1)
status: Done
assignee: []
created_date: '2026-09-26 15:39'
updated_date: '2026-09-26 18:21'
labels:
  - exam
  - items
dependencies: []
priority: high
type: feature
ordinal: 907000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A grammar item is currently answerable without reading Japanese, and no validator can see it. This is the concrete defect behind doc-21 §9.1 and the strongest reason to want better items at all.

Assembled items, verbatim:

    Choose the pattern that completes: 朝ごはんを食べました。
      options: Verb stem + ました (answer) / ません / ませんでした / ましたが

`hasStemLeak` passes it, because the answer STRING "Verb stem + ました" is not a substring of the evidence. But ました is right there inside 食べました, so a learner string-matches the visible form to the option. Same for `X + を` over 「本を読みます。」, where を is visible in 読みます. These items are passable and teach nothing, and single-correct-answer is not answerability.

THE FIX IS DETERMINISTIC, which is why it is this task and not an agent task. A grammar point ships its `pattern` ("Verb stem + ました") and its example sentence. The pattern names the literal that realizes it - the trailing ました - and `vaporetto_split` segments the example into tokens (packages/db/src/migrate.ts:281 registers it, and it is reachable from the sidecar today). So the target token is findable: the trailing literal of the pattern, resolved against the segmented example. Mask it, keep the rest of the sentence, and the item stops being answerable by string-match.

The residue is honest: matching a pattern to its realization is exact when the pattern ends in a literal (ました, ません, を) and approximate when it does not (Noun + です is a copula, not a suffix). Say which case an item is, and do not pretend the approximate case is masked.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The target realization is masked in the stimulus of every grammar-backed item, so the answer is no longer readable off the sentence. Asserted behaviourally over an assembled paper: for each masked item the answer string is absent from what the learner is shown.
- [x] #2 An item whose pattern ends in a literal (ました, ません, を) is masked by that literal, resolved against a `vaporetto_split` segmentation of the example. The test asserts the literal token is gone and the rest of the sentence survived.
- [x] #3 A pattern that does not name a literal (Noun + です) is either masked by a recorded strategy or explicitly marked unmaskable, and the item records which. A test asserts no item claims to be masked when the blank was not found - an unverifiable mask is worse than none.
- [x] #4 The mask survives assembly, persistence and replay byte-identically, so a reviewed item is the item the learner saw. Asserted through the store round-trip, not through the in-memory item.
- [x] #5 A mutation-gate seam covers the masking, so a revert to the unmasked sentence is caught rather than shipping as a silent quality regression that no test can see.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DONE, 5/5. The mask is now recorded on the item and the record is the thing a reviewer reads.

PERSISTENCE. Migration 0015 adds `items.mask` (text, nullable) and `ItemResolution.mask` is an `ItemMask | null`. The type moved DOWN to `packages/item-engine/src/types.ts` as `MaskStrategy` / `ItemMask`, because a masking record is a property of a question item, not of the server that assembled it. Null means "nothing to mask" - a vocabulary item, or a listening item whose script never leaves the server - and stays distinct from a stored unmasked record, which is the entire point of the field.

THE INVARIANT IS ENFORCED AT THE BOUNDARY, twice, in `maskRecord`. `verified: true` is only legal with `trailing-literal`, the one strategy that re-tokenized and confirmed the literal was gone. It is checked on the way IN (so an invalid record cannot be stored) and again on the way OUT through `decodeItemMask` (so a hand-edited cell cannot be read as valid). That is AC#3's "no item claims to be masked when the blank was not found", enforced rather than asserted.

A cell the store cannot read throws, like `stimuli` - a mask that silently decoded to null would make a masked item look unmasked, which is the failure this task exists to prevent.

TWO REAL BUGS FOUND WHILE WIRING IT, both caught by the store's own conflict guard rather than by a test I wrote. The picker hands over a `MaskResult`, which also carries `masked` - the sentence with the blank, already the item's passage - and duplicating it into a column would have stored the stimulus twice. And the JSON comparison tripped on key order, so re-storing an identical item threw "already exists with different content" for ten items. Fixed by normalizing to the persisted shape in one place (`maskRecord` + `encodeMask`), which also gives the comparison a canonical form.

AC#4 is landed as the same records read back through the pipeline, so what a reviewer sees is what the learner saw. The test also asserts a listening item's mask is null, which is the other half of "records which": an item with nothing to mask says so rather than being silent.

STILL DELIBERATELY ABSENT: the client projection. `ItemForClient` does not carry `mask`, because the reader is the review surface TASK-137 owns and a contract field with no reader is the doc-21 §2 defect shape. When TASK-137 lands, this is the field it renders - an item that could not be masked is visibly flagged as leaky rather than being inferred from a passage that happens to show the answer.

Residue, unchanged and measured: 61% of grammar points are maskable. The rest are `literal-absent-from-sentence` (the pattern spells the form differently), `literal-not-a-token` (the literal is inside a longer token, so masking would cut a word in half), `no-literal-in-pattern` (55 patterns name a morphological process, not a surface), and `unverified-after-masking`. Every one of those now carries its reason on the item.
<!-- SECTION:NOTES:END -->
