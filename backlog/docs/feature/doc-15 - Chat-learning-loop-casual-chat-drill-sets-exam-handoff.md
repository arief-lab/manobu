---
id: doc-15
title: 'Chat learning loop: casual chat, drill sets, exam handoff'
type: specification
created_date: '2026-09-24 05:14'
updated_date: '2026-09-24 09:16'
---
# Chat learning loop: casual chat, drill sets, exam handoff

> **Status:** draft v1
> **Date:** 2026-09-24
> **Type:** specification
> **Parent:** `doc-12` (exam + kana gate). This doc owns the *chat* surface: the conversation tier, the drill-set loop, and how the chat hands off to a paper or a checkpoint.
> **Siblings:** `doc-16` (the item engine this loop consumes), `doc-18` (how a turn becomes a session: layers, slots, the receipt), `doc-14` (papers), `doc-13` (kana checkpoint)
> **Wireframes:** `doc-19` §2 (receipt, confirm, degrade) and §3 (the drill-set card and summary)
> **Asset map (all verified):** ACP chat lane (`/ai`), host-MCP `ask_user` pattern (`packages/acp`), slash lane (`packages/chat-session/src/slash.ts`), FSRS store (`cards` + `revlog`, `apps/server/src/routes/cards.ts`), corpora via `crates/jlpt-mcp`, legacy SSE teacher lane (`/learn/chat`)

---

## 0. Scope

Owns: the three tiers a learner can use, what the chat may do unprompted, how a request routes to a tier, the drill-set interaction contract (card, verdict, explanation, session shape), what persists, and the hand-offs to a paper or a checkpoint.

Does not own: the item itself (`doc-16`), paper assembly and exam storage (`doc-14`), the kana checkpoint's paper and pass rule (`doc-13`), the chat engine's frames and folds (owned by `packages/chat-session/AGENTS.md`).

---

## 1. The three tiers

The chat is the front door. Exams are one branch of it, not the product.

| Tier | Learner says | What happens | Persistence |
| --- | --- | --- | --- |
| **1. Casual** | "what does 〜てしまう mean", "how do I say ...", "I watched a drama and heard やっぱり" | Ordinary conversation. The agent answers with corpus-grounded detail. No quiz, no score, no card | The turn, in the conversation |
| **2. Drill set** | "give me 10 questions on particles", "quiz me on N4 vocab", "I keep getting は and が wrong" | A **bounded drill set**: one multiple-choice item at a time, rendered as a card in the transcript, immediate verdict, optional explanation, then next. Ends with a summary | The items, the picks, and (when FSRS-backed) a real grade |
| **3. Exam** | "N3 mock", "a real N5 paper, I have 40 minutes" | The paper pipeline: blueprint, assembler, validator, then the **exam workspace** (`doc-17`) where the chat stays on the left and the paper (sections, timer, navigation) takes the right pane, then the debrief back in the same thread | The paper (`doc-14` §6) |
| *(branch)* **Kana checkpoint** | "N5 mock" from a learner who has not shown kana | The gate offers the checkpoint first (`doc-13`), then continues into the paper either way | Admission record (`doc-13` §7) |

Tier 1 is where most turns live. Tier 2 is the default way to turn curiosity into retrieval practice. Tier 3 stays deliberately heavier: sections, timing, a paper, a verdict.

---

## 2. What the chat must never do

- **Never quiz unprompted.** A grammar question is answered as a grammar question. If a drill set looks useful, the chat *offers* in one dismissible line ("want three questions on this?"), the same offer-never-force rule as the kana gate (`doc-12` §3.4, D1). Retry-is-the-lesson does not mean test-is-the-greeting.
- **Never invent a score.** Counts come from stored attempts; a "you got 7/10" line is computed, never estimated.
- **Never present a drill item as an exam.** No timers, no sectional bands, no CEFR on tier 2 (`doc-12` §5).
- **Never answer its own question.** When the chat shows an item, the verdict comes from the learner's pick.
- **Never leave the loop endless.** A session has a declared length and an end (the roleplay rule: bounded, not an endless thread, `apps/desktop/src/features/roleplay/roleplay.tsx`).

---

## 3. Routing: explicit first, then deterministic signals

