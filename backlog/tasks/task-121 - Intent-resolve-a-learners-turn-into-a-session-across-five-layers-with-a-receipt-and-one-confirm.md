---
id: TASK-121
title: >-
  Intent: resolve a learner's turn into a session across five layers, with a
  receipt and one confirm
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:06'
updated_date: '2026-09-24 15:04'
labels: []
dependencies: []
documentation:
  - backlog/docs/feature/doc-18 - Intent-resolution-and-session-setup.md
  - backlog/docs/feature/doc-19 - UI-wireframes-the-chat-learning-surface.md
priority: high
type: feature
ordinal: 864500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The chat must turn ordinary talk ("quiz me on particles", "は vs が is killing me", "the stuff I keep getting wrong") into a session without a modes-and-menus UI. `doc-18` defines five layers: L0 explicit, which already partly ships as the four starter chips (`STARTERS`, `apps/desktop/src/routes/ai.tsx:81`, rendered `:800`); L1 a deterministic slot grammar; L2 a structured proposal `{ tier?, level?, count?, anchors[] }` the client may only offer on; L3 a confirm step; L4 a fallback that answers casually and offers once. The agent proposes and the code decides, so a model can never start a session on its own. `doc-18` §4.1 is the part that makes this more than parsing: it names the **stored row** behind every referent a learner can say, so "the stuff I keep getting wrong" resolves from data (`deriveWeakPatterns`, `apps/desktop/src/lib/mock.ts:145`; the level store `apps/desktop/src/lib/learner-level.ts:47`; the review queue `apps/desktop/src/lib/review.ts:33` into `previewIntervals`, `packages/srs/src/index.ts:172`) rather than from confidence. `doc-19` §2 draws the receipt, the confirm card (which mirrors the real `AcpAskCard`: Submit stays disabled until answered, plus Decline, collapsing to a compact line once resolved) and the four degraded states.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Explicit commands beat signals, a model proposal never starts a session without an accepted offer, and every layer is reachable by a test.
- [x] #2 A starter chip starts the session its text describes through L1 without a model turn.
- [x] #3 A proposal carrying an empty `anchors[]` starts nothing: the learner sees the receipt or the offer instead.
- [x] #4 An inferred session confirms and an explicit one does not, and a free-text turn during a confirm resolves it as `Change` without blocking.
- [x] #5 A topic with no corpus items at the level produces the nearest-topic line and starts no session.
- [x] #6 "Not particles, は and が" re-resolves and supersedes the unasked items rather than starting a second session, and "stop" ends with counts equal to the stored attempts.
- [x] #7 "The same as last time" with no previous session produces the out-loud line from doc-18 §4.1 rather than an invented filter.
- [x] #8 An unresolvable turn is answered as conversation with one offer, and the next unresolvable turn does not repeat the offer.
- [x] #9 With the model unavailable, explicit sessions still start and inferred ones do not.
- [x] #10 Every string in doc-18 §10 exists in the typed deck, and `packages/ui/test/copy-snapshot.test.ts` stays green.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Five layers per doc-18: L0 explicit (STARTERS ai.tsx:81), L1 slot grammar, L2 proposal anchors->stored row (mock.ts:145, learner-level, review.ts), L3 confirm, L4 fallback. Agent proposes code decides, receipt + confirm card (AcpAskCard), tier routing, supersession, nearest-topic, out-loud, offer dedupe, model-unavailable explicit still works. Wire doc-18 §10 copy keys.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Five layers per doc-18: L0 explicit (STARTERS ai.tsx:81, /quiz//exam), L1 slot grammar (tier/level/count), L2 proposal anchors->stored row (mock.ts:145, learner-level, review), L3 confirm (Start/Change, free-text->Change), L4 fallback once. Receipt, anchors empty->no session, nearest-topic, supersession, out-loud, offer dedupe, model-unavailable explicit still works. 9 copy keys doc-18 §10 in copy.ts, walkthrough gate. Verified: intent.test.ts 10 AC (415 pass), check 447 clean, check-types 13/13. Resolver at apps/desktop/src/lib/intent.ts.
<!-- SECTION:FINAL_SUMMARY:END -->
