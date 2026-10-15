---
id: doc-12
title: Chat-generated JLPT exams (N5..N1) + a kana readiness gate
type: specification
created_date: '2026-09-24 04:45'
updated_date: '2026-09-25 17:53'
---
# Chat-generated JLPT exams (N5..N1) + a kana readiness gate

> **Status:** draft v4 (all decisions settled; detail split into child specs)
> **Date:** 2026-09-24
> **Type:** specification
> **Scope owner:** exam surfaces (`/jlpt-mock`), chat (`/ai`), the JLPT corpora (`crates/jlpt-mcp`, `packages/japanese`)
> **Child specs:** `doc-13` (kana checkpoint: paper, scoring, retake policy) owns `§3`; `doc-14` (papers: request, assembler, validator, storage) owns `§4`; `doc-15` (chat learning loop: casual chat, drill sets, exam handoff) owns the chat surface; `doc-16` (item engine: shared items, difficulty, grading, storage) owns the question itself; `doc-17` (exam workspace) owns the surface a running paper is taken on; `doc-18` (intent resolution and session setup) owns how a turn becomes a session
> **Companion docs:** `doc-4` (JLPT in manobu), `doc-5` (absolute-beginner coverage), `doc-10`/`doc-11` (UX redesign), `doc-2`/`doc-8` (corpora)
> **Wireframes:** `doc-19` (every surface below, drawn as ASCII frames, with the copy key behind each string)
> **Tracked work:** `TASK-113` (result-layer honesty, v0) · `TASK-114` (R-02 sweep) · `TASK-115`/`116` (chat offline/dev) · `TASK-117..120` (kana gate v1/v1.5) · `TASK-121..125` (drill-set loop v2) · `TASK-126..128` (papers + workspace v3) · `TASK-129`/`130` (kana queue, romaji fade) · `TASK-131`/`132` (v4/v5 tracked) · `TASK-133` (wireframe capture) — see `§6` for phasing
> **Out of scope:** EJU (`doc-3`) — D10

---

## 0. TL;DR

Four deliverables, in order:

1. **v0, prerequisite: fix the result layer before it is built on.** Three things there are wrong today: the sectional badges are not measurements, the CEFR badge is unreachable, and the overall pass gate is unwired. §2 has the evidence; `TASK-113` carries the fix.
2. **v1: a kana readiness checkpoint before N5 papers.** Hiragana and katakana, all six corpus kinds, regenerated per attempt, passed per script. **Default-on offer with a persistent skip**: it blocks the recommendation, never the URL, and never records a pass the learner did not earn. Detail in `doc-13`.
3. **v2: the chat learns with you.** Three tiers in one surface: casual conversation, **drill sets** (ask for questions, get a multiple-choice item in the transcript, pick, get an immediate verdict, next), and exam handoff only when asked. Needs one shared **item engine** so "make a quiz" and "make an exam" are not two question machines. Detail in `doc-15` and `doc-16`. The chat never quizzes unprompted, and never claims a score it did not compute.
4. **v3: chat-generated papers for N5..N1.** When the learner asks for a paper, the same items are composed into sections: the agent picks anchors, a deterministic assembler builds and validates the paper, and the debrief returns to chat as facts. Detail in `doc-14`. **The UI changes shape for a paper**: the chat stays on the left and a real exam component with sections, timer and navigation takes the right pane. Detail in `doc-17`.

| Question | Answer |
| --- | --- |
| Who authors the items? | A deterministic assembler in the shared item engine (`doc-16` §4, §8), from corpus anchors. The agent selects candidates and writing intent; it never ships a final option set (D6, `doc-14` §4) |
| Does a generated paper equal a real exam? | No. A `shortened` paper mirrors the section shape and item-type mix; only an `exam-conditions` paper claims official per-section timings, and `exam-conditions` N1-N2 is v5 (D10 boundary, `doc-14` §2) |
| Is the kana gate a hard block? | No: default-on offer with a persistent skip. `skip` is an override, never a pass (D1, §3.4) |
| What can admit a learner? | Three named sources: `checkpoint`, `drill-coverage`, `skip`. No blended readiness score (D2, `doc-13` §6) |
| Where is an exam stored? | `exams` + `exam_items` in `user.db`, migration `0007` after `0006_chat_conversations.sql`. The answer key never enters the chat transcript (D8, `doc-14` §6) |

---

## 1. The ask

The chat is where learners already talk about exams: `/ai` ships a quiz starter chip (`apps/desktop/src/routes/ai.tsx:84`) and the mock's plan button seeds the chat with weak grammar ids. The exam itself, meanwhile, is nine hand-authored questions (`SEED`, `apps/desktop/src/routes/jlpt-mock.tsx:25`) selected by a `filter` that resolves `{ filter }` rather than questions (`apps/desktop/src/routes/jlpt-mock.tsx:12`, `:18`).

So the request has two halves: let the chat *produce* a level-correct paper, and let the app *report back* into the chat. Upstream of both: do not offer an N5 paper to someone who cannot read kana.

What this doc deliberately does **not** model as a solved dependency is the result layer. §2 explains why.

### 1.1 Canonical vocabulary (G5, decided here)

One concept, one name. Three meanings of "practice" had accumulated across these specs (the paper mode, the chat's
question loop, the review desk), and names are permanent once they are in code and copy.

| Concept | Canonical | Retired |
| --- | --- | --- |
| A paper with the official shape and a smaller budget | `shortened` (mode) | `practice` |
| A paper taken under official per-section minutes | `exam-conditions` (mode) | `full` |
| The chat's inline question loop | **drill set** (tier 2, `doc-15`) | "inline practice" |
| The host tool that serves one item of it | `next_drill_item` | `next_practice_item` |
| The attempt record | `drill_attempts` | `practice_attempts` |
| `items.surface` for tier 2 | `"drill"` | `"practice"` |
| The incoming sentence and what is made of it | **request** resolved into a **receipt** (`doc-18`) | "intent" as a score |
| `practice` itself | the review desk's existing vocabulary (`/review`, retention, `/drill`) | not the paper mode, not tier 2 |

The rule this protects: the learner never sees "practice" on two surfaces that mean different things, and a
scored surface always names its own shape (`shortened paper`, `exam conditions`). This is a spec decision; the
shipped strings follow in v0 (`TASK-113`) and in the phases below.

---

## 2. What ships today, and the four defects not to inherit

### 2.1 Inventory

