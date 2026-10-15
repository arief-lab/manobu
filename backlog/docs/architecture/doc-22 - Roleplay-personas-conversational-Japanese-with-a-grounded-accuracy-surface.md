---
id: doc-22
title: 'Roleplay personas: conversational Japanese with a grounded accuracy surface'
type: specification
created_date: '2026-09-26 07:20'
updated_date: '2026-09-26 07:20'
tags:
  - roleplay
  - persona
  - chat
  - product
  - design
---
# Purpose

Records the roleplay-persona direction so it can be picked up without re-deriving it. This is parked design, not current work: the exam content pipeline comes first (doc-21, TASK-138, TASK-139). What follows is the shape of the idea, the one hazard that decides its design, and the question that is still open.

# 1. The idea

The chat surface carries two stances. One is the teacher: Sensei, existing, instructional, grounded. The other is a persona: a sister, a lover, a friend, whoever the learner picks. The learner talks to that character instead of to the teacher.

The mechanism is motivation, not roleplay-as-a-game. A learner keeps talking to a person they like, and stops abandoning the app. The sentence-level tools already in the chat, translating a line and explaining what it means, ride along, so the fun surface keeps a correctness surface attached.

# 2. What already exists

- Persona loading is markdown with `---` frontmatter under `assistant/*.md` at the repo root, boot-loaded into a `Map<slug, Persona>` by `apps/server/src/assistant-loader.ts`. Frontmatter carries `name` and `description`; the body is never exposed over `/assistants`.
- Resolution order is `MANOBU_ASSISTANT_DIR` (set by the Tauri sidecar), then `import.meta.dir` / cwd / exec-relative `assistant/` directories, then the embedded Sensei fallback (`FALLBACK_SYSTEM_PROMPT`).
- The sentence-level tools this sketch depends on are already part of the chat surface.

So a first persona is a markdown file, not an architecture change. Sensei is the existing member of the set, not a special case.

# 3. The hazard, which is the part that decides the design

Sensei's grounding rules, 8 and 9 in `assistant/sensei.md`, require every example sentence to come from `lookup_examples` / `search_examples` / `random_example` and to cite its Tatoeba id, never invented. That discipline currently lives in exactly one file, which makes it a property of a persona rather than a property of the app. A companion persona has no such constraint, and it actively wants to be fluent, warm and encouraging.

So the failure mode is: a long, affectionate, natural-sounding conversation, in vocabulary above the learner's level, with subtly incorrect grammar. Nothing crashes, no validator fires, the learner internalises it, and they finish less able in Japanese than when they arrived while feeling the whole thing went well.

That is the doc-21 §1 hazard in its most concentrated form, and the exposure is higher here than on the exam, because roleplay is where the learner spends most of their time and forms most of their habits.

# 4. The principle that resolves it

**Fluency carries the motivation, grounding carries the accuracy.** The character is unconstrained. The moment the learner taps a sentence, the explanation is sourced under the same discipline Sensei already has. One trust story across both stances, not two.

# 5. What this implies the feature needs

- **A level gate.** `learnerLevel` already exists on the chat input. It is a constraint on the persona, not a setting on it. Without it an N5 learner gets a partner who speaks like a native, which is either incomprehensible or infantilising.
- **A system-prompt floor that every persona inherits**, so that grounding is a property of the app: cite the corpus for examples, correct the learner's Japanese rather than silently switching to English, hold the learner's level. Sensei's rules 8 and 9 become the first instance of a shared floor rather than a one-off. Without this, adding a persona adds an ungrounded generation surface, which is the hazard in §3 arriving fresh each time.
- **The sentence tools treated as load-bearing, not as extras.** They are the accuracy surface, and they carry the same sourcing rule as Sensei's examples.

# 6. Open question: who writes the personas

One word, two very different products.

- **An app-provided catalogue.** Ours to write and moderate: a content catalog, a voice decision per persona, and a named review owner. Cheapest, and the only version consistent with a shared prompt floor in §5.
- **User-written personas.** Users supply system prompts, which is a prompt-injection and safety surface. It needs its own storage, validation, reset and moderation path, and a per-user persona model that the current boot-loaded global `Map` does not provide. It is materially larger than it looks, and it turns the loader from a catalog into a per-user store.

Unresolved. It decides whether §5's floor is enforceable, so it should be answered before the first persona is written rather than after.

# 7. Sequencing

Exam content first (doc-21, TASK-138, TASK-139). Not because roleplay matters less, but because the grounding layer is the shared prerequisite. The exam is where that layer gets proven, against the same corpus and the same validators, on the surface where correctness is checkable. Roleplay is the surface that justifies the layer.

When this is picked up, the first deliverable is one persona file plus the shared prompt floor, so that the second persona costs nothing and the floor is demonstrated rather than assumed.

# 8. Related

- doc-21 §1 for the ordering argument and §7 for what the model must not decide.
- doc-12, doc-14, doc-16 for the exam pipeline this sequencing depends on.
- `assistant/sensei.md` for rules 8 and 9, the first instance of the floor in §5.
- TASK-137 for model-written prose: the same authoring question arrives here, on a surface where a bad answer is read as a personality rather than as a wrong question.
