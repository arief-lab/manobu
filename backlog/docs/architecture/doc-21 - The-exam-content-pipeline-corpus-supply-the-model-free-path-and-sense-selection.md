---
id: doc-21
title: >-
  The exam content pipeline: corpus supply, the model-free path, and sense
  selection
type: specification
created_date: '2026-09-26 06:53'
updated_date: '2026-09-28 16:41'
tags:
  - exam
  - items
  - architecture
  - corpus
  - content
---
# Purpose

Records what the exam content pipeline actually does, what it has to work with, and the decisions still open about it. The companion documents describe intent: doc-12 (chat-generated exams, the kana readiness gate), doc-14 (request, assembler, validator, storage), doc-16 (the shared item engine, grading and storage), doc-19 (the rendered UI audit). This one describes the supply side and the constraints that decide what is buildable. It is the parent of TASK-138 and TASK-139.

# 1. The product direction

Two halves of one app. An AI teacher that helps a learner study Japanese, and an exam engine that can produce an unbounded number of JLPT-shaped practice questions from the local corpus and the jlpt-mcp tools. The exam is where correctness is provable, because every item is anchored to a catalog entry and assembled by code. The teacher is built on top of that, because a teacher grounded in a broken exam will confidently teach the wrong thing, and that is the failure mode that actually costs a learner progress. The order is therefore exam content first, teacher second. It is a hazard argument, not a design preference.

# 2. What the exam does today

`apps/server/src/services/exam-service.ts:144` defines `LOCAL_CATALOG` as sixteen literal entries: 学校 先生 電車 本 友達 家族 水 朝 夜 駅 店 家 時間 日本語 音楽 天気, each with three hand-picked distractors (`interface LocalCatalogEntry`, :138). `catalogOffsetFor` (:424) hashes `examId:seed:section:itemType` into a starting offset, and `appendItemTypeCandidates` (:440) walks `LOCAL_CATALOG[(offset + index) % 16]` to fill each item type's allocation.

Three consequences follow, and they are the whole finding:

1. Every paper is a rotation of sixteen nouns, at every level. Seeded N1, N2 and N3 papers all surfaced the same handful of words, so a learner taking two papers sees the same words twice.
2. The item type does not affect content. A conjugation item and a particle item are both built from 学校/先生/電車, because both draw the same rotation. `itemType` drives allocation and validation and nothing else.
3. The anchors are digests of synthetic ids (`vocab:N5:<digest>`), so the anti-hallucination guarantee is being checked against a sixteen-word list. `doc-16` §2 states that `anchors` is non-empty by construction and resolves through a corpus view; a digest does not resolve in a corpus view, so that check is currently vacuous.

This shipped inside TASK-126 with all eleven acceptance criteria met. Its criteria specified what the assembler, validator and state machine would do, never where the candidate list came from, so nothing tested for it.

**A recurring defect shape.** Four findings in this pipeline share one structure: an interface was specified without checking that something on the far side of it exists, or without checking that anything enforces it. The assembler was built with no content source (this section), the contract declared `focus` with no consumer (TASK-139), the blueprint allocates listening with no delivery path (§6), and the validators in doc-14 are declared as guarantees without an enforcement point (§9). Four instances is a habit, not luck, and it is cheaper to guard than to keep finding. The guard: for every field a contract declares and every section a blueprint allocates, add an acceptance criterion that something downstream consumes it, and a test that fails when nothing does.

# 3. What is available and unused

Measured 2026-09-26 from `packages/japanese/data`. These are the planning numbers; do not re-derive them.

| Source | N5 | N4 | N3 | N2 | N1 | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Vocabulary entries | 700 | 649 | 1,835 | 1,846 | 3,475 | 8,505 |
| Grammar points | 77 | 89 | 130 | 149 | 150 | 595 |
| Kanji (JLPT-classified) | 79 | 166 | 367 | 367 | 1,232 | 2,211 |
| Anchors available | 856 | 904 | 2,332 | 2,362 | 4,857 | 11,311 |

Three facts about that table that are not obvious from it:

- `kanji.json` holds 13,108 rows but only 2,211 carry `jlpt_waller`. The remaining 10,897 cannot be level-assigned at all, so any code assuming a kanji is JLPT-tagged will silently produce unlevelable items.
- Vocabulary entries carry `partOfSpeech`, which is what makes same-POS distractors possible per doc-14 §4. The tags are inconsistent in granularity (`noun, pref`, `intransitive verb`, `transitive verb` in one list), so for a model-free path they are the practical part-of-speech source and a starting point rather than a classification to trust for a form-class check. See §8 for why the better classifier is out of reach.
- A 30-item paper with no repeated anchor is covered at every level, with room for two or three passes over the same anchors.

