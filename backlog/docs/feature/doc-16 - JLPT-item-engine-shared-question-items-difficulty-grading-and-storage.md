---
id: doc-16
title: 'JLPT item engine: shared question items, difficulty, grading and storage'
type: specification
created_date: '2026-09-24 05:14'
updated_date: '2026-09-26 04:23'
---
# JLPT item engine: shared question items, difficulty, grading and storage

> **Status:** draft v1
> **Date:** 2026-09-24
> **Type:** specification
> **Parent:** `doc-12`. This doc owns the **item**: what a question is, where it is stored, how it is anchored, how difficulty is chosen, and how it is graded.
> **Consumers:** drill sets (`doc-15`), exam papers (`doc-14`), the kana checkpoint (`doc-13`)
> **Siblings:** `doc-18` (how a request resolves into the anchors this engine selects from)
> **Wireframes:** `doc-19` §3 (the card an item renders into)
> **Corpus:** `packages/japanese/data/*` via `crates/jlpt-mcp` (12 tools) and the server routes

---

## 0. Scope

Owns: the `QuestionItem` shape, the item store, per-surface differences, item types and which are deterministically validatable, the difficulty and selection policy, grading and the FSRS write, explanation policy, and reuse of a missed item across surfaces.

Does not own: how a surface presents items (cards and chat in `doc-15`, papers and sections in `doc-14`), the checkpoint's coverage and pass rule (`doc-13`), or the result layer (`doc-12` §2 / `TASK-113`).

**The reason this doc exists:** "make a quiz" and "make an exam" must not become two question-making machines. One engine, three surfaces, one validator.

---

## 1. One engine, three surfaces

| Surface | Item granularity | Presentation | Sections | Timer | Verdict surface | Stored as |
| --- | --- | --- | --- | --- | --- | --- |
| Drill set (`doc-15`) | one at a time | chat card | none | none | immediate, in the card | `items` + `drill_sessions` + `drill_attempts` |
| Exam paper (`doc-14`) | paper of N | exam wizard | by level | mode-dependent | after submit | `items` + `exam_items` |
| Kana checkpoint (`doc-13`) | script paper | exam wizard (checkpoint skin) | per script | none | after submit | `items` + `exam_items` with `source: "checkpoint"` |

What differs per surface is presentation and scoring policy. What does **not** differ: the item shape, the anchoring rule, the validator, and the key-containment rule.

---

## 2. `QuestionItem`

```
QuestionItem {
  id                // stable, served as a reference; the item the client is allowed to see
  surface           // "drill" | "exam" | "checkpoint"
  level             // N5..N1, or a kana script marker for checkpoint items
  itemType          // see §4
  prompt            // the stem, in Japanese, with the blank marker where applicable
  stimuli[]         // ORDERED reading passages and scripts the item depends on (TASK-132)
  passage?          // reading stimulus: the FIRST stimuli passage, kept for single-stimulus consumers
  options[]         // ordered, exactly 4 in v1
  answerIndex       // NEVER sent to the client before a pick (D8)
  explanation?      // see §7
  anchors           // >= 1 corpus id, the whole point (§6)
  script?           // listening: the FIRST stimuli script, the spoken text (hidden) — audio is generated, not stored
  fsrsVocabId?      // when the item is FSRS-backed, the card it grades
  seedPart?         // deterministic option order input
}
```

Two rules:

- **The key is data, not text.** `answerIndex` lives in the store and in the resolution payload, never in a rendered transcript before the learner picks (for drill sets, `doc-15` §5; for papers, `doc-14` §6).
- **`anchors` is non-empty by construction.** An item with no anchor cannot be stored, which makes "unanchored content" a write-time impossibility rather than a review-time hope.
- **One ordered stimulus set (TASK-132; supersedes the singular `passage?`/`script?` pair).** `stimuli` is the canonical list and the singular fields are its materialized FIRST entry, so a row written before the set existed still reads correctly and a multi-source item still looks like a passage item to a single-stimulus consumer. An item type declares what it owes in one requirement table: `long-reading` 1 passage, `reading-info` 0 (optional), `listening-detail` 1 script, `integrated-reading` 2 passages, `integrated-listening` 1 script plus any passages. A missing required kind is `stimuli-kind`; the right kinds in too small a number is `stimuli-count`. There is no "no stimuli at all" reason, because an empty set is always already a missing required kind. Scripts never reach a client: the wire carries passages only.