| Concern | Today | Evidence |
| --- | --- | --- |
| Filter | `filter` in `all / N5 / N4 / N3 / N2 / N1` | `apps/desktop/src/routes/jlpt-mock.tsx:12` |
| Paper source | route-local `SEED`: 6 grammar/vocab + 2 reading + 1 listening | `apps/desktop/src/routes/jlpt-mock.tsx:25` |
| Wizard | `Timer` (`:93`), `Progress` (`:127`), `Choices` (`:175`), `Score` (`:399`), `Plan` (`:461`), `SectionBadge` (`:247`) | `apps/desktop/src/features/mock/jlpt-mock.tsx` |
| Scoring helpers | `scoreQuestion` (`:49`), `deriveWeakPatterns` (`:145`), `computeMockResult` (`:178`), `sectionCaps` (`:238`), `overallPassMark` (`:244`), `sectionalPassMark` (`:259`), `cefrForScore` (`:270`), `deriveSectionalWeak` (`:313`), `scoreBySection` (`:327`) | `apps/desktop/src/lib/mock.ts` |
| Corpus the chat can query | `lookup_vocab` (`crates/jlpt-mcp/src/main.rs:141`), `list_vocab_by_level` (`:182`), `list_grammar_by_level` (`:210`), `lookup_kanji` (`:227`), `search_examples` (`:355`), `random_example` (`:367`) | `crates/jlpt-mcp/src/main.rs` |
| Exam persistence | none; highest migration is `0006_chat_conversations.sql` | `packages/db/src/migrations/` |
| Kana measurement | none; `DrillLab` is in-session only | `apps/desktop/AGENTS.md` (SCR-08 row) |

### 2.2 Defect 1: the sectional badges are not measurements (tracked as TASK-113)

`computeSectional` (`jlpt-mock.tsx:283`) counts correct/total per section and hands it to `scoreBySection` (`:300` → `lib/mock.ts:327`), which scales by ratio to the caps the code has taken as official (N5 caps: lang 120, reading 60, listening 60; marks 38/19/19). Those caps are **wrong at N4/N5**, see §2.6. Then `SectionBadge` (`:247`) prints pass/fail from `points >= sectionalPassMark`.

On the current seed that means:

| Section | Items | Points per item | 4-of-9 run | Badge |
| --- | --- | --- | --- | --- |
| lang | 6 | 20 | 2 correct = 40 | `Language 40/120 ✓` (mark 38) |
| reading | 2 | 30 | 1 correct = 30 | `Reading 30/60 ✓` (mark 19) |
| listening | 1 | 60 | 1 correct = 60 | `Listening 60/60 ✓` (mark 19) |

Headline: `Score 44% (4/9)`. Badges: three passes. **One listening question is worth an entire 60-point listening section.**

The points-per-item column is those caps divided by the seed's item counts, so it inherits the defect §2.6 corrects: under the official model the eight language-and-reading items scale together against 120, which is 15 points per item, not 20 and 30.

**Reproduced in a running app, 2026-09-24.** The seed paper was driven end to end in a browser (pass record: `doc-19` §12.1): answering all nine items and submitting renders `Language 40/120 ✓`, `Reading 0/60 ✗ (2 wrong)`, `Listening 60/60 ✓`, with **no CEFR element and no overall-gate element in the DOM at all**. The one-item listening section scoring its full cap is therefore not an arithmetic curiosity in a helper: it is what the learner sees. The pass marks are calibrated for ~30-45 real items per band; below a viability floor the ratio scaling is arithmetic without meaning.

Consequence for this feature: v2 cannot present generated short papers through the same badges. A generated paper either meets a per-section item floor (then scaled bands plus pass gates are defensible and labeled `shortened`) or reports raw counts only.

### 2.3 Defect 2: the CEFR badge is unreachable (tracked as TASK-113)

Both finalize paths call `cefrForScore(level, r.score)` (`jlpt-mock.tsx:628` and `:661`). But `cefrForScore` (`lib/mock.ts:270`) takes a **0-180 total-points** score (N5 80 → A1, N2 115 → B2), while `r.score` from `computeMockResult` is a **count of correct answers** (`lib/mock.ts:178`). So the badge can only appear on a paper with 80+ items where 80+ answers are correct.

The unit tests do not catch it because they call the helper directly with 0-180 numbers (`apps/desktop/test/mock.test.ts:295`), never through the component. This is a wiring gap disguised by green tests, and it means §4.5's debrief must not promise CEFR until v0 fixes the call site.

### 2.4 Defect 3: no persisted kana signal exists

`apps/desktop/AGENTS.md` (SCR-08 row) records that the romaji fade waits on per-kana drill mastery persistence, and that `DrillLab` tracks in-session only. `kanji-progress.ts` is the precedent store (`markSeen` `:154`, `markLearned` `:159`, `cellState` `:31`), which means the kana store is new code, not a config change. `doc-13` §7 defines both stores.

### 2.5 Defect 4: the overall pass gate is unwired (tracked as TASK-113)

`overallPassMark` (`lib/mock.ts:244`) encodes the total-score half of the official two-gate rule (total at or above `N1 100 / N2 90 / N3 95 / N4 90 / N5 80`, `doc-4` §1.4), and it has **zero consumers anywhere in `apps/desktop/src`**: a repository-wide search returns only the definition. Its unit test (`apps/desktop/test/mock.test.ts:234`) asserts the returned numbers, so the suite stays green while the score view applies only the sectional half of the rule.

The consequence is not cosmetic. A real JLPT pass requires **both** gates, so a paper can pass every section and still fail overall, and the reverse. Today the result screen can express neither case: `SectionBadge` (`jlpt-mock.tsx:247`) is the entire verdict surface, and `Score` (`:399`) prints no total against the mark. Two parts of this doc depend on this being right: the §5 non-goals, which must not imply the two-gate rule is applied when it is not, and the §4.5 debrief, which cannot report a verdict it does not compute.

This is the third defect in the same layer with the same root cause: helper tested, wiring not. §8 lists the coverage that would have caught all three.

### 2.6 Defect 5: the N4/N5 section caps are not the official sections (tracked as TASK-113)

The official model allocates **180 points at every level, but not the same number of scoring sections** (`jlpt.jp/e/guideline/results.html`):

| Level | Scoring sections | Range |
| --- | --- | --- |
| N1, N2, N3 | Language Knowledge (Vocabulary/Grammar) · Reading · Listening | 60 + 60 + 60 = **180** |
| N4, N5 | Language Knowledge (Vocabulary/Grammar)·Reading · Listening | 120 + 60 = **180** |

`sectionCaps` (`lib/mock.ts:238`) returns `{ lang: 120, reading: 60, listening: 60 }` for N4/N5, which sums to **240**. It keeps a separate Reading section at N4/N5, which the official report does not have, and it splits the 120-point combined section in two. `sectionalPassMark` (`:259`) inherits the error: it returns a 19-point mark for a `reading` section that N4/N5 do not score.