Alongside the anchors sits stimulus material, which is not anchors and is deliberately not counted in the table: **1,787 example sentences** attached to grammar points (N5 233, N4 267, N3 390, N2 447, N1 450). Every one is `source: "original"`, meaning hand-written rather than harvested, and each carries `{japanese, english, source}`. That provenance matters twice: it removes the citation requirement Sensei works under, and it removes the corpus dependency that §4 says sentences would otherwise impose. §6 is where this becomes load-bearing, and §7 approach 2 is what it unblocks.

The Tatoeba/Tanaka sentence corpus (`sentences/sentences.jsonl`, ~42 MB raw) is also absent from these numbers, for the reason in §4.

# 4. Reachability: what a model-free path can and cannot reach

The exam path is model-free by design. That is a real property, not an accident: it is reproducible, needs no AI, and has no per-item latency or cost. The distinction that decides everything below is between the Rust MCP *server* and Vaporetto *itself*, because they are reachable by different routes.

**The jlpt-mcp MCP server is agent-only.** There is no MCP client anywhere in the TypeScript tree: no `@modelcontextprotocol/sdk`, no `StdioClientTransport`, no `Client(` construction in `apps/server/src` or `packages/*/src`. The comment at `packages/agent/src/subagents/index.ts:17` states it outright, that the heavy lifting is in the Rust server and "we don't talk to it from these stubs". What the sidecar holds is `parseMcpServers`, which reads `ACP_MCP_SERVERS` to hand the *spec* to the agent (TASK-96, and its only production caller); the agent CLI spawns `jlpt-mcp` as its own child. The drill path therefore reaches the rich corpus indirectly, because the agent fetches candidates on its behalf through the `next_drill_item` host tool. The exam cannot take that route without giving up the property it is protecting, which is why it holds sixteen words.

**Vaporetto is reachable from TypeScript, and not through MCP.** It is registered as a SQLite extension inside the database the sidecar already holds: `packages/db/src/migrate.ts:281` runs `db.exec("SELECT vaporetto_split(' ', ' ');")` and `packages/db/test/fts5-perf.test.ts:251` calls it directly. The registered functions are `vaporetto_split`, `vaporetto_init`, `vaporetto_warmup`, `vaporetto_active`, plus the FTS5 helpers `vaporetto_and_query` and `vaporetto_or_query`. The cache is generated by `packages/db/scripts/fetch-vaporetto.ts`, which runs `vaporetto --example gen-cache` inside `crates/jlpt-mcp`. So segmentation is available to a model-free path today, with no new process and no IPC. This is also why TASK-93's title names `vaporetto_split`: it is the SQL function name, not a tool name.

**Speech is reachable from the desktop app.** Text-to-speech and speech-to-text already ship: sherpa-onnx in the Tauri shell (`apps/desktop/src-tauri/src/speech/tts.rs`, `stt.rs`, `vad.rs`, `models.rs`) with a TypeScript client in `packages/speech/src/`. It is in use, not aspirational, by `features/roleplay/roleplay.tsx`, `features/listen-type/listen-type.tsx`, `features/kanji-detail/kanji-detail.tsx` and `shared/token-text.tsx`, which speaks a word on tap, along with a model-settings screen. The exam does not use it, which is §6.

**Sentences remain out of reach.** The desktop bundle ships `n1..n5.json`, `grammar/`, `kanji.json` and `kanjivg/`, and explicitly not the Tatoeba sentence corpus, per the TASK-43 packaging contract. A model-free path reading the bundle gets vocabulary, grammar, kanji and the 1,787 hand-written grammar examples, and no harvested sentence context.

# 5. Decision taken: a model-free path reads the shipped JSON

A model-free path reads `packages/japanese/data` directly from TypeScript. The bundle already carries the corpus and the server already reads it for `/api/vocab` and `/api/nextCards`, and the candidate layer is small: list by level, mint an anchor, `stable_hash(seed + anchor)`, deduplicate, sort, truncate. The only genuine alternative considered was making the sidecar an MCP client to `jlpt-mcp`, so the two surfaces would share one implementation and the Tatoeba corpus would come along. **That option is retired.** Its only real argument was reaching the tokenizer, and §4 shows the tokenizer is already in the database, so the cost (a persistent child process to supervise, ship, health-check and pin a working directory for, which is the packaging fragility TASK-38 and TASK-43 already document) buys nothing that is still missing. What remains of the sentence corpus is a packaging decision about install size, not an architecture decision, and it is open as §11.2.

The drift risk of two implementations is answered by AC#7 of TASK-138: one anchor format shared through `@manobu/api-contract`, with a test that resolves an anchor by string rather than by array position.

