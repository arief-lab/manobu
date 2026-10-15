---
id: doc-17
title: 'Exam workspace: chat on the left, the running paper on the right'
type: specification
created_date: '2026-09-24 05:19'
updated_date: '2026-09-27 17:39'
---
# Exam workspace: chat on the left, the running paper on the right

> **Status:** draft v1
> **Date:** 2026-09-24
> **Type:** specification
> **Parent:** `doc-12`. This doc owns the **presentation surface for a running paper**: the split layout, the chat column, the timer and section behavior, composer gating, and resume.
> **Siblings:** `doc-15` (chat learning loop: the tiers that lead here), `doc-18` (how the request that opens this workspace is resolved), `doc-14` (paper generation, storage, state machine), `doc-17`'s scoring rules come from `doc-12` §2 / `TASK-113`
> **Wireframes:** `doc-19` §6 (the split frame and its four mode differences), §7 (result), §8 (review)
> **Verified constraints:** `apps/desktop/src/routes/__root.tsx:76` (`CHROME_FREE_PATHS`), `:94` (`isChromeFreePath`), `/ai`'s column composition (`routes/ai.tsx:708`), `packages/ui` has no resizable primitive

---

## 0. Scope

Owns: the workspace route, the two-column layout contract, chat-column behavior, composer gating during a paper, timer and section navigation, resume/abandon, what is hidden until submit, accessibility of the timer, and the component architecture of the paper pane.

Does not own: how a paper is built and stored (`doc-14`), what a question is (`doc-16`), the chat tiers (`doc-15`), the scoring rules and their known defects (`doc-12` §2 / `TASK-113`), the checkpoint's own paper (`doc-13`).

---

## 1. Why a workspace and not a route swap

Generating a paper, running it, and debriefing it are **one conversation**. If asking for an N3 mock navigated away from the chat, the learner loses the thread that produced the paper, and the debrief has nowhere natural to land.

So the surface changes shape instead: the chat stays visible on the left, and the paper takes the right pane as a real exam component with sections, a timer, and navigation.

```
┌──────────────────────────┬───────────────────────────────────────────────┐
│  chat (left)             │  paper (right, primary)                       │
│                          │                                               │
│  transcript              │  ┌ header: {level} · {mode} · section list ┐  │
│  - the request turn      │  │ ① Vocab ② Grammar·Reading ③ Listening   │  │
│  - the "paper ready" card│  └───────────────────────────────────────────┘  │
│                          │  ┌ section header: name · ⏱ 18:42 · pause ┐   │
│                          │  │ passage / audio stimulus when needed     │  │
│  [composer]              │  │ Q 7/20  prompt + 4 options              │  │
│  - live (shortened)      │  │ [Next]                                  │  │
│  - paused (exam-cond.)   │  └───────────────────────────────────────────┘  │
└──────────────────────────┴───────────────────────────────────────────────┘
```

---

## 2. Layout contract

- **Two columns, paper-primary.** CSS grid (`grid-cols-[var(--chat-col)_1fr]` style, tokens not hex), min-height `h-full min-h-0`, both columns independently scrollable. The paper column never shrinks below a readable measure.
- **Chat column width: `minmax(360px, 32%)`**, capped by a max so a wide monitor does not give the chat half the screen. Rationale and precedent: the repo deliberately ships *different frames per moment* (`setup` uses `max-w-400` with a `minmax(340px,5fr)` rail, the desk uses `max-w-350` with a fixed `320px` rail), and the user rejected unifying them because the pages are different moments. A running paper is a third moment: it needs the widest working area and a narrow chat for the debrief.
- **No drag-resize in v1.** `packages/ui/src/components` ships no resizable primitive; inventing one for this is cost without a demonstrated need. A **collapse toggle** (chat column → icon rail; the paper takes the full width) covers the real need, and a persisted preference remembers the choice.
- **Narrow windows:** below the breakpoint the chat collapses by default and the toggle is prominent. The exam must never be the cramped half.
- **The chat column reuses the existing composition.** The `/ai` column is already a self-contained `flex h-full min-h-0 w-full flex-col` with a shrink-0 header and a transcript that owns its `MessageScroller.Provider` (`routes/ai.tsx:706`-`708`), plus the `InputGroup` composer. The workspace mounts the same pieces; no second chat component.
- **No global chrome.** The workspace carries its own minimal bar (level, mode, `← desk`, and the collapse toggle), in the chrome-free family.

