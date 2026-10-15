---
id: doc-14
title: 'JLPT exam generation pipeline: request, assembler, validator, storage'
type: specification
created_date: '2026-09-24 05:07'
updated_date: '2026-09-27 02:08'
---
# JLPT exam generation pipeline: request, assembler, validator, storage

> **Status:** draft v1, decisions settled
> **Date:** 2026-09-24
> **Type:** specification
> **Parent:** `doc-12` (chat-generated JLPT exams + kana readiness gate). This doc owns the *detail* of `doc-12` §4; `doc-12` keeps the decision record and the summary.
> **Siblings:** `doc-13` (kana checkpoint detail), `doc-15` (the chat surface: casual chat, drill sets, exam handoff), `doc-16` (the item engine: item shape, storage, difficulty, grading), `doc-17` (the workspace a running paper is taken on: chat left, paper right), `doc-18` (how the request that reaches §3 is resolved)
> **Wireframes:** `doc-19` §5 (request receipt, real lead time, ready)
> **Depends on:** `TASK-113` (result-layer honesty, v0) for the score view this pipeline feeds

---

## 0. Scope

Owns: the blueprint (modes, per-section budgets, item-type mix), the request contract, assembler rules, the validator and its rejection enum, the `exams`/`exam_items` schema and state machine, the chat contract in both directions, and the verification list.

Does not own: the item itself (`doc-16`), the kana checkpoint (`doc-13`), the chat surface and its drill-set tier (`doc-15`), the result-layer defects (`doc-12` §2), the entry-point UX table (`doc-12` §3.4), phasing (`doc-12` §6). A paper is a **composition of items**, never a second question generator.

**Explicitly out of scope: EJU (D10).** No `eju-mock` work, no subject tree, no science-vs-Japan-and-the-World exclusivity, no two-consumer engine. The only EJU relationship is a boundary: do not bake JLPT-only assumptions into the item shape where avoiding it costs nothing. See §9.

---

## 1. Decisions (settled 2026-09-24)

| ID | Decision | Value |
| --- | --- | --- |
| D5 | Viability floor (result layer) | band points / 6 per item: a 60-cap section needs ≥10 items, a 120-cap section needs ≥20. Below it, raw counts only. Owned by `TASK-113`; the assembler sizes papers to clear it. Caps are **scoring** sections (`doc-12` D11): at N4/N5 the 120-cap band covers Language Knowledge plus Reading together, so both budgets count toward one floor |
| D6 | Generation split | **Agent picks candidates, code assembles, validator vetoes.** The agent never ships a final option set |
| D7 | `usage` items | **Dropped from v2.** No deterministic check exists; revisit when an adjudication pass does |
| D8 | Key handling | **Anchors only in the tool result.** The assembler fills the key locally; the key never enters the transcript |
| D9 | Chat card | **A new row in `CARD_BODIES`** (`packages/chat-session/src/chat-card-switch.tsx:193`) |
| D10 | EJU | **Out of scope.** Build for JLPT; do not generalize for a consumer that does not exist |

---

## 2. Blueprint

### 2.1 Two modes, honestly labeled

| Mode | Section shape | Timer | Badges | Says "exam conditions"? |
| --- | --- | --- | --- | --- |
| `shortened` | official shape, smaller `budget` | scaled, labeled "shortened pace" | only above the D5 floor; otherwise raw counts | No |
| `exam-conditions` | official shape and official section minutes, item-type mix complete | official minutes | full bands + overall gate | Yes, and `exam-conditions` is v4 |

**Paper size is an input, not a constant.** Official per-section item counts are not a published fixed set, so the assembler takes an explicit `budget` per section and must satisfy the **item-type mix** from `doc-4` §1.3. The ratio is the target; a count nobody can cite is not.

### 2.2 Section shape by level (`doc-4` §1.2)

| Level | Sections | Official minutes | Reading / listening types |
| --- | --- | --- | --- |
| N1 | LangKnow·Reading + Listening | 110 + 55 | long, integrated, thematic; integrated listening |
| N2 | same | 105 + 50 | long, integrated, thematic |
| N3 | Vocab / Grammar·Reading / Listening | 30 + 70 + 40 | long reading yes, integrated no |
| N4 | Vocab / Grammar·Reading / Listening | 25 + 55 + 35 | no long reading, no outline listening |
| N5 | Vocab / Grammar·Reading / Listening | 20 + 40 + 30 | short/mid + information retrieval |

### 2.3 Floor-aware sizing

`shortened` budgets should clear the D5 floor whenever the learner asked for a real paper, so the result can report bands: **≥10 items in a 60-cap section, ≥20 in a 120-cap section** (one item worth ≤6 points). A deliberately short paper (a five-minute warm-up) is allowed and reports raw counts with the "shortened paper" label. The assembler decides this at request time from the budget, not after submit.

