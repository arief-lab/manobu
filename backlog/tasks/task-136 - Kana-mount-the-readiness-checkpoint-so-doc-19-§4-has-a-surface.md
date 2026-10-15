---
id: TASK-136
title: 'Kana: mount the readiness checkpoint so doc-19 §4 has a surface'
status: To Do
assignee: []
created_date: '2026-09-26 03:58'
updated_date: '2026-09-26 05:43'
labels:
  - kana
  - ui
dependencies: []
priority: medium
type: feature
ordinal: 901000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the TASK-133 rendered-frames pass (2026-09-26). The kana readiness checkpoint has an instrument, an admission model and a result component, and no surface: every one of doc-19 §4's five frames is unvalidated because nothing renders them.

EVIDENCE. The result branch exists and is complete — apps/desktop/src/features/mock/jlpt-mock.tsx:635 renders KanaCheckpointResult when source === "checkpoint" — but the only mount of that provider in the app is apps/desktop/src/routes/jlpt-mock.tsx:220, which passes level and questions and neither checkpoint nor source. source therefore defaults to "mock" and the checkpoint branch is unreachable. TASK-118 (the instrument) and TASK-119 (admission + the gate offer) are both Done; neither was asked to mount it.

WHY IT MATTERS BEYOND THE PICTURE. doc-12 §3 frames the checkpoint as the feature that makes an N5 paper honest (an N5 paper is a reading test and none of it is answerable in romaji), and doc-19 §4's frames are the only specification of what the learner sees. Right now the offer, the kind groups, the pass and fail states, the mid-set correction and the cooldown are all unbuilt as surfaces.
SIBLING PATTERN - a built thing with no way in. This task is one of two instances of that shape in the repo right now. The kana checkpoint is a complete component with no route: `routes/jlpt-mock.tsx:220` passes neither `checkpoint` nor `source`, so `source` defaults to `"mock"` and the checkpoint branch at `jlpt-mock.tsx:635` is unreachable. The other is `selectItems` (`packages/item-engine/src/selection.ts`): a complete selection policy with no caller at all - the `./selection` subpath is exported from `package.json` and nothing imports it, not `apps/server`, not another package, not even a test outside its own file.

Both were surfaced by audit rather than by a failure, and both had defects that nothing in the running app could see. The checkpoint's five `doc-19` §4 frames are unvalidated because no surface renders them, which is what made this task findable at all. The selector's new-bucket order was a no-op for any id set whose members differ only in their final character (the `paper-<hex>` and `card-101` shapes) - fixed in `TASK-135`, and now pinned by a property test, but still nothing in the app exercises it.

The lesson is worth carrying: an unwired subsystem is where latent defects accumulate, because its own unit tests are the only things that ever touch it and they cannot see the gap either. When you build a subsystem, wire it in the same change, or state plainly in its DOX entry that nothing calls it yet - the second is much better than silence, and this note is the second.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A real mount passes the checkpoint config and source, so the branch at jlpt-mock.tsx:635 is reachable in the running app. No test-only or storybook-only path counts.
- [ ] #2 The gate offer is reachable on the path to an N5 paper as doc-13 §3.4 specifies, and it reads the real admission and mastery stores (TASK-117) rather than a fixture: a learner with a shaky script is offered the checkpoint, one with a solid script is not.
- [ ] #3 Both result states render through KanaCheckpointResult, and the two-rule pass holds in the UI: 90% is not enough when a (kind, row) group is entirely wrong.
- [ ] #4 The cooldown from TASK-119 is visible after a failed attempt, and the settings reset clears it.
- [ ] #5 No CEFR badge and no official-score claim appears anywhere in the checkpoint (TASK-113's rule).
- [ ] #6 A browser pass captures the five §4 frames into doc-19 with alt text, and doc-19 §4 and §13 stop calling them unvalidated.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pattern note added to the description so it lives on the board rather than in a commit message. Both instances re-verified on 2026-09-26 before writing: selectItems, SelectionPools and SelectItemsInput have 0 references outside packages/item-engine, and routes/jlpt-mock.tsx:220 still mounts <JlptMock level questions> with neither checkpoint nor source. The selector has no task of its own, which is itself part of the point: nothing on the board owned it, so its defect was found by reading rather than by a failure.
<!-- SECTION:NOTES:END -->