| Input | Tier |
| --- | --- |
| `/quiz`, `/drill` | 2 (args may carry topic, level, count) |
| `/exam`, `/mock` | 3 |
| "give me N questions on X", "quiz me", "test me on" | 2 |
| "mock", "exam", "paper", "test conditions", a level plus a duration | 3 |
| anything else | 1 |

Rules:

- **Explicit commands win.** The slash lane already ships with `source: "builtin" | "acp" | "skill"`, a documented merge priority, and `selectionBehavior: "execute"` explicitly "reserved for future client-side commands" (`packages/chat-session/src/slash.ts`). The drill-set intents are builtins; selecting one is a client-side mode switch, not prompt text. A `/practice` alias is deliberately **not** shipped: `doc-12` §1.1 keeps "practice" for the review desk.
- **The model may propose a tier, the client decides.** A lightweight deterministic classifier (the `packages/agent` keyword-routing precedent) owns the default, and a model proposal can only *ask* (an offer line the learner accepts). This keeps tier selection testable and keeps a hallucinated "let us start your exam" out of the transcript.
- **A tier switch mid-conversation is announced, not silent.** Going from tier 1 to tier 2 shows one line
  ("starting a 10-question set on particles: say stop any time"), and the session ends explicitly.
- **What the sentence means is resolved before any of this.** How slots are extracted, how "particles" becomes
  anchors, and when the learner is asked to confirm is `doc-18`; this section owns only which tier wins.

---

## 4. The drill-set loop

One item at a time, in the transcript, in this order:

1. **Item**: prompt, the passage or audio when the type needs it, options, and a way to pass (`skip`).
2. **Pick**: the learner taps an option.
3. **Verdict**: immediate, local, deterministic: correct or not, and which option was right. Never a spinner, never a round-trip wait for prose. This is the TASK-36 grading rule (no silent grading) applied to chat.
4. **Explanation**: available on demand, and shown automatically after a wrong pick. Anchored: it names the grammar point or the word's sense from the item's anchors. It is marked as generated, and it never replaces the verdict.
5. **Next**, or **end**.

Session shape:

