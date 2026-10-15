---
id: TASK-163
title: 'Copy: "1 items" everywhere, and an unnamed chat has two different names'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 08:28'
updated_date: '2026-09-28 14:33'
labels:
  - ui
  - copy
dependencies: []
priority: low
type: bug
ordinal: 928000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA walk 2026-09-28 left two copy defects that share one root: the deck substitutes numbers but never agrees with them.

1. Pluralization. `primary: "Building your paper. {n}/{total} items ready."` (packages/ui/src/lib/copy.ts:294) and `primary: "Built-in seed · {validated}/{total} items ready offline"` (:306) always say "items", so a one-item paper reads "1 items". The deck already ships a helper: `export const pluralize = (n: number, one: string, other: string): string =>` at packages/ui/src/lib/copy.ts:420, and it has zero callers anywhere in apps/desktop. `t()` (:423) does plain `{k}` substitution with no plural branch, despite the comment at :417. There is no Intl.PluralRules in the repo.

2. One concept, two names. The chat header falls back to `{opened?.title ?? "New Chat"}` (apps/desktop/src/routes/ai.tsx:458) while every other surface calls the same state "Untitled chat" (apps/desktop/src/routes/exam/$examId.tsx:67 and apps/desktop/src/features/chat-history/history-desk.tsx:38). A learner sees a conversation labelled one way in history and another way once it is open.

Checked and deliberately excluded: the "Sensei" vs "AI Assistant" inconsistency from the QA note does not exist. "AI Assistant" has zero occurrences in apps/desktop/src and packages/ui/src, and "Sensei" is used consistently. The missing-value glyph finding also stayed unproven: the placeholder is an en dash (`?? "–"`), which Inter covers, so it is filed nowhere.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A count of one renders as one item, at both call sites named above
- [x] #2 Either the unused pluralize helper gains callers or it is deleted, so the deck does not ship dead copy machinery
- [x] #3 One unnamed-conversation label is used across the header, the history list and the exam workspace
- [x] #4 packages/ui/test/copy-snapshot.test.ts still passes, and no touched string gains an em dash (R-02)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Root cause is one mechanism: `t()` (packages/ui/src/lib/copy.ts:423) substitutes `{k}` but has no plural branch, so the deck hardcodes plural nouns.

