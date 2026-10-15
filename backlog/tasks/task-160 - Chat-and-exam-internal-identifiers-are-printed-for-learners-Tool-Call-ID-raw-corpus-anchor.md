---
id: TASK-160
title: >-
  Chat and exam: internal identifiers are printed for learners (Tool Call ID,
  raw corpus anchor)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 08:27'
updated_date: '2026-09-28 13:04'
labels:
  - ui
  - chat
  - exam
dependencies: []
priority: medium
type: bug
ordinal: 925000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA walk 2026-09-28: two surfaces show the learner an identifier that only means something inside the system.

1. Tool call UUID. `Tool Call ID: {live.toolCallId}` at packages/ui/src/components/acp-tool-call-card.tsx:92 and `Tool Call ID: {card.toolCallId}` at packages/ui/src/components/acp-tool-call-states.tsx:118. Both render unconditionally, with no dev or debug gate, so every external tool call puts a raw UUID in the transcript. (Host tools are suppressed upstream by TASK-110, so this is a genuine third-party call, which is exactly when a learner needs plain language, not an id.)

2. Raw anchor id in the paper review. `const anchor = item.anchors.join(" · ")` at apps/desktop/src/features/exam/exam-paper-pane.tsx:554 feeds `{t("exam.review.anchor", { anchor })}` at :607, and packages/ui/src/lib/copy.ts:222 renders "Built from {anchor}". The interpolated value is a corpus id, not a word: TASK-138 states an anchor IS a corpus id, and apps/server/src/.../paper-fallback.ts seeds `anchors: [question.grammarId]`. So the review row reads "Built from <internal-key>" where a learner expects the vocabulary or grammar point. Note the sibling explanation at :612 is gated by `shouldRenderExplanation`; :607 is not.