The consequence is narrow and total. The three badges §2.2 renders are in different units from the headline, so they cannot be added into the `overallPassMark` (`:244`) total, and the reason is visible in the numbers: the mark is stated **of 180** against a set of sections that sum to 240. That is the mechanical reason Defect 4's gate has no consumer to wire into, and why it is a section-set bug rather than a rescaling one.

The fix is the correct section set, not a coefficient. At N4/N5 the `reading` bucket folds into `lang` (the 120-point section is literally "Language Knowledge (Vocabulary/Grammar)·Reading"), caps become 120 + 60, marks become 38 of 120 and 19 of 60, and the badges add up to the 180 the mark is stated in. N1 to N3 are already correct and must not change. Because the section set is a **scoring** concern, the paper pipeline's test-section mix (`doc-14` §2.2) and per-item budget floors (`doc-14` §2.3) are unaffected: N4 still has three test sections and two scoring sections.

**Where the assumption is baked in (sweep, 2026-09-24).** The wrong section count is not confined to the two helpers. It is asserted in `sectionCaps` (`lib/mock.ts:238`) and `sectionalPassMark` (`:259`); restated in five comments (`lib/mock.ts:217` to `:223`, `:237`, `:322`; `features/mock/jlpt-mock.tsx:245`, `:571`); rendered unconditionally as three badges by a three-entry map (`jlpt-mock.tsx:416` to `:432`); pinned by three green tests (`test/mock.test.ts:218` to `:231` caps, `:241` to `:247` marks, `:249` to `:264` scaling, so `bun test test/mock.test.ts` reports **25 pass** while asserting the defect); and recorded as fact in `apps/desktop/AGENTS.md:94`.

The spec layer is clean, which is what makes this an implementation drift rather than a spec error: `doc-4` (`:174`, `:214`) carries the official model as "2-vs-3 sections, `60/60/60` vs `120/60`", `TASK-23.7`'s acceptance criterion #2 said `120/60`, and only that task's implementation notes drifted to `120/60/60`. §2.2's points-per-item column is derived from the same caps and should be read that way.

---

## 3. Feature A: the kana readiness checkpoint

> Full detail: **`doc-13`**. This section keeps the decisions and the reason the design is shaped this way.

### 3.1 Why a gate

An N5 paper is a reading test. Its vocabulary section asks for kanji readings and contextual word choice, its grammar-plus-reading section assumes fluent kana, and its listening section assumes you can hold a sentence. `doc-4` §1.3 tabulates the item types; none is answerable in romaji. The repo already shipped the kana chart, the 46+46 charts and the kana decks, so the checkpoint is the app catching up to the exam it already offers.

### 3.2 What the gate may read (D2, decided: both)

| Signal | Source | Role |
| --- | --- | --- |
| Checkpoint result | the kana paper | One of three named admission sources, per script |
| Per-kana drill mastery | persisted drill outcomes | A second admission source, and the adaptive sampler's input. Never blended with the checkpoint into one score |
| Kana-chart copies | `manobu:kana-chart-copy` | Nothing. A copy is not a read |

Admission is therefore an OR of `checkpoint | drill-coverage | skip`, each with its own rule and its own stored reason, so the UI can always say *why* it is offering the paper. The state machine and the deck-coverage constraint live in `doc-13` §6.

### 3.3 The paper (detail in `doc-13` §2-§4)

Coverage comes from `packages/japanese/data/kana.json`: **208 cells in six `kind`s** (gojuon 46, katakana 46, dakuten 25, katakana-dakuten 25, yoon 33, katakana-yoon 33), every cell carrying `char`, `romaji` and `row`. Three findings from the data drive the design:

- **It is not 46+46.** A base-46 gate false-passes: N5 vocabulary is full of しゃしん, きって, コーヒー, ガラス.
- **`っ` and `ー` are absent from the corpus**, so sokuon and chōonpu are tested at word level (きって vs きて), not cell level.
- **Groups are `(kind, row)`, never `row`.** `dakuten` が carries `row: "k"`, so pooling kinds would hide a wiped-out hiragana か-row.

Two script sections, ~46 items each (~92 total, about five minutes, untimed), 2 items per group, distractors from the same group. Pass rule, per script independently:

1. At least **90%** of that script's items correct, and
2. **no `(kind, row)` group may be fully wrong** (groups with at least 2 sampled items; single-cell groups like `n-alone` fold into rule 1).

Rule 1 is a slip test, rule 2 is a gap test. Together: 4 scattered misses pass, 2 misses in one group plus 2 elsewhere fail. Worked examples and the rejected alternatives (80%, 95%, a timer) are in `doc-13` §4.

### 3.4 Gate semantics (D1, decided): recommendation, not access

Real JLPT has no prerequisites (`doc-4` §1.1, `jlpt.jp` FAQ), and N4..N1 are not gated at all (skipping N5 for N3 is the most common strategic skip, `doc-4` §1.5). For N5 and the `all` default:

| Entry point | Behavior |
| --- | --- |
| `/jlpt-mock?filter=N5` typed URL or deep link | **Never blocked.** Loads, with a one-line note offering the checkpoint |
| Desk tile / dashboard CTA | Offers the checkpoint first: "N5 papers are written in kana. About five minutes to check yours first." |
| Chat request for an N5 paper | Offers the checkpoint inline as part of the conversation, then continues into the paper either way |
| Settings | Shows the admission state per script with the source that set it, and an explicit reset |

One always-visible escape, in the honest-copy style the mock already uses for placement (`mock-skip-placement`, `jlpt-mock.tsx:148`): *"I can read kana: skip this"*. Skipping records an explicit override and **does not write a pass**; it stops the nudging and is reversible in Settings. Honest naming: a default-on nudge that is a real gate for learners who accept it, not a lock.

Retakes (D4, decided): unlimited, regenerated per attempt, with a **24-hour cooldown from the third failed attempt**, per script (`doc-13` §5).

### 3.5 The checkpoint result is not a mock result (detail in `doc-13` §8)

A checkpoint item carries no `grammarId`, so `computeMockResult` → `deriveWeakPatterns` (`lib/mock.ts:145`) has nothing to resolve and `Plan` (`jlpt-mock.tsx:461`) would scaffold a seven-day *grammar* plan for a kana failure. Required: `source: "checkpoint"` on the exam record gating the result view; a result that shows per-script pass/fail and the blocked `(kind, row)` groups; a kana queue action; and no CEFR, no sectional bands, no overall pass mark. The kana queue needs a `/drill` `validateSearch` extension, since the schema accepts `kind` only (`apps/desktop/src/routes/drill.tsx:23`).

---

## 4. Feature B: the chat generates items, and papers on request