---

## 3. Mounting rules (the ones that break silently)

1. **One `ChatSessionProvider`, not two.** The chat column mounts it; nothing else on the route does. The floating `AskSenseiWidget` must not mount here: it is hidden on chrome-free paths (`routes/__root.tsx:133` renders it only when `!chromeFree`), and the launcher's own hide list — currently `/ai` and the legacy conversation route — must gain this route for the same documented reason: a second panel duplicates the page and its Provider races the shared `manobu:chat:v1` draft blob.
2. **Chrome-free registration, with a prefix branch.** `isChromeFreePath` matches `CHROME_FREE_PATHS.includes(pathname)` plus one prefix case for `/kanji/` (`routes/__root.tsx:94`). A parameterised route such as `/exam/$examId` can never match by equality, so the helper needs a prefix branch (the `/kanji/` precedent), or the workspace renders with the global Header above it.
3. **Route loader.** New routes must satisfy the loader audit (`apps/desktop/test/route-loaders.test.ts`): a `loader` with `ensureQueryData` or a `data: local-state` marker. The workspace loader resolves the paper: `ensureQueryData(examQueryOptions(examId))`, so an unknown id fails as a route error rather than opening an empty exam.
4. **The conversation belongs to the paper.** `exams` carries the conversation that requested it (`doc-14` §6), so the left column opens **that** thread, not a fresh chat. Reopening the conversation from `/chat/history` shows the paper card, and the card links back here.
5. **`/jlpt-mock` stays.** The generated-paper workspace is additive. `/jlpt-mock?filter=` keeps serving the built-in seed paper (including offline), and it is not chrome-free today — no change needed there.

---

## 4. Composer gating: the leak the split introduces

Making the chat visible during a paper creates a question the old design did not have: the learner can ask the agent for the answers.

| Mode | Composer | Why |
| --- | --- | --- |
| `shortened` | **live** | The point is learning. The items show their own verdict anyway, and there are no bands to protect |
| `exam-conditions` | **paused**, with an honest line and a pause counter | Test conditions. Real JLPT has no mid-paper help |
| after submit | **live** | The debrief is a normal chat turn in the same thread |

The paused state says why, in learner voice: *"Your paper is running. Questions unlock at submit."* plus a way to abandon.

Why not a prompt-level refusal instead: the agent authored the items, so it may hold a key in its own context, and "please do not tell me" is not a construction. The only guarantee is not sending turns, which is also what exam conditions mean.

---

## 5. Timer and sections

| Concern | `shortened` | `exam-conditions` |
| --- | --- | --- |
| Clock | a scaled pace indicator, labeled "shortened pace", no band implied | official per-section minutes (`doc-14` §2.2) |
| Per-section | optional | **yes**, one countdown per section, running only while that section is active |
| Pause | free | allowed but **recorded**: pause count and total paused time appear in the result |
| Time up | n/a | **auto-submits the section and never clears an answer** |
| Bands / CEFR before submit | hidden | hidden |

Section behavior:

- Exactly one **active** section. The section list shows each section's state (not started / active / submitted) and is a navigation affordance only within what the state allows, so a learner cannot wander into a later section backwards and forwards.
- A section transition is explicit (`Submit section`) and persisted, so a crash or a quit resumes into the right section with answers intact (`doc-14` §6 requires per-pick persistence).
- Progress is item count only (`Q 7/20`). No mastery percentage, no projected score: a projected score is a claim we cannot make before submit, and the current result layer is not trustworthy enough to extrapolate from (`doc-12` §2.2).