Deliberately NOT in scope: the context token chip. `${view.used.toLocaleString()} tokens` at apps/desktop/src/routes/ai.tsx:115 is the documented honest fallback when the agent reports no window size (TASK-103 AC#4, comment at :108-110), not a leak.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The transcript no longer shows a raw tool-call UUID to a learner, and the task records what replaced it
- [x] #2 If the id is kept for support diagnostics, it is gated behind an explicit developer affordance rather than rendered for everyone
- [x] #3 The review row names the human-readable content the item was built from, not the corpus id
- [x] #4 The token chip is left alone and the task says why, so a later pass does not re-ticket it
- [x] #5 A test pins the anchor projection at the seam that produces it, asserted by calling it rather than by reading source text (TASK-134)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Research that changed the shape

Anchors are NOT parseable into a learner-facing name. The shipped formats are `vocab:<level>:<word>:<reading>` and `grammar:<id>` (apps/server/src/services/exam-corpus.ts:143-147), and real stored items carry anchors like `vocab:N5:05d1e39637e1241d9290` (local.db items.anchors) where the third segment is not a word at all. So a client-side split would print a hash for some items, which is the same defect. The corpus is the only honest source, and it is process-cached (`examCorpus()`, exam-corpus.ts:250), so the debrief can resolve labels cheaply.

## Plan

1. Contract (packages/api-contract/src/exam.ts:493): `ExamDebriefItemSchema` gains `anchorLabels: z.array(z.string().min(1))`, MAY BE EMPTY. `anchors` stays (dispute, replay and weakAnchors are keyed by id).
2. Server (exam-corpus.ts, next to the anchor constructors so format and label live together): `anchorLabelsFor(anchors, corpus)` - vocab entry -> `word（reading）` (word alone when reading equals it), grammar entry -> `pattern`, unresolvable anchor -> nothing. Wire into `debriefFor` (exam-service.ts:2039) via `examCorpus()`.
3. Desktop ReviewRow (exam-paper-pane.tsx:554,607): a pure `reviewAnchorLine(item)` seam returns the sentence only when labels exist; the row hides the line when it returns null. No raw id reaches the learner.
4. Deck: `drill.explain.generated` (packages/ui/src/lib/copy.ts:171) drops its {anchor} param, which also closes the same leak in the drill card (packages/ui/src/components/drill-card-states.tsx:296 interpolates `anchors[0]`) without a second contract change.
5. Tool-call id (AC#1, AC#2): delete the rendered line at acp-tool-call-card.tsx:88-93 and acp-tool-call-states.tsx:115-120. The title plus status tag is what replaces it: they already identify the call. Keep `data-tool-call-id` on the Card (a DOM attribute, never visible, and what tests select on) and add `debug?: boolean` to `AcpToolCallCardProps` that renders the id only when true; packages/chat-session/src/parts/acp-tool-call-part.tsx passes it from `env.VITE_DEBUG` (the TASK-30 developer affordance; packages/ui must not depend on @manobu/env).
6. Tests (AC#5, called not read): server test over `anchorLabelsFor` (vocab, grammar, unresolvable, reading-equals-word); desktop test over `reviewAnchorLine` (labels shown, empty hidden, no id in the output); ui test that the id is absent by default and present with debug.
7. Mutation seams: `exam-review-prints-the-corpus-anchor` and `tool-call-id-visible-without-debug`.
8. Verify: bun test apps/server, apps/desktop, packages/ui, packages/api-contract; check-types; ultracite; check:dox; mutation-gate --check plus the two new seams; browser pass over one submitted paper and one external tool call is NOT possible offline, so the review row is verified by rendering the seam and by the existing /exam browser route with the sidecar up.
9. Docs: apps/server/AGENTS.md (debrief label contract), apps/desktop/AGENTS.md (review row), packages/ui/AGENTS.md (tool-call card + deck key), packages/api-contract/AGENTS.md if it lists the debrief shape.

## AC#4

The token chip at apps/desktop/src/routes/ai.tsx:115 stays exactly as it is: TASK-103 AC#4 documents it as the honest fallback when the agent reports no window size. Not a leak, not touched.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification: bun test apps/server (239 pass/1 skip), apps/desktop (505 pass/3 skip), packages/ui (168 pass), packages/chat-session (263 pass); bun run check-types (14/14 tasks); bun x ultracite check clean on the 16 touched files; bun run check:dox clean; bun scripts/mutation-gate.ts --check resolves all 39 seams. Three new seams run and are CAUGHT: exam-debrief-sends-no-anchor-labels, exam-review-prints-the-corpus-anchor, tool-call-id-visible-without-debug. Real browser pass: sidecar on :4317 + Vite on :3001, one N5 shortened paper requested/answered/submitted over /rpc (exam-21ecaa2b-f913-42d9-80dc-6fc2a0c37c16), /exam/<id> review rows rendered 'Built from 東（ひがし）', 'Built from 塩（しお）', 'Built from Noun + ではありません' - zero corpus ids in any exam-review-anchor line.

Plan deviation: a third seam, exam-debrief-sends-no-anchor-labels (scripts/mutation-gate.ts), was added because the two planned seams pin the helper and the row but not the caller -  (apps/server/src/services/exam-service.ts:2063) can drop the anchorLabelsFor call and every unit test still passes. It mutates the call to  and apps/server/test/exam-pipeline.test.ts assertSubmittedExam catches it at the wire.

Clarification of the two blanks above (shell ate the quoted symbols): the caller is debriefFor at apps/server/src/services/exam-service.ts:2063, and the seam mutates its anchorLabels: anchorLabelsFor(entry.item.anchors, corpus) line to anchorLabels: [], which the pipeline test catches.

Found while verifying in the browser, deliberately NOT fixed here (outside the two surfaces this task scoped): the chat paper card still prints raw ids, via packages/ui/src/components/paper-card-states.tsx:134 interpolating debrief.weakAnchors into paper.debrief.weak ("Missed: {anchors}"), so a submitted paper in the transcript reads "Missed: vocab:N5:東:ひがし · grammar:dewa-arimasen-negative-polite-copula". It is the same defect with a different field: weakAnchors is deduped across items and keyed by id, so closing it needs a weakAnchorLabels on the debrief and the paper frame plus a fold change in packages/chat-session, and it would re-pin packages/ui/test/paper-card.test.tsx:173 which currently asserts the raw id as expected behavior. Recorded as the one remaining leak in packages/ui/AGENTS.md.

Closeout addendum: the review-row fix surfaced a fourth print path that also leaked the corpus id. The chat paper card line "Missed: {anchors}" (packages/ui/src/lib/copy.ts, rendered by PaperDebrief in packages/ui/src/components/paper-card-states.tsx) interpolated debrief.weakAnchors, which are join keys, so a submitted paper in the transcript read "Missed: vocab:N5:...". Fixed by putting learner-facing names beside the ids at every hop: the paper chat frame gained an OPTIONAL debrief.weakAnchorLabels (optional because a stored frame replays through ChatFrameSchema.safeParse, TASK-137); apps/server paperFrameData populates it with uniqueStrings(anchorLabelsFor(result.weakAnchors, corpus)); the chat-session fold carries it only when present so a pre-field frame shows nothing rather than an id; PaperDebrief prints labels and keys the list off ids. Tests: exam-pipeline asserts the stored frame labels are name-shaped, chat-engine/paper.test.ts pins the fold incl. the legacy no-labels case, paper-card.test.tsx asserts ids absent. Seams paper-card-prints-weak-anchor-ids and paper-frame-omits-weak-anchor-labels both CAUGHT.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Two identifier leaks closed, one new field, three seams. (1) Tool-call id: the raw UUID is no longer rendered by either card path; AcpToolCallCardProps gained debug?: boolean (packages/ui/src/components/tool-call-shared.ts), ToolCallIdLine in acp-tool-call-states.tsx is the single renderer for both the generic card and the diff-only fast path, and packages/chat-session/src/parts/acp-tool-call-part.tsx passes env.VITE_DEBUG === "1" (packages/ui must not depend on @manobu/env). What replaced it for a learner is what was already there: the call title and the status tag. data-tool-call-id stays on the Card as an invisible attribute. (2) Corpus anchor: ExamDebriefItemSchema gained anchorLabels, filled by anchorLabelsFor in apps/server/src/services/exam-corpus.ts (vocab word（reading）, word alone when reading equals it, grammar pattern, nothing for an anchor the corpus cannot name) and wired into debriefFor; the desktop review row renders it through a pure reviewAnchorLine seam and hides the line when there are no labels. The same change closed the drill card leak by dropping the {anchor} parameter from drill.explain.generated ("Generated explanation."). AC#4: the token chip at apps/desktop/src/routes/ai.tsx:115 is untouched, as recorded in the plan. Verified: full bun test for apps/server, apps/desktop, packages/ui, packages/chat-session all green, check-types 14/14, ultracite clean, check:dox clean, mutation-gate --check 39/39 and all three new seams CAUGHT, plus a real browser pass over a submitted N5 paper whose review rows read "Built from 東（ひがし）" and "Built from Noun + ではありません" with zero corpus ids on the page. One sibling leak was found in that browser pass and is left for the user to decide on: the chat paper card prints debrief.weakAnchors raw via packages/ui/src/components/paper-card-states.tsx:134 ("Missed: vocab:N5:東:ひがし · ..."), pinned as expected by packages/ui/test/paper-card.test.tsx:173; closing it needs a weakAnchorLabels on the debrief AND the paper frame plus a chat-session fold change, i.e. a second contract change outside this task.
<!-- SECTION:FINAL_SUMMARY:END -->