> How a turn becomes a session (layers, slots, topic anchors, the receipt) is **`doc-18`**. The chat surface itself (three tiers, the drill-set loop, routing) is **`doc-15`**. The question itself (shape, storage, difficulty, grading) is **`doc-16`**. Paper assembly is **`doc-14`**. This section keeps the decisions and the shape.

### 4.1 Blueprint (detail in `doc-14` §2)

Section shape and minutes per level come from `doc-4` §1.2 (`jlpt.jp/e/guideline/testsections.html`): N1 `110 + 55`, N2 `105 + 50`, N3 `30 + 70 + 40`, N4 `25 + 55 + 35`, N5 `20 + 40 + 30`. Two modes, honestly labeled: `shortened` (official shape, smaller budget, scaled timer labeled "shortened pace", bands only above the viability floor) and `exam-conditions` (official minutes and mix, no caveat, v4). Paper size is a **request input**, not a constant: the assembler takes a `budget` per section and must satisfy the item-type mix from `doc-4` §1.3.

### 4.2 Pipeline (D6, decided)

```
Request   { level, mode, sections?, budget, focus?, seed }   — chat or the desk
Propose   candidate anchors per slot (MCP tools)             — agent
Assemble  slots -> ordered items, options, answers, times    — deterministic TS
Validate  accept | reject(reason) per item, then per paper    — deterministic TS
```

The boundary is the point: the agent's output is a *candidate list*, never a final item. The assembler owns option order, section placement, counts and times; the validator owns the veto, over an enum of rejection reasons (`no-anchor`, `anchor-missing`, `anchor-level`, `ambiguous`, `duplicate-option`, `unlucky-distractor`, `stem-leak`, `mix-mismatch`, `passage-length`, `script-missing`, `floor-unmet`) that doubles as the test list (`doc-14` §5).

### 4.3 Anchoring catches hallucination; `ambiguous` catches the real bug (D7, decided)

Anchored items can still be wrong: a blank sentence may admit two correct options. Anchoring prevents invented content; `ambiguous` prevents a wrong answer key. Form-based items get a deterministic round trip (`lib/conjugate.ts` `verifyForm`, `lib/deinflect.ts`, `crates/jlpt-mcp/src/deinflect.rs`), word-level items require two independent anchors, reading passages are never model-written prose, and **`usage` items are dropped from v2** because no deterministic check exists.

### 4.4 Where the paper lives (D8, D9, decided)

`exams` + `exam_items` in `user.db`, migration `0007`, with `source` gating the result view. State machine `draft → ready → in_progress → submitted` plus `abandoned`, answers persisted per pick, time-up auto-submitting without clearing, resume on open. The tool result carries **anchors only**; the assembler fills the key locally, because the tool-call card renders raw output today (`AcpToolCallPart`, `packages/chat-session/src/parts/acp-tool-call-part.tsx:13`). The chat card is a new row in `CARD_BODIES` (`packages/chat-session/src/chat-card-switch.tsx:193`), emitted **after** the exam row commits.

### 4.5 The chat contract, both directions

- **Request.** "Give me an N4 paper, I have 60 minutes" becomes the request object; N5/`all` runs the checkpoint offer first.
- **Debrief.** Post-submit only, gated on `status === "submitted"` rather than on prompt etiquette. Facts, not guesses: raw counts, scaled bands *or* raw-only below the floor, weak pattern ids, anchor list. The agent explains why a missed item was wrong using its anchors, which is the one place the key may appear, after the paper is closed.
- **Next step.** Deterministic (`doc-10` R1 session spine, TASK-61; drill bridge TASK-62).

### 4.6 Out of scope: EJU (D10, decided)

No `eju-mock` work, no subject tree, no science-vs-Japan-and-the-World exclusivity, no two-consumer engine, no promise about `doc-3`. The only EJU relationship is a boundary: do not bake JLPT-only assumptions into the item shape where avoiding it costs nothing. Build for JLPT now.

---

## 5. Non-goals

- No official-score equivalence. Real JLPT scores are IRT-equated; we scale raw to capped bands and label it `shortened paper result`.
- **No scaled band or pass/fail badge below the viability floor** (band points / 6 per item: 60 → 10 items, 120 → 20). Raw counts and an honest label instead (D5, `TASK-113`).
- No CEFR claim until the §2.3 wiring is fixed and the input is a real 0-180 total.
- No claim that the official two-gate rule is applied until `overallPassMark` (`lib/mock.ts:244`) reaches the score view (§2.5).
- No real exam items, no reproductions of past papers.
- No locked levels. Nothing is gated by payment, streak, or time-in-app; kana admission is the only gate and it is skippable.
- No EJU work (D10).
- No free-writing or free-speaking grading inside an exam.
- No replacement for `/drill`, `/reader`, `/lesson`: the exam measures, the bridges (TASK-61/62) return the learner to practice.

---

## 6. Phasing

| Phase | Ships | Detail | Tasks |
| --- | --- | --- | --- |
| **v0 Result honesty** (`TASK-113`) | CEFR call site fixed (`jlpt-mock.tsx:628`/`:661`) to receive a 0-180 total; viability floor with scaled badges only above it; `overallPassMark` (`lib/mock.ts:244`) wired so both official gates apply; `shortened` vs `exam-conditions` labels | §2.2, §2.3, §2.5 | `TASK-113` |
| **v1 Kana checkpoint** | six-kind paper, `(kind, row)` groups, per-script pass rule, regeneration, 24h cooldown from the third attempt, two stores, offer-then-continue entry points, kana queue + `/drill` schema extension | `doc-13` | `TASK-117` stores, `TASK-118` instrument, `TASK-119` admission, `TASK-129` queue into `/drill` |
| **v1.5 Deck extension** | `dakuten` and `yoon` drill decks (plus katakana mirrors and word-level sokuon items) so `drill-coverage` admission becomes reachable; also feeds the deferred romaji fade | `doc-13` §6.2, §10 | `TASK-120`, `TASK-130` romaji fade |
| **v2 Drill-set loop** | the three tiers in one chat (casual, drill sets, exam handoff), intent resolution and the receipt, the shared item engine + `items` + `drill_sessions`/`drill_attempts` stores, the host-MCP drill card with batch prefetch, session summary and FSRS write-through | `doc-15`, `doc-16`, `doc-18` | `TASK-121` intent, `TASK-122` storage, `TASK-123` engine, `TASK-124` lifecycle, `TASK-125` card |
| **v3 The pipe (papers)** | request → assembler → validator, `exams`/`exam_items`, state machine, the exam workspace (chat left, paper right), chat card, post-submit debrief, N5 + N4 `shortened` papers | `doc-14`, `doc-17` | `TASK-126` pipeline, `TASK-127` workspace, `TASK-128` review |
| **v4 Three sections** | N3/N2 vocab-split sections, per-section timing, long reading for N3 | `doc-14` §2.2 | `TASK-131` (shipped) |
| **v5 N1 `exam-conditions`** | integrated and thematic reading, integrated listening, 110 + 55 | `doc-14` §2 | `TASK-132` (shipped) |