`crates/jlpt-mcp/src/main.rs:272` already exposes `drill_candidates(level, source, seed, limit)`, and its own tool contract is the division of labour the exam wants: deterministic corpus-backed candidates, canonical anchors and raw source entries, never prompts, options or answer keys. All four `DrillCandidateSource` variants are implemented (`engine.rs:423-460`, and Sentence at :462-470). It is seeded, deduplicated and capped at 50, and it already filters candidates by required part of speech through `pos.contains(candidate.required_pos)` (`engine.rs:67`, `:216`, `:734`). It is therefore the right thing to port, and its judgement calls are few enough to port with it. What it deliberately does not do is decide anything about an item: it returns the raw entry with every sense still attached.

# 6. Listening has no delivery path, and text-to-speech makes it cheap

`packages/api-contract/src/exam.ts` contains no audio, speech, tts or voice field at all. Not thin, absent. Yet the blueprints allocate listening sections and the scoring weights them heavily: N1 is 60 of 180 points and N2 is 50 of 105. The item types `listening`, `listening-detail` and `integrated-listening` exist, and there is no way to carry a sound to the client. **Every listening section in every generated paper is unrenderable.** This is an instance of the defect shape in §2 and it is the largest of them, because it silently removes most of a paper while every test still passes.

The delivery side already ships (§4), so the missing piece is a field and not a dependency. An exam listening item can be synthesized with the same voice picker that already speaks a word on tap in `token-text.tsx`.

The script side ships too, which is the useful part. The 1,787 hand-written grammar examples from §3 are level-tagged, short, and already in the bundle, so a listening item is: take a grammar point at the level, take one of its examples as the script, synthesize it. No new packaging, no new process, and no citation obligation because nothing was harvested.

**What that does and does not save.** The *script* selection is deterministic and free. The *question* is not: per §9 the agent authors it, so a listening item does cost a model call, with the latency, cost and model-quality variance that implies. An earlier draft of this section called the listening item free and model-free, and that was wrong; only the script is. The honest version is that the anchor and the audio are cheap and the prose is not, which is a normal exam cost rather than an unusual one.

**The division of labour for a listening item**, since the three parts have different owners: code chooses the grammar point and the example (deterministic, grounded, level-correct), the agent writes the question about them (§9), sherpa-onnx speaks the example (§4), and the assembler validates. Note that a grammar-anchored listening item never touches `LOCAL_CATALOG`, so this section does not wait on TASK-138.

It also gives §7 approach 2 a cheaper form. Sense disambiguation by context does not require the Tatoeba corpus. It requires a sentence, and 1,787 hand-written level-tagged sentences are already present, so the packaging decision in §11.2 is no longer on the critical path for the first pass of item quality.

**Where the audio lives, decided: nowhere.** There is no audio file. The TTS is sherpa-onnx inside the Tauri shell, the models are downloaded to app_data_dir and never bundled, and the sidecar has no TTS - so there is nothing for it to produce and nothing to cache. The item carries the SCRIPT and the client synthesizes on demand.

This reverses the recommendation this section first made (cache per item, store the path). The reasoning dissolves once synthesis is client-side: the script is persisted on the item, so a resumed exam re-synthesizes from the same stored string. Replay is exact and no file can go stale. The residual cost is a cold TTS init on first play, from a model the learner already opted into in Settings. AC#1's original framing - "the contract carries an audio reference" - was wrong in kind for the same reason: there is no reference to carry.

**A documented exception to TASK-132.** The script does cross to the client, for listening items only, as the `speech` field. TASK-132's rule ("a listening script must never be projected") held while the audio was assumed to come from elsewhere. The exception is narrow: listening items only, so no reading item's passage can be spoken by a client that was never asked to hear it; the synthesis input rather than a reading aid; and `stimuli` still projects passages only, with an integrated-listening item's accompanying passage still travelling as `passage`.

Speech-to-text is the larger prize and the larger hazard. The app has no speaking section, and the real exam pairs listening with speaking, so STT could enable a section that does not exist today. But a beginner's Japanese transcribes badly, and a bad transcript turned into authoritative feedback is worse than no feedback: it is the same failure as doc-22 §3, where an ungrounded answer is read as a personality rather than as a wrong fact. The discipline that makes it safe is detection rather than evaluation. Use the transcript to check whether the learner produced a specific target form, a yes/no against something whose answer is already known. Do not score pronunciation or judge fluency with it, and do not let it produce a correction the corpus cannot source.

# 7. Polysemy is the crux