---

## 3. Storage

| Table | Columns | Notes |
| --- | --- | --- |
| `items` | id, surface, level, item_type, prompt, stimuli JSON (TASK-132), passage, options JSON, answer_index, explanation, anchors JSON, script, fsrs_vocab_id, seed_part, created_at | shared by all three surfaces; migration `0007` after `0006_chat_conversations.sql` |
| `exam_items` | exam_id, item_id, section, item_type, `order` | a paper is a **composition** of item ids plus per-surface ordering, not a copy of the item |
| `drill_sessions` | id, conversation_id, tier, level, anchors JSON, declared_count, started_at, ended_at, status | the session record the receipt (`doc-18` §4), suspension (§5.1) and the summary read |
| `drill_attempts` | id, session_id, item_id, chosen_index, correct, at | the record the summary and the weak-anchor counts read |
| `exams` | id, level, mode, source, seed, budgets, created_at, status, result JSON | `doc-14` §6 |

Consequences worth stating, because they are the point of composing instead of copying:

- **A missed exam item can be replayed as a drill item** (`doc-15` §9) with the same id, so "retry this exact question" is a lookup, not a regeneration.
- **Determinism is per item**, so the same paper renders identically (`doc-14` §6) while a drill set can draw the same item at a different option order via its own `seedPart`. The order is a seeded Fisher-Yates over the item identity (`TASK-135`), never a sort over hash keys that differ only in their last character — that mistake made the order the identity and every generated paper answered A.
- **A session is a row, not a transcript.** `drill_sessions` is what "drill set: particles · 10 items" refers to, what the receipt names (`doc-18` §4), and what resume reads after a reload.
- **FSRS linkage is explicit.** `fsrs_vocab_id` exists only where a real card can exist (word and reading items). Grammar and listening-comprehension items have no card and must not fake one. The legacy lane's demo interval (`vocabSrsDueCards` with `{ difficulty: 5, stability: 10 }`, `packages/agent/src/subagents/index.ts`) is not a model for this.

---

## 4. Item types

| `itemType` | Shape | Anchor | Deterministically validatable |
| --- | --- | --- | --- |
| `kanji-reading` | word shown, choose its reading | `n{level}.json` entry | Yes: readings are in the corpus |
| `word-in-context` | sentence with a blank, choose the word | sentence id + vocab id | Yes: two anchors, distinct surfaces |
| `grammar-form` | sentence with a form blank, choose the form | grammar id + sentence id | Yes: round trip via `verifyForm`/deinflect |
| `conjugation` | verb/form pair, choose the shape | `verbs-n5.json` + the conjugation engine | Yes: engine is the ground truth |
| `particle` | particle blank | grammar id + sentence id | Yes: exactly one candidate fits by construction |
| `reading-info` | notice/passage plus a question | authored reader story or corpus sentence | Partly: one question per short passage; the integrated types own the multi-passage case (TASK-132) |
| `listening-detail` | TTS line, choose the answer | sentence id or authored line | Partly: same as reading, plus a required script |
| `long-reading` | one long passage, one question | authored reader story or corpus sentence | Partly: required passage + length budget (TASK-131, N3 only) |
| `integrated-reading` | SEVERAL passages around one theme, cross-passage question | authored reader story or corpus sentences | Partly: required 2+ passages (TASK-132, N1 only) |
| `integrated-listening` | one or more recorded lines, optionally with a printed passage | sentence id or authored line | Partly: required 1+ script, passages allowed (TASK-132, N1 only) |
| `kana-cell` | kana cell or word, choose romaji/kana | `kana.json` cell | Yes: `char`/`romaji` are the key (`doc-13` §3) |
| ~~`usage`~~ | word usage distinction | none available | **No. Excluded** (D7) |