---

## 3. Request contract

```
{ level, mode, sections?, budget, focus?, seed }
```

| Field | Source of the default |
| --- | --- |
| `level` | learner level store; chat may set it from the sentence |
| `mode` | `shortened`, unless the learner asks for exam conditions |
| `budget` | mode default, or the learner's stated time ("I have 60 minutes" scales the budget down or up) |
| `focus` | last result's weak pattern ids (`doc-12` §4.5), so re-practice lands where it hurt. **LIVE since TASK-140.** The picker reads it as a PRIOR, not a filter: each slot first offers the focus anchor at that position when it is the right family for the item type and not already spent in the paper, and otherwise falls through to the seeded pool walk unchanged. So re-practice really does land where it hurt, a two-id focus still yields a full paper at the level floor, and an unknown or wrong-family id is a no-op rather than an error. Persisted on `exams.focus` (migration 0014) and round-tripped exactly (TASK-139). See doc-21 §9 for why the prior is `focus` and not the agent's choice. |
| `seed` | generated once and stored on the exam, so the paper is reproducible |

An N5 or `all` request also runs the `doc-12` §3.4 checkpoint offer first.

---

## 4. Assembler rules

The assembler is deterministic TypeScript and owns every decision the model must not make:

| Decision | Rule |
| --- | --- |
| Section placement | by the §2.2 shape for the level and mode |
| Item count | the request `budget`, per section |
| Option order | seeded permutation per item (the exam id, the request seed and the item id decide it); identical for a given exam id and seed. Fixed in `TASK-135`: the order used to be a sort over hash keys that differed only in their last character, so it was the identity for every item and every paper answered A |
| Distractor sourcing | real corpus surfaces at the paper's level, same part of speech or form class |
| Form-based distractors | the learner's actual error shape, the `wrongRuleVariant` convention already proven in `apps/desktop/src/features/lesson/conjugate.tsx` choices |
| Reading passages | corpus sentences or authored story data (`apps/desktop/src/lib/reader-stories.ts`) only, never model-written prose |
| Listening scripts | anchored text, spoken through `@manobu/speech/tts` `speak` at the learner's `useTtsPrefs` speed/sid, transcript hidden (the `mock-listening-play` path, `apps/desktop/src/features/mock/jlpt-mock.tsx:384`) |

The agent's output is a *candidate list*: anchors plus writing intent. The assembler turns that into items, or asks for a replacement.

---

## 5. Validator

The validator is **owned by `doc-16` §6** and consumed here: one implementation, one test list, no per-surface fork. Anchoring prevents invented content. It does **not** prevent a wrong answer key; the `ambiguous` check does. One rejection reason per test:

| Reason | Check |
| --- | --- |
| `no-anchor` | item cites zero corpus ids |
| `anchor-missing` | cited id not in the corpus |
| `anchor-level` | cited id is not at the paper's level |
| `ambiguous` | two or more options satisfy the item |
| `duplicate-option` | two options are the same surface |
| `unlucky-distractor` | distractor is not a real corpus surface at that level |
| `stem-leak` | the answer appears verbatim in the stem or passage |
| `mix-mismatch` | section's item-type mix violates §2.1 |
| `passage-length` | reading text exceeds the level cap (`LEVEL_MAX_JP_LEN`, `crates/jlpt-mcp/src/engine.rs:537`) |
| `script-missing` | listening item has no spoken script |
| `floor-unmet` | `shortened` paper whose budget clears no section floor while labeled as band-scored |

### 5.1 Per-item-type strategy

- **Form-based items** (sentential grammar, conjugation): a deterministic round trip. If a distractor also passes `verify`/`deinflect` for the stated target, reject. The machinery exists (`lib/conjugate.ts` `verifyForm`, `lib/deinflect.ts`, `crates/jlpt-mcp/src/deinflect.rs`).
- **Word-level items** (kanji reading, word in context, katakana words): two independent anchors (a vocab id and a sentence id), and reject on any duplicate reading among options.
- **`usage` items**: dropped from v2 (D7). No deterministic check exists; an unverifiable key is worse than a missing item type.
- **Reading passages**: one question per short passage in v2, so a single misread cannot cascade.

---

## 6. Storage and state machine

