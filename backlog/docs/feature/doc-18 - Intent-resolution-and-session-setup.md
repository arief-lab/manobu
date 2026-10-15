---
id: doc-18
title: Intent resolution and session setup
type: specification
created_date: '2026-09-24 05:53'
updated_date: '2026-09-24 09:42'
---
# Intent resolution and session setup

> **Status:** draft v2
> **Date:** 2026-09-24
> **Type:** specification
> **Parent:** `doc-12`. This doc owns how one chat turn becomes a session: which tier it is, what it is about, how a topic becomes corpus anchors, what the learner is told back, and how a wrong reading is corrected.
> **Siblings:** `doc-15` (the tiers and the drill-set loop this sets up), `doc-16` (the items), `doc-14` (papers), `doc-13` (checkpoint), `doc-17` (the workspace a paper runs in)
> **Wireframes:** `doc-19` §2 (the receipt, the confirm card, clarify, no anchors)
> **Verified constraints:** `classify()` (`packages/agent/src/index.ts:105`) is a four-way regex; `CopyKey` (`packages/ui/src/lib/copy.ts:15`), deck (`:95`), R-02 guard `packages/ui/test/copy-snapshot.test.ts`; `STARTERS` (`apps/desktop/src/routes/ai.tsx:81`, rendered `:800`); `packages/chat-session/src/slash.ts` (builtins, `selectionBehavior: "execute"` reserved)

---

## 0. Scope

Owns: the five resolution layers, the slot table, topic-to-anchor resolution, the receipt rule, the confirm card, mid-session corrections, the resolution counters, and the strings all of that shows.

Does not own: the tier table and the never-do list (`doc-15` §2-§3), the loop, card and summary (`doc-15` §4-§6), the item itself (`doc-16`), paper assembly (`doc-14`), or the workspace a paper runs in (`doc-17`).

---

## 1. Why this doc exists

The feature is only as good as the sentence it understands, and today there is no intent layer at all.

- `classify()` (`packages/agent/src/index.ts:105`) is a four-way regex: `KANJI_HINT|CJK` → kanji, `GRAMMAR_HINT|HIRAGANA` → grammar, `VOCAB_HINT` (`review|srs|due|interval|fsrs`) → vocab, else conversation. **Any message containing a single hiragana character is classified `grammar`**, so "how do I say I am hungry" routes to the grammar sub-agent. It also lives on `/learn/chat`, the lane `doc-15` §8 parks.
- The vehicle (`/ai`, the ACP lane) has no router: the agent decides in prose, so tier selection is unobservable and untestable.

That produces three failures, all of which the learner experiences the same way ("it did not understand me"):

| Failure | Example | What it costs |
| --- | --- | --- |
| Not a tier | "give me 10 questions on particles" answered as a question *about* particles | tier 2 never starts; the learner asked for practice and got prose |
| Wrong topic | "particles" echoed back as a keyword and turned into a corpus keyword search | the set contains は and が in arbitrary order and misses what the learner asked for |
| Wrong scope | "an N5 mock" answered with ten drill items | the paper never opens, and a scored surface was never created |

The fix is not a bigger prompt. It is a resolution step with named layers, a receipt the learner can read, and one correction path.

---

## 2. The five layers

| Layer | Mechanism | May start a session? | May override |
| --- | --- | --- | --- |
| **L0 explicit** | the slash lane (`/quiz 5 particles`, `/exam N3`) and the starter chips already on the surface (`STARTERS`, `apps/desktop/src/routes/ai.tsx:81`, rendered at `:800`) | yes, alone | everything |
| **L1 deterministic slot grammar** | a small pure parse of the message: tier verbs (EN and JP), level tokens `N[1-5]`, counts, duration, scope words (`due` / `weak` / `new`), topic phrase. No model | yes; confirms when the session is scored | nothing above it |
| **L2 model proposal, structured** | the agent's reading of the turn, emitted as a host tool call (`{ tier?, level?, count?, anchors[] }`), never prose that has to be parsed | **no.** It becomes a receipt or an offer line the learner accepts | nothing; it proposes |
| **L3 confirm** | one line carrying `Start` / `Change`, reusing the parked host call (§5) | completes the session the proposal described | the proposal |
| **L4 fallback** | nothing resolvable: answer the turn casually and offer once | no | nothing |