Measured: `meaning` is a single semicolon-separated string, and the semicolon parts are the senses. They are capped at 9 per entry at every level, the median entry carries 4-6, and 86-90% of entries are multi-sense (N5 601/700, N1 3,130/3,475). Avoiding polysemous entries is therefore not a strategy, because it would exclude most of the corpus - but the ceiling is 9, not the hundreds an earlier draft of this section claimed. Polysemy is near-universal and BOUNDED, which makes sense selection a small choice with a real default rather than an open-ended judgement call.

**Correction worth keeping.** The first version of this section reported "99-100% of entries are multi-sense, maximum 236 rising to 364". That was a measurement error: the count was taken with `len()` on what is a string, so it measured characters. The `meaning` field has no per-sense structure beyond the semicolons. Any number here that came from `len(meaning)` is wrong; the ones above are counted from the semicolon parts.

**The strategy, chosen from the data:** sense[0] is the primary sense. The upstream glosses are ordered by priority, and for a learner the first one is the teachable one. The other senses of the same entry then form a free plausible distractor set (approach 4 below), which needs no part-of-speech matching at all.

A sense must be chosen for each item, and three approaches are available:

1. **Restrict by item type.** Several item types never need a sense at all. A kanji-reading item needs only a reading, and a vocabulary-recognition item can be built from a surface form plus one gloss. This dodges polysemy outright for a large share of items, costs nothing, and is the recommended first move.
2. **Use a sentence as context.** A real sentence reveals which sense is live. The 1,787 hand-written grammar examples supply this today at every level, which is what makes the approach available without the packaging decision in §11.2. The crate's own richer version, via `linkedWords` on every example hit, remains out of reach for a model-free path.
3. **Curate a single exam-facing sense per entry.** Best item quality, most curation, and a corpus schema change. Largely superseded: the cap of 9 and the sense[0] default make the common case cheap, so curation is only worth it for the entries whose first gloss is a poor learner-facing gloss.
4. **Distractors from the same entry's other senses.** A word that also means something else is the most plausible wrong answer available, it is free, and it cannot be wrong about part of speech because it IS the same word. This is the cheapest high-quality distractor set in the corpus and it only exists because polysemy is pervasive.

TASK-138 AC#7 requires a strategy written down and holding across a level, not on one hand-picked item: sense[0] as the primary, same-entry senses as distractors, approach 1 for the item types that need no sense at all.

# 8. Where Vaporetto belongs

Segmentation is available to every surface, model-free or not, through the SQLite function described in §4. Its concrete jobs, none of which is "finding meaning", which it cannot do:

- **Locating the token a cloze blank replaces.** Japanese has no spaces, and an LLM writing Japanese guesses compound boundaries, so a blank built on a mis-segmented compound is a broken item. `vaporetto_split` answers this from inside the database, so the exam can do it today.
- **Verb versus noun**, needed before any conjugation item can be built, which is also a segmentation-adjacent check on the surface form.
- **Conjugation verification**, where a full table is available from the crate.

**The part-of-speech tag is the asymmetry.** The Rust crate tokenizes with tags (`crates/jlpt-mcp/src/tokenize.rs:155`, `pub pos: Option<String>`, populated at :196, with tests asserting 動詞-一般 and 助動詞), and `drill_candidates` filters on it. The SQL surface exposes none of that: the registered functions split, initialise, warm up and serve FTS5 queries, and none returns tags. So a model-free path can segment but not tag, and its part-of-speech source is the corpus `partOfSpeech` field described in §3. Consequence for TASK-138 AC#3: same-POS distractor matching rests on the corpus field, so the granularity inconsistency in §3 is a quality risk in its own right, and the criteria should be written knowing that rather than assuming a clean classifier.

One prohibition, which §9 qualifies rather than overturns: **the agent does not invent a sense.** It may propose one from the entry's actual list. See §9 for the reconciliation.

# 9. Who authors what: the code and agent boundary

Combining code and an agent is right, and the shape of the combination is the whole decision. It is not a blend and it is not a handoff. It is a boundary, and the catalog is the interface across it.

- **The model proposes.** Which anchor, whether two grammar points belong in a single question, which example sentence makes the cleanest prompt, and the prose itself.
- **Code refuses.** Anything not in the catalog is rejected, the single-correct-answer property is checked, and the chosen anchor is recorded on the item.
- **Neither overrides the other on its own ground.** The model cannot make something into a real grammar point. Code cannot write a question a human would call clear.

Code also keeps what it must keep regardless of authorship, because these are the blueprint and they are already implemented: how many items of each type per section, which level, the minutes, the floors, the scoring split. The model chooses content inside a shape it did not draw.

**Reproducibility does not depend on the deterministic anchor.** This is worth stating because it is easy to over-argue. Items are persisted, so once a paper exists the anchor is a stored column and replay reads the row. What determinism at selection time actually buys is the two things that survive the model being in the loop: the anchor cannot be hallucinated, and a reader can see what any item is about. It does not buy replay stability, which storage buys, and it does not buy personalisation, which targeting buys.

