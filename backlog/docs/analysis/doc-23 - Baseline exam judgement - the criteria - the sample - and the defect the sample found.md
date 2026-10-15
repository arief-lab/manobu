---
id: doc-23
title: >-
  Baseline exam judgement: the criteria, the sample, and the defect the sample found
type: specification
created_date: '2026-09-26 06:00'
---

# Purpose

The second bar in doc-21 §9.3: the validator can reject a bad item (met - `stem-leak` caught the kana-surface entries, and the filter it prompted was rejecting 388 to exclude 91), but nothing can yet say whether authoring an item with a model made the exam better or worse. This is the reference point that makes that question askable, and it is the parent of TASK-145.

# 1. The criteria, written before the judging

Five questions about one item. Each is answerable differently, and the difference matters for who is allowed to answer it.

| # | Criterion | Answerable by | How |
| --- | --- | --- | --- |
| C1 | Is the answer UNIQUE - is exactly one option correct? | mechanical, then a reader | the validator's `answer-provenance` and `satisfies` checks prove one option is marked; whether the other three are actually WRONG is a reading of Japanese |
| C2 | Is the answer DERIVABLE from what the learner is shown? | mechanical | the `items.mask` record: `verified: true` means the target literal was re-tokenized and found gone |
| C3 | Is the item LEVEL-APPROPRIATE? | mechanical, then a teacher | the anchor's corpus level equals the item's; whether an N5 learner is ready for it is a pedagogy call |
| C4 | Are the DISTRACTORS plausible? | a reader | can they be worked out from the item's own surface, and do they look like the same family |
| C5 | Is the PROMPT unambiguous? | mechanical, then a reader | the prompt must name a cue (a word, a reading, a sentence); "unambiguous" also covers wording |

**Who judged this, precisely.** C2 is fully mechanical. C1, C3, C4 and C5 were judged by an agent reasoning over the corpus data and the Japanese - which is enough to FLAG a problem with evidence, and not enough to certify a gloss. Every judgement below is therefore marked either `pass`, `FAIL`, or `flagged` (suspicious, needs a native speaker or a teacher to confirm). Nothing here is presented as a human verdict, because the task said "hand-judge" and the honest position is that part of it was not hand-judged by a person.

# 2. The sample

Deterministic and reproducible: level N5, mode `shortened`, seed `baseline-n5-v1`, sections vocabulary + grammar-reading + listening, budget 4/4/2. Ten items, `ready: true`, `shortfall: 0`. The exam row is the stored reference; TASK-140 persists the request, so this exact paper is rebuilt from the same seed and the same level.

# 3. The judgement, per item class

## word-in-context - FAIL (C1), the finding of this exercise

| item | prompt | options | answer |
| --- | --- | --- | --- |
| `vocab:N5:一日:ついたち` | Choose the meaning of 一日. | from morning till night / the whole day / all day (long) / one day | one day |
| `vocab:N5:一人:ひとり` | Choose the meaning of 一人. | being by oneself / being alone / being single / one person | one person |
| `vocab:N5:暇:ひま` | Choose the meaning of 暇. | time (it takes to do something) / spare time / leisure / free time | spare time |

All three have **more than one correct option**. 一日 is "one day" AND "all day"; 一人 is "one person" AND "being single"; 暇 is "spare time", "leisure" and "free time" interchangeably. A learner who picks "leisure" for 暇 is RIGHT and is marked wrong.

The cause is the distractor family this project chose. doc-21 §7 approach 4 recommends the entry's own other senses as distractors, on the reasoning that they are "the most plausible wrong answer available" and cannot be wrong about part of speech. That reasoning is half right and half wrong: they cannot be wrong about part of speech, but they are not wrong at all. **They are other correct senses of the same word.** So for every multi-sense entry - 86-90% of the corpus - the family produces an ambiguous item rather than a hard one.

That is a direct contradiction inside the design, found by the baseline rather than by a test, and it corrects §7 approach 4. The fix is not to drop the family - it is the cheapest plausible pool there is - but to use it only where the other senses are *wrong in context*, which a sentence can supply and a bare gloss cannot. So the family belongs to the CONTEXTED item types, and a bare "choose the meaning of X" needs its distractors drawn from other WORDS instead, with the same-POS filter doing the work. That is a change to TASK-138, not to this task, and it is the most valuable thing this baseline produced.

**Caveat on my own judgement:** whether "leisure" is acceptable for 暇 is a call for someone who teaches Japanese. I can show the corpus lists all four glosses on one entry; I cannot certify which the app should accept.

## grammar-form, particle, reading-info - pass, with one variety defect