| Property | Value |
| --- | --- |
| Length | declared up front, default 10, settable (`/quiz 5 particles`) |
| Pacing | self-paced, no timer (a timer here would manufacture the panic the kana gate explicitly avoids) |
| Ordering | deterministic policy in `doc-16` §5 (due → weak → new), interleaved, not blocked by topic |
| Adaptation | after 2 consecutive misses on the same anchor: a worked example, then a near-neighbour item; a correct answer after a miss re-queues the original at the end |
| Exit | `stop` any time; the summary reports what actually happened |
| Multi-select | not in v1 (multiple-choice single pick only; the ask card's `multiSelect` is not reused) |

### 4.1 Throughput: the card never waits on the model

If every item were one agent turn, a ten-item set would feel dead, and that would kill tier 2 in practice. The pool
mechanics live in `doc-16` §5.1; the loop-side contract is:

- the set opens only once its first batch is ready, so the receipt and the first item arrive together, never a
  spinner first;
- an open set holds a runway of unasked items and refills it in the background while the learner answers;
- a pick is graded locally and immediately: neither the verdict nor the next item waits for a model turn;
- with the runway empty, the card shows `drill.pending` and offers to end the set. It never invents an item, and it
  never repeats one as if it were new;
- the agent's reaction (acknowledgement, explanation) is asynchronous prose. It may land after the next item is
  already on screen, which is correct: the verdict is the feedback, the prose is the commentary.

### 4.2 Suspension

A learner asks something else mid-set, or closes the app. Three exits, all explicit:

| Event | Behavior |
| --- | --- |
| They ask something else (a question, a paper, a checkpoint) | the set **suspends**: the header shows `3/10 paused`, the conversation carries the detour, and resuming is one action (`resume` / `end`) |
| The app closes mid-set | the session row (`drill_sessions`, `doc-16` §3) resumes on return: asked, answered, remaining and the declared length are stored, never re-derived from the transcript |
| They never resume | the session stays suspended, the app nudges once and stops, and unasked items are never counted as misses |

**Who reacts in prose.** Code owns the verdict, the ordering, the counters and the re-queue. The agent owns acknowledgement, explanation, and the offer of what to do next. That split is the same one `doc-14` §4 uses for papers: the model selects and explains, code decides and grades.

---

## 5. The drill item card (host-MCP, following `ask_user`)

The card is a **host-MCP tool**, not a new transport. The repo already does exactly this for structured human input:

- `apps/server` runs the host `ask_user` MCP server; the ACP session exposes it to the agent (`packages/acp/src/session.ts:468`, "Host-provided servers (apps/server's ask_user MCP, 80.2) bypass the …").
- When the agent calls it, the session **parks** the request (`session.ts:724`, "Park an `ask_user` question set on a session and surface it as an `ask` frame") and the client answers through `chat.answerAsk`, which resolves the parked call (`session.ts:26`), so the tool result flows back to the agent.

So: **`next_drill_item`** is a second host tool in the same server, with the same lifecycle.

```
agent  -> next_drill_item({ sessionId })
server -> { itemId, itemType, prompt, passage?, options[], audio? }      // NO key
learner picks in the card
card   -> resolves the parked call with { itemId, chosenIndex }
server -> { itemId, correct, correctIndex, explanation?, anchors, fsrsVocabId? }
agent  -> reacts (acknowledge, explain, offer next)
```

Why this shape:

| Requirement | How it is met |
| --- | --- |
| **The key never enters the transcript** (D8 rule, `doc-12` §4.4) | the request frame carries prompt and options only; the key is resolved app-side and returned *after* the pick |
| Immediate verdict | the card grades on the resolution payload, so feedback does not wait for an agent token |
| The agent can adapt | the resolution payload is structured (`correct`, `anchors`, `fsrsVocabId`), so adaptation is data, not prose-parsing |
| Replay and reload | the same settle semantics the ask card already has (a replayed row carries lifecycle status and a persisted answered render, `packages/chat-session/src/parts/acp-ask-part.tsx`) |
| No JSON blob in the transcript | the host call must be suppressed from the raw tool-call card exactly as `ask_user` is (TASK-110's allowlist) |
| The card is visible when it matters | the scroll-into-view treatment the ask card got (TASK-112) |
| Layout | the card family is `Card`-based, so it joins `STRETCHED_TYPES` (`packages/chat-session/AGENTS.md:235`) |

**Engine/card plumbing to settle (open item, §12):** `packages/acp` currently parks *asks*. Either generalize that seam into a parked-host-call with a `kind` discriminator, or add a parallel park/answer pair. Generalizing is cleaner and keeps one replay path; it touches `packages/acp` (its own AGENTS contract), so it is a deliberate first step rather than a side effect.

---

## 6. What the learner sees at the end

An honest close, and a deterministic next step (the `doc-10` R1 session-spine rule, TASK-61):

- what was asked and how it went: `7/10`, and the anchors missed with their counts, computed from stored attempts;
- what changed in the schedule: for FSRS-backed items, the real grade written and its next interval from the card row (never the demo-memory interval the legacy lane fakes, `packages/agent/src/subagents/index.ts` `vocabSrsDueCards` uses `{ difficulty: 5, stability: 10 }`);
- one next action: drill the missed anchors, run the same set again, take a paper (`doc-14`), or go back to talking;
- no streak, no percentage-of-mastery bar, no shame copy (R-02: no em dash in user strings).

### 6.1 Copy keys

| Key | String |
| --- | --- |
| `drill.start` | "Starting a 10-question set on particles: say stop any time." |
| `drill.verdict.correct` | "Correct." |
| `drill.verdict.wrong` | "Not quite. The answer is {answer}." |
| `drill.explain.action` | "Why?" |
| `drill.explain.generated` | "Generated from {anchor}." |
| `drill.skip` | "Skip" |
| `drill.stop` | "Stop" |
| `drill.next` | "Next" |
| `drill.pending` | "Preparing the next one." |
| `drill.summary.counts` | "{correct}/{asked}" |
| `drill.summary.schedule` | "Next review: {when}" |
| `drill.summary.next` | "Next: {action}" |
| `drill.suspended` | "{answered}/{declared} paused. Resume or end?" |

Thirteen keys, all in the typed deck (`packages/ui/src/lib/copy.ts:95`) and covered by
`apps/desktop/test/walkthrough-copies.test.ts` where that gate applies.

---

## 7. Persistence and reload

- **The conversation** keeps the items and the picks, like any other turn: the drill card is a transcript card, and the chat already survives reload (blob plus database rows, `doc-12` §4.4 route contract).
- **The session and its attempts** live in `drill_sessions` + `drill_attempts` (`doc-16` §3) so counts, weak anchors and reload state are computed from a record, not from parsing rendered messages.
- **The FSRS write** happens on the pick for FSRS-backed items (word/reading items), through the existing grade route contract (`apps/server/src/routes/cards.ts` `GradeSchema { cardId, grade: again | hard | good | easy }`). Grammar items have no card and do not pretend to.
- **A reload mid-session** restores the session state (asked, answered, remaining, declared length) from the row and offers to continue or end. It never restarts the count as if nothing happened.

---

## 8. The existing lanes, and which one is the vehicle

| Lane | State | Verdict |
| --- | --- | --- |
| `/ai` ACP agent chat | live; cards, slash lane, persistence, host-MCP | **the vehicle** for all three tiers |
| `/learn/chat` SSE teacher lane | retired — `apps/server/src/index.ts:153` `app.route("/learn", …)` and the `/learn/*` route tree were removed in the 2026-09-14 router audit (`TASK-62` still deep-links to `/learn/conjugate|drill|listen` and must be updated before it consumes `doc-16`); the lane's provider registry was empty and its replies were deterministic formatters (`doc-12:381`, `task-129:31`) | **not the vehicle.** Reuse its anchoring idea, do not rebuild the lane. |
| `/drill`, `/review`, `/reader` | focused practice surfaces | consumers of the same items (`doc-16` §9), reached by the bridges |

---

## 9. Hand-offs

- **To a paper (tier 3).** Offered when the learner asks, or once after a completed drill set where the level has enough coverage. The offer states the shape ("an N4 shortened paper, about 20 minutes"), never a promise of a real exam (`doc-14` §2). Accepting it opens the exam workspace (`doc-17`): the chat does not disappear, and in `exam-conditions` mode its composer pauses until submit so the paper's answers cannot be asked for.
- **To the checkpoint.** Only for N5 and `all` requests from a learner with no kana admission (`doc-13` §6). The chat offers it inline, and continues into the paper either way (D1).
- **To the review desk.** Missed FSRS-backed items are already cards with a new due date; the chat can
  deep-link the review desk.
- **To a paper's review pass.** After a paper, the workspace's review rows (`doc-17` §7.1) can hand a single item
  back as a one-item drill set: the item id already exists, so it is a lookup, not a regeneration.
- **To drills.** Missed anchors map to the drill/reader surfaces through the existing weak-pattern bridge (TASK-62), so a miss in chat and a miss in a paper land in the same queue.

---

## 10. Non-goals

- No unsolicited quizzing, no "streak" mechanics, no gamified pressure.
- No multi-select, no free-text answer grading, no speaking tasks inside the inline loop in v1 (out of scope of objective grading, `doc-12` §5).
- No separate drill history surface: the conversation *is* the history; `drill_attempts` is data, not a page.
- No second chat lane. `/learn/chat` is not extended, and no new transport is added for drill sets.
- No timing, scoring bands, or CEFR in tier 2.

---

## 11. Verification

- Routing: explicit commands beat signals; a model "proposal" never starts a session without an accepted offer; every tier is reachable by a test.
- Card lifecycle: a pending item renders interactive; after the pick it renders the settled state with the picked option and the correct option; a replay from stored rows shows the same settled state and no interactive controls.
- **Key containment**: a golden asserting the item frame in the transcript carries no `correctIndex`, and that the resolution (with the key) appears only after the pick.
- No raw tool card: the host drill call does not render a JSON tool-call card (the TASK-110 assertion, extended to this tool name).
- Verdict ordering: the verdict renders before any agent prose, and a wrong pick always shows the explanation affordance.
- Adaptation: 2 consecutive misses on one anchor inserts a worked example then a near-neighbour item; a later correct answer re-queues the missed item once.
- Bounded: a session ends at its declared length; `stop` ends it early and the summary reflects the real counts.
- Honest close: counts equal `drill_attempts`; a non-FSRS item writes no grade; an FSRS item's next interval equals the card row's.
- Degradation: no server or no item available yields an honest "no item right now" line and keeps tier 1
  working. Flattening the model entirely still allows explicit (`/quiz 5 particles`) sessions, per `doc-18` §7.
- **Throughput**: a set does not open before its first batch exists; with the runway emptied and a refill in flight
  the card shows `drill.pending` rather than blocking or repeating; the verdict never waits for a model turn.
- **Suspension**: a mid-set question suspends (header shows the paused count, the paper detour runs), a reload
  restores asked/answered/remaining, and unasked items never count as misses.
- Copy: the thirteen keys in §6.1 exist and contain no em dash, enforced by `packages/ui/test/copy-snapshot.test.ts`.

Commands: `bun run check-types`, `bun run check`, `bun run test` in `apps/desktop`; `bun --filter @manobu/chat-session test`; `bun test` in `apps/server`.

---

## 12. Open items

| Item | Why it is open | Recommendation |
| --- | --- | --- |
| Parked-call seam in `packages/acp` | asks are parked today; a drill answer needs the same park/resolve with a different payload | generalize into a parked host call with a `kind` discriminator, keeping one replay path |
| Slash builtin registration | `source: "builtin"` exists in the merge but no builtin set ships | ship `/quiz`, `/drill`, `/exam` as builtins in the composer feed |
| Session default length and topic syntax | product taste, and the arg parser has to be simple | default 10; `/quiz 5 particles`; no nested grammar |
| Whether the agent or the client opens the next item | affects latency and who owns the loop | settled in §4.1: the client draws from the runway on pick-resolution; the agent narrates asynchronously |
| Runway size and batch cost | latency versus token spend, and the numbers are guesses until measured | 3-item runway, batches of 5 (`doc-16` §5.1); tune with the local counters (`doc-18` §8) |
| `/learn/chat` future | it is live but stub-quality | leave parked; if it is ever revived, it must consume `doc-16` items rather than grow its own formatters |

---

## 13. References

Verified this session (file:line):

- `packages/acp/src/session.ts:26` (the ask resolves through `answerAsk()`), `:468` (host-provided servers, apps/server's ask_user MCP), `:724` (park an ask and surface it as an `ask` frame); `packages/acp/src/session-types.ts:38`; `packages/acp/src/acp-events.ts:133`, `:201`
- `packages/chat-session/src/parts/acp-ask-part.tsx` (the ask card adapter: submit via `chat.answerAsk`, replay settle via `resolutionFrom`)
- `packages/chat-session/src/slash.ts` (`SlashCommandSource`, `SlashSelectionBehavior` with `execute` reserved, `mergeSlashCommands` priority)
- `packages/chat-session/src/chat-engine/types.ts:87` (the `ask` frame as the `ask_user` host-MCP request)
- `packages/chat-session/AGENTS.md:235` (`CARD_BODIES` dispatch, `STRETCHED_TYPES`)
- `apps/server/src/routes/cards.ts` (`GradeSchema { cardId, grade }`, `/cards`, `/cards/due`, `/cards/grade`; `gradeMap` again 1 … easy 4)
- `apps/server/src/routes/learn-chat.ts` (SSE lane: `route()` orchestrator, "v1 doesn't call a real LLM provider", formatters, `/nextCards`); `apps/server/src/index.ts:153` (`app.route("/learn", learnRoute)`)
- `apps/server/src/services/next-cards.ts` (`generateNextCards`, corpus-anchored)
- `packages/agent/src/index.ts:105` `classify` (the four-way regex that is *not* an intent layer; `doc-18` owns the replacement)
- `packages/agent/src/subagents/index.ts` (`conversationCoachGrammarCheck`, `grammarExplainerLookupPattern`, `kanjiTutorDecompose`, `vocabSrsDueCards` with demo memory `{ difficulty: 5, stability: 10 }`)
- `packages/db/src/schema/user.ts:9` `cards`, `:29` `revlog`, `:68` `conversations`, `:83` `messages`
- `crates/jlpt-mcp/src/main.rs:141/182/210/227/355/367` (anchor tools)
- `apps/desktop/src/features/roleplay/roleplay.tsx` (bounded-session precedent)

Backlog docs and tasks: `doc-12` (parent), `doc-18` (intent resolution and session setup), `doc-16` (item engine), `doc-14` (papers), `doc-17` (exam workspace), `doc-13` (checkpoint), `doc-10` (R1 next step), `TASK-61`, `TASK-62`, `TASK-110` (host tool card suppression), `TASK-112` (scroll to the pending card), `TASK-113` (result-layer honesty).