1. Give `t()` the ICU-lite plural its own comment already promises (copy.ts:417): parse `{name, plural, one {…} other {…}}` through the existing `pluralize` helper. Cases are literal text (no nested vars); the count itself stays a plain `{n}` substitution. Unknown/absent var falls back to `other`. This makes `pluralize` load-bearing, which is AC#2's preferred branch (deleting it would leave the deck unable to agree with its own numbers).
2. Pluralize the live count strings that a learner can actually see at one: `paper.build.running` (copy.ts:294) and `paper.offline.seed` (:306) agree with `total` (the noun counts the paper's items, so a 1-item paper reads "1/1 item"), plus `exam.pause.recorded` (:217, "Paused 1 time") and `review.header` (:337, "1 card due") which are the same defect the QA walk did not name. Checked and left alone: `reset.confirm` (:316) and `review.goal_switch` (:330) have zero live call sites and their counts are never 1; `set.learning.retention.body` (:384) is a statistical "1 in N" phrasing, not a count display.
3. One unnamed-chat label: add deck key `chat.untitled` = "Untitled chat" (the wording 2 of the 3 sites already use), and route all three through one desktop helper so they cannot drift again.
4. Found bug while reading the call site: `exam-paper-pane.tsx:205` renders `{validatedSlots}/{totalSlots} items ready.` in the CardContent of the same `DraftState` card whose CardTitle already renders that exact sentence from the deck. Delete the duplicate line; it is unsourced copy that would have needed the plural fix too.

Tests: update `packages/ui/test/copy-snapshot.test.ts` exact-copy assertions and add one-vs-many assertions per pluralized key; add a desktop test that the shared chat-title helper returns the deck label for an untitled conversation and the stored title otherwise. Mutation-gate seams for the plural branch and the chat-title fallback. No em dash anywhere new (R-02, guarded by copy-snapshot.test.ts).

Verify live: the three chat surfaces (header, history row, exam workspace) in the running app.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1: `t()` now carries the count. `packages/ui/test/copy-snapshot.test.ts` "plural agreement (TASK-163)" pins `t("paper.build.running", { n: 1, total: 1 })` = "Building your paper. 1/1 item ready." and `t("paper.offline.seed", { total: 1, validated: 1 })` = "Built-in seed · 1/1 item ready offline", with the 1/30 plural kept (the noun counts the paper's items, i.e. `total`, so a build in progress still reads naturally). Live proof in the running app: the review header at one due card reads "Review · FSRS · Due at R ≤ 90% · 1 card due · 1 total" (was "1 cards due").

AC#2: `pluralize` is load-bearing rather than deleted: `pluralizeClauses()` inside `t()` calls it for every `{n, plural, one {…} other {…}}` clause in the deck, so no caller can forget a var and the comment at copy.ts:417 finally describes what the code does. Seam `deck-plural-arms-not-swapped` (arms swapped) and `paper-build-line-agrees-with-its-count` (clause dropped from the build line) are both CAUGHT.

AC#3: one helper, one string. `apps/desktop/src/lib/chatTitle()` (deck key `chat.untitled` = "Untitled chat") is now the only place an untitled conversation is named: `routes/ai.tsx` header, `routes/exam/$examId.tsx` `ExamChatHeader`, `features/chat-history/history-desk.tsx` row (its private `titleOrPlaceholder` is gone). Live: `/ai` and `/ai?c=b3516292-…` (a saved chat with a null title) both read "Untitled chat", and the sub-line is what distinguishes them ("How can I help you today?" vs "Continuing a saved conversation."); the history rows render through the same helper. Seam `one-label-for-an-unnamed-chat` (header fallback re-inlined as "New Chat") is CAUGHT. The exam workspace header was not driven live: no paper exists in the local db, so `/exam/$examId` has nothing to open. It calls the same one-line helper, type-checked.

AC#4: `bun run test` = 10/10 tasks (packages/ui 172 pass, desktop 490 pass / 3 skip), `bun run check-types` = 14/14, `fallow dead-code --boundary-violations` 0, `bun run check:dox` clean, `bun x ultracite check` clean on the five changed source/test files, `mutation-gate --check` 47/47 anchors. No em dash added: the new strings use `·`, `:` and `.` only, and the R-02 deck walk in copy-snapshot passes.

Out of AC, fixed because they are the same defect or the same card: `exam.pause.recorded` ("Paused 1 time") and `review.header` ("1 card due") were the other two live count strings that a learner hits at one; `reset.confirm` and `review.goal_switch` also carry bare plurals but have zero call sites and no reachable count of one, so they were left alone. `exam-paper-pane.tsx` `DraftState` printed "{validated}/{total} items ready." in its CardContent under a CardTitle that already rendered that exact sentence from the deck: unsourced duplicate copy that would have needed the plural fix too, so the body line is deleted.

Docs: `packages/ui/AGENTS.md` records the deck's plural clause as the rule for any new count string; `apps/desktop/AGENTS.md` gains the `chat-title.ts` row plus the two chat-surface rows that named the old labels.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The deck had numbers and no agreement: `t()` substituted `{n}` and nothing else, so every count string hardcoded its plural, and one concept (a chat with no title) carried two names across three surfaces.

`t()` now parses an ICU-lite clause, `{total, plural, one {item} other {items}}`, through the `pluralize` helper that previously had no callers, so the arms live in the deck with the sentence and a caller cannot forget a var. Both arms are literal text, the count stays a plain `{n}`, and a missing or non-numeric var takes `other` rather than leaking the clause. Applied to the two strings the task named (`paper.build.running`, `paper.offline.seed`) and to the two other live counts a learner reaches at one (`exam.pause.recorded`, `review.header`); `reset.confirm` and `review.goal_switch` keep their bare plurals because neither has a call site or a reachable count of one.

The unnamed chat is named in one place: `apps/desktop/src/lib/chat-title.ts` returns the deck's `chat.untitled` for a conversation with no title, and the `/ai` header, the exam workspace header and the history row all call it. The header's "New Chat" is gone; a fresh chat takes the same label its history row will show once it saves, and the sub-line under it is what says whether anything is persisted. `DraftState` in `exam-paper-pane.tsx` also lost a body line that reprinted, verbatim and unsourced, the sentence its own CardTitle renders from the deck.

Proofs: three new mutation seams (`deck-plural-arms-not-swapped`, `paper-build-line-agrees-with-its-count`, `one-label-for-an-unnamed-chat`), all caught; `bun run test` 10/10 tasks, `check-types` 14/14, boundaries 0, DOX index clean. Live in the running app: the review header reads "1 card due" at one due card, and `/ai` reads "Untitled chat" both fresh and opened on a saved untitled conversation. The exam workspace header is the same one-line call and was not driven: no paper exists in the local db to open it with.
<!-- SECTION:FINAL_SUMMARY:END -->
