---
id: TASK-141
title: 'Exam: the listening section has a real script and still no way to hear it'
status: Done
assignee: []
created_date: '2026-09-26 15:39'
updated_date: '2026-09-27 01:51'
labels:
  - exam
  - listening
  - speech
dependencies: []
priority: high
type: feature
ordinal: 906000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The listening half of every paper is still unrenderable, and the hard half of the fix has already landed. TASK-138 sourced listening items to real grammar points and their hand-written example sentences, so a listening item now has a real SCRIPT. It still cannot be played, because `packages/api-contract/src/exam.ts` has no audio, speech, tts or voice field at all - not thin, absent - while the blueprints allocate listening (N1 60 of 180 points, N2 50 of 105) and the item types `listening-detail` / `integrated-listening` exist and validate.

The delivery side already ships: sherpa-onnx in the Tauri shell (`apps/desktop/src-tauri/src/speech/tts.rs`, `stt.rs`, `vad.rs`, `models.rs`) with a TypeScript client in `packages/speech/src/`, in use by `features/roleplay/roleplay.tsx`, `features/listen-type/listen-type.tsx`, `features/kanji-detail/kanji-detail.tsx` and `shared/token-text.tsx`, which speaks a word on tap. So the missing piece is a field, a client control, and a decision about where the audio lives - not a dependency.

ONE TASK, NOT TWO, and the reason is this task's own lesson. Shipping "the field" and "the playback" as separate tasks produces a field nothing consumes, which is the third instance of the defect shape doc-21 §2 catalogs (the 16-word catalog, the dropped `focus` field, the absent audio). The guard doc-21 §2 asks for - an acceptance criterion that something downstream consumes, plus a test that fails when nothing does - is the reason this is one unit.

The desktop-runtime question doc-21 §6 raises is open and is the one thing to settle first: audio cached on the item (a synthesized file per item with its path stored, durable across a restart) versus synthesized on demand at playback time (stateless, but resuming an exam then depends on the Tauri speech path being present and warm). Caching on the item is the better default, because resume should not depend on re-synthesizing, but the client playback path is not the sidecar's to decide.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The exam contract carries an audio reference for a listening item, and a listening item assembled from a corpus script can be played end to end from the desktop. One task on purpose: a field with no consumer is the doc-21 §2 defect shape.
- [x] #2 The audio location decision doc-21 §6 raises is settled and written down, with the resume requirement named as the deciding constraint: an exam resumed after a restart must not depend on re-synthesizing.
- [x] #3 A test fails when the contract declares the audio field and nothing renders it, so the field cannot ship unconsumed. The desktop assertion is behavioural (a control appears and plays), never a source-text read.
- [x] #4 An audio item whose synthesis is unavailable reports an honest unavailable state rather than a silent player or a stub duration, in the same spirit as TASK-124’s pending/unavailable drill items.
- [x] #5 The script shown to the learner and the script synthesized are the same string, asserted over an assembled listening item, so a learner never hears text they cannot read back in the review.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DONE, 5/5, and the design is the OPPOSITE of what the task originally described. There is no audio file anywhere.

WHAT SHIPPED. The contract carries the SCRIPT, not an audio reference: `ExamItem.speech` is `string | null`. The store decides, in `toClientItem`, via the exported `SPEAKING_ITEM_TYPES` so the exam service's resolution path decides identically. The desktop renders `ExamSpeechControl`, which hands the text to the existing `ListenButton` - already speaking, playing, showing a speaking state and honouring the user's voice and speed preferences. The whole client half is a control and a pass-through.

AC#1's original framing was wrong in kind and is corrected: "the contract carries an audio reference" assumed the sidecar produces audio. It cannot - the TTS is sherpa-onnx inside the Tauri shell, the models are downloaded and never bundled, so there is nothing to reference and nothing to cache. The task shrank from "field plus cache plus playback" to "carry text, render a control".

AC#2 is the reverse of what I filed, and the reversal is the finding. I recommended caching per item because a resumed exam should not depend on re-synthesizing. That dissolves once synthesis is client-side: the script is PERSISTED on the item, so a resumed exam re-synthesizes from the same stored string. Replay is exact, no file can go stale, and the only residual is a cold TTS init on first play from a model the learner already opted into in Settings. Decision: on demand, client-side, no persisted audio.

THE EXCEPTION IS listening-detail ONLY, and it was originally wider. The first cut covered BOTH listening types and that broke a named TASK-132 test, "keeps an integrated listening script out of the client render" - because `integrated-listening`'s script is ONE OF SEVERAL stimuli (a script plus an accompanying passage), which is exactly the shape TASK-132 wrote `itemStimuliForClient` for. Narrowed to `listening-detail`, where the script IS the item and the learner must hear it. Widening it to `integrated-listening` would silently override an invariant another task owns, so playing an integrated-listening item is left as a separate decision with its own reasoning. The test failure is what surfaced this, which is the argument for running the whole suite rather than the task's own tests.

AC#4 FOUND A REAL LIE. `ListenButton` swallowed a synthesis failure and played the sign animation anyway - a reasonable demo for a worksheet, and a lie on a listening section, where the learner taps hear, sees a voice animate, and has heard nothing. It now takes an optional `onError`, called in the catch alongside the demo animation; callers that cannot report a state keep their existing behaviour unchanged, and the exam reports UNAVAILABLE. The first version of the control used `onErrorCapture`, which would NOT have worked: `speak()` runs in a click handler, not during render, so the error never reached a render boundary.

AC#5 is the assertion that cannot be faked: a listening item's spoken text is one of that item's OWN options, so the review can point at what the learner heard; and no other item type carries one. Deliberately NOT `options[0]`: the TASK-135 shuffle permutes options after assembly and the answer key stays server-side, so the index is unstable by design and `toContain` is the honest property. The first version asserted the index and failed for exactly that reason.

AC#3 is behavioural: the control appears for a listening item carrying its exact script, a reading item with no speech renders no control at all (asserted by the ABSENCE of the test id and the aria-label, never a source read), and a no-speech control renders empty rather than complaining - a non-listening item is not a degraded listening item.

DOCS CORRECTED, because the finding invalidated three claims that were still standing: apps/server/AGENTS.md's "the serialized state free of script text", packages/db/AGENTS.md's "because a listening script must never be projected", and doc-21 §6, which had recommended caching on the item and is now decided with the reversal stated rather than quietly overwritten.
<!-- SECTION:NOTES:END -->