---

## 6. What is hidden until submit

- The answer key: never rendered, never in the transcript, never in the left column. The key lives in the item store and is read on submit (`doc-16` §2, D8).
- The result: bands, CEFR, weak anchors, and the pass/fail verdict appear only after submit.
- The archive: while a paper is `in_progress`, the right pane shows only the active section. Section review (going back to see what you answered) opens at submit.

---

## 7. End states

| End | Behavior |
| --- | --- |
| `Submit` (last section) | Result renders in the right pane under the `TASK-113` rules (bands only above the viability floor; raw counts plus a "shortened paper" label below it; the overall gate applied for `exam-conditions`). The composer unlocks and the debrief lands as a chat turn in the left column, ending with one deterministic next step (`doc-15` §6) |
| `Abandon` | Two-step confirm, no score recorded, `abandoned` status persisted, an honest line in the transcript; the paper stays in history as abandoned, never as a 0 |
| Leave the workspace | Nothing else happens: the paper stays `in_progress`, `/exam/$examId` resumes it, and the app relaunch resumes it too |
| Quit mid-section | Same, plus the section clock stops (an unattended countdown that expires while the app is closed would be a trap) |

---

### 7.1 Review after submit

The result is a verdict; the review is where the paper teaches, and it is the phase a learner returns to. Two phases in
the right pane after submit:

| Phase | Shows |
| --- | --- |
| `result` | the verdict under the `TASK-113` rules: total against the mark, sectional badges where the floor allows, the honest shortened label below it, and the pause count for `exam-conditions`. Each badge name comes from `examScoringSectionLabel({ id, level })` in `@manobu/api-contract`, the same call the chat column's summary makes, so the two columns cannot name one section two things |
| `review` | one row per item: the item (stimulus collapsed), your pick, the correct option, the anchor it was built from (`grammarId`, vocab id or sentence id), and an explanation block when the debrief returns one |

- **Post-submit only.** The review renders `answerIndex`, so it is gated on `status === "submitted"` exactly like the
  debrief (`doc-14` §6). Before submit the pane renders neither.
- **The correct option is data; the explanation is prose.** When an explanation exists it is agent-generated, marked
  as such, and anchored (it names the grammar point or the word sense the item was built from). It never replaces the
  correct option. **A composed exam item has no explanation at all**: nothing in this repo authors exam prose, so the
  server stores `null` and the row renders no block (TASK-137; authoring is the parked TASK-145). The pane opens the
  generated block only when the debrief returns non-null prose *and* flags it generated, because those two fields
  arrive independently.
- **Two explicit actions per row:** `replay this item` (a lookup by item id, so a missed paper item becomes a
  one-item drill set with the same key, `doc-16` §3) and `send these anchors to the desk` (the TASK-62 bridge).
  Nothing is written automatically.
- **A dispute is a first-class outcome.** `Report a wrong answer` marks the item `disputed`, removes it from future
  pools and keeps it in this paper's record. The validator's `ambiguous` reason (`doc-16` §6) is the machine check;
  this is the human one, and a key that ships anyway needs somewhere honest to go. The label names the action rather
  than a verdict, because the control sits on every row, including the ones the learner got right (TASK-137,
  `doc-19` §12.2 finding 4). After the action the same control reads `Disputed`.
- **The checkpoint gets the same pass** (`doc-13` §8): cell, pick, correct reading, group.

### 7.2 Copy keys

