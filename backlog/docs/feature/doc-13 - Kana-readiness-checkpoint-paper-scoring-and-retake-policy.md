---
id: doc-13
title: 'Kana readiness checkpoint: paper, scoring and retake policy'
type: specification
created_date: '2026-09-24 05:06'
updated_date: '2026-09-24 11:17'
---
# Kana readiness checkpoint: paper, scoring and retake policy

> **Status:** draft v1, decisions settled
> **Date:** 2026-09-24
> **Type:** specification
> **Parent:** `doc-12` (chat-generated JLPT exams + kana readiness gate). This doc owns the *detail* of `doc-12` §3; `doc-12` keeps the decision record and the summary.
> **Companion:** `doc-14` (exam generation pipeline, the detail of `doc-12` §4)
> **Siblings:** `doc-15` (the chat surface, where the checkpoint is offered), `doc-18` (how that request is resolved)
> **Wireframes:** `doc-19` §4 (the offer, the item, the result, the cooldown)
> **Depends on:** `TASK-113` (result-layer honesty) for the wizard's score view; `packages/japanese/data/kana.json` for coverage

---

## 0. Scope

Owns: coverage model, item types, per-script sizing, sampling, pass rule, retake and cooldown policy, the admission model (which signals can admit), store shape, result view, and the verification list for the checkpoint.

Checkpoint items are ordinary shared `QuestionItem`s (`doc-16` §2) stored in the shared `items` table (`doc-16` §3) with `surface: "checkpoint"` and composed into a paper through `exam_items`. The checkpoint is taken on the same paper surface as any stored paper (`doc-17`), in its own skin: two per-script sections, no section timing, no bands, no CEFR. The item shape, the anchoring rule, the validator and the key-containment rule are therefore not forked here; this doc owns only what is specific to the checkpoint.

Does not own: the entry-point UX table and the offer/skip semantics (`doc-12` §3.4), the exam storage schema (`doc-14` §6), the result-layer defects (`doc-12` §2).

---

## 1. Decisions (settled 2026-09-24)

| ID | Decision | Value |
| --- | --- | --- |
| D1 | Gate strictness | **Default-on offer with a persistent skip.** Blocks the recommendation, never the URL; a skip is an explicit override, never a recorded pass |
| D2 | Gate input | **Both**: checkpoint result and per-kana drill mastery. Resolved as an OR of three *named* admission sources rather than a blended score (§6) |
| D3 | Coverage and pass rule | Six corpus kinds plus word-level sokuon and chōonpu; per-script 90% with a per-group block rule (§4) |
| D4 | Retake policy | **Unlimited attempts, regenerated per attempt, with a 24-hour cooldown from the third failed attempt** (§5) |

D5 (the *result-layer* viability floor, 60 → 10 items / 120 → 20 items) is a mock-scoring rule, not a checkpoint rule; it lives in `doc-12` §7 and `TASK-113`.

---

## 2. Coverage model

Coverage comes from `packages/japanese/data/kana.json`: **208 cells in six `kind`s**, every cell carrying `char`, `romaji` and `row`. Group sizes are exact, not estimated:

| `kind` | Cells | Groups (`row`) | Group sizes |
| --- | --- | --- | --- |
| `gojuon` | 46 | 11 | vowel 5, k 5, s 5, t 5, n 5, h 5, m 5, y 3, r 5, w 2, `n-alone` 1 |
| `katakana` | 46 | 11 | identical to `gojuon` |
| `dakuten` | 25 | 4 | k 5, s 5, t 5, h 10 (ば行 + ぱ行) |
| `katakana-dakuten` | 25 | 4 | identical to `dakuten` |
| `yoon` | 33 | 7 | `h+y` 9, `k+y` 6, `s+y` 6, `t+y` 3, `n+y` 3, `m+y` 3, `r+y` 3 |
| `katakana-yoon` | 33 | 7 | identical to `yoon` |

Three rules that follow from the data:

1. **Group by `(kind, row)`, never by `row`.** `dakuten` が carries `row: "k"`, so pooling kinds would hide a wiped-out hiragana か-row behind healthy が-row answers.
2. **Six kinds, not 46+46.** A base-46 gate false-passes: N5 vocabulary is full of しゃしん, きって, コーヒー, ガラス.
3. **`っ` and `ー` are absent from the corpus.** The 208 cells include ん but no sokuon and no chōonpu, so those are tested at *word* level (きって vs きて, コーヒー), anchored in `packages/japanese/data/n5.json`.

---

## 3. The paper