| anchor | prompt | answer | mask |
| --- | --- | --- | --- |
| `grammar:particle-o-object` | Choose the pattern that completes: 本＿＿読みます。 | X + を | trailing-literal, verified |
| `grammar:masu-polite-verb` (particle) | Choose the pattern that completes: 毎朝、コーヒーを飲み＿＿。 | Verb stem + ます | trailing-literal, verified |
| `grammar:masu-polite-verb` (reading-info) | Choose the pattern that completes: 毎朝、コーヒーを飲み＿＿。 | Verb stem + ます | trailing-literal, verified |

C2 passes: the literal is masked and the record says `verified`. C5 passes: the prompt names the sentence. C4 passes and is the surprise worth recording: the four options for the ます item are ません / ませんでした / ました / ます, which are **inflections of the same verb** - exactly distractor family 3, the family doc-21 §9.1 says no tag filter can produce. They appeared because the N5 grammar list happens to contain those four points, not because anything selected for it. So family 3 is already half-present by accident, and selecting for it deliberately is a real improvement rather than new work.

**Variety defect (FAIL, recorded):** the `particle` and `reading-info` items share the same anchor, the same sentence and the same answer. The paper asks essentially one question twice. AC#4 of TASK-138 spends a vocabulary word once per paper, but nothing stops two ITEM TYPES from spending the same grammar point. A grammar anchor needs the same once-per-paper discipline the word-spend has.

## kanji-reading - pass

「Choose the correct reading of 塩.」 with わたし / ひがし / わたくし / しお. C2 passes (the prompt names the word, the options are readings, nothing is derivable without knowing 塩). C4 flagged, not failed: わたし and わたくし are both readings of 私, so two options are the same word twice. Plausible, not wrong, but a weak pair.

## conjugation - pass

「Choose the word written as くる.」 → 来る, with 暇 / 弾く / 止まる. C2 passes. C4 flagged: the distractors are same-tag verbs, so 弾く is plausibly harder than an N5 learner wants, and none of them is an inflection of くる - the recognition shape is honest, but the distractor family is not family 3.

## listening-detail - pass, with a wording defect

Two items, scripts 「これは本だ。」 and 「先生は元気でした。」, options being example sentences from other grammar points, `speech` carrying the spoken string. C2 passes and correctly so: the script never crosses to the client, so nothing is readable off the page. C4 passes - the sentences are plainly different from each other.

**Wording defect (FAIL, minor):** the prompt says "Choose the phrase heard in the recording" and the options are whole SENTENCES, not phrases. Small, but it is exactly the kind of thing a learner notices.

# 4. The tally

| class | items | C1 | C2 | C3 | C4 | C5 |
| --- | --- | --- | --- | --- | --- | --- |
| word-in-context | 3 | **FAIL** | pass | pass | **FAIL** | pass |
| grammar-form / particle / reading-info | 3 | pass | pass | pass | pass | pass |
| kanji-reading | 1 | pass | pass | pass | flagged | pass |
| conjugation | 1 | pass | pass | flagged | flagged | pass |
| listening-detail | 2 | pass | pass | pass | pass | flagged (wording) |

Three defect classes recorded, which is the point: a baseline with no failures cannot distinguish an improvement.

1. **Every bare `word-in-context` item is ambiguous**, because the chosen distractor family supplies other correct senses. Affects ~86-90% of the corpus. The most valuable finding here, and it corrects doc-21 §7 approach 4.
2. **Two item types can spend the same grammar anchor**, so a paper can ask the same question twice.
3. **"phrase" vs sentence** in the listening prompt.

# 5. The comparison method, for TASK-145

Not a summary verdict. Per class, on the SAME paper, the same five criteria, both sets judged by the same person on the same day:

- **Report the disagreement rate per criterion**, not a score. `word-in-context`: 3/3 items judged FAIL on C1, so an authored set that also fails 3/3 has demonstrated nothing; a set that fails 1/3 has improved that class and must say so.
- **A criterion that is mechanical stays mechanical.** C2 is answered by the mask record, so an authored item cannot be given credit for passing it - it cannot fail it either, unless the mask claim is unverified, which the store refuses to store.
- **Judged criteria stay judged.** C1 and C4 must be re-judged by the same reader; do not let an authored set be credited on the strength of the deterministic set having been measured.
- **State the N.** Ten items is a sample, not a distribution. Any claim from this baseline is "in these ten items", and TASK-145 inherits that limit unless it widens the sample.
- **Report what got worse.** An authored set that fixes C1 and breaks C4 is a regression overall, and the disagreement table has to be able to say so.

# 6. Related

- doc-21 §9.3 for the two bars, §7 for the distractor family this baseline corrects, §9.1 for the derivability gap.
- TASK-138, which owns the vocabulary distractor change this finding implies.
- TASK-145, blocked on this task.
- TASK-137, whose review surface is where an authored-vs-deterministic difference would be visible to a learner.