**A guard that is not enforced is decorative.** If the model may re-propose after a rejection, it will, and a validator with no attempt budget eventually admits something. Validation therefore needs a bounded retry count and a failure path that reports the item unavailable rather than forcing it through. Without that the validator is a suggestion, which is the §2 defect shape one level up: a guarantee declared with no enforcement point.

**The sequence, each step earning the next.**

1. **Code picks the anchor.** Zero model-quality variance while the validator is proven. You are still building a pipeline, and debugging a validator and a prose generator at the same time is how both end up wrong. Because items are persisted, the anchor is a stored column from this point on, so step 3 changes nothing about replay.
2. **Land targeting, which is TASK-139.** A code-picked anchor is blind to the learner: it selects by level, seed and catalog offset, so it produces correct-but-arbitrary rather than correct-and-targeted. `focus` is what closes that gap. This is why TASK-139 is a personalisation layer and not a contract-hygiene fix, and why §2 counts the dropped field as one of the real defects.
3. **Let the model propose inside the validated catalog,** once the validator has caught a genuine bad item. Then the model is a bonus rather than a risk, and it gains the one thing code structurally cannot do: noticing that two grammar points belong in the same question. What that is FOR, and how the sidecar would reach the model to do it, are §9.1 and §9.2.

**Reconciling step 3 with §8.** §8 holds that the agent does not choose a sense, and step 3 looks like it contradicts that. It does not, and the line is vocabulary versus everything else. A grammar point has no polysemy problem, so free proposal is safe there. A vocabulary entry carries up to 9 senses, so if the model may propose a vocabulary anchor it must also propose a sense, the validator requires that sense to be one the entry actually carries, and the item records which one was used. The model picks from a set and never invents one, which is precisely what §8 was asking for. It is also why "validated catalog" has to mean the entry's full sense list rather than the word, and why TASK-138 AC#7's sense strategy is a prerequisite for vocabulary proposal rather than an alternative to it.

## 9.1 What step 3 is actually for

Step 3 above says when the model may start authoring. It does not say what the model is for, and answering that is what makes the step bounded rather than "write a better question" - which is unauditable, because nothing can check it.

**The gap the validator cannot see.** `hasStemLeak` compares the answer STRING against the prompt and passage. It passes an item whose answer is nonetheless visible. Assembled corpus items, verbatim:

    Choose the pattern that completes: 朝ごはんを食べました。
      options: Verb stem + ました (answer) / ません / ませんでした / ませんが

The answer string "Verb stem + ました" is not a substring of the evidence, so `stem-leak` passes. But ました is right there inside 食べました, and a learner can string-match it to the option without reading any Japanese. The same holds for `X + を` over 「本を読みます。」, where を is visible in 読みます. These are passable items that teach nothing, and no amount of validator work finds them: single-correct-answer is not answerability, and non-derivability is a different property from non-appearance.

So the model's first job is narrow and checkable: **mask the target realization in the stimulus**, so the answer stops being readable off the sentence. Code cannot do this without a Japanese-aware masker, and the sentence has to survive with the blank in the right place.

**Three distractor families. The third is the one a tag filter cannot produce - and, as TASK-145 found, the one this repo already computes deterministically.**

1. *Same entry, other sense* - §7 approach 4, **and corrected by the TASK-144 baseline: this family produces other CORRECT answers, not wrong ones.** See below.
2. *Same part of speech* - AC#3. A tag filter over the level pool, and the tag granularity in §3 caps how good it can get.
3. *Same rule, wrong application* - for 「Verb stem + ました」 the wrong options should be ません / ませんでした / ましょう: inflections of the SAME verb, which is what a real JLPT grammar item does. Family 2 approximates this when the level's grammar points happen to be the same verb's inflections, and misses when they are not. It cannot be produced by a POS or tag filter at all, because the members of this family share a lemma and differ only in application.

**TASK-145 CORRECTED THE HEADLINE OF THIS SECTION.** The claim was that family 3 is "the one code cannot produce", and the claim about the tag filter was right while the claim about code was wrong. The repo has computed family 3 exactly since the Conjugate Lab landed: `choiceOptions` in the conjugation table builds "the correct form, then the wrong-rule variant, then other forms of the SAME verb", and `wrongRuleVariant` produces 飲ません for a godan, 食べって and 食べれる for an ichidan, はいて for はいって. It was simply unreachable from the exam path, because the table lived in `apps/desktop` and a sidecar cannot import from another app - so the fix was to move the table to `@manobu/japanese/conjugation`, not to build a model path. `services/exam-distractors.ts` now assembles the family from it.