Two script sections (hiragana, katakana), each sampling its own four kinds. Untimed. Every item answered.

| Item type | Intent | Source |
| --- | --- | --- |
| `kana-to-romaji` | きゅう: which sound is this | `kana.json` cells, both scripts |
| `romaji-to-kana` | which of these is `ryo` | cells; distractors from the same `(kind, row)` |
| `katakana-word` | コーヒー: read this loanword | `katakana*` kinds plus chōonpu word items |
| `word-kana` | きって vs きて: sokuon | `n5.json` vocab anchors where the minimal pair exists |
| `look-alike` | シ vs ツ, ソ vs ン | the shipped `LookAlike` pairs in `apps/desktop/src/features/drill/kana-chart.tsx` |

**Sampling: 2 items per group, drawn from the group's cells.** That yields

| Kind | Groups × 2 | Items |
| --- | --- | --- |
| `gojuon` / `katakana` | 11 × 2 | 22 (the `n-alone` group has 1 cell, so 21 when `ん` is drawn once) |
| `dakuten` / `katakana-dakuten` | 4 × 2 | 8 |
| `yoon` / `katakana-yoon` | 7 × 2 | 14 |
| word-level (sokuon, chōonpu) | n/a | 2 |
| **Per script** | | **~46** |
| **Both scripts** | | **~92** |

Roughly five minutes of untimed recognition, which is what the offer copy must say (`doc-12` §3.4 offers "about five minutes", not "two").

**Distractors are confusable, not random:** same `(kind, row)`, same vowel column, or a shipped look-alike pair. ロ against あ is a free point and teaches nothing.

**Regeneration (D4).** Every attempt draws a fresh stratified sample with a stored seed. Untimed plus a fixed paper would be passable by position memory in one sitting, which would make the gate a lie.

**Adaptive scoping (D2).** Cells with persisted drill mastery (§6) are sampled *last*: the paper still covers every `(kind, row)` group, but a learner with solid gojuon evidence spends their items on the groups they have not shown. This is how drill evidence enters admission without blending into an opaque score.

---

## 4. Pass rule

Pass is per script, independently. A perfect hiragana run never covers a katakana failure.

1. **≥90% of that script's sampled items correct.** With ~46 items this allows at most 4 wrong (46 × 0.9 = 41.4, so ≥42 correct).
2. **No group may be fully wrong.** A `(kind, row)` group with at least 2 sampled items blocks the pass if every sampled item in it is wrong. Groups whose corpus group holds a single cell (`n-alone`, i.e. ん) fold into rule 1 only, because one item is not evidence of a gap.
3. **All items answered.** No skipping; the paper is short and untimed.

Why the two rules together:

- Rule 1 alone passes a learner who scattered four misses across four unrelated groups. Those are slips, and slips are noise.
- Rule 2 alone is passable by luck on a short paper. Together they say: *a random miss is fine, a systematic hole in one row is not.*
- Concretely: 4 wrong, one in each of four different groups → pass. 2 wrong in the same `(kind, row)` group and 2 elsewhere → rule 1 passes (42/46 = 91%) and rule 2 fails (0/2 in one group) → **blocked**. The floor exists precisely for the paper that would otherwise pass on its average.

Rejected alternatives, recorded so they are not re-litigated:

- **80% overall.** With 4-option items the chance baseline is 25%; 80% is far weaker than it sounds and would admit learners who cannot yet read a N5 question stem.
- **95% overall.** Rejected as harsh for a checkpoint: five misses on 92 items is not a comprehension gap.
- **Timer.** Speed is not what the gate measures, and a timer manufactures panic in the exact population being protected.

---

## 5. Retake policy (D4, decided here)

| Attempt | Availability |
| --- | --- |
| 1st | Any time |
| 2nd | Immediately after the first result, offered with the miss review so the correction is fresh |
| 3rd and later | **24 hours after the previous failed attempt** |

Rationale: regeneration already stops memorization, but unlimited instant retries turn an untimed gate into a lucky-draw grinder. The first retry exists because retry-is-the-lesson is the house rule; the 24-hour cooldown from the third attempt exists because after two failures the learner needs study, not another roll. The cooldown is **per script**: failing katakana never blocks a hiragana attempt.

The cooldown blocks the checkpoint only. It never blocks `/drill`, `/reader`, `/lesson`, or any N4..N1 paper, and it is not a wall on the URL (`doc-12` §3.4).

---

## 6. Admission model (D2 = both)