- **Tables.** `exams` (id, **conversation_id**, level, mode, source, seed, budgets, created_at, status, result JSON) plus `exam_items` (exam_id, **item_id**, section, item_type, `order`) composing the shared `items` rows (`doc-16` §3). Migration `0007` after `packages/db/src/migrations/0006_chat_conversations.sql`, same `user.db` ownership as cards. Composing rather than copying is what lets a missed paper item be replayed later as a drill-set item with the same id (`doc-16` §3).
- **`source`** is `generated | seed | checkpoint`, and it gates the result view: a checkpoint has no grammar ids and no bands (`doc-13` §8).
- **States.** `draft → ready → in_progress → submitted`, plus `abandoned`.
  - Answers persist **per pick**: an `exam-conditions` N1 paper runs 165 minutes and a crash at minute 90 cannot lose it.
  - Answer order per section is explicit; section transitions are events, not navigation accidents.
  - Time-up **auto-submits the section and never clears a score**.
  - `in_progress` resumes on open.
- **Key containment.** The key lives in `exam_items` and is read by the exam surface. The tool result carries anchors only (D8), because the tool-call card renders raw output today (`AcpToolCallPart`, `packages/chat-session/src/parts/acp-tool-call-part.tsx:13`). The debrief is gated on `status === "submitted"`, not on prompt etiquette.
- **Route.** A stored paper is taken in the **exam workspace** (`doc-17`): the chat column opens the paper's own `conversation_id` and the paper column runs it with sections, a per-section timer and navigation. `/jlpt-mock?exam=<id>` remains as the chrome-wrapped single-surface fallback, and `/jlpt-mock?filter=` keeps today's behavior including the offline seed fallback (`fetchGrammarLevel` never throws, `apps/desktop/src/lib/mock.ts:106`).
- **Determinism.** `seed` is stored; the same exam id renders identical option order on every mount (the TASK-74.1 precedent).

---

## 7. Chat contract

| Direction | Contract |
| --- | --- |
| Request | "Give me an N4 paper, I have 60 minutes" becomes the §3 request; N5/`all` runs the checkpoint offer first |
| Card | announced **after the exam row commits**, so a dropped socket cannot produce a link to nothing. One new row in `CARD_BODIES` (D9) |
| Debrief | post-submit only, gated on `status === "submitted"`. Facts, not prose guesses: raw counts, scaled bands *or* raw-only below the floor, weak pattern ids, anchor list |
| Next step | deterministic (`doc-10` R1 session spine, TASK-61; drill bridge TASK-62), not "want me to make another one?" |
| Leakage | the generation turn must not narrate the key; the debrief is the one place it may appear, and only after the paper is closed |
| Inline tier | tier 2 lives in `doc-15`: one item per card, the verdict in the card, no sections, no timer, no bands. This pipeline is only the paper branch |
| Lead time | assembly is the slow path (a 60-item paper is not one model call), so the request returns immediately and the building state is honest: the chat shows one working line, and its counts are **real validated-slot counts** ("18/20 items ready"), never a synthetic progress bar. A `shortened` paper of 20 items is batched per section in parallel; the exam stays `draft` until every section validates, so a partial paper is never takeable |
| Request resolution | how the sentence became this request (layers, slots, the receipt the learner confirms) is `doc-18`; this doc starts from the resolved request object |

### 7.1 Copy keys

| Key | String |
| --- | --- |
| `paper.mode.shortened` | "shortened paper" |
| `paper.mode.examConditions` | "exam conditions" |
| `paper.build.running` | "Building your paper. {n}/{total} items ready." |
| `paper.build.failed` | "The paper could not be built. Try again?" |
| `paper.result.rawOnly` | "Shortened paper: item counts only." |
| `paper.result.twoGates` | "Total {total}/{max} against {mark}, plus each section." |
| `paper.debrief.weak` | "Missed: {anchors}" |
| `paper.debrief.notSaved` | "Your last result was not saved." |

Eight keys in the typed deck (`packages/ui/src/lib/copy.ts:95`), covered by
`apps/desktop/test/walkthrough-copies.test.ts` where that gate applies. No em dash (R-02).

---

## 8. Verification

- Validator: one test per §5 reason, including `floor-unmet`.
- **Ambiguity**: a fixture where two options fit is rejected; a distractor that is the target's wrong-form sibling passes only for the intended item.
- Mix: a generated N5 `shortened` paper matches the §2.2 section list; an N3 paper has three sections.
- Floor interplay: a budget below the D5 floor produces raw counts and the short-paper label; a budget at the floor produces bands.
- Determinism: same exam id and seed, identical option order across two mounts.
- State machine: crash during `in_progress` resumes with answers intact; time-up auto-submits without clearing; only `submitted` unlocks a debrief.
- No-leak: a golden asserting the generation turn's rendered transcript contains no answer text; the debrief turn may.
- Offline: no server means the seed fallback plus an honest badge, never an empty paper.
- Cross-surface: the chat debrief's numbers equal the stored result object.
- Lead time: the building line's counts equal the number of validated slots at that moment; a paper is not takeable
  while any section is unvalidated.