Rules:

- **A session starts only when the slots are complete** (see §3). Defaults fill the gaps: count 10, mode `shortened`, level from the level store. The one gap that is never defaulted silently is the **topic**: if the sentence names no topic and the conversation has none, ask exactly once.
- **The model may propose, the client decides** (the rule `doc-15` §3 already states). L2 output never starts anything by itself, which is what keeps a hallucinated "let us begin your exam" out of the transcript.
- **L0 beats prose.** `/exam N3 aah sorry N4` is N3: the argument is parsed, the trailing sentence is not.
- **Tier 1 is the fallback, not a session.** A misread there costs nothing, so ambiguity resolves *down* to conversation, never up to a scored surface.
- **L4 offers once.** When nothing resolves, the turn is answered as conversation and the offer is made a single time; the next unresolvable turn does not repeat it, because an offer that nags is a demand. The offer carries the same session a starter chip would start.

---

## 3. Slots

| Slot | Source | Default | Notes |
| --- | --- | --- | --- |
| `tier` | L0-L2 | conversation | the tier table is `doc-15` §3 |
| `level` | L0/L1 plus §4.1 ("N4 vocab", the last paper's level) | `getLearnerLevel()` (`apps/desktop/src/lib/learner-level.ts:47`) | no store value and no mention: ask once (§7) |
| `topic` | L0/L1/L2 → §4 | none | the only slot that is never silently defaulted |
| `count` | L0/L1 ("10 questions", "5 more") | 10 | bounded: a request over 30 is announced, not silently capped |
| `mode` | L0/L1 ("under exam conditions") | `shortened` | papers only (`doc-14` §2.1) |
| `duration` | L0/L1 ("I have 60 minutes") | mode default | papers only; also decides the tier when both are plausible (§7) |

---

## 4. From topic to anchors

"Particles" has to become ids before anything can be built from it, otherwise the topic is decoration.

| Learner says | Resolves to | Where it comes from |
| --- | --- | --- |
| particles | the N5 particle grammar points as a set (は, が, に, で, を) | `list_grammar_by_level` |
| は vs が | the contrast pair, two grammar ids, one scope | `list_grammar_by_level` |
| て-form | the て-form grammar point plus verb anchors | grammar + `verbs-n5.json` |
| N4 vocabulary | the `n4.json` surface at that level | `list_vocab_by_level` |
| katakana words | katakana-kind cells (`kana.json`) plus loanword entries | `kana.json`, `n{level}.json` |
| my weak points | the last result's weak pattern ids | `deriveWeakPatterns` (`apps/desktop/src/lib/mock.ts:145`) |

Rules:

- **Topic resolution is a corpus query, not a keyword echo.** The resolved anchor list is stored on the session row (`drill_sessions.anchors`, `doc-16` §3), so the summary, the weak counts and the hand-off to a paper all read the same ids the set was built from.
- **The receipt rule.** Every session that will be scored or persisted states what it understood, in one line, naming the resolved anchors rather than the keyword: "drill set: particles (は, が, に, で) · 10 items · N5". Tier 1 never shows a receipt.
- **No anchors, no session.** If the corpus query returns nothing at that level, the chat says what it did find ("no N5 items on that topic; nearest is に vs で") and offers to switch topic or level. It never invents an item and never opens an empty set.
- **One question at most.** Clarification is a single question, never a menu; if the learner answers "whatever", the default is taken and the receipt is shown, so the choice stays visible.

---

### 4.1 Referential resolution reads stored rows, not confidence

"The stuff I keep getting wrong" is only answerable because the wrong answers have somewhere to live. Every referent below names the store it reads; none is inferred from the sentence alone.

| Learner says | Resolved from | State |
| --- | --- | --- |
| "the stuff I keep getting wrong" | the last paper's weak pattern ids (`deriveWeakPatterns`, `apps/desktop/src/lib/mock.ts:145`) plus, once it exists, the stored anchors of past attempts (`drill_attempts`, `doc-16` §3) | the derive ships; the attempts table is specified, not built |
| "the same as last time" | the previous `drill_sessions` row's stored filter and anchors (`doc-16` §3) | specified |
| "harder" / "easier" | a one-step move on the learner level store (`getLearnerLevel` `apps/desktop/src/lib/learner-level.ts:47`, `setLearnerLevel` `:49`), applied to the next batch only | ships |
| "my reviews" / "due" | the review queue: the `cards` table (`packages/db/src/migrations/0000_sour_master_chief.sql:63`) read through `batchNext` (`apps/desktop/src/lib/review.ts:33`) with intervals from `previewIntervals` (`packages/srs/src/index.ts:172`). The same rows the review desk shows | ships |
| "that one" / "this" | the anchors of the last item in the transcript (deictic), never a corpus search | needs item ids on the transcript turn (`doc-16` §3) |
| "N4 vocab" | the level token plus the corpus query `list_vocab_by_level` (`crates/jlpt-mcp/src/main.rs:182`) at that level | ships |

Rules:

- **A missing referent is said out loud, not guessed.** "The same as last time" with no previous session produces an out-loud line and a default offer, never an invented filter.
- **Deictic reference is transcript-scoped.** "That one" resolves inside the open conversation; it never expands into a corpus query.
- **A referent never widens scope silently.** "Harder" moves the level for the next batch and leaves the declared length and topic alone.
- **Referents are re-resolved each batch, not frozen at session start.** The store moved under the session, so the next batch reads it again and the receipt states any change.

## 5. Explicit versus inferred: when to confirm

| Situation | Receipt | Confirm (`Start` / `Change`, Decline for no session) |
| --- | --- | --- |
| `/quiz 5 particles` (L0 complete) | yes | no: it starts |
| "quiz me on particles" (inferred) | yes | yes |
| "N4 mock" (tier 3, always expensive) | yes | yes |
| tier 1 conversation | no | no |

The rule: **confirm when the session is inferred or expensive; never when the learner already spelled it out.** The confirmation is one question with two answers, and it is not a form.

Mechanically it reuses the parked host call the ask card already uses (`packages/chat-session/src/parts/acp-ask-part.tsx`, `doc-15` §5): **one question, `multiSelect: false`, options `Start` and `Change`**, with the card's own Decline wired to "just chat" so a declined confirm starts nothing scored. Two behaviors of the shipped card are part of this contract rather than incidental:

| Card behavior | Source | Why the spec depends on it |
| --- | --- | --- |
| Submit stays disabled until an option is chosen | `AcpAskCard` all-answered gating (`packages/ui/src/components/acp-ask-card.tsx`) | the learner performs an explicit act, which is what makes this a decision and not a nudge |
| A resolved card collapses to a compact summary line | `AcpAskCard` compact terminal states (TASK-86) | reopening the conversation shows what was decided, not a live form again |

**The flow is select, then Submit: two steps, not one tap.** That is accepted cost, not an oversight: a one-tap variant would mean a second card component maintained for the confirm alone, and confirming a scored session is exactly the moment where an explicit act is defensible. A learner who ignores the card and keeps typing is resolved as `Change` rather than blocked, and Decline means no session starts.

`Change` reopens the resolution in prose ("What should I change: topic, level, or length?") instead of showing four fields, because the correction is usually about one slot and the learner already knows which.

---

## 6. Mid-session corrections

The learner corrects in the middle of a set, so each correction maps to a deterministic effect the client applies. The agent narrates it; nothing is negotiated in prose.

| Learner says | Effect |
| --- | --- |
| "harder" / "easier" | step the level for the next batch, recorded on the session |
| "not particles, は and が" | re-resolve the anchors; unasked items are superseded (`doc-16` §5.1) |
| "stop" | end the session; the summary is computed from stored attempts |
| "5 more" | extend the declared length by 5, recorded |
| "make it an exam" | hand off to tier 3 with the current anchors as the paper's `focus` (`doc-14` §3) |
| "why was that wrong" | the current item's explanation; no state change |

---

## 7. When resolution cannot succeed

| Situation | Behavior |
| --- | --- |
| No model available | L0 and L1 are client-side, so `/quiz 5 particles` still works. An inferred session does not start; tier 1 continues. This is the degradation that matters most, because it is also the offline case |
| Both tiers plausible ("test me on N4 grammar for 30 minutes") | the duration decides (a stated duration is tier 3), and the receipt states which was chosen and offers the other |
| Level unknown, no store value | ask once, remember the answer, never guess |
| Topic with no anchors | §4's nearest-topic line, no session |
| The same turn contains two topics | the first is used and named in the receipt; the second becomes a follow-up suggestion, not a silent second session |

---

## 8. Instrumentation (local, telemetry off)

Counters kept locally, in the spirit of the `gsm` counters and the telemetry-off default: sessions started per tier, receipts shown, confirmed, changed; clarifications asked; no-anchor outcomes; corrected topics; and mis-resolutions reported from the receipt's "not what I meant" action.

Read from Settings, and the reason is not curiosity: without them, tuning the intent layer is guesswork and the failure mode is invisible, because a learner who is misunderstood simply stops asking. No counters leave the machine.

---

## 9. Verification

- **L0**: `/quiz 5 particles` starts a 5-item set on the particle anchors with no confirm step; `/exam N3` opens a paper.
- **Extraction**: "give me 10 questions on particles" → tier 2, particles, count 10; "an N5 mock" → tier 3; "what does 〜てしまう mean" → tier 1. That last case is the `classify()` counterexample: it contains hiragana, so today's router would send it to the grammar sub-agent.
- **Receipt**: shown for every scored or persisted session, naming resolved anchors rather than the keyword; absent on tier 1.
- **Confirm**: inferred sessions confirm, explicit ones do not, and a free-text turn during a confirm resolves it as `Change` without blocking.
- **No anchors**: a topic with no corpus items at the level produces the nearest-topic line and no session.
- **Correction**: "not particles, は and が" re-resolves and supersedes unasked items; "stop" ends with counts that equal the stored attempts.
- **Degradation**: with the model unavailable, explicit sessions still start and inferred ones do not.
- **L0 chips**: a starter chip starts the session its text describes, through L1, without a model turn.
- **L2 shape**: a proposal carrying an empty `anchors[]` starts nothing; what the learner sees is the receipt or the offer.
- **L4 once**: an unresolvable turn is answered as conversation with one offer, and the next unresolvable turn does not repeat it.
- **Referents**: "the same as last time" with no previous session produces the out-loud line in §4.1, not an invented filter.
- **Copy**: every string in §10 exists in the typed deck, and R-02 is enforced rather than asserted: `packages/ui/test/copy-snapshot.test.ts` fails on an em dash in any key's `primary`, `edge` or `error`, and the deck is clean as of v2.

Commands: `bun run check-types`, `bun run check`, `bun run test` in `apps/desktop`; `bun test` in `packages/ui`; `bun --filter @manobu/chat-session test`.

---

## 10. Copy keys

| Key | String |
| --- | --- |
| `intent.receipt` | "drill set: particles (は, が, に, で) · 10 items · N5" |
| `intent.confirm.start` | "Start" |
| `intent.confirm.change` | "Change" |
| `intent.confirm.prompt` | "What should I change: topic, level, or length?" |
| `intent.clarify.topic` | "What should the questions be about?" |
| `intent.noAnchors` | "No N5 items on that topic. Nearest is {topic}. Use that?" |
| `intent.correct.action` | "Not what I meant" |
| `intent.correct.done` | "Changed to {receipt}." |
| `intent.degraded.model` | "Running without the AI right now. Commands like /quiz 5 particles still work." |

All nine go into the deck (`packages/ui/src/lib/copy.ts:95`) and into the walkthrough gate (`apps/desktop/test/walkthrough-copies.test.ts`) where that gate's shape applies.

---

## 11. Open items

| Item | Why it is open | Recommendation |
| --- | --- | --- |
| Topic vocabulary source | §4's table needs a curated map from learner words to anchors; free text will miss it | ship a curated list for the top ~30 topics, then fall back to corpus search (`search_examples`) |
| Where L1 runs | client-side determinism versus a model call | client-side parsing for L1, the model only for L2 |
| Whether the counters get a surface | Settings read-only versus a debug panel | Settings, read-only, no export |
| Correction vocabulary | the phrasings a learner actually uses are unknown | start with §6's six, extend from the mis-resolution counter |
| L1 grammar coverage | the tier verbs, scope words and topic phrasings a learner actually uses are unknown | ship the parser pure and tested, then widen it from the counter in §8 |

---

## 12. References

Verified this session (file:line):

- `packages/agent/src/index.ts:105` `classify` (four-way regex: `KANJI_HINT|CJK`, `GRAMMAR_HINT|HIRAGANA`, `VOCAB_HINT`), `createProviderRegistry` (empty registry is why `/learn/chat` is not the vehicle)
- `packages/ui/src/lib/copy.ts:15` `CopyKey`, `:95` the deck (em-dash free in every value as of v2), `:264` the keyed helper
- `packages/ui/test/copy-snapshot.test.ts` (the R-02 guard: every key's `primary`/`edge`/`error`, whole deck)
- `apps/desktop/src/routes/ai.tsx:81` `STARTERS`, rendered at `:800`
- `apps/desktop/src/lib/learner-level.ts:12` `JLPT_LEVELS`, `:47` `getLearnerLevel`, `:49` `setLearnerLevel`
- `apps/desktop/src/lib/review.ts:33` `batchNext`; `packages/srs/src/index.ts:172` `previewIntervals`; `cards` (`packages/db/src/migrations/0000_sour_master_chief.sql:63`)
- `apps/desktop/test/walkthrough-copies.test.ts` (the copy gate: keys exist, non-empty, expected behavioral cues)
- `packages/chat-session/src/slash.ts` (`SlashCommandSource`, `SlashSelectionBehavior` with `execute` reserved, `mergeSlashCommands` priority)
- `packages/chat-session/src/parts/acp-ask-part.tsx` (the parked-call lifecycle the confirm card reuses)
- `apps/desktop/src/lib/mock.ts:145` `deriveWeakPatterns`
- `crates/jlpt-mcp/src/main.rs:141` `lookup_vocab`, `:182` `list_vocab_by_level`, `:210` `list_grammar_by_level`, `:227` `lookup_kanji`, `:355` `search_examples`, `:367` `random_example`

Backlog docs: `doc-12` (parent: §3.4 gate semantics, §4.5 chat contract), `doc-15` (tiers, loop, card), `doc-16` (items, `drill_sessions`, selection), `doc-14` (papers), `doc-13` (checkpoint), `doc-17` (workspace).

---

## 13. Revision log

**v2 (2026-09-24, five layers and database-backed referents).** The layer table became five: L0 explicit now names the starter chips that already ship (`STARTERS`, `apps/desktop/src/routes/ai.tsx:81`), L1 is a deterministic slot grammar rather than prose reading, L2 is a structured proposal the client may only offer on, L3 is the confirm step, and L4 is the new fallback (answer casually, offer once). Added §4.1, which names the stored row behind every referent. That table is the direct answer to "where does 'the stuff I keep getting wrong' come from": `deriveWeakPatterns` (`apps/desktop/src/lib/mock.ts:145`), the level store (`apps/desktop/src/lib/learner-level.ts:47`), and the review queue (`apps/desktop/src/lib/review.ts:33` into `previewIntervals`, `packages/srs/src/index.ts:172`), with the attempts and session tables still specified rather than built (`doc-16` §3). R-02 stopped being an assertion: `packages/ui/test/copy-snapshot.test.ts` fails on any em dash in the deck, and the deck's 20 user-visible em dashes were replaced with `:`, `.` and `·` in the same pass.