**So the model's job in step 3 is smaller than this section implied.** The irreducible part is the SENTENCE a verb is dropped into, plus prose. The inflections, the wrong-rule variants and the masking are all table work, and asking a model for them would buy latency and variance in exchange for a worse answer. That is §9's boundary drawn in the right place, not a retreat from it: "the model proposes, code refuses" is about what may be *invented*, and an inflection the table already knows is not something to be invented.

The catch worth recording: `wrongRuleVariant` can return the CORRECT form. きます classifies as ichidan, so its ichidan wrong-rule ません form is きません, which is also the correct kuru ません form. The table's consumer drops the collision, and `exam-distractors.ts` repeats the guard because it reports the variant as data. A wrong-rule variant equal to the answer is not a distractor, it is a duplicate option, and a model asked for one would not reliably notice.

The observable difference is the one that matters: after this work every distractor in a grammar item is currently drawn from a same-tag pool, which means an item is often solvable by noticing which pattern shares a stem with the visible sentence. Families 1 and 3 are the ones that force the learner to know the rule.

## 9.2 The call direction, decided

§4 establishes that the exam path is model-free and the Rust corpus is agent-only. §5 retired the sidecar-as-MCP-client option for reading the corpus. Neither says how the sidecar would REACH the model to author, and the two directions are not a detail:

- **Sidecar calls the agent** (over ACP, the direction `ensureAcp` already uses for chat). The paper stays the sidecar's: it draws the blueprint, allocates the types, chooses the anchors, and asks for prose per item. This is what §9's "code keeps the blueprint" actually requires in practice.
- **The agent drives** (via a host tool, the direction `next_drill_item` and `ask_user` already use). The model composes and the sidecar validates. Cheaper to build, and it lets the model decide how many items a section has - which means the blueprint, the minutes and the floors stop being the code's, and §9's opening claim stops being true.

**Decided 2026-09-26: the first.** The sidecar calls the agent over ACP, the paper stays the sidecar's, and the model never decides how many items a section has. The allocation and the floors are already implemented and tested, and they are the part of this pipeline that must not become negotiable. TASK-143 carries the reasoning and the three residue decisions.

The external evidence agreed rather than decided it. AionCore runs agents the same way: `aionui-runtime` owns the spawn through a builder that separates long-running CLIs whose stdio the host owns from short-lived tools it merely parses, `aionui-process` supervises the subprocess, and `aionui-ai-agent` queues worker tasks rather than serving a request-scoped call. The host supervises, the model does bounded work, the host keeps the shape. One of its rules is worth copying outright: at the ACP translation boundary it strips inline base64 from tool results before they reach the WebSocket or SQLite, keeping the file path instead. This repo solved the same class of problem independently and differently (the `frameContent` table, TASK-81.5, and the hub ring, TASK-80.14), so that is convergent validation rather than an instruction.

**Revised 2026-09-28 (TASK-167): the invariant stands, and a learner-named total is explicitly refused.**

TASK-156's QA walk found the symptom that makes this worth reopening: asking Sensei for a 10-question N3 paper produced the 30-item level default. §9.2 was written about who allocates; the agent path asks the narrower question TASK-167 was filed for, namely may the model relay ONE bounded total that code then splits? No, for three reasons, the first two measured rather than argued:

1. **It cannot buy what it promises.** `paperScoringFloorStatus` requires `minimumItems: 10` per scoring section (`packages/item-engine/src/paper.ts:390`), and the N3/N4/N5 default budget is exactly 10/10/10, so the level default already sits on the floor. Calling the shipped function with a total split across the three sections: 10 items is `raw-only`, 20 is `raw-only`, 30 is `band`, 45 is `band`. A bounded total whose bound is the floor cannot serve "10 on N3", which is the only request that started this. "Shorter" is reachable today without a total, because a single-section paper at 10 items is `band`: narrowing scope shortens a paper, shrinking a section does not.
2. **One total is not one pure splitter.** At N1/N2 a section feeds TWO scoring columns (40 `language-knowledge-reading` items project to `language-knowledge` 23 plus `reading` 10), so an allocator must work on the scoring projection rather than the section list, or it silently ships unbandable papers. That is a new failure mode with no visible symptom, which is exactly what "must not become negotiable" was protecting.
3. **What the learner asked for already exists on another seam.** A learner who wants ten questions, now, about particles, wants the drill: per-item, count-free, real SRS intervals. A paper is a scoring instrument; asking it to be short is asking it to be something else.