Level assignment: the anchor's level decides the item's level. A word from `n4.json` cannot produce an N5 item, which is the `anchor-level` rejection in §6.

---

## 5. Difficulty and selection policy

Deterministic, testable, and owned by code. The agent supplies anchor candidates; code decides which item comes next (`doc-14` §4's split, at single-item granularity).

**Selection order (default v1): due → weak → new, in a 40/40/20 mix**, interleaved rather than blocked, so a session does not become ten items on one particle:

| Bucket | Source | Why |
| --- | --- | --- |
| `due` | `/cards/due` (real FSRS rows, earliest first) | maintains the review load the desk already tracks |
| `weak` | `deriveWeakPatterns` output from the last paper or drill set (`apps/desktop/src/lib/mock.ts:145`), plus the anchor counts in `drill_attempts` | retrieval practice where it actually hurt |
| `new` | the learner's level, from `list_vocab_by_level` / `list_grammar_by_level` | growth, in a measured dose |

**Level ladder:** items come from the learner's level. Two consecutive misses on the same anchor step down one level for that anchor's topic; three consecutive correct answers on a topic step up. The step is recorded, so the summary can explain it.

**After two consecutive misses on one anchor:**

1. insert a worked example (the grammar point's own fields, or the word's sense), then
2. insert a near-neighbour item on the same anchor built from the learner's actual error shape (the `wrongRuleVariant` convention proven in `apps/desktop/src/features/lesson/conjugate.tsx`), then
3. return to the normal mix.

**Re-queue rule:** a missed item comes back once at the end of the session. Not twice, not forever: a
session that keeps replaying misses stops being practice and becomes a punishment.

### 5.1 Pool, runway and batch generation

The card never waits on the model (the loop-side rules are `doc-15` §4.1; these are the engine's).

| Rule | Value |
| --- | --- |
| First batch | a set does not open until `min(5, count)` items exist, validated and stored |
| Runway | keep at least 3 unasked items ready at all times |
| Refill | when the runway drops below 3, request the next batch of 5 in the background. Answering an item never triggers a blocking request |
| Batch shape | cheap types (kana cell, kanji reading, conjugation, particle) generate 5-8 at a time; reading and listening items (passage plus script, both anchor-heavy) generate 1-2 |
| Draw order | **pool first, generate second**: an unasked stored item matching the session's anchors and level is drawn before a new call. Storage is cheap because items are anchored and deterministic (`doc-14` §4) |
| Validity | an item is re-checked at draw time by resolving its anchors; a corpus change that breaks an anchor invalidates the item rather than serving it |
| Supersession | after two misses on one anchor (`doc-15` §4.2) or a topic correction (`doc-18` §6), unasked batch items are marked `superseded` and not drawn. At most 2 supersessions per session, so a correction cannot spiral into repeated generation |
| Waiting | with the runway empty and a refill in flight, the card shows `drill.pending` and offers to end the set |
| Cost | a 10-item set is roughly 2-3 batches plus supersessions; the batch size is the knob, tuned with the local counters (`doc-18` §8) |

Why this is not premature: the alternative (one item per agent turn) is the failure that makes a question set feel
dead, and neither the verdict nor the ordering depends on the model, so this is a scheduling decision the engine can
own without new contracts.

---

## 6. Anchoring and the validator

The validator is owned here and consumed by `doc-14` §5 and `doc-13` §4; one implementation, one test list, no per-surface fork.

| Reason | Check |
| --- | --- |
| `no-anchor` | zero corpus ids |
| `anchor-missing` | cited id not in the corpus |
| `anchor-level` | cited id is not at the item's level |
| `ambiguous` | two or more options satisfy the item |
| `duplicate-option` | two options are the same surface |
| `unlucky-distractor` | distractor is not a real corpus surface at that level |
| `stem-leak` | the answer appears verbatim in the stem or passage |
| `mix-mismatch` | paper-level only (`doc-14`) |
| `passage-length` | exceeds `LEVEL_MAX_JP_LEN` (`crates/jlpt-mcp/src/engine.rs:537`) |
| `script-missing` | listening item has no script |
| `floor-unmet` | paper-level only (`doc-14`) |

`ambiguous` is the important one: anchoring prevents invented content, a round trip prevents two right answers. Per-type strategy is in `doc-14` §5.1 (form-based round trip, two anchors for word-level, `usage` excluded).

---

## 7. Grading contract

| Step | Who | Detail |
| --- | --- | --- |
| Pick | the card (drill set) or the wizard (paper) | sends `{ itemId, chosenIndex }` |
| Verdict | code | `chosenIndex === answerIndex`; deterministic, immediate, no model call |
| Explanation | agent prose, on demand or after a wrong pick | constrained to the item's anchors: it may cite the grammar point or the word's sense, never invent a rule. Marked as generated |
| Record | code | `drill_attempts` row; on papers, the item's correctness inside the paper result |
| FSRS write | code, only when `fsrsVocabId` exists | through the existing grade contract `GradeSchema { cardId, grade: again \| hard \| good \| easy }` (`apps/server/src/routes/cards.ts`); mapping is item-appropriate (wrong → again, correct-slow → hard/good, correct-fast → easy) and recorded once per attempt |
| Idempotency | code | a double submit for the same `(itemId, session)` is a no-op, so a replayed card cannot double-grade a card |

Offline: if the store is unreachable, a drill set degrades to tier 1 talking (`doc-15` §11) and a paper falls back to the built-in seed (`doc-14` §6). No item is ever served without its key being resolvable somewhere.

---

## 8. Where items come from

| Source | Mechanism |
| --- | --- |
| Corrections | the corpora, through the MCP tools the agent already has: `list_vocab_by_level` (`crates/jlpt-mcp/src/main.rs:182`), `list_grammar_by_level` (`:210`), `search_examples` (`:355`), `random_example` (`:367`), `conjugate`, `lookup_pitch_accent` |
| Sentences | `packages/japanese/data/sentences/` with the level heuristic (`sentence_level`, `crates/jlpt-mcp/src/engine.rs:545`) |
| Reading/listening stimuli | authored reader stories (`apps/desktop/src/lib/reader-stories.ts`) and the server's corpus-anchored generator (`apps/server/src/services/next-cards.ts`) |
| Kana | `packages/japanese/data/kana.json` (`doc-13` §2) |

The agent proposes anchors and writing intent; the assembler builds the item and the validator may reject it. A rejected item is replaced, never repaired by hand at runtime.

---

## 9. Consumers and reuse

- **`doc-15`** drill sets: one item per card, immediate verdict, session summary.
- **`doc-14`** papers: `exam_items` composes item ids into sections, with the paper's own scoring and state machine.
- **`doc-13`** checkpoint: the same item shape with `surface: "checkpoint"` and coverage rules that the checkpoint owns.
- **`/drill`, `/review`, `/reader`**: not consumers of `items` in v1; they keep their own decks and FSRS cards. The bridge is the anchor, not the table, so a missed item points at a drill/reader target (TASK-62) instead of forcing those surfaces onto this schema.

---

## 10. Verification

- Item write: an item with zero anchors, a missing anchor, a wrong-level anchor, a duplicate option, a non-corpus distractor, a stem leak, or a missing listening script is rejected (one test per reason).
- Ambiguity: the two-option fixture is rejected; the wrong-form-sibling distractor is accepted only for the intended item.
- Key containment: a stored item rendered to a client carries no `answerIndex`; the resolution payload does.
- Storage: an exam paper references item ids (`exam_items`), and re-using a missed item in a drill set resolves to the same row. A suspended session resumes from `drill_sessions`.
- FSRS: a grammar item has no `fsrs_vocab_id` and writes no grade; a word item writes exactly one revlog row per attempt; a double submit writes none.
- Selection: the 40/40/20 mix holds over a 20-item run; a due card outranks a new item of the same level; determinism for a fixed seed.
- Adaptation: two consecutive misses on one anchor produces worked example → near-neighbour → normal mix; three consecutive correct steps the topic up one level.
- Re-queue: a missed item returns exactly once.
- Degradation: unreachable store yields tier 1 talking, never an item without a resolvable key
  (`doc-12` §9).
- Batch: a set does not open below its first batch; the refill fires at runway 3 and never blocks a pick; a
  supersession drops unasked items and is capped at 2; a batch-drawn item is re-validated when drawn.
- Copy: the drill keys used here live in `doc-15` §6.1 and the pending state in particular is asserted not to
  fabricate an item.

Commands: `bun run test` in `apps/desktop` and `apps/server`; `cargo test` in `crates/jlpt-mcp` for new MCP tools; `fallow audit --base main` before push.

---

## 11. Open items

| Item | Why it is open | Recommendation |
| --- | --- | --- |
| MCP tool for candidate selection | must not collide with the 12 existing tools and must respect the crate's golden-parity test (`crates/AGENTS.md`) | add `drill_candidates` and keep it out of `DEBUG_TOOLS` (`crates/jlpt-mcp/src/main.rs:118`) |
| ~~Item cache vs regenerate~~ | **closed by §5.1**: pool first, generate second, with draw-time anchor revalidation | shipped as specified |
| Where the grade mapping lives | three surfaces share the mapping, so it must not drift | one pure function in the item engine, tested once |
| Cheap-vs-good items | a kana cell item is free; a reading item needs a passage and two anchors | draw a session's shape so the cheap items cannot dominate (the 40/40/20 mix plus a per-type cap) |

---

## 12. References

Verified this session (file:line):

- `apps/desktop/src/lib/mock.ts:145` `deriveWeakPatterns`, `:327` `scoreBySection`, `:238` `sectionCaps`, `:244` `overallPassMark`
- `apps/desktop/src/features/lesson/conjugate.tsx` (`wrongRuleVariant` distractor convention)
- `apps/desktop/src/lib/deinflect.ts` `similarityPercent` (`:584`), `apps/desktop/src/lib/conjugate.ts` `verifyForm`
- `apps/desktop/src/lib/reader-stories.ts` (authored reading/listening stimuli)
- `packages/japanese/data/kana.json` (208 cells, six kinds; no `っ`, no `ー`)
- `packages/japanese/data/` `n1..n5.json`, `grammar/`, `sentences/`, `verbs-n5.json`
- `crates/jlpt-mcp/src/main.rs:118` `DEBUG_TOOLS`, `:141` `lookup_vocab`, `:182` `list_vocab_by_level`, `:210` `list_grammar_by_level`, `:227` `lookup_kanji`, `:355` `search_examples`, `:367` `random_example`; `engine.rs:537` `LEVEL_MAX_JP_LEN`, `:545` `sentence_level`, `:557` `pseudo_random_index`
- `apps/server/src/routes/cards.ts` (`GradeSchema`, `/cards`, `/cards/due`, `/cards/grade`)
- `apps/server/src/services/next-cards.ts` (`generateNextCards`)
- `packages/db/src/schema/user.ts:9` `cards`, `:29` `revlog`; `packages/db/src/migrations/0006_chat_conversations.sql` (highest; `0007` free)
- `packages/agent/src/subagents/index.ts` (`vocabSrsDueCards` demo memory is not a real interval source)

Backlog docs and tasks: `doc-12`, `doc-15`, `doc-14`, `doc-13`, `TASK-61` (session spine), `TASK-62` (weakness bridge), `TASK-113`.