Admission for a script is an OR of three **named** sources. No blended score, no hidden weighting, and the source is stored so the UI can always say why it is offering or not offering.

**Sequencing (D12).** v1 admits through `checkpoint` and `skip`. `drill-coverage` is specified here and refused at runtime until §6.2 ships, because a source that cannot fire is a promise the UI would have to hide. The refusal is deliberate and testable, not an oversight: the store, the state machine and the source name are all in place, and one flag flips when the decks cover six kinds.

| Source | Satisfied when | Notes |
| --- | --- | --- |
| `checkpoint` | the script's paper passed §4 | the instrument |
| `drill-coverage` | every `(kind, row)` group in that script is `solid` (§6.1) | **refused until the v1.5 deck work in §6.2 ships (D12)**. The enum value and the state machine exist from day one; the resolver returns "not available" rather than "not yet met", so a learner is never told they failed a gate that was not offered |
| `skip` | the learner chose *I can read kana: skip this* | an override, **not** a pass; reversible in Settings |

### 6.1 Per-cell mastery state

Derived from persisted drill outcomes, not from a single session:

| State | Rule |
| --- | --- |
| `solid` | ≥3 correct outcomes for the cell, spread over ≥2 sessions, with the last 2 outcomes correct |
| `shaky` | at least one outcome, not `solid` (includes any recent wrong) |
| `unseen` | no recorded outcome |

The ≥2-sessions clause is what keeps this honest: one good minute in the drill is not evidence of reading ability. A wrong answer resets the cell to `shaky` immediately, so a gap reappears the moment it is real. Where a source is available, all three drill modes count (`pick it`, `draw it`, `say it`).

### 6.2 The constraint that makes "both" partial, and the fix

Drill decks today cover **two of the six kinds**: `apps/desktop/src/routes/drill.tsx:23` types `kind` as `gojuon | katakana | kanji`, and the deck builders filter to `kind === "gojuon"` / `"katakana"` only. There is no dakuten, yōon or sokuon deck. So today `drill-coverage` is **unreachable**, and drill evidence can only scope the checkpoint (§3, adaptive scoping).

To make drill-only admission real, the v1.5 deck extension adds `dakuten` and `yoon` kinds (and mirrors them for katakana) to `DrillSearch` and the deck builders, plus word-level sokuon items. Until that ships, the honest statement is: **drill shortens the checkpoint; it does not replace it.** Do not paper over this with a lower bar, and do not claim blended readiness.

---

## 7. Stores

Two stores, deliberately separate (the `lib/kanji-progress.ts` precedent: one localStorage key, a JSON blob, corrupt reads degrade to empty):

- `manobu.kanaMastery` — per-cell practice state: `{ cell: "きゃ", kind, row, outcomes: [{ correct, mode, at }], state }`. Read by the checkpoint's adaptive sampler, by the deferred romaji fade in `worksheet.tsx` (`doc-12` §2.4), and by the kana queue. **Never** consulted for admission directly; only through the §6.1 state machine.
- `manobu.kanaCheckpoint` — admission: `{ script: "hiragana" | "katakana", source, passedAt, attempts: [{ at, score, groupsFailed, itemIds }] }`.

Why two: mastery is a moving measurement that any drill session rewrites; admission is an auditable record of a specific gate event. Mixing them is how a gate becomes unexplainable.

---

## 8. Result view and the kana queue

A checkpoint result is not a mock result. Checkpoint items carry no `grammarId`, so `computeMockResult` → `deriveWeakPatterns` (`apps/desktop/src/lib/mock.ts:145`) has nothing to resolve and `Plan` (`apps/desktop/src/features/mock/jlpt-mock.tsx:461`) would scaffold a seven-day *grammar* plan for a kana failure.

Shows: per-script pass/fail, the blocked `(kind, row)` groups with the exact cells missed, and a **kana queue** action. Does not show: CEFR, sectional bands, overall pass mark, or a grammar plan.

**The result is also a review pass, not just a verdict** (`doc-17` §7.1 owns the paper's version of this, and the
checkpoint uses the same one): a row per answered cell showing the cell, the pick, the correct reading, and the
`(kind, row)` group it belongs to, with the same two actions (replay this cell as a drill item, send the blocked group
to the queue). It renders only after submit, and it is the one place in this surface where the answer key may appear.

### 8.1 Copy keys