| Key | String |
| --- | --- |
| `exam.paused.composer` | "Your paper is running. Questions unlock at submit." |
| `exam.pause.action` | "Pause" |
| `exam.pause.recorded` | "Paused {count} times, {total} total." |
| `exam.section.submit` | "Submit section" |
| `exam.section.timeUp` | "Time. Section submitted." |
| `exam.timer.fiveMin` | "Five minutes left in this section." |
| `exam.timer.oneMin` | "One minute left." |
| `exam.abandon.confirm` | "Abandon this paper? Nothing is scored." |
| `exam.abandon.done` | "Abandoned. It stays in your history." |
| `exam.review.title` | "Your answers" |
| `exam.review.yourPick` | "You chose {answer}" |
| `exam.review.answer` | "Answer: {answer}" |
| `exam.review.anchor` | "Built from {anchor}" |
| `exam.review.replay` | "Try this one again" |
| `exam.review.sendToDesk` | "Send these to the desk" |
| `exam.review.dispute` | "Report a wrong answer" |
| `exam.collapse.toggle` | "Hide chat" / "Show chat" |

Seventeen keys in the typed deck (`packages/ui/src/lib/copy.ts:95`), covered by
`apps/desktop/test/walkthrough-copies.test.ts` where that gate applies. No em dash (R-02).

---

## 8. Accessibility

- **The timer must not announce every second.** The existing seed wizard's timer is `aria-live="polite"` with `mm:ss`, which is tolerable for a 9-item demo and hostile for a 40-minute section. In the workspace, announce **thresholds only** (5 minutes remaining, 1 minute remaining, time up, section submitted); the visible clock keeps updating silently.
- Keyboard: the paper column takes focus when a section activates; number/letter keys select an option and `Enter` advances, with the option group a real radio group (`fieldset` + `legend`, as the existing `Choices` already is). `Escape` never silently leaves a running paper.
- The collapse toggle is a real button with `aria-pressed` and does not move focus out of the paper mid-answer.
- Contrast and copy follow R-02: no em dash in user strings, text on any solid fill clears WCAG AA.

---

## 9. Component architecture

Extend the existing SCR-10 compound rather than forking it. The mock already ships `.Timer` (real, pausable), `.Progress`, `.Choices` (fieldset radio group), `.Next`, `.ReadingCard`, `.ListeningCard`, `.Score`, `.Plan`, `.SubmitFail` (`apps/desktop/src/features/mock/jlpt-mock.tsx`).

New, paper-specific:

