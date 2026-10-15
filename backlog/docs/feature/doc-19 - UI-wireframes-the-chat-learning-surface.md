---
id: doc-19
title: 'UI wireframes: the chat learning surface'
type: specification
created_date: '2026-09-24 09:02'
updated_date: '2026-09-27 17:37'
---
# UI wireframes: the chat learning surface

> **Status:** draft v3 (v2's frames redrawn from rendered screenshots for §6.1, §6.3, §7.1, §7.2 and §8; §12.2 records the pass, what it corrected, and the three surfaces it could not reach)
> **Date:** 2026-09-24
> **Type:** specification
> **Parent:** `doc-12`. This doc owns **what each surface looks like**: text wireframes for every screen this feature adds or changes, the states each screen has, and the copy key behind every string.
> **Siblings:** `doc-13` (kana checkpoint), `doc-14` (paper pipeline), `doc-15` (chat loop and card), `doc-16` (items), `doc-17` (workspace layout contract), `doc-18` (intent resolution). A frame shows the shape; the sibling owns the behavior.
> **Verified constraints:** `/ai` composition (`apps/desktop/src/routes/ai.tsx:706`-`708`, `STARTERS` at `:81`, chips rendered at `:800`); mock wizard parts (`apps/desktop/src/features/mock/jlpt-mock.tsx:93` `Timer`, `:127` `Progress`, `:175` `Choices`, `:247` `SectionBadge`); ask card `AcpAskCard` (adapter `packages/chat-session/src/parts/acp-ask-part.tsx`); tool card shell `packages/ui/src/components/tool-call-card.tsx`

---

## 0. Why wireframes, and what they are not

Seven specs describe behavior; only `doc-17` §1 carried a frame. Everything else left the shape to the implementer, which is how one feature gets built twice.

These are **ASCII wireframes**, deliberately:

- They cannot drift from tokens the way a mock can: no color, no spacing scale, no font. Color and spacing come from the theme (sumi/kibari/ai/shu) and the existing primitives, unchanged.
- They are diffable, so a layout change lands in the same pull request as the code.
- They are honest about what is undecided: a frame writes `{anchors}` where a real surface renders real anchors.

| Convention in a frame | Meaning |
| --- | --- |
| `key.name` | the copy key that owns the string (`doc-13` §8.1, `doc-14` §7.1, `doc-15` §6.1, `doc-17` §7.2, `doc-18` §10) |
| `Ⓐ Ⓑ Ⓒ` | a state variant, described under the frame |
| `[ ... ]` | a button or chip |
| `{...}` | interpolated data, never literal text |
| `···` | content continues, elided for the drawing |

Every string inside a frame obeys R-02 (no em dash). Where a frame needs a separator it uses `·`, `:`, or a period. The frames are also the cheapest way to catch a copy key that names a string nobody renders.

---

## 1. Surface inventory

| Surface | Route / mount | New or changed | Frame | Behavior owned by |
| --- | --- | --- | --- | --- |
| Chat, tier 1 | `/ai` | existing, gains intent handling | §2.1 | `doc-15` §2, `doc-18` |
| Intent receipt + confirm | inline in `/ai` | new | §2.2 to §2.4 | `doc-18` §4, §5 |
| Drill set, tier 2 | inline host card in `/ai` | new | §3 | `doc-15` §4, §5 |
| Kana checkpoint, tier 1.5 | inline card, wizard steps | new | §4 | `doc-13` |
| Paper request | inline in `/ai` | new | §5 | `doc-14` §7 |
| Exam workspace, tier 3 | `/exam/$examId` | new | §6 | `doc-17` |
| Result | right pane of the workspace | hardened from the seed version | §7 | `doc-12` §2, `TASK-113` |
| Review after submit | right pane, `review` phase | new | §8 | `doc-17` §7.1 |
| Degraded states | wherever they happen | new | §9 | `doc-12` §9 |

No frame adds a global navigation item. The chat is the doorway to all four tiers, and the workspace is the only new route.

---

## 2. Intent: how a turn becomes a session

### 2.1 The vehicle at rest (tier 1)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [← desk]   ● New Chat                 [12% ctx] [persona ▾] [history] ⟳    │
│             How can I help you today?                                      │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│    Sensei                       ← the empty-state card's title             │
│    Morning, manobu!                                                        │
│    What are we working on today?                                           │
│                                                                            │
│    [ Hiragana practice ]  [ What does 食 mean? ]  [ は vs が ]             │
│    [ Plan my week ]                                                        │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│ [ slash menu floats over this row when the draft starts with / ]           │
│ Type your message...                    [Default ▾]      [ Send ]          │
└────────────────────────────────────────────────────────────────────────────┘
```

Every string above was read off the running route, not invented: `Sensei` (empty-state title), `Morning, manobu!`, `What are we working on today?`, the placeholder `Type your message...`, the picker label `Default`, `Send`, and the four chips with testids `chat-suggestion-*` (`doc-19` §12.1). The chips are the real `STARTERS` (`apps/desktop/src/routes/ai.tsx:81`) and are already an L0 entry point (`doc-18` §2), so a chip must start the session its text would start if typed. Tier 1 shows no receipt and no card (`doc-18` §5): a misread here costs one turn.

### 2.1.1 What a live turn looks like in this transcript

The drill card, the receipt and the confirm in the frames below are not floating in space: they land inside a transcript that already renders roles and a waiting signal. Drawn from the same running route:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ You                                                                        │
│   what does 食 mean?                                                       │
│ AI Assistant                                                               │
│   Thought        ← thinking-label, the live strip (TASK-111)               │
│   食 (shoku / ta·beru) means to eat or food. As a standalone               │
│   reading, 食べる (tabe-ru, …)                                             │
│ 28,653 tokens      ← context-usage chip in the header                      │
└────────────────────────────────────────────────────────────────────────────┘
```

Consequence for the frames that follow: a receipt or a drill card is **another part in this sequence**, so it inherits the role labels around it and must not introduce its own transcript chrome. The waiting signal while it builds is the thinking strip's, not a spinner of its own.

### 2.2 Receipt and confirm card (L2 to L3)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ you                                                                        │
│   quiz me on particles but make it ten                                     │
│                                                                            │
│ ⚙ drill set · particles (は, が, に, で) · 10 items · N5   ← intent.receipt│
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  Start reading from this?                    ← intent.confirm.prompt  │ │
│  │   ( ) Start        ( ) Change   ← single-select option rows           │ │
│  │   [ Submit ]  disabled until one is chosen      [ Decline ]           │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

The card is the parked ask card (`AcpAskCard`), and its real flow is **select, then Submit**: the Submit button stays disabled until the question is answered, Decline sends a decline receipt, and a resolved ask collapses to a compact summary line (`packages/ui/src/components/acp-ask-card.tsx`, TASK-86). The resolved state in the transcript is therefore:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ⚙ resolved: Start · drill set · particles (は, が, に, で) · 10 items · N5 │
└────────────────────────────────────────────────────────────────────────────┘
```

- Options are `intent.confirm.start` and `intent.confirm.change`; the prompt is `intent.confirm.prompt`.
- **Validation gap, now closed:** this frame was first drawn as a one-tap confirm, which the component does not do. `doc-18` §5 has been aligned to the shipped flow (one question, `multiSelect: false`, options `Start` and `Change`, Submit disabled until one is chosen, Decline meaning no session), so the frame, the spec and `AcpAskCard` now say the same thing.
- The receipt is a transcript line, not a toast: it survives reload, so a wrong reading stays visible and `intent.correct.action` can call it out.

### 2.3 Clarify once, then fall back (L4)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ you                                                                        │
│   give me some practice                                                    │
│ sensei                                                                     │
│   What should the questions be about?       ← intent.clarify.topic         │
│ you                                                                        │
│   whatever                                                                 │
│ ⚙ drill set · N5 vocabulary · 10 items      ← default taken, and shown     │
└────────────────────────────────────────────────────────────────────────────┘
```

Clarification is a single question, never a menu (`doc-18` §4). When nothing resolves at all, L4 answers casually and offers once; the next unresolvable turn does not repeat the offer.

### 2.4 No anchors, no session

```
┌────────────────────────────────────────────────────────────────────────────┐
│ you                                                                        │
│   quiz me on keigo                                                         │
│ sensei                                                                     │
│   No N5 items on that topic. Nearest is に vs で. Use that?                │
│                                    ← intent.noAnchors                      │
└────────────────────────────────────────────────────────────────────────────┘
```

Nothing opens until the offered topic is accepted. The learner is never shown an empty set, and the chat never invents an item to fill one.

---

## 3. Drill set (tier 2)

### 3.1 The set opens when the first batch is ready

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ⚙ drill set · particles (は, が, に, で) · 10 items · N5                   │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  Preparing your set: 1 of 10 ready          ← drill.pending           │ │
│  │  ▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

The bar counts **validated items**, not elapsed time (`doc-16` §5.1). It appears only for the first batch; later batches stream in behind the current question and never take over the card.

### 3.2 The item card

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ⚙ drill set · particles                     Q 3/10                         │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  私は 学校 ___ 行きます。                                             │ │
│  │                                                                       │ │
│  │    [ に ]   [ で ]   [ を ]   [ が ]      ← 2 to 4 choices            │ │
│  │                                                                       │ │
│  │    Ⓐ unanswered   Ⓑ correct   Ⓒ wrong                                 │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│ Ⓐ the only interactive state: tapping a choice grades it                   │
│ Ⓑ に  ✓  correct · に marks the destination   ← drill.verdict.correct      │
│    [ Explain ]   [ Skip ]                     ← drill.explain.action       │
│ Ⓒ で  ✗  not quite. に marks the destination  ← drill.verdict.wrong        │
│    [ Explain ]   [ Next ]                     ← drill.next                 │
└────────────────────────────────────────────────────────────────────────────┘
```

- Verdicts are **data first, prose second**: the option states are component state (correct ring, wrong ring, as the mock's `Choices` does at `features/mock/jlpt-mock.tsx:175`) and the explanation is a chat turn. `drill.explain.generated` labels a generated explanation so it is never mistaken for corpus text.
- `drill.skip` and `drill.stop` sit beside the card, not inside a menu.
- A skipped or unanswered item is never counted as a miss in the summary.

### 3.3 Suspended on a detour

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ⚙ drill set · particles                    3/10 paused                     │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  Paused while you ask. 7 items waiting.     ← drill.suspended         │ │
│  │    [ Resume ]      [ End set ]                                        │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│ you                                                                        │
│   why is に the destination marker?                                        │
│ sensei                                                                     │
│   ···                                                                      │
└────────────────────────────────────────────────────────────────────────────┘
```

A detour suspends the set, and the counter states how many items remain (`doc-15` §4.2). The transcript stays chronological, so the learner's question appears after the pause card rather than inside it.

### 3.4 Summary and one next step

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ⚙ drill set complete · 7 of 10 correct, 1 skipped, 2 unasked               │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  Next review scheduled: particles in 2 days  ← drill.summary.schedule │ │
│  │  Weakest: は vs が, 3 wrong                  ← drill.summary.counts   │ │
│  │    [ Drill the weak 3 ]   [ Make it an N5 mock ]                      │ │
│  │                               ← drill.summary.next                    │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

Exactly **one deterministic next step** is the primary action (`doc-15` §6). The numbers must equal the stored `drill_attempts` rows, not a recount of the card.

---

## 4. Kana checkpoint (tier 1.5, `doc-13`)

### 4.1 The offer on the path to an N5 paper

```
┌────────────────────────────────────────────────────────────────────────────┐
│ you                                                                        │
│   give me an N5 mock                                                       │
│ ⚙ N5 shortened paper. Before that: a kana check? 46 items,                 │
│   about five minutes.                                                      │
│                                       ← kana.gate.offer                    │
│   [ Start the check ]   [ Skip for now ]   ← kana.gate.skip                │
│ Readiness: not established                ← kana.gate.source               │
└────────────────────────────────────────────────────────────────────────────┘
```

The offer is default-on and never a lock (D1): skipping opens the paper, and a skip never records a pass. `kana.gate.source` names which admission source is in play (`checkpoint`, `drill-coverage`, `skip`), so a paper never implies a check that did not happen.

### 4.2 The item, in kind groups

```
┌────────────────────────────────────────────────────────────────────────────┐
│ kana check · hiragana          group 3/22 · item 2/2                       │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │   Which reading?                            ← kind label              │ │
│  │                                                                       │ │
│  │       [ し ]     [ つ ]     [ ち ]     [ ら ]                         │ │
│  │                                                                       │ │
│  │   きゃく → [ き ] [ ゃ ] [ く ]   ← word-level row                    │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

- Six kinds plus word-level sokuon and chōonpu items (D3). Progress is per group (`kana.checkpoint.group`), never a percentage.
- **Untimed.** No clock appears anywhere in this wizard, because the pass rule is coverage, not speed.

### 4.3 Result, pass and fail

```
┌────────────────────────────────────────────────────────────────────────────┐
│ kana check · hiragana                          blocked ✗                   │
├────────────────────────────────────────────────────────────────────────────┤
│ kind          correct   items   group rule                                 │
│ gojuon          20/22     22    one row fully wrong                        │
│ dakuten            8/8      8    ok                                        │
│ yoon             12/14     14    ok                                        │
│ word-level          2/2      2    ok                                       │
│ total            42/46   = 91%   rule 1 passes, rule 2 blocks              │
│                            ← kana.checkpoint.fail                          │
├────────────────────────────────────────────────────────────────────────────┤
│ [ Review the 4 you missed ]        ← kana.result.review.title              │
│ [ Retake ]      ← unlimited, regenerated, cooldown from 3rd                │
└────────────────────────────────────────────────────────────────────────────┘
```

This is `doc-13` §4's own worked example, not an invented one: 42/46 is 91%, which clears the coverage rule, and the two wrong answers sitting in one `(kind, row)` group block the pass anyway. The pass header is `kana.checkpoint.pass`, the fail header is `kana.checkpoint.fail`, and both carry the queue affordance `kana.checkpoint.queue`, because a checkpoint result cannot share the mock's weak-pattern path (`doc-13` §3.5).

**Validation note:** the frame first said `40-item` and `group 3/12`. `doc-13` §4 sizes the paper at **2 items per group across 11 gojuon rows + 4 dakuten + 7 yōon groups, plus 2 word-level items = about 46 per script** (92 for both), so both numbers were wrong and are fixed here.

### 4.4 Mid-set correction (the third case in `doc-18` §6)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ you                                                                        │
│   not particles, は and が                                                 │
│ ⚙ drill set · は vs が · 6 items left, 4 superseded                        │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  は vs が: the topic and the subject      ← the next item             │ │
│  │    [ は ]   [ が ]   [ を ]   [ に ]                                  │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

A correction re-resolves the anchors and **supersedes the unasked items** (`doc-16` §5.1), and the receipt says so in numbers rather than in prose. Unasked items are never counted as misses, and the set does not restart: the answered four stay answered.

### 4.5 Cooldown

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Third failed hiragana attempt today. Next retake in 21h.                   │
│                                  ← kana.checkpoint.cooldown                │
│ [ Keep drilling kana ]                                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

The cooldown gates the scored checkpoint only. It never blocks the drill set or the paper.

---

## 5. Paper request and assembly (`doc-14`)

### 5.1 Receipt, then real lead time

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ⚙ N4 shortened paper · Vocab / Grammar·Reading / Listening · 45 min        │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  Building your paper: 34 of 42 slots validated                        │ │
│  │                                     ← paper.build.running             │ │
│  │  ① Vocab 12/12 ✓   ② Grammar·Reading 10/18 …                          │ │
│  │  ③ Listening 12/12 ✓                                                  │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

The counts are **real validated slots**, never a synthetic bar (`doc-14` §7). A paper stays `draft` until every section validates, so this frame cannot reach 100% with a hole in it. The section names are `doc-14` §2.2's for N4 (Vocab / Grammar·Reading / Listening) and the size clears the D5 floor: 42 items, with at least 10 in every 60-point section and at least 20 in the 120-point one (`doc-14` §2.3). `paper.build.failed` carries the reason (`insufficient pool at this level`, `validator vetoed N items`) and a retry, and copy must never claim a paper exists while the state is `draft`.

### 5.2 Failed, honestly stated

```
┌────────────────────────────────────────────────────────────────────────────┐
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  Could not build this paper. 41 of 45 slots validated.                │ │
│  │  ③ Listening: only 8 usable items at N4 today.                        │ │
│  │                             ← paper.build.failed                      │ │
│  │    [ Try a smaller paper ]   [ Use the built-in N4 sample ]           │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

The two recoveries are the ones the failure matrix promises: a smaller budget still clears the floor, and the seed paper always exists (`doc-12` §9, `apps/desktop/src/lib/mock.ts:106`). A failed build never leaves the learner with a spinner and no paper.

### 5.3 Ready

```
┌────────────────────────────────────────────────────────────────────────────┐
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  Your N4 paper is ready: 42 items, 3 sections.                        │ │
│  │    [ Start the paper ]   [ Preview the plan ]                         │ │
│  │                               ← paper.mode.shortened                  │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│   (exam-conditions papers say so here instead: paper.mode.examConditions)  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Exam workspace (`/exam/$examId`, `doc-17`)

### 6.1 `shortened`: chat left, running paper right

```
┌────────────────────┬───────────────────────────────────────────────────────┐
│ Paper chat          │ ← desk   N5                     [ Hide chat ]        │
│  N5 paper           │                                                      │
│                     │┌──────────────────────────────────────────────────┐  │
│  AI Assistant       ││ 1 Vocabulary  active                                │
│                     ││ 2 Grammar·Reading  pending                          │
│  N5 paper           ││ 3 Listening  pending                                │
│  shortened paper    │└──────────────────────────────────────────────────┘  │
│  In progress        │┌──────────────────────────────────────────────────┐  │
│                     ││ Section 1                                           │
│  Vocabulary         ││ Vocabulary                                          │
│    10/10 · ready    ││ shortened pace · 05:38                              │
│  Grammar·Reading    │├──────────────────────────────────────────────────┤  │
│    10/10 · ready    ││ Q 4/10                                              │
│  Listening          ││ Choose the option that…                             │
│    10/10 · ready    ││ [ A. ]        [ B. ]                                │
│                     ││ [ C. ]        [ D. ]                                │
│                     ││ [ Next ]                                            │
│ [ composer: LIVE ]  ││ 7 unanswered  [ Submit section ]                    │
│                     ││ [ Abandon ]                                         │
└────────────────────┴───────────────────────────────────────────────────────┘
```

The chat column is `minmax(360px, 32%)` and collapses; the paper never becomes the cramped half (`doc-17` §2). The composer stays **live** in `shortened`, because the items show their own verdict anyway (`doc-17` §4). `exam.collapse.toggle` is the control, and the preference persists.

**Corrected 2026-09-26 against the rendered pane** (`img/doc-19-exam-workspace-shortened.png`). Three claims in the previous frame were wrong: the section chips carry **status words** (`1 Vocabulary  active`, `2 Grammar·Reading  pending`) and are not navigation, so the circled numbers and the `✓` are gone; the header stacks `N5` over `shortened paper` with `← desk` on the left and `Hide chat` on the right, so the inline `N4 · shortened paper` and the word `[collapse]` are gone; and the pane shows a `7 unanswered` count plus an `Abandon` trigger that the old frame did not draw at all.

### 6.2 `exam-conditions`: same frame, four differences

```
┌────────────────────────────────────────────────────────────────────────────┐
│ chat                     │ N4 · exam conditions                            │
│                          │ ② Grammar·Reading     ⏱ 18:42 remaining         │
│  [ composer: PAUSED ]    │   [ Pause ]  paused 0 times so far              │
│                          │                                                 │
│  Your paper is running.  │ ┌──────────────────────────────────────────┐    │
│  Questions unlock at     │ │ Q 7/18  [prompt]                         │    │
│  submit.                 │ │ [ choice ] [ choice ] [ choice ]         │    │
│                          │ │ [ Next ]            [ Submit section ]   │    │
│  ← exam.paused.composer  │ └──────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────────┘
```

| Difference | `shortened` | `exam-conditions` |
| --- | --- | --- |
| Clock | scaled pace label, no band implied | official per-section countdown (`doc-14` §2.2) |
| Composer | live | paused with `exam.paused.composer`, plus a pause counter (`exam.pause.action`) |
| Pause | free | allowed and **recorded** (`exam.pause.recorded`) |
| Time up | not applicable | `exam.section.timeUp` auto-submits the section and never clears an answer |

Warnings are `exam.timer.fiveMin` and `exam.timer.oneMin`, and they are announcements, not dialogs.

### 6.3 Narrow window

```
┌────────────────────────────────────────────────────────────────────────────┐
│← desk    N5   shortened paper              [ Show chat ]                   │
├────────────────────────────────────────────────────────────────────────────┤
│ 1 Vocabulary  active     2 Grammar·Reading  pending    3 Listening  pending│
│┌──────────────────────────────────────────────────────────────────────────┐│
││ Section 1                                 [ Resume ]                      │
││ Vocabulary · shortened pace · 05:38                                       │
│├──────────────────────────────────────────────────────────────────────────┤│
││ Q 4/10                                                                    │
││ Choose the option that best completes the sentence.                       │
││ [ A. ]            [ B. ]                                                  │
││ [ C. ]            [ D. ]                                                  │
││ [ Next ]                                                                  │
││ 7 unanswered                    [ Submit section ]  [ Abandon ]           │
│└──────────────────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────────────┘
```

Below the breakpoint the chat collapses by default and the toggle is prominent (`doc-17` §2). The exam is never the surface that shrinks first.

**Corrected 2026-09-26** (`img/doc-19-exam-workspace-narrow.png`): the collapsed chat is a `Show chat` **button** in the header, not an icon rail, and the section chips sit above the card rather than inside it.

### 6.4 Submit and abandon

```
┌────────────────────────────────────────────────────────────────────────────┐
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  Submit the last section? 3 questions unanswered.                     │ │
│  │    [ Submit ]        [ Keep going ]       ← exam.section.submit       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  Abandon this paper? No score is recorded, and it stays in            │ │
│  │  history marked abandoned.            ← exam.abandon.confirm          │ │
│  │    [ Abandon ]       [ Back to the paper ]                            │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

Abandon is two-step and never records a `0` (`exam.abandon.done`). Both confirms are inline cards rather than modals, so the paper stays visible behind them.

---

### 6.5 Resume after reload

```
┌────────────────────────────────────────────────────────────────────────────┐
│ chat                     │ N4 · shortened paper  resumed mid-paper         │
│                          │ ┌──────────────────────────────────────────┐    │
│  the request turn        │ │ Grammar·Reading   12:04 left             │    │
│  and the paper-ready card│ │ Q 11/18  [prompt]                        │    │
│                          │ │ [ choice ] [ choice ] [ choice ]         │    │
│  [ composer: LIVE ]      │ │ [ Next ]           [ Submit section ]    │    │
│                          │ └──────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────────┘
```

A reload lands on the same question with the same remaining section time, because answers are persisted per pick and the paper's own `conversation_id` reopens the thread (`doc-14` §6, `doc-17` §3). Paused time keeps counting against the recorded total, not against the learner's silence.

---

## 7. Result (right pane, `TASK-113` rules)

### 7.1 Above the viability floor

```
┌────────────────────────────────────────────────────────────────────────────┐
│Result    shortened paper                                                   │
│Overall 60/180                                                              │
│Total 60/180 against 80, plus each section.                                 │
│Not passed                                                                  │
│                                                                            │
│Language Knowledge·Reading                    42/120 · Pass                 │
│Listening                                   18/60 · Not passed              │
│                                                                            │
│[ Your answers ]                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

Both gates appear, because the official rule is two gates (`doc-4` §1.4): a paper can fail overall while every section passes. The rendered pane states each gate in its own line: the total in a sentence (`Total 60/180 against 80, plus each section.`) and each section as a word (`Pass` / `Not passed`) rather than a glyph, so the frame carries words where the first draft carried `✓`.

Two things this frame promised that the rendered pane does **not** show, recorded in §12.2 rather than drawn: the per-section **marks** (the data carries `passMark` 38 and 19, the pane does not print them) and any **CEFR or pause summary** (both are absent by design, and a CEFR badge on a real paper would be the defect `TASK-113` closed). The `Your answers` button is the only footer control; the weak-anchors handoff is not on this surface.

**Validation notes on this frame.** Three drafts of this frame were wrong, and the third correction is the one that matters. `sectionalPassMark` (`apps/desktop/src/lib/mock.ts:259`) returns 38 for `lang` and 19 for `reading`/`listening` at N4, so the first version's `Reading·Grammar 22/60 ✗` was internally impossible (22 clears 19). The second draft then drew three badges that summed to 240 against a mark of 180, because `sectionCaps` (`lib/mock.ts:238`) returns `120 + 60 + 60` for N4/N5. That was recorded as a gap in §13; **the gap was in the section set, not the arithmetic**. The official report gives N4 and N5 **two** scoring sections, Language Knowledge (Vocabulary/Grammar)·Reading at 120 and Listening at 60, so this frame now draws two badges that add up to the headline and is the first draft of the frame that is additive by construction. Declared in `doc-12` §2.6 and D11; the implementation is `TASK-113`.

**The names in this frame are derived, not written.** `Language Knowledge·Reading` and `Listening` come from `examScoringSectionLabel({ id, level })` in `packages/api-contract/src/exam.ts`, the one function the chat summary, the result pane, the paper fold and the offline fallback call. The id alone cannot pick the name: at N4/N5 the reading items score inside `language-knowledge`, so that id is the combined column, while at N1/N2 it is the split one and `reading` is its own column. Before `TASK-137` five private maps each re-decided this and their default arm named the N4/N5 column `Vocabulary` in the chat while the pane beside it said `Language Knowledge·Reading` (§12.2 finding 3). `apps/server/test/exam-section-labels.test.ts` pins every name against the official set per level, in blueprint order, and the frame cannot drift from it silently.

### 7.2 Below the floor

```
┌────────────────────────────────────────────────────────────────────────────┐
│Result    shortened paper                                                   │
│Shortened paper: item counts only.                                          │
│                                                                            │
│1/1 correct                                                                 │
│                                                                            │
│Vocabulary   1/1                                                            │
│                                                                            │
│[ Your answers ]                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

Below the floor (band points / 6 per item, D5) the frame shows **raw counts and an honest label**, and the badge components are absent from the DOM rather than dimmed. The wording is `shortened paper`, never an official-score equivalence.

The buckets differ by mode on purpose. Below the floor the counts are the **test** sections (`lang`, `reading`, `listening` as the paper asks for them), because a raw count needs no cap to be true. Above the floor the bands are the **scoring** sections, which at N4/N5 fold reading into language knowledge, so three buckets become two (D11). A builder who carries the three-bucket shape into the banded view is reintroducing the 240-versus-180 bug.

### 7.3 Degraded: the agent died mid-paper

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ⚙ Your paper is unaffected. The agent will pick it up at submit.           │
└────────────────────────────────────────────────────────────────────────────┘
```

The paper continues **headless**: items, timer, submit and results are code, not the model (`doc-12` §9). The debrief returns when the agent does.

---

## 8. Review after submit (`doc-17` §7.1)

```
┌────────────────────────────────────────────────────────────────────────────┐
│Your answers                                     [ Hide review ]            │
│┌──────────────────────────────────────────────────────────────────────────┐│
││ ▸ Q 1. Choose the option that best completes the sentence.                │
││   A. 電車 ✓                      B. バス                                  │
││   C. 自転車                      D. 飛行機                                │
││   You chose 電車                 Answer: 電車                             │
││   Built from vocab:N5:454be2c4bdf6084269cf                                │
││   [ Try this one again ]   [ Report a wrong answer ]                      │
│├──────────────────────────────────────────────────────────────────────────┤│
││ ▸ Q 2. {prompt}                                                           │
│└──────────────────────────────────────────────────────────────────────────┘│
│[ Send these to the desk ]   ← only when an item is wrong                   │
└────────────────────────────────────────────────────────────────────────────┘
```

- The correct option is **data** and always present. The explanation is **prose** and may be generated, but no exam item has one: nothing in this repo authors exam prose (`TASK-145` is parked), so the row's `explanation` is null and the `drill.explain.generated` block stays out of this frame. The pane opens that block only when the debrief returns non-null prose *and* says it was generated, because the two debrief fields arrive independently and a flag cannot vouch for text (`apps/desktop/src/features/exam/exam-paper-pane.tsx` `shouldRenderExplanation`).
- `Replay this item` resolves by item id, so it lands on that item in a fresh set instead of restarting the paper.
- `Dispute` marks the item `disputed` and removes it from future pools (`doc-17` §7.1). The frame states the effect, because the learner is changing shared content. After the action the same control reads `Disputed` and disables, so the row shows the state it is now in.

**Corrected 2026-09-26 against the rendered review** (`img/doc-19-review.png`). The row is a disclosure (`▸ Q 1. {prompt}`) that opens onto the **options with the correct one ticked**, which the old frame omitted, and the three fact lines are `You chose {answer}` / `Answer: {answer}` / `Built from {anchor}` rather than `your pick:` / `answer:` / `anchor:`. There is no `Result` / `Review` tab pair and no item count in the header: the surface is a `Your answers` heading with a `Hide review` toggle. `[ Explain ]` does not exist as a control; the explanation renders inline as a generated block when there is one. `Replay this item` renders as `Try this one again` and `Dispute` renders with the deck's own wording, `This answer is wrong` - a learner reads that as a verdict, so the label is a live question, not a drawing detail. `[ Send these anchors to the desk ]` is real but **conditional**: it renders only when at least one item was answered wrong.

**Corrected 2026-09-28 (`TASK-137`), three things this frame drew that the surface no longer renders.** The generated-explanation block is gone from the exam row: the server stopped stamping every candidate item with the stub `explanation` (`apps/server/src/services/exam-service.ts` now stores null), so the row has no prose to open and the frame above no longer shows one. The dispute control is an action, `Report a wrong answer`, and therefore a button in brackets rather than a bare statement. And each scoring section now has one name from one source: `packages/api-contract/src/exam.ts` `examScoringSectionLabel({ id, level })` is what the chat summary, the result pane, the paper fold and the offline fallback all call, so the §7 column headers and the chat line beside them cannot diverge again. The 2026-09-26 capture `img/doc-19-review.png` predates all three and is kept as the record of what that pass found.

---

## 9. Empty and failure states, drawn

Every row of the failure matrix (`doc-12` §9) has a surface, and the rule they enforce is that a degraded state **names what still works**: none is a dead end with one disabled button.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ The desk is offline. Your last stored session still opens. [ Retry ]       │
│ You're offline: cached lessons still work, AI disabled  ← error.offline    │
│ This build needs a database update before drills can run. [ Update ]       │
│ No usable items on that topic right now. Try a wider topic?                │
│ That is all the corpus has on this topic: 6 of 10 items.                   │
│ 🔇 No audio output · pitch diagrams + type fallback still work             │
│ Kana data could not be read. Re-download it in Settings.                   │
│ Running without the AI right now. /quiz 5 particles still works.           │
│                                  ← intent.degraded.model                   │
│ Backwards clock: the timer clamps, the result records it. No banner.       │
└────────────────────────────────────────────────────────────────────────────┘
```

Three of those reuse existing deck keys (`voice.no_output` for offline TTS, `error.offline` for the chat route, and the rest of the offline family under `error.*`), which is why they are not new keys in §11.

The chat row is the one the running app does not honor yet. Verified in a browser on 2026-09-24 (§12.1): with the server down the desk degrades honestly (`sensei offline — the desk still works`) while `/ai` renders `Failed to open the chat: Failed to fetch` inside an error boundary. The frame states the intended line, `doc-12` §9 carries the same observation in its failure row, and §13 keeps it open until it ships.

---

## 10. Cross-cutting, visible in every frame

| Concern | Rule | Where a frame shows it |
| --- | --- | --- |
| Contrast | text on a solid fill clears WCAG AA 4.5:1; one theme, no `dark:` variants | every chip and verdict state |
| Focus order | transcript, then card actions, then composer | §3.2, §6.4 |
| Keyboard | choices are buttons; the drill card answers on `1` to `4`; `Enter` accepts, `Esc` dismisses | §3.2, §6.4 |
| Live regions | verdicts, timers and progress are polite announcements | §3.2, §6.1 |
| Motion | no animated dash where text is the signal | §3.1 counts instead |
| Copy voice | no em dash in user strings (R-02), enforced for the deck by `packages/ui/test/copy-snapshot.test.ts` | every string in this doc |
| Scroll | the transcript is the only scroller in the chat column; the paper pane scrolls independently | §6.1 |
| Focus trap | no modal anywhere: confirms are inline cards | §6.4 |

---

## 11. Copy keys by frame

| Frame | Keys |
| --- | --- |
| §2.1, §2.1.1 the vehicle at rest | **no key exists yet**: the empty state is passed as props from the route (`emptyTitle="Morning, manobu!"`, `emptyDescription="What are we working on today?"`, `apps/desktop/src/routes/ai.tsx:797` - `:798`), and the chips come from `STARTERS` (`apps/desktop/src/routes/ai.tsx:81`, rendered `:800`). Giving these strings a key is part of the `doc-20` sweep, not of this feature |
| §2.2 receipt and confirm | `intent.receipt`, `intent.confirm.start`, `intent.confirm.change`, `intent.confirm.prompt`, `intent.correct.action`, `intent.correct.done` |
| §2.3 clarify and fallback | `intent.clarify.topic`, `intent.degraded.model` |
| §2.4 no anchors | `intent.noAnchors` |
| §3 drill set | `drill.pending`, `drill.start`, `drill.verdict.correct`, `drill.verdict.wrong`, `drill.explain.action`, `drill.explain.generated`, `drill.skip`, `drill.stop`, `drill.next`, `drill.suspended`, `drill.summary.counts`, `drill.summary.schedule`, `drill.summary.next` |
| §4 kana | `kana.gate.offer`, `kana.gate.skip`, `kana.gate.source`, `kana.checkpoint.pass`, `kana.checkpoint.fail`, `kana.checkpoint.group`, `kana.checkpoint.cooldown`, `kana.checkpoint.queue`, `kana.result.review.title`, `kana.settings.reset` |
| §5 paper | `paper.mode.shortened`, `paper.mode.examConditions`, `paper.build.running`, `paper.build.failed` |
| §6 workspace | `exam.collapse.toggle`, `exam.paused.composer`, `exam.pause.action`, `exam.pause.recorded`, `exam.section.submit`, `exam.section.timeUp`, `exam.timer.fiveMin`, `exam.timer.oneMin`, `exam.abandon.confirm`, `exam.abandon.done` |
| §7 result | `paper.result.rawOnly`, `paper.result.twoGates`, `paper.debrief.weak`, `paper.debrief.notSaved` |
| §8 review | `exam.review.title`, `exam.review.yourPick`, `exam.review.answer`, `exam.review.anchor`, `exam.review.replay`, `exam.review.sendToDesk`, `exam.review.dispute` |
| §9 empty and failure states | no new keys: reuses the existing `error.*` family and `voice.no_output` |

Every key in this table exists in the sibling that defines it. A frame that needs a string with no key is a spec bug, not a licence to inline the string.

The one row that breaks that rule is §2.1: the strings the running `/ai` actually renders come from route props and a route constant, so the frame pins real text with no key behind it. That is the state of the code, not a frame defect, and it is why the sweep in `doc-20` is a prerequisite rather than a tidy-up.

**Checked against the running surface 2026-09-26.** All 57 keys named above exist in `packages/ui/src/lib/copy.ts`, so the "every key exists" claim holds. Two shapes the check found, both recorded rather than papered over:

- **Keys that render conditionally.** `exam.review.sendToDesk` and `paper.debrief.weak` render only when at least one item was answered wrong, so a clean paper shows neither. The frames marked the control unconditionally; the redrawn §8 marks it.
- **A frame control with no key and no render.** §7.1's previous `[ Send the weak 6 to the desk ]` had neither a key nor a render anywhere: the handoff that key would own is not on the result surface. The frame no longer draws it. §8's `[ Explain ]` is the same shape and is gone for the same reason.

The one row that still breaks the rule is §2.1, unchanged: the empty-state strings and the starter chips render from route props and a route constant with no key behind them.

---

## 12. What was validated against the code

Every frame was checked against the source on 2026-09-24. Five claims did not survive and are fixed in the frames above; the one that is a spec problem rather than a drawing error is in §13.

| Frame | Claim | Evidence | Result |
| --- | --- | --- | --- |
| §2.1 | the four chips are the real starter labels | `apps/desktop/src/routes/ai.tsx:81` `STARTERS` | matched |
| §2.1 | empty state is `Morning, manobu!` / `What are we working on today?`, chips render as outline chips in it | `packages/chat-session/src/message-transcript.tsx:66`, `apps/desktop/src/routes/ai.tsx:786` | matched |
| §2.1 | the status dot sits with the title, not the subtitle | `routes/ai.tsx` header `h1` | **fixed** |
| §2.2 | confirm resolves in one tap | `AcpAskCard` holds Submit disabled until answered, plus Decline, and collapses once resolved (TASK-86) | **fixed in both places**: the frame shows select then Submit then the compact resolved line, and `doc-18` §5 was rewritten to match |
| §4.1, §4.2 | the check is 40 items over 12 groups | `doc-13` §4: 2 per group × (11 gojuon + 4 dakuten + 7 yōon) + 2 word-level = about 46 per script | **fixed**: 46 items, `group 3/22` |
| §4.3 | a plausible passing result | `doc-13` §4's worked example: 42/46 = 91% still blocks when one group is fully wrong | **fixed**: the frame now uses that example |
| §5.1, §5.2 | section names and paper size | `doc-14` §2.2 N4 = Vocab / Grammar·Reading / Listening; §2.3 floor = ≥10 per 60-cap section, ≥20 per 120-cap | matched after sizing the example at 42 items |
| §7.1 | `Reading·Grammar 22/60 ✗` | `sectionalPassMark` (`apps/desktop/src/lib/mock.ts:259`) gives 19 for reading at N4, so 22 would pass | **fixed**: `Reading 15/60 ✗`, with the mark shown |
| §7.1 | the badges add up to the headline | the official model (`jlpt.jp/e/guideline/results.html`): N1 to N3 score three sections of 60; N4 and N5 score **two**, Language Knowledge (Vocab/Grammar)·Reading at 120 and Listening at 60. `sectionCaps` (`lib/mock.ts:238`) invents a third at N4/N5, which is the whole of the 240 | **fixed, and it was a section-set bug**: the frame draws two badges that sum to 180, declared as `doc-12` §2.6 / D11 and redrawn in §7.1 |
| §4.4 | a mid-set correction supersedes the earlier receipt rather than starting a second session | `doc-18` §6, third case | matched; the frame is new in v2 |
| §5.2 | a failed build has a real recovery | `apps/desktop/src/lib/mock.ts:106` is the built-in N4 sample the frame offers | matched; the frame is new in v2 |
| §6.5 | a reload resumes on the same question and the same section time | answers persist per pick; the paper carries its own `conversation_id` (`doc-14` §6, `doc-17` §3) | matched; the frame is new in v2 |
| §7.2 | below the floor is `1 correct of 1` | D5: a 60-point section needs 10 items | matched, and the frame now says why |
| §9 | offline TTS reuses a deck key | `voice.no_output` in `packages/ui/src/lib/copy.ts` | matched |

### 12.1 Browser pass (2026-09-24)

A real browser pass was run against the dev server (`bun run dev` in `apps/desktop`, `http://localhost:3001`), driven route by route. What it changed:

| Surface | What the browser showed | Effect on this doc |
| --- | --- | --- |
| `/jlpt-mock` | `mock-progress` = `Q 1/9`, 4 choices, and the helper line renders as `Choose an answer to continue · 40% opacity until choice` | §3.2's card shape and the deck's middot all confirmed, including that the R-02 deck fix is live in the app |
| `/jlpt-mock` end to end | after 9 answers the result screen renders `Language 40/120 ✓`, `Reading 0/60 ✗ (2 wrong)`, `Listening 60/60 ✓`, with **no CEFR element and no overall-gate element** in the DOM | **§7.1 is now confirmed rather than predicted**: a one-item listening section really does score its full 60-point cap, and the two missing outputs are missing in the running app, exactly as `doc-12` §2.2 to §2.5 claim |
| `/dashboard` | renders with the server down: `sensei offline — the desk still works`, plus the lesson card | §9's first line is real behavior on the desk, not an aspiration |
| `/ai` with the sidecar up | **the route works**: header `← desk` / `New Chat` / `How can I help you today?`, empty state `Sensei` / `Morning, manobu!` / `What are we working on today?`, four `chat-suggestion-*` chips, placeholder `Type your message...`, `Default` picker, `Send`; a real turn rendered `You`, the answer, `AI Assistant`, a `Thought` strip (`thinking-label`) and `28,653 tokens` | §2.1 now uses these verified strings, and **new §2.1.1** draws the live turn these frames land in. Config matters: the app calls same-origin `/rpc` + `/ws`, vite has no proxy, so a browser session needs the sidecar on `:3000` **and** `VITE_SERVER_URL=http://localhost:3000` |
| `/ai` with no sidecar | **dies into an error boundary**: `Failed to open the chat: Failed to fetch`, `← Back to history`, `Start a new chat`, with a `FetchLinkTransport` TypeError in the console. Part of this was missing config (no `VITE_SERVER_URL`), but the same boundary is what a learner sees if the sidecar is genuinely gone, because `/ai` has no offline branch | **finding stands, now in §9**: the frame list gained the chat route's honest offline line (`error.offline`), and the same observation is a row in `doc-12` §9 |
| `/settings`, `/drill` | rendered strings carry em dashes verbatim (`No goal picked yet — the first-run page will ask...`, `a · Apple — sharp (katakana)`, `stroke data offline — pick or say still work`) | `doc-20`'s inventory is real, not a static-analysis artifact |

What the browser pass could **not** cover: the drill set, the kana checkpoint, the confirm card, the exam workspace and the review phase do not exist yet, so nothing is rendered to compare against for §2.2, §3 to §6 and §8. Those stay unvalidated until they are built, which is why rendered screenshots remain an open item in §13.

---

### 12.2 Rendered frames pass (2026-09-26)

A browser pass ran against the real stack: the sidecar on `:3000` against a throwaway `DATABASE_URL`, vite on `:3001` (its `/rpc` + `/ws` proxy is why `VITE_SERVER_URL` had to be pointed at `:3000` explicitly, since `apps/desktop/.env` sets it to the Tauri port `4317`). Every exam below was seeded through the sidecar's own RPC surface (`exam.request` → `assemble` → `start` → `answer` → `submit`), and the drill item through the real WS surface (`chat.startDrill`), so no state on these surfaces is hand-written into the database.

| §1 inventory row | Captured | Evidence |
| --- | --- | --- |
| Chat, tier 1 (`/ai`) | yes | `img/doc-19-drill-card.png` (a real parked drill card in a real conversation) |
| Intent receipt + confirm (§2.2-§2.4) | **no** | needs a live agent turn that parks an `ask_user`; the fake agent is test-only and not reachable from a browser, and a real CLI turn is not deterministic enough to audit against |
| Drill set, tier 2 (§3) | yes | `img/doc-19-drill-card.png` |
| Kana checkpoint (§4) | **no, and not only because it is unbuilt** | the branch exists (`jlpt-mock.tsx:635` renders `KanaCheckpointResult` when `source === "checkpoint"`), but the only mount passes neither prop (`routes/jlpt-mock.tsx:220`), so `source` defaults to `"mock"` and the checkpoint surface is unreachable in the running app |
| Paper request (§5) | partial | the paper-ready card is real and visible in the chat column of every workspace capture; the receipt (§5.1) needs a live agent turn |
| Exam workspace (§6.1, §6.2, §6.3) | yes | `img/doc-19-exam-workspace-shortened.png`, `img/doc-19-exam-workspace-exam-conditions.png`, `img/doc-19-exam-workspace-narrow.png` |
| Result (§7.1, §7.2) | yes | `img/doc-19-result-mixed.png` (60/180, one section failing), `img/doc-19-result-raw-only.png` (below the floor), `img/doc-19-result-banded.png` (180/180) |
| Review after submit (§8) | yes | `img/doc-19-review.png` (30 rows) |
| Degraded states (§9, §7.3) | **no** | the desk's offline line was captured in §12.1; §7.3 needs an agent killed mid-paper, which a seeded paper cannot produce |

Alt text, one line each:

- `doc-19-exam-workspace-shortened.png` — the N5 workspace in `shortened`: chat column left with the paper card and a live composer, paper right with three status-word section chips, a `Section 1 / Vocabulary` card reading `shortened pace · 05:38`, question 4 of 10 with four options in a two-by-two grid, `Next`, `7 unanswered`, `Submit section` and `Abandon`.
- `doc-19-exam-workspace-exam-conditions.png` — the same paper in `exam-conditions`: the section card reads the official `20:00` instead of a pace label, a `Paused 1 times, 12s total.` line sits under the card, the composer is disabled and the chat shows `Your paper is running. Questions unlock at submit.`
- `doc-19-exam-workspace-narrow.png` — the same workspace at 760px: the chat is gone behind a `Show chat` button and the paper takes the full width.
- `doc-19-result-mixed.png` — a submitted N5 paper at 60/180 against 80: `Not passed` overall, `Language Knowledge·Reading 42/120 · Pass` and `Listening 18/60 · Not passed`, which is the case the old frame could not show (it drew a passing top line with a failing section).
- `doc-19-result-raw-only.png` — a one-item paper below the viability floor: `Shortened paper: item counts only.`, `1/1 correct`, one raw count, no bands and no pass claim.
- `doc-19-result-banded.png` — a 30-item N5 paper answered entirely correctly: 180/180 with both sections passing.
- `doc-19-review.png` — the review phase expanded: 30 disclosure rows, each with the options and the correct one ticked, `You chose` / `Answer` / `Built from`, a generated-explanation block, `Try this one again` and `This answer is wrong`. **Captured before `TASK-137`**: the generated-explanation block and the verdict-shaped dispute label are both gone from a real row now, so §8's frame is the current surface and this capture is the evidence for §12.2 findings 2 and 4.
- `doc-19-drill-card.png` — a real tier-2 drill set in `/ai`: the card reads `Drill set`, `N5 · kanji-reading`, `1/3`, one question, four options stacked full width, `Skip` and `Stop`.

**What the pass corrected in the frames.** §6.1 (status-word chips, the stacked header, the `Hide chat` label, the unanswered count and the `Abandon` trigger that were not drawn), §6.3 (a `Show chat` button, not an icon rail), §7.1 (words instead of `✓`, the total stated in a sentence, and the removal of three things the pane does not render: the sectional marks, the CEFR line and the pause summary), §7.2 (the real raw-only shape, which states the label but not the reason), §8 (the disclosure row with its options, the three fact-line labels, and the conditional desk button). Each correction is noted in the section it belongs to, not only here.

**What the pass found that is a defect, not a drawing error.** Recorded here because this pass is what surfaced them; none is a doc change, and each now has an owner: `TASK-135` (the shuffle), `TASK-136` (the missing checkpoint mount) and `TASK-137` (the three result/review honesty items, findings 2 to 4).

1. **Every generated paper's correct answer is option A.** FIXED in `TASK-135` (the order is a seeded Fisher-Yates over the item identity again, and the gate has a seam for it); the mechanism below is kept because it is the kind of defect a frame cannot show: All 30 items in a seeded paper carry `answerIndex: 0`, and every rendered review row ticks `A.`. The cause is in `packages/item-engine/src/paper.ts:679` `hashString` combined with `deterministicOptionOrder`: the option index is appended as the **last** character of the hash input, and a djb2-style hash makes the final character's code the lowest-order term, so `hash(prefix + "0") < hash(prefix + "1") < ...` for **any** prefix. Sorting by that hash is therefore the identity permutation, `shuffleQuestionItemOptions` never reorders, and `answerIndex` stays `0`. This is the same shuffle `doc-14` §4 and `doc-16` §3 promise is seeded and per-item, so both docs currently overstate what the code does.
2. **The generated-exam debrief renders a placeholder as if it were generated prose.** FIXED in `TASK-137` (`apps/server/src/services/exam-service.ts` stores `explanation: null` for a composed item, and both consumers gate on it); the mechanism below is kept because the stub outlived the surface it was written for: Every review row shows `Generated from vocab:{anchor}.` above the literal string `server-only explanation`, which is the stub `explanation` that `apps/server/src/services/exam-service.ts` puts on every candidate item. The label is honest about provenance and dishonest about the text. The same stub reached the replayed drill's why-answer panel too (`packages/ui/src/components/drill-card-states.tsx`), so the fix had to be at the source rather than one surface's render condition, and `explanationGenerated` derives from that column, which made the flag dishonest as well while the stub stood.
3. **The same fact carries two labels in one screen.** FIXED in `TASK-137` (one level-aware `examScoringSectionLabel({ id, level })` in `packages/api-contract/src/exam.ts` is now the only name source, and the emitted paper frame carries section *ids* so a stored row cannot replay a stale name); the mechanism below is kept because it is the shape of the bug, not its text: The chat column summarises the first scoring section as `Vocabulary 120/120` while the result pane beside it says `Language Knowledge·Reading 120/120`. Both are the same 120-point section (`doc-12` §2.6 folds reading into language knowledge at N4/N5). Five private maps each re-derived the name from the id, each with a partial `if` chain whose default arm swallowed the two ids that need a level to be named, so the same screen said two true-but-different things and no single edit could make them agree.
4. **A copy key reads as a verdict.** FIXED in `TASK-137` (`packages/ui/src/lib/copy.ts` `exam.review.dispute` is `Report a wrong answer`, pinned by `packages/ui/test/copy-snapshot.test.ts`); the note below is kept because the wording was the finding: `exam.review.dispute` renders the words `This answer is wrong` on a button, including on rows the learner answered correctly (the row's own `data-correct` is `true`). It is a Dispute action, not a statement about the answer. The label is now an action verb on every row, correct or not, which is why the correct-row case is no longer contradictory; the after-state reads `Disputed`.

**Not reachable, restated for the record:** the ask/confirm card, the kana checkpoint and §7.3's dead-agent state. The first needs a live agent turn, the second has no mount at all, the third needs an agent killed mid-paper.

---

## 13. Open items

| Item | Why it is open | Recommendation |
| --- | --- | --- |
| ~~Rendered frames for the unbuilt surfaces~~ | **closed 2026-09-26** (§12.2): the workspace, result, review and drill card are captured as screenshots with alt text, and every frame they contradicted is redrawn. Three surfaces remain uncaptured for stated reasons: the ask/confirm card (needs a live agent turn), the kana checkpoint (**no mount exists** — `routes/jlpt-mock.tsx:220` passes no `checkpoint`/`source` prop, so the branch at `jlpt-mock.tsx:635` is unreachable) and §7.3's dead-agent state | the kana checkpoint mount is the actionable one: it is a component without a route, and every §4 frame is unvalidated until it has one |
| The chat route has no degraded state | with the sidecar unreachable `/ai` renders an error boundary (`Failed to open the chat: Failed to fetch`) while the desk degrades honestly, and the boundary is what a learner sees whether the cause is a dead sidecar or a missing dev config | the chat surface needs the same honest offline line as the desk (row added in §9, `doc-12` §9 updated). Until then the L4 fallback in §2.3 only covers a dead agent, not an unreachable server |
| Local chat dev needs two processes and an env var | a browser session on `/ai` fails unless the sidecar runs on `:3000` and `VITE_SERVER_URL` points at it, because vite proxies neither `/rpc` nor `/ws` | document it in the developer setup (or add the vite proxy) so the next person does not diagnose a product gap where there is a config gap |
| Card width in the chat column | the drill card and the ask card must share one measure or the transcript looks ragged | one transcript card width token, decided when the drill card ships |
| Where the receipt lives after reload | the receipt must persist, but the session header is per turn | keep it in the transcript and carry the same anchors on the session row |
| Dispute surface | `Dispute` changes shared corpus content and there is no review queue drawn | decide between an admin list and a local counter before shipping §8 |
| Empty-state illustration policy | the app ships no illustrations today | stay text-only, and revisit only if a state tests as confusing |
| Terminal width | every frame is exactly 78 **display** columns, counted with CJK glyphs at double width, and `tmp/gen-doc-19.py` raises instead of emitting a ragged frame. The app has no terminal | treat width as an authoring convention, not a UI constraint |
| Section points versus the 180 total | **settled (D11, `doc-12` §2.6)**: two scoring sections at N4/N5, so the badges add to 180. What is still open is the implementation, not the rule | `TASK-113`: change `sectionCaps` and `sectionalPassMark` at N4/N5, fold the `reading` bucket into `lang` for banding, and leave N1 to N3 untouched. The §7.1 frame is the target shape |

---

## 14. References

Verified this session (file:line):

- `apps/desktop/src/routes/ai.tsx:81` `STARTERS` (the four real chips), rendered at `:800`; column composition `:706` - `:708`; header `← desk` pill and `session-dot`
- `apps/desktop/src/features/mock/jlpt-mock.tsx:93` `Timer` (`mock-timer`, `mock-timer-toggle`), `:127` `Progress` (`mock-progress`, `Q {n}/{total}`), `:175` `Choices` (fieldset legend is the prompt, correct and wrong rings), `:247` `SectionBadge`
- `packages/chat-session/src/parts/acp-ask-part.tsx` (`AcpAskCard` adapter; resolution kinds `answered`, `declined`, `expired`)
- `packages/ui/src/components/tool-call-card.tsx` (the tool card shell and result bodies the drill card reuses)
- `apps/desktop/src/lib/mock.ts:244` `overallPassMark` (zero consumers; `TASK-113` AC #7), `:270` `cefrForScore`
- `packages/ui/test/copy-snapshot.test.ts` (the R-02 guard these frames must satisfy)
- `packages/ui/src/components/acp-ask-card.tsx` (Submit gating, Decline, compact resolved state: the flow §2.2 draws)
- `packages/chat-session/src/message-transcript.tsx:66` (starter chips render as outline chips inside the empty state)
- `apps/desktop/src/lib/mock.ts:238` `sectionCaps`, `:244` `overallPassMark`, `:259` `sectionalPassMark` (the numbers in §7, and the 240-versus-180 gap in §13)

Backlog docs: `doc-12` (parent, §9 failure matrix, §1.1 vocabulary), `doc-13`, `doc-14`, `doc-15`, `doc-16`, `doc-17` (§1 frame, §2 layout contract), `doc-18`. Tasks: `TASK-113` (result-layer honesty), `TASK-44` (migrations), `TASK-101` (history), `TASK-110`, `TASK-112`.