| Key | String |
| --- | --- |
| `kana.gate.offer` | "N5 papers are written in kana. About five minutes to check yours first." |
| `kana.gate.skip` | "I can read kana: skip this" |
| `kana.gate.source` | "Reading shown from: {source}" |
| `kana.checkpoint.pass` | "{script}: passed" |
| `kana.checkpoint.fail` | "{script}: not yet" |
| `kana.checkpoint.group` | "Missed the {group} group" |
| `kana.checkpoint.cooldown` | "Next attempt available {date}." |
| `kana.checkpoint.queue` | "Drill these cells" |
| `kana.result.review.title` | "Your answers" |
| `kana.settings.reset` | "Reset kana admission" |

Ten keys in the deck (`packages/ui/src/lib/copy.ts:95`) and covered by
`apps/desktop/test/walkthrough-copies.test.ts` where that gate applies. No em dash (R-02).

---

## 9. Verification

- Coverage: every `(kind, row)` group in both scripts appears in a generated paper; `n-alone` appears once.
- Grouping: a paper cannot mask a failed `gojuon` `k` group behind `dakuten` `k` answers (the pooled-row regression).
- Sampling: two consecutive attempts share no item ids; the same seed reproduces the same paper exactly.
- Sizing: per-script counts match §3 (22/8/14/2) within the `n-alone` allowance.
- Pass rule: 4 scattered wrong passes; 0/2 in one group plus 2 elsewhere fails; 5 wrong fails; an unanswered item blocks submit.
- Per-script independence: a perfect hiragana section does not admit katakana.
- Cooldown: attempts 1 and 2 are immediately available; the third within 24h is refused with a date; the cooldown is per script; it never blocks `/drill` or N4..N1.
- Admission: `skip` never writes `passedAt`; `drill-coverage` is refused while §6.2 is unshipped; the UI names the source.
- Mastery state machine: 3 correct in one session stays `shaky`; 3 correct over 2 sessions becomes `solid`; a later wrong drops it to `shaky`.
- Word items: sokuon and chōonpu items exist in every paper, anchored to real `n5.json` vocab.
- Degradation: corrupt or absent stores yield "no attempt yet", never a fake pass (the `parseSettings`
  precedent). Every row of `doc-12` §9 that names the checkpoint is covered here.
- Review: the post-submit review renders one row per answered cell with the correct reading and the group; it does
  not render before submit; the replay action resolves through the item store rather than regenerating the item.
- Copy: the ten keys in §8.1 exist, are non-empty, and contain no em dash, enforced by `packages/ui/test/copy-snapshot.test.ts`.

Commands: `bun run check-types`, `bun run check`, `bun run test` in `apps/desktop`.

---

## 10. Open items

| Item | Why it is open | Recommendation |
| --- | --- | --- |
| Deck extension to six kinds (v1.5) | `drill-coverage` admission is unreachable until it ships (§6.2) | **D12**: ship the decks in v1.5, right after the checkpoint, and flip `drill-coverage` in the same release; the decks also feed the romaji fade |
| Word-item pool size | 2 items per script is thin coverage for sokuon/chōonpu | grow from `n5.json` minimal pairs once the assembler can validate them (`doc-14` §5) |
| Offer copy timing | the string says a duration the sizing must match | "about five minutes" for ~46 items per script |
| Where the 24h clock reads from | server vs client time | client, matching the existing localStorage stores; revisit when `user.db` owns progress. A backwards clock must not clear a cooldown (`doc-12` §9) |

---

## 11. References

Verified this session (file:line):

- `packages/japanese/data/kana.json` — 208 cells, six kinds, group sizes as tabulated in §2; `row` on every cell; `katakana` field on 5 gojuon entries only; no `っ`, no `ー`
- `apps/desktop/src/routes/drill.tsx:23` `DrillSearch` (`chart`, `kind: gojuon | katakana | kanji`); deck builders filter to `gojuon` / `katakana`
- `apps/desktop/src/features/drill/kana-chart.tsx` (`LookAlike` pairs)
- `apps/desktop/src/lib/kanji-progress.ts:31` `cellState`, `:154` `markSeen`, `:159` `markLearned` (store precedent)
- `apps/desktop/src/lib/mock.ts:145` `deriveWeakPatterns`
- `apps/desktop/src/features/mock/jlpt-mock.tsx:461` `Plan`, `:148` `mock-skip-placement`
- `apps/desktop/AGENTS.md` SCR-08 row (drill mastery is in-session only today; the romaji fade waits on it)

Backlog docs: `doc-12` (parent: §2.4, §3.4, §5, §6, §7), `doc-5` (absolute-beginner kana scope), `doc-4` (§1.3 N5 item types), `TASK-113` (result-layer honesty).