Four tasks are cross-cutting rather than phase-scoped, so they do not appear in the table above: `TASK-114` (the R-02 copy-voice sweep, `doc-20`), `TASK-115` (`/ai` needs an honest offline state when the sidecar is unreachable), `TASK-116` (the chat dev config that makes a local `/ai` session work at all) and `TASK-133` (capture the rendered frames back into `doc-19` once the surfaces exist). None of them blocks a phase. `TASK-114` is worth doing **before** v2 and v3 rather than after, because those two phases add the largest number of new user-visible strings to a surface that is currently half-swept: the deck is guarded while 119 rendered strings elsewhere are not, so new copy arriving first would extend the tail the guard cannot see.

Ordering inside a phase is expressed as task dependencies rather than prose, so the graph is the authority: `TASK-117` stores before `TASK-118` instrument before `TASK-119` admission; `TASK-122` storage before `TASK-123` engine before `TASK-124` lifecycle and `TASK-125` card; and `TASK-126` pipeline before `TASK-127` workspace before `TASK-128` review. `TASK-121` (intent) is independent of the storage chain but is a dependency of `TASK-125`, because a drill card cannot open without an accepted offer.

v4 and v5 were **tracked, not scheduled**, and both have since shipped against v3: `TASK-131` (N3 vocab split, per-section timing, the N3 `long-reading` type, and the D11 three-column N1/N2 scoring split) then `TASK-132` (N1 at 110 + 55 with the integrated reading and listening types, and the ordered stimulus set in `doc-16` §2). The order they were kept in is the order they were built in: the section count had to be right before an integrated N1 item shape could sit on top of it. `doc-14` §9 no longer defers them.

This table was rebuilt by a doc-to-task coverage audit rather than assembled by hand. Every phase, and every bullet in the Verification sections of `doc-13` to `doc-17`, was checked against the task set; the audit found four uncovered deliverables (the kana queue into `/drill`, the romaji fade the mastery store unblocks, and the two deferred phases) plus two under-specified tasks (`TASK-127` had the timer rule from `doc-17` §8 but not its keyboard and focus rules, and `TASK-125` was missing the card-width token that `doc-19` §13 leaves open). All six are now closed.

---

## 7. Decisions (settled 2026-09-24)

| ID | Decision | Decided | Detail |
| --- | --- | --- | --- |
| **D1** | Gate strictness | **Default-on offer with a persistent skip.** Hard lock rejected; `skip` is an override, never a pass | §3.4 |
| **D2** | Gate input | **Both.** Three named admission sources (`checkpoint`, `drill-coverage`, `skip`), never a blended score. Drill evidence also scopes the sampler. Note: `drill-coverage` is unreachable until the v1.5 deck extension | §3.2, `doc-13` §6 |
| **D3** | Coverage and pass rule | Six kinds plus word-level sokuon and chōonpu; per script **90%** with **no fully wrong `(kind, row)` group**; untimed; 2 items per group; distractors from the same group | `doc-13` §3, §4 |
| **D4** | Retake policy | Unlimited, **regenerated per attempt**, **24-hour cooldown from the third failed attempt**, per script | `doc-13` §5 |
| **D5** | Viability floor | **Band points / 6 per item**: a 60-cap section needs ≥10 items, a 120-cap section ≥20. Below it, raw counts only | §5, `TASK-113` |
| **D6** | Generation split | **Agent picks candidates, code assembles, validator vetoes** | §4.2, `doc-14` §4, §5 |
| **D7** | `usage` items | **Dropped from v2** (no deterministic check) | §4.3, `doc-14` §5.1 |
| **D8** | Key handling | **Anchors only in the tool result**; assemble the key locally; debrief gated on `submitted` | §4.4, `doc-14` §6 |
| **D9** | Chat card | **New row in `CARD_BODIES`**, emitted after the exam row commits | §4.4, `doc-14` §7 |
| **D10** | EJU | **Out of scope.** Build for JLPT; no subject tree, no shared-engine promise | §4.6, §5 |
| **D11** | Section model | **The official section set, not an even split.** N1 to N3 score three 60-point sections; N4 and N5 score **two**: Language Knowledge (Vocabulary/Grammar)·Reading (120) and Listening (60). Both sum to 180, so the badges add to the headline instead of to 240. `sectionCaps` and `sectionalPassMark` change at N4/N5; N1 to N3 do not | §2.6, `TASK-113` |
| **D12** | `drill-coverage` sequencing | **Ships with the v1.5 deck extension, not before.** D2's three named sources stand and the `drill-coverage` enum value is specified now, but the resolver refuses it until the decks cover six kinds and the mastery store can hold a `solid` group. v1 admits through `checkpoint` and `skip` only | `doc-13` §6, §6.2 |

---

## 8. Verification (cross-cutting)

Per-doc lists: `doc-13` §9 (checkpoint) and `doc-14` §8 (pipeline). Shared obligations:

- **Wiring coverage, not just helpers.** All three v0 defects survived because `test/mock.test.ts` calls helpers directly while nothing renders `<JlptMock>`. Component-level tests are required for the floor, the CEFR input, and the two-gate verdict.
- Determinism: the same stored exam id and seed render identical option order across mounts.
- Degradation: no server, corrupt stores, and unregistered sources all yield honest states, never a fabricated pass or an empty paper (`lib/mock.ts:106` contract).
- Cross-surface: the chat debrief's numbers equal the stored result object's numbers.
- No-leak: a golden asserting the generation turn's rendered transcript carries no answer text while the
  debrief turn may.
- **Copy contract.** Every new user-visible string is added to the typed deck (`CopyKey`,
  `packages/ui/src/lib/copy.ts:15`; deck at `:95`) and covered by the walkthrough gate
  (`apps/desktop/test/walkthrough-copies.test.ts`). R-02 (no em dash) is **enforced**, not asserted:
  `packages/ui/test/copy-snapshot.test.ts`
  walks every key's `primary`, `edge` and `error` and fails on a dash. The deck's 20 user-visible em dashes were
  replaced in the same pass; the five that remain in `copy.ts` sit in the file's own comments, which the guard
  deliberately does not read.
- **Degradation matrix.** Every row of §9 has a test or an explicit manual check; no row may be "handled" by prose.