**What a learner who wants a short paper is told instead** (AC#2). TASK-156 put `sizeStatement` in the tool result so the agent repeats the host's number rather than inventing one. TASK-167 fixed the sentence that had been making the opposite promise: `START_EXAM_DESCRIPTION` advertised `mode` as "shortened" for a quick paper, and `mode` never changes an item count. `paperSectionTimeLimitSeconds` (`packages/item-engine/src/paper.ts:302-326`) scales the seconds only, and `exam-conditions` additionally rejects unmet floors (`:1113`). The description now says both modes carry the same number of items and that no mode makes the paper smaller, and `apps/server/test/exam-host-tool.test.ts` pins the claim against the listing the server advertises and against the behavior: same sections and same counts in both modes, strictly more seconds in `exam-conditions`. Prose on an agent-facing surface is only a guarantee if a test reads it off the wire. Driven live on 2026-09-28 (headless Chromium against the dev server, the same ask in the same words), the reply is: "You asked for 10 questions; the paper is 30 items, not 10. The size comes from the N3 level's default budget, and I can't build a smaller paper than that", followed by the per-section breakdown and the paper card. Before the wording changed, the identical ask produced only "Your N3 paper is ready: 30 items, 3 sections.", which states a true size and leaves the mismatch to inference. The instruction now requires both numbers in the reply, which is the difference between the two runs.

The desktop composer path stays count-free (`apps/desktop/src/lib/composer-routing.ts:23`), so this changes nothing about what the learner can ask the app for directly.

## 9.3 Step 3 has two bars, not one

The sequence says to wait until the validator has caught a genuine bad item, and that condition is met - `stem-leak` rejected the kana-surface entries (91 of 400 sampled N5 entries had `word === reading`), and the kana filter it prompted turned out to be rejecting 388 to exclude 91. But that is only the first bar, and confusing the two is how a prose generator ships unvalidated:

1. **The validator can reject a bad item.** Met. Proven by the two defects above.
2. **You can tell whether authoring made the exam better.** Not met, and not automatic. A model-authored item that passes the validator is unproven, not good. Without a set of items judged by hand, and a way to compare a deterministic paper against an authored one, a change to the authoring prompt is indistinguishable from noise.

The second bar is a measurement problem, not a code problem, and it is the one that decides whether step 3 is an improvement or a regression with extra latency. **doc-23 is that baseline**: five named criteria, a deterministic ten-item sample, a per-class table, and three recorded defect classes - one of which (the same-entry-senses family producing correct answers) contradicts §7 and is a TASK-138 change. TASK-145 is blocked on it, and doc-23 §5 is the comparison method it inherits, including the limit that matters: ten items is a sample, so every claim is "in these ten items".

## 7.1 The same-entry-senses family is wrong for a bare gloss question

**Corrected by the TASK-144 baseline (doc-23), which is the first thing to read before implementing distractor family 3.**

§7 approach 4 recommends the entry's own other senses as distractors, on two grounds: they are "the most plausible wrong answer available" and they "cannot be wrong about part of speech". The second half holds. **The first half is false.** They are not wrong at all - they are other correct senses of the same word, and on a bare "choose the meaning of X" item that makes the item ambiguous rather than hard.

Judged from the baseline sample, all three `word-in-context` items fail criterion 1, the answer is unique:

    Choose the meaning of 暇.
      time (it takes to do something) / spare time / leisure / free time
      answer: spare time

A learner who answers "leisure" is RIGHT and is marked wrong. The same holds for 一日 (one day / all day / the whole day) and 一人 (one person / being single). Since 86-90% of entries are multi-sense, this affects the large majority of that item type.

So the family is not dropped - it is still the cheapest plausible pool there is - but it belongs to the **CONTEXTED** item types, where a sentence makes one sense right and the others wrong. A bare gloss question has nothing to disambiguate with, so its distractors must come from other WORDS with the same-POS filter doing the work. That is a TASK-138 change and it is the most valuable thing the baseline produced.

## 9.4 Two precedents worth taking, and one to refuse

**Already adopted, so nothing to file.** The AionCore rule worth copying turned out to be one this repo has taken on purpose: `packages/acp/src/session-normalize.ts` describes "camelCase, then oversized inline base64 stripped (**AionUi contract**)", and `acp-events.ts` holds the `IMAGE_BASE64_PREFIXES` list, an `image_base64` omission reason, and a synthesized image reference for what it strips. An earlier draft of this section called that convergent validation with `frameContent`; it is stronger than that - the same contract, deliberately, and documented as such. Nothing to do.

**Take: the runaway guard.** aionrs bounds a model with `max_tool_call_failure_turns` (default 3), a broader `max_turns`, and an emergency guard, and its detector also catches consecutive all-error rounds and short repeating cycles. That is the attempt budget §9 calls missing, in a shipping agent, so the shape is not speculative. TASK-145 AC#1.

**Take: the worker-task shape.** AionCore's host owns the spawn and the supervision and queues worker tasks rather than serving a request-scoped call, which is exactly "ask the model to do N bounded things" - the shape exam authoring is. A detail worth copying: its spawn builder distinguishes long-running CLIs whose stdio the host owns from short-lived tools it merely parses, and every spawn sets `kill_on_drop` and strips `NODE_OPTIONS`/`CLAUDECODE` so a debug profile cannot leak into a child.

**Refuse: the 24-crate decomposition.** AionCore carries JWT, CSRF, teams, chat channels, cron and a plugin system, because it is a multi-user backend. This is a single-user Tauri + Bun app. Copying that layout would be cargo-culting a structure that answers questions this app does not have. Take the seams; leave the structure.

# 10. Two framings to keep

**Infinite variations over finite anchors, not infinite questions.** The supply is measured at 11,311 JLPT-classified anchors, and multi-sense entries mean one anchor supports many distinct items. A learner who knows 600 of the 700 N5 words should still be meeting fresh items about words they know, which is why the real exam reuses anchors across papers. "Never the same item twice" is a variety property and is provable. "Infinite vocabulary" is a supply property we do not have and did not need. The caution is that multi-sense is a supply fact and not a quality fact: the same per-entry senses that make variation possible are what makes §7 a real decision rather than a lookup.

**JLPT-shaped, never JLPT.** The shape is already encoded: section structure, minutes, item-type mix, and the 120/60 and 60/60/60 scorings. The content will never be official. The app's honesty machinery already anticipates this, with the deliberately unreachable CEFR badge, the `shortened` versus `exam-conditions` labels, and the raw-count-only treatment of below-floor papers. Keep it, and keep the claim to "JLPT-shaped practice".

# 11. Open questions

1. ~~How the model-free path reads the corpus.~~ Settled in §5: the shipped JSON, from TypeScript. The MCP-client alternative is retired.
2. Whether the Tatoeba sentence corpus ships in the desktop bundle. Lower priority than it was, because §3's 1,787 hand-written examples cover the first pass, but it still decides whether the crate's richer `linkedWords` context and `drill_candidates(source: sentence)` ever reach the exam.
3. Whether the part-of-speech inconsistency in §3 is corrected at the corpus, or worked around in the item layer, now that §8 shows there is no better classifier reachable from a model-free path.
4. ~~The exam authoring call direction.~~ Settled in §9.2 and TASK-143: the sidecar calls the agent. Residue there: session lifecycle, latency tolerance, and whether authored items are opt-in.
5. Whether the teacher surface gets its own candidate contract or reuses the exam's. Reusing it is the single-trust-story option and is the reason for the ordering in §1, but it is not written down anywhere.
6. Whether a speaking section is wanted at all. The app has none, STT makes one possible, and §6 records why it has to be detection-based rather than evaluative. A product decision, not a technical one.
7. ~~Who authors the item prose and the anchor.~~ Settled in §9: code refuses, the model proposes, recorded on the item. Two residual numbers are still open rather than the question itself: the validator's attempt budget, and whether step 3 opens for vocabulary in the first pass or only for grammar.
8. ~~Whether the audio lives on the item or is synthesized on demand.~~ Settled in §6: nowhere - the item carries the script and the client synthesizes on demand, so there is no file to cache. What remains open there is only the TASK-132 exception, now landed and documented.

# 12. Related tasks

- TASK-138, exam: source the generated paper from the shipped corpus, not sixteen hardcoded nouns. The implementation of everything in §3, §5, §7 and §8.
- TASK-139, exam: the accepted focus field is dropped and the request round-trip is lossy. Per §9 this is the personalisation layer, not a hygiene fix, which raises its priority.
- TASK-137, exam: result and review honesty pass, including the placeholder explanation and model-written prose.
- TASK-136, kana: mount the readiness checkpoint so doc-19 §4 has a surface.
- TASK-141, exam: the listening section has a real script and still no way to hear it. The contract's missing audio field plus client playback, as one unit.
- TASK-142, exam: mask the target realization, the §9.1 derivability gap. Deterministic, because a pattern's trailing literal resolves against a `vaporetto_split` segmentation.
- TASK-143, exam: the authoring call direction. Done - the sidecar calls the agent; §9.2.
- TASK-144, exam: hand-judge a baseline exam set, the §9.3 second bar. A judgement task, and the cheapest thing on the track.
- TASK-145, exam: author items with the agent - masked targets and wrong-rule distractors, §9 step 3. Blocked on TASK-144.
- TASK-134, tests: replace the source-text assertion class with behavioural ones or documented deletions.
- TASK-71, audit: the stale umbrella over the exam work.
- doc-22, the parked roleplay-persona direction, which shares the grounding discipline in §8 and §9 and the same hazard.