- Copy: the eight keys in §7.1 exist and contain no em dash, enforced by `packages/ui/test/copy-snapshot.test.ts`.
- Degradation: `doc-12` §9 rows for a dead agent mid-generation, a dead agent mid-paper, an unreachable server and an
  offline listening section are each exercised.

Commands: `bun run check-types`, `bun run check`, `bun run test` in `apps/desktop`; `cargo test` in `crates/jlpt-mcp` for new MCP tools; `fallow audit --base main` before push.

---

## 9. Out of scope

- **EJU (D10).** No subject tree, no EJU mocks, no shared-engine promise. `doc-3` stays parked.
- ~~`exam-conditions` N1 and N2~~ — shipped as `TASK-131` (N3/N2 three sections, 105 + 50) and `TASK-132` (N1 integrated and thematic reading, integrated listening, 110 + 55). What is still deferred is the *source* of those stimuli: the assembler seeds its passages and scripts locally rather than pulling authored reader-story data (`§4`).
- `usage` items (D7).
- IRT equating or any official-score equivalence claim. We scale raw to capped bands and label it a shortened paper result.
- Free-writing or free-speaking grading inside an exam.

---

## 10. Open items

| Item | Why it is open | Recommendation |
| --- | --- | --- |
| MCP tool naming | new tools on `crates/jlpt-mcp` must not collide with the 12 existing ones, and `crates/AGENTS.md` gates a golden-parity test | propose `exam_blueprint` + `exam_candidates` for papers and `drill_candidates` for drill sets (distinct tools, `doc-16` §11) — all three stay out of `DEBUG_TOOLS` (`crates/jlpt-mcp/src/main.rs:118`) |
| Agent skill file for authoring | item writing quality depends on instructions the agent reads | a skill under the `packages/skills` resolution order (built-in, then `.manobu/skills`, then `~/.manobu/skills`) |
| Default budgets per level | v2 needs concrete numbers, and they must clear the D5 floor | set them with the floor and the mode table in one place, tested |
| Whether the debrief writes back to the weak queue automatically | TASK-62 owns the bridge | keep it explicit (a button), not automatic, so the learner sees the handoff |
| Section-level parallel assembly | generation is the slow path, and per-section batches could cut the wait | ship sequential per section first, measure with the building-line counts, then parallelise |

---

## 11. References

Verified this session (file:line):

- `apps/desktop/src/routes/jlpt-mock.tsx:12` `filter` enum, `:18` `mockQueryOptions`, `:25` `SEED`
- `apps/desktop/src/lib/mock.ts:106` `fetchGrammarLevel` (never throws), `:145` `deriveWeakPatterns`, `:238` `sectionCaps`, `:244` `overallPassMark`, `:259` `sectionalPassMark`, `:270` `cefrForScore`, `:327` `scoreBySection`
- `apps/desktop/src/features/mock/jlpt-mock.tsx:247` `SectionBadge`, `:283` `computeSectional`, `:384` `mock-listening-play`, `:461` `Plan`
- `apps/desktop/src/features/lesson/conjugate.tsx` (`wrongRuleVariant` distractor convention)
- `apps/desktop/src/lib/deinflect.ts`, `apps/desktop/src/lib/conjugate.ts` `verifyForm`
- `packages/japanese/data/` — `n1..n5.json`, `grammar/`, `sentences/`, `reader-stories.ts` sources
- `crates/jlpt-mcp/src/main.rs:118` `DEBUG_TOOLS`, `:141` `lookup_vocab`, `:182` `list_vocab_by_level`, `:210` `list_grammar_by_level`, `:227` `lookup_kanji`, `:355` `search_examples`, `:367` `random_example`; `crates/jlpt-mcp/src/engine.rs:537` `LEVEL_MAX_JP_LEN`, `:545` `sentence_level`, `:557` `pseudo_random_index`
- `crates/AGENTS.md` (golden-parity contract for the MCP crate)
- `packages/db/src/migrations/0006_chat_conversations.sql` (highest; `0007` free)
- `packages/chat-session/src/parts/acp-tool-call-part.tsx:13` `AcpToolCallPart`; `packages/chat-session/src/chat-card-switch.tsx:193`; `packages/chat-session/AGENTS.md:235` (`CARD_BODIES`, `STRETCHED_TYPES`)
- `packages/skills/AGENTS.md` (skill resolution order)

Backlog docs: `doc-12` (parent), `doc-13` (kana checkpoint), `doc-15` (chat surface), `doc-16` (item engine), `doc-17` (exam workspace), `doc-4` (§1.2/§1.3/§1.4), `doc-10` (R1/R3), `doc-3` (EJU, parked), `TASK-113`.