Commands: `bun run check-types`, `bun run check`, `bun run test` in `apps/desktop`; `cargo test` in `crates/jlpt-mcp` for new MCP tools; `fallow audit --base main` before push.

---

## 9. Failure and degradation matrix

The child docs each carry their own degradation lines. They are consolidated here because the same failure reaches
them all, and because the honest answer differs by surface: what the chat must do when the agent is gone is not what a
running paper must do.

| Failure | Surface | Behavior | Never |
| --- | --- | --- | --- |
| No agent CLI installed, or it dies mid-set | drill set (`doc-15` §4) | the set suspends at the last answered item; the summary is computed from `drill_attempts`; tier 1 stays usable; one line says so | a silent empty card, an invented item, a lost count |
| Agent dies during paper generation | paper (`doc-14` §7) | the exam stays `draft`, the chat card is **never** emitted, one line offers a retry | a takeable empty paper, a card linking to nothing |
| Agent dies while a paper is running | workspace (`doc-17`) | the paper continues **headless**: sections, timer, verdict and scoring are deterministic and local, so nothing stops. The debrief is queued and rendered when the agent returns | a lost pick (per-pick persistence, `doc-14` §6), a stalled timer |
| Server or `user.db` unreachable | every scored surface | a drill set degrades to tier 1 talking; a paper falls back to the built-in seed (`fetchGrammarLevel` never throws, `apps/desktop/src/lib/mock.ts:106`); results are reported as not saved. **Observed 2026-09-24:** the desk already degrades honestly (`sensei offline — the desk still works`) while `/ai` does not degrade at all, it renders an error boundary (`Failed to open the chat: Failed to fetch`), so the chat surface needs the same honest line before this row is true | a fabricated next due date, a fake band |
| Migrations never ran (the `TASK-44` history: user db present, schema absent) | items, exams, kana stores | drill sets refuse to open with an honest line pointing at the desk; papers use the seed; the checkpoint reads "no attempt yet" (the `parseSettings` precedent) | a crash, a fake pass |
| Topic resolves to no anchors at the level | drill set, paper (`doc-18` §4) | the nearest-topic line, and an offer to switch topic or level | an invented item, an empty set |
| Model returns candidates the validator vetoes | item engine (`doc-16` §6) | the item is dropped and replaced; if a section cannot be filled, the paper reports the reduced count and the label follows the floor rule | a wrong key shipped |
| Pool exhausted and generation failing (runway 0) | drill set (`doc-16` §5.1) | the `pending` card state plus an option to end the set | a repeated item passed off as new |
| Offline, so TTS cannot speak | listening items | listening items are excluded from a drill set; a `shortened` paper marks the section unavailable and excludes it from bands, with the label saying so | a silently missing section |
| Corrupt kana or drill stores | checkpoint (`doc-13` §9) | "no attempt yet" | a fake admission, a fake mastery |
| Client clock moved backwards during a cooldown | checkpoint (`doc-13` §5) | the cooldown reads the stored timestamp plus elapsed monotonic time | a cooldown cleared by changing the clock |
| An answer key the learner disputes | review (`doc-17` §7.1) | the item is marked `disputed`, removed from future pools, kept in this paper's record | a silent dismissal of the report |

Two rules for this table: a row that cannot be tested is not a behavior, and no row is allowed to end in a scored
number the app cannot compute.

---

## 10. Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Building v2 on the broken badge | Generated papers would print confident lies at scale | v0 first (§2.2, §6) |
| "Realistic" drifting into "claims to be real" | Honesty is the surface's strongest asset | `shortened` vs `exam-conditions` labels; bands only above the floor (§4.1, §5) |
| A gate that shames beginners | It protects the population a wall hurts most | Offer-not-lock, persistent skip, in-character copy, no progress bars (§3.4) |
| A gate passed by memorizing positions | An untimed paper rewards the wrong thing | Regenerate every attempt, seeded, 24h cooldown from the third failure (§3.3, D4) |
| D2 promised more than the data allows | Drill decks cover two of six kinds, so `drill-coverage` cannot admit anyone yet | **D12**: `drill-coverage` ships with the v1.5 deck extension, never before it; until then say "drill shortens the checkpoint", never "drill replaces it" (`doc-13` §6.2) |
| Section badges in different units from the headline | `sectionCaps` sums to 240 at N4/N5 against a mark of 180, so no roll-up exists | **D11**: use the official section set (two scoring sections at N4/N5). Until it ships, a shortened paper shows raw counts rather than a total it cannot compute |
| A wrong answer key | One confidently wrong key burns trust in the whole surface | Anchors + `ambiguous` veto + drop unverifiable `usage` + golden papers (§4.3) |
| Answer key visible in chat | The learner can read ahead in the same thread | Anchors-only tool result; post-submit debrief gate (§4.4) |
| A 165-minute paper with no persistence | A crash loses everything and the learner never returns | Per-pick persistence + resume (`doc-14` §6) |
| Model cost per paper | A full N1 paper is a lot of tokens | Code assembles from corpus candidates; the agent selects, it does not author walls of text. `exam-conditions` is v4 |

---

## 11. Source references

Verified this session (file:line):

- `apps/desktop/src/routes/jlpt-mock.tsx:12` `filter` enum, `:18` `mockQueryOptions`, `:25` `SEED`
- `apps/desktop/src/lib/mock.ts:49` `scoreQuestion`, `:106` `fetchGrammarLevel`, `:145` `deriveWeakPatterns`, `:178` `computeMockResult`, `:238` `sectionCaps`, `:244` `overallPassMark`, `:259` `sectionalPassMark`, `:270` `cefrForScore`, `:313` `deriveSectionalWeak`, `:327` `scoreBySection`
- `apps/desktop/src/features/mock/jlpt-mock.tsx:93` `Timer`, `:127` `Progress`, `:148` `mock-skip-placement`, `:175` `Choices`, `:247` `SectionBadge`, `:283` `computeSectional`, `:300` `scoreBySection` call, `:384` `mock-listening-play`, `:399` `Score`, `:417` `mock-sectional`, `:437` `mock-cefr-badge`, `:461` `Plan`, `:628`/`:661` `cefrForScore(level, r.score)`
- `apps/desktop/test/mock.test.ts:234` `overallPassMark` expectations, `:295` CEFR unit expectations (0-180 inputs, no component path)
- `apps/desktop/src/routes/drill.tsx:23` `DrillSearch` (`chart`, `kind` only)
- `apps/desktop/src/lib/kanji-progress.ts:31` `cellState`, `:154` `markSeen`, `:159` `markLearned`
- `packages/japanese/data/kana.json` — 208 cells in six kinds; group sizes in `doc-13` §2; `row` on every cell; `katakana` field on 5 gojuon entries only; no `っ`, no `ー`
- `crates/jlpt-mcp/src/main.rs:141/182/210/227/355/367`; `crates/jlpt-mcp/src/engine.rs:537` `LEVEL_MAX_JP_LEN`, `:545` `sentence_level`, `:557` `pseudo_random_index`
- `packages/db/src/migrations/0006_chat_conversations.sql` (highest; `0007` free)
- `packages/chat-session/src/parts/acp-tool-call-part.tsx:13` `AcpToolCallPart`, `packages/chat-session/src/chat-card-switch.tsx:193`, `packages/chat-session/AGENTS.md:235` (`CARD_BODIES`, `STRETCHED_TYPES`)
- `apps/desktop/AGENTS.md` SCR-10 and SCR-08 rows; `crates/AGENTS.md`; `packages/skills/AGENTS.md`