| Sub | Owns |
| --- | --- |
| `.PaperScope` | the provider: paper, active section, answers, clock, phase. Children read it; nothing sniffs the DOM |
| `.SectionNav` | the section list and its states |
| `.SectionHeader` | section name, clock, pause, submit-section |
| `.Stimulus` | reading passage / listening audio for the item |
| `.SubmitSection` | the explicit section transition |
| `.Result` | post-submit result (shared with the seed wizard's `.Score` where the shape matches) |
| `.Abandon` | the two-step exit |

Rules from the repo's composition contract: `Object.assign(Root, { .Sub })`, no boolean-prop explosion, state in the Root, subs via `useContext`. The Collapse control is a plain button in the workspace bar, not a compound sub.

---

## 10. Verification

- Layout: the paper column keeps its minimum measure at the breakpoint; collapsing the chat gives the paper the full width; the preference survives reload.
- Mounting: exactly one `ChatSessionProvider` on the route; the AskSensei launcher does not render here (assert the hide list); an unknown exam id is a route error, not an empty workspace.
- Chat continuity: the left column opens the paper's own conversation; opening from `/chat/history` shows the card and the card lands back in the workspace.
- Composer gating: live in `shortened`, paused with the line in `exam-conditions`, live again immediately after submit; the paused state still allows abandon.
- No leak: a golden asserting the running transcript and the pre-submit pane contain no `answerIndex` and no answer text.
- Timer: thresholds announce at 5 minutes, 1 minute, and time up, and the clock does not announce every second; time-up auto-submits the section without clearing an answer; `exam-conditions` records pauses and the result shows them.
- Sections: one active section at a time; a section cannot be re-entered while a later one is active; the transition persists.
- Resume: quitting mid-section resumes into the same section with answers and a stopped clock; the app relaunch does the same.
- End states: submit unlocks the composer and posts the debrief in the same thread; abandon records no score
  and is not shown as a zero.
- Review: it renders only after submit, one row per item with your pick and the correct option, no explanation block
  while the item has none, `replay` resolves to the same item id, and a dispute marks the item without altering this
  paper's record.
- Copy: the seventeen keys in §7.2 exist and contain no em dash, enforced by `packages/ui/test/copy-snapshot.test.ts`.

Commands: `bun run check-types`, `bun run check`, `bun run test` in `apps/desktop`; `bun --filter @manobu/chat-session test`.

---

## 11. Open items

| Item | Why it is open | Recommendation |
| --- | --- | --- |
| Chat column width and breakpoint | needs a real window to tune | start `minmax(360px, 32%)`, collapse below `lg`; tune after the first generated paper |
| Whether `shortened` papers also open the workspace | `shortened` is also fine as drill cards (`doc-15` tier 2) | yes for multi-item shortened papers, no for the one-at-a-time drill loop; the mode decides |
| Section review before submit | reading mode vs answering mode | allow a read-only pass over submitted sections only if it does not slow the exam; defer |
| Whether to add a resizable primitive to `packages/ui` | would be a design-system addition with its own standards | only if collapse proves insufficient |
| Mobile/tablet | out of scope for the desktop-first v1 | revisit with the Tauri mobile targets |
| Review row density | a 60-item paper means 60 rows, and the collapsed stimulus may need a summary line | start with plain rows plus a section filter; revisit when a real paper has been reviewed |

---

## 12. References

Verified this session (file:line):

- `apps/desktop/src/routes/__root.tsx:76` `CHROME_FREE_PATHS`, `:94` `isChromeFreePath` (exact match plus the `/kanji/` prefix branch), `:133` the AskSensei widget renders only when `!chromeFree`
- `apps/desktop/src/routes/ai.tsx:706`-`708` (the chat column: `MessageTranscript` owns its `MessageScroller.Provider`, full-height flex column), `:38` `InputGroup`, `:301` the error-frame container
- `apps/desktop/src/features/mock/jlpt-mock.tsx` (`.Timer` `:93` real and pausable, `.Progress` `:127`, `.Choices` `:175` fieldset radio group, `.Next`, `.ReadingCard`, `.ListeningCard`, `.Score` `:399`, `.Plan` `:461`, `.SubmitFail`)
- `apps/desktop/src/routes/jlpt-mock.tsx` (the seed paper route, unchanged by this doc)
- `apps/desktop/test/route-loaders.test.ts` (new routes need `loader:` + `ensureQueryData` or a `data: local-state` marker)
- `packages/chat-session/src/multi-mount.test.tsx` (two simultaneous Providers do not share state; the three existing chat surfaces)
- `packages/chat-session/AGENTS.md:235` (`CARD_BODIES` dispatch; `STRETCHED_TYPES` for Card-based families)
- `packages/ui/src/components/` (audited: `message-scroller.tsx`, `message.tsx`, `bubble.tsx`, `input-group.tsx`, `textarea.tsx`, `questionnaire.tsx`; **no resizable primitive**)
- `apps/desktop/AGENTS.md` (SCR-10 row; the chrome-free route family and the "different frames per moment" precedent, `setup` `minmax(340px,5fr)` vs the desk's fixed `320px` rail)

Backlog docs: `doc-12` (parent, §9 failure matrix, §1.1 vocabulary), `doc-14` (papers and storage), `doc-15` (chat tiers), `doc-18` (intent resolution), `doc-16` (items), `doc-13` (checkpoint), `TASK-113` (result-layer honesty), `TASK-101` (conversation history), `TASK-110` (host tool card suppression), `TASK-112` (scroll to a pending card).