Backlog docs: `doc-13`, `doc-14`, `doc-15`, `doc-16`, `doc-17` (child specs), `doc-4` (§1.1 no prerequisites, §1.2 sections/minutes, §1.3 item-type matrix, §1.4 two-gate scoring, §1.5 skipping, §2.1-2.2 what ships, §7 extend-don't-rewrite), `doc-5`, `doc-10` (R1/R3/R7), `doc-11`. `doc-3` (EJU) is parked by D10.

---

## 12. Revision log

**v13 (2026-09-24, coverage audit).** Asked whether every deliverable in the feature docs had a task, the set was checked rather than assumed, and it did not. Four deliverables had no task: the kana queue that hands blocked cells into `/drill` (`doc-13` §8, `doc-12` §3.5, and it needs a `validateSearch` extension because `apps/desktop/src/routes/drill.tsx:23` accepts `chart` and `kind` only), the romaji fade in `worksheet.tsx` that the mastery store unblocks (`doc-12` §2.4, `doc-13` §7, §10), and the two deferred phases v4 and v5 (`TASK-131`, `TASK-132`). Two existing tasks were also under-specified against their own docs: `TASK-127` carried the timer rule from `doc-17` §8 but none of its keyboard or focus rules, and `TASK-125` was missing the one transcript card width token `doc-19` §13 leaves open. Now `TASK-129` to `TASK-133`, plus four added criteria. §6's table is regenerated from that audit, v4 and v5 went from empty cells to tracked tasks, and the audit also found a pre-existing problem outside this feature: `TASK-62` still deep-links to `/learn/conjugate`, `/learn/drill` and `/learn/listen`, and `/learn` was retired in the 2026-09-14 router audit, so its links need updating before it can consume the shared schema extension.

**v12 (2026-09-24, the work is scheduled).** §6 gained a Tasks column, so every phase names the tasks that deliver it instead of leaving the link implicit: v0 is `TASK-113`, v1 is `TASK-117` to `TASK-119`, v1.5 is `TASK-120`, v2 is `TASK-121` to `TASK-125`, and v3 is `TASK-126` to `TASK-128`. v4 and v5 are marked as having no tasks because `doc-14` §9 defers them. The three phase-less tasks are named in the note under the table, with the reasoning that `TASK-114` (the R-02 sweep) should land before v2 and v3 rather than after, since those phases add the most new user-visible strings to a surface the guard does not yet cover. Ordering is recorded as task dependencies, which is now the authority rather than the prose. Fifteen tasks, `TASK-114` to `TASK-128`, all `To Do`.

**v11 (2026-09-24, the two open decisions settled).** Two questions this doc kept deferring are now answered, both from source rather than preference. **D11** resolves the 240-versus-180 gap by reading the official model instead of assuming a symmetric split: N1 to N3 score three 60-point sections, N4 and N5 score **two** (Language Knowledge (Vocabulary/Grammar)·Reading at 120, Listening at 60), so `sectionCaps` invented a Reading section at N4/N5 that the official report does not have, and that invention is why the badges could never add up to the mark. New §2.6 records the defect, its origin in `sectionCaps` (`lib/mock.ts:238`) and its fix, and `TASK-113`'s existing acceptance criterion covers the implementation. **D12** settles the `drill-coverage` sequencing that `doc-13` §6.2 and §10 had left as an open item: the enum value and the store shape are specified now, the resolver refuses it until the v1.5 deck extension makes it reachable, and v1 admits through `checkpoint` and `skip`. D2 is unchanged: three named sources, never a blended score.

The same pass swept the repository for every other place that assumes three scoring sections at N4/N5. The result is recorded in §2.6: the wrong model is in the two helpers, five comments, the badge render loop, three unit tests that pass while pinning it, and the `apps/desktop/AGENTS.md` row, while every spec doc is clean and `doc-4` had the official model right from the start.

**v10 (2026-09-24, browser pass).** The result-layer defects in §2 stopped being a static-analysis claim. Driving the shipped seed paper in a real browser and submitting it renders `Language 40/120 ✓`, `Reading 0/60 ✗ (2 wrong)`, `Listening 60/60 ✓`, with no CEFR element and no overall-gate element anywhere in the DOM: a one-item listening section really does score its full 60-point cap in the running app, and both missing outputs are missing exactly where the learner looks. The same pass found one new gap, now in §9: with the server unreachable the desk degrades honestly (`sensei offline — the desk still works`) while `/ai` renders an error boundary, so the chat surface has no degraded state. It also confirmed `doc-20`'s inventory is real rather than a static-analysis artifact: the same run printed `No goal picked yet — the first-run page will ask...`, `a · Apple — sharp (katakana)` and the seed prompt `聞いてください — What is the car like?`. Full record: `doc-19` §12.1.

**v9 (2026-09-24, wireframes and the copy-voice work order).** Added `doc-19`, ASCII wireframes for every surface this feature adds or changes: the chat at rest, the intent receipt and confirm card, the four degraded intent states, the drill-set card with its pending, answered, suspended and summary states, the kana checkpoint wizard and result, the paper request with real slot counts, the split workspace in both modes plus its narrow and confirm states, the result above and below the viability floor, the review rows, and the failure states from §9. Each frame names the copy key behind its strings, so a frame that needs a string with no key is caught as a spec bug. Added `doc-20`, the R-02 work order: a repo-wide scan found **221 non-comment em dashes** (119 rendered copy across 36 files, 11 placeholder glyphs, 18 Rust strings, plus prompt, diagnostic, tooling and test hits) and 1229 more inside shipped corpus data, which it deliberately leaves as a decision. The scanner is committed at `scripts/voice-sweep.ts`, so the checklist regenerates instead of being trusted; the deck guard (`packages/ui/test/copy-snapshot.test.ts`) already covers the typed surface.

**v8 (2026-09-24, copy voice enforced, intent layers final).** R-02 stopped being a promise: `packages/ui/test/copy-snapshot.test.ts` now fails on any em dash in a copy value, and the deck's 20 user-visible em dashes became `:`, `.` and `·`. `doc-18` moved to v2: the layer table is five now (L0 explicit, including the starter chips already on `/ai`; L1 deterministic slot grammar; L2 structured proposal; L3 confirm; L4 fallback), and its new §4.1 names the stored row behind every referent a learner can say, so "the stuff I keep getting wrong" resolves from data rather than confidence. `TASK-113` was reworded to the §1.1 vocabulary in its title, description and acceptance criteria, with scope, priority and status untouched.

**v7 (2026-09-24, intent layer, throughput and bookkeeping).** Added `doc-18` (intent resolution and session setup: the four layers, the slot table, topic-to-anchor resolution with the receipt rule, when a session must confirm, mid-session corrections, local counters). Added §1.1, the canonical vocabulary: the paper mode `practice` is renamed **`shortened`** and `full` is renamed **`exam-conditions`**, tier 2 is a **drill set** served by `next_drill_item` with `drill_attempts` and `sessions.surface = "drill"`, and `practice` stays the review desk's word. Added §9, the consolidated failure and degradation matrix, so the per-doc degradation lines cannot drift apart or quietly become prose. Closed three gaps the six specs had left open: **prefetch and runway** (`doc-16` §5.1, `doc-15` §4.1), because a card that waits on a model turn would kill tier 2 in practice; **post-paper review** (`doc-17` §7.1, `doc-13` §8), because the review pass is where a paper teaches and it was unspecified; and **copy keys per surface** (`doc-13` §8.1, `doc-14` §7.1, `doc-15` §6.1, `doc-17` §7.2, `doc-18` §10) against the typed deck. Recorded honestly: R-02 (no em dash) has no automated guard, and the deck ships 25 em dashes today, so the guard is an open item.

**v6 (2026-09-24, exam workspace).** A generated paper no longer reuses the single-surface wizard route: taking it opens a split workspace with the chat on the left and the paper (sections, per-section timer, navigation, submit) on the right, so generation, running and the debrief stay one conversation. Added `doc-17` (layout contract, mounting rules, composer gating during a paper, timer and section behavior, resume, accessibility, component architecture). Two consequences recorded there: the floating AskSensei chat must not mount on that route (one Provider, no draft-blob race), and `isChromeFreePath` needs a prefix branch because a parameterised route can never match by equality.

**v5 (2026-09-24, scope widened to the whole chat).** The chat is not only an exam generator: it is the learning surface, with three tiers (casual conversation, drill sets, exam on request). Added `doc-15` (the chat loop: tiers, deterministic routing, the host-MCP drill card, session shape, hand-offs) and `doc-16` (the shared item engine: `QuestionItem`, the `items` store that papers and drill sets both compose, difficulty and selection policy, grading, FSRS write-through, reuse of a missed item across surfaces). Phasing changed: **the drill-set loop (v2) now precedes paper assembly (v3)**, because it is cheaper, higher frequency, and validates the item engine and its validator before papers depend on them. The chat-must-never-quiz-unprompted rule and the "code grades, the agent explains" split are recorded in `doc-15`. The legacy `/learn/chat` SSE lane is explicitly not the vehicle (it is live but its provider registry is empty; `doc-15` §8).

**v4 (2026-09-24, decisions settled).** All ten decisions closed; D2 overridden to **both** and D10 overridden to **EJU out of scope**. Detail moved into two child specs so nothing is duplicated: `doc-13` owns the checkpoint (coverage model with exact group sizes, item types, sizing, sampling, the two-rule pass rule with worked examples, retake and cooldown policy, the three-source admission model, stores, result view) and `doc-14` owns the pipeline (blueprint and modes, request contract, assembler rules, the eleven-reason validator enum, storage and state machine, chat contract). §3 and §4 here are reduced to decisions plus links. New in this revision: the v1.5 deck extension (without it, `drill-coverage` admission is unreachable because drill decks ship two of six kinds), the concrete cooldown, the band-scaled viability floor (band points / 6 per item), and the removal of every EJU sharing promise.

**v3 (2026-09-24, scored-surface audit).** Added §2.5 (Defect 4: `overallPassMark` at `lib/mock.ts:244` has zero consumers, so only the sectional half of the official two-gate rule reaches the score view), and refreshed the §0, §5, §6 and §8 text that assumed two working result-layer outputs. `TASK-113` gained the matching acceptance criterion. The same audit checked every other scored surface and found them clean on unit handling: review queue (`routes/review.tsx:97` through `lib/review.ts:44` into `previewIntervals`), settings retention slider (`features/settings/settings.tsx:137`/`:138`), `similarityPercent` (`lib/deinflect.ts:584`), `shadowScore` (`lib/shadow.ts`), drill raw counts (`features/drill/drill-lab.tsx:1340`), and the reader (no percentages). It also found one latent trap outside this doc's scope: `particleScore` (`lib/roleplay.ts:45`) caps at 3 while the composer divides by `required.length` (`features/roleplay/roleplay.tsx:545`), unreachable today because all six scene lines declare at most 2 particles (`lib/roleplay-scenes.ts:70`-`:149`). Audit trail: `TASK-113` comments #1 and #2.

**v2 (2026-09-24, critical review).** Corrections to v1, each verified against source rather than recalled:

- Added §2.2 / §2.3 / §2.4 and promoted the result-layer fix to **v0**. v1 listed the sectional badges and the CEFR badge as working dependencies; both are defective (ratio scaling on 1-2 item sections; raw count passed where 0-180 points are expected, so the CEFR badge can never appear).
- Rewrote §3 on real data. v1 said "46+46 gojuon with a `katakana` field"; the corpus is 208 cells in six kinds and the `katakana` field exists on 5 entries. v1's row floor was also unsound: `dakuten` が carries `row: "k"`, so pooling by `row` masks failed gojuon rows.
- Added the anti-memorization rule (regeneration per attempt) and the `っ`/`ー` gap, both absent from v1.
- Added §3.5: a checkpoint result has no `grammarId`, so it cannot share the mock's weak-pattern/plan/CEFR path, and the kana queue needs a `/drill` schema extension.
- Replaced §4.1's fixed timings with `practice` vs `full` modes and a paper-budget input; closed the timing decision with a rule. (Those two modes are named `shortened` and `exam-conditions` since v7.)
- Added the rejection-reason enum, the `ambiguous` veto, and the decision to drop `usage` items from v2 (v1 implicitly assumed anchoring equals correctness).
- Added the exam state machine, per-pick persistence, resume, time-up behavior, and the answer-key containment rule.
- Renumbered decisions to D1..D10.
