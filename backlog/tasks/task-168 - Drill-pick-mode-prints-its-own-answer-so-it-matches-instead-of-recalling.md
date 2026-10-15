---
id: TASK-168
title: 'Drill: pick mode prints its own answer, so it matches instead of recalling'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 13:56'
updated_date: '2026-09-28 17:11'
labels:
  - drill
  - ux
dependencies: []
priority: low
ordinal: 933000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while verifying TASK-162 on 2026-09-28. CardFace renders the target character unconditionally at the top of the card (apps/desktop/src/features/drill/drill-lab.tsx:846-854) and PickGrid includes that same character among the four choices (:1359-1398). Live read on the Hiragana deck: cardTop "あ" with options ["う","あ","ん","い"]. The learner is asked which of four shapes equals the shape already printed above them, which is discrimination, not recall.

It matters more than it did: TASK-162 made pick the first-run default, because it is the only mode answerable by a tap on every deck without a microphone or stroke-order knowledge. So the mode a brand-new learner spends their first set in is currently the one that measures the least.

TASK-162 deliberately did NOT change this. Turning the prompt into a cue changes what the drill measures: a learner who passes pick today by shape-matching would start failing, and the mastered count would mean something different across one commit boundary. That trade, and the choice between replacing pick and adding a fourth mode, belongs in its own work order.

Context the code will not tell you: the distractors are the 3 nearest deck neighbours (typeFallbackChoices, exported via __test__), which remain sensible options for a cue-to-form task; the card subtitle already carries the cue data (romaji for kana, gloss for kanji); and the always-visible glyph is currently doubling as the verdict feedback on a miss.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 In pick mode the card shows a cue the learner must answer from (the reading for a kana deck, the meaning for the kanji deck) and does not show the target character before the pick.
- [x] #2 The character is revealed at the verdict beat, so a correct pick confirms and a wrong pick teaches, and the tap-to-continue path still advances.
- [x] #3 draw and say keep the character visible: draw needs the ghost, say produces the sound from the form.
- [x] #4 The pick instruction line states the new task in the learner words and no other mode copy changes; no em dash is introduced.
- [x] #5 The prompt is a pure seam asserted by calling it, and a mutation seam fails when pick prints its own answer before the pick.
- [x] #6 The task records the decision to replace pick or add a fourth cue-recall mode, with the reason, including that recognition-with-the-form-shown is a legitimate first stage for a kana never seen.
- [x] #7 Verified live in the running app, not only by tests: a first-run learner on the Hiragana deck and on the Kanji N5 deck each get the cue, answer, and see the reveal.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
DECISION (AC#6): replace pick, do not add a fourth cue-recall mode. pick writes real grades into the SRS (finishCard -> onGrade(good ? 3 : 1), drill-lab.tsx:467-478) and TASK-162 made it the first-run default, so whatever pick measures is what a new learner's whole deck is graded by, and today it measures shape-discrimination: the answer is printed above the four choices (:877) and is one of them. A fourth mode would be two tap-grids differing only by whether the answer is on screen, and would cost a MODE_INSTRUCTION entry, a resolveMode key and a stored preference nobody chooses deliberately. The stage AC#6 names (recognition with the form shown, legitimate for a kana never seen) survives the replacement by moving to the beat it belongs to: a correct pick holds the glyph for CORRECT_HOLD_MS (:223), a wrong pick holds the card until drill-card-continue is tapped (:963-975), so first exposure and the correction are the same moment instead of a permanent answer key. The comparability trade TASK-162 named is accepted: a stored manobu.drillMode of pick silently changes what it grades; no version key, since the new meaning is the honest one.
THE LEAK IS TWO LINES WIDE: CardFace prints the glyph unconditionally (:877) AND the first card of the set animates the target stroke order on the card (phase intro :492-496, KanjiVg ghost :917-928) while the choices sit below it. Fixing the header but leaving the sweep still shows the answer being drawn.
PLAN: 1) add pickCue(current), pure and exported via __test__: strokeCount === undefined (the kana discriminator cardSubtitle uses, :844) gives romaji, otherwise gloss ?? romaji; neither can contain the form. 2) CardFace gains modePick beside modeDraw: the header slot renders pickCue while phase is loading/intro/ready in pick, and current.char at the verdict (correct|wrong), same slot so no layout jump. 3) ghostVisible (:709-710) is 0 in pick until the verdict, then strokeCount: the square is an empty 米字格 and fills with the real character at the reveal. 4) the card-lifecycle effect (:492) takes the intro branch only when mode !== pick, so no sweep can draw the answer; introPlayedRef stays unset, so switching to draw later still gets its first-card sweep. 5) MODE_INSTRUCTION.pick becomes "read the cue, then tap its character"; draw and say copy untouched (AC#4), no em dash. 6) typeFallbackChoices unchanged: deck-nearest characters stay valid form options and the target must be tappable.
VERIFY: drill-mode.test.ts calls pickCue on a kana and a kanji row and asserts the cue is not the form; drill-machine.test.tsx renderToStaticMarkup of CardFace at ready vs wrong in pick proves the glyph is absent before the pick and present at the verdict; a new mutation-gate seam prints current.char in the pick branch and must be caught; live headless Chromium on :3001 walks the Hiragana deck and the Kanji N5 deck as a first-run learner (cue, tap, reveal) and cleans any rows it writes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as planned: pickCue + ghostStrokes are the two new pure seams (both in __test__), CardFace takes modePick and swaps its header slot between the cue and the character, the ghost block is withheld while the answer is open, and the intro sweep is draw-only. MODE_INSTRUCTION.pick is now "read the cue, then tap its character"; draw and say copy untouched.

GAP FOUND WHILE VERIFYING LIVE (fixed in the same change): the first reveal screenshot showed the four choice buttons looking identical after a wrong pick. PickGrid carried data-correct/data-picked for tests only, with a static border-border class, so nothing on screen said which shape was the answer or which one was tapped. That was tolerable while the target was printed above the grid (the verdict only had to confirm), and is not once the grid is the only place the answer lives. PickGrid now paints border-primary on the correct choice and border-mark on the tapped one from the verdict onward, and stays unmarked while the answer is open. Pinned by a renderToStaticMarkup case over the exported PickGrid.

No DB cleanup needed: /drill writes nothing server-side (drill.tsx passes no onGrade, so no FSRS row; gsm log() is in-memory + IndexedDB and never calls fetch). The live walk therefore left local.db untouched.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Pick is a recall task now. The default answer mode printed the target character above four choices that included it, so the mode a first-run learner spends their first set in graded shape-matching into the SRS scale (finishCard -> onGrade 3|1).

Changed in apps/desktop/src/features/drill/drill-lab.tsx: a new pure pickCue(card) asks a kana card by its reading and a kanji card by its meaning; CardFace takes modePick and its header slot carries the cue while the answer is open and the character from the verdict on; the KanjiVG ghost (whose faint guides draw the same glyph) is withheld while asking, and ghostStrokes returns the completed form at the verdict, so the 米字格 fills in as the answer is revealed; the intro stroke sweep is now draw-only, because it animated the answer stroke by stroke on the first card of every pick set; MODE_INSTRUCTION.pick became "read the cue, then tap its character". draw and say keep the form on the card, unchanged.

Decision (AC#6): replace pick rather than add a fourth cue-recall mode. Two tap-grids differing only by whether the answer is on screen is not a distinction a learner can choose between, and it would cost a mode key, an instruction entry and a stored preference. Recognition with the form shown is still served, at the beat that wants it: a correct pick holds the glyph for the 1s stamp, a wrong pick holds the card open on it until the tap. The comparability trade TASK-162 named is accepted: mastered counts before/after this commit mean different things, and there is no version key.

Gap found and fixed during live verification: after a wrong pick the four buttons looked untouched. PickGrid had data-correct/data-picked for tests and a static border, so once the grid became the only place the answer lives, nothing marked which shape was right or which was tapped. It now paints border-primary on the answer and border-mark on the tap from the verdict onward, and stays unmarked while asking.

Verified: apps/desktop/test/drill-mode.test.ts calls pickCue and ghostStrokes directly (cue is the reading / the meaning / never the form; strokes held back until the verdict; draw and say untouched) and pins the new instruction line; apps/desktop/test/drill-machine.test.tsx renders CardFace and PickGrid through renderToStaticMarkup (no trace of 日 or あ in the asking markup, glyph plus subtitle plus ghost at the verdict, tap-to-continue still there, draw and say still print the form). Mutation seam drill-pick-prints-its-own-answer restores {current.char} in the card top and is CAUGHT (bun scripts/mutation-gate.ts drill: 3 caught; --check: 54 anchors resolve). Root bun run test 10/10 tasks, check-types 14/14, ultracite clean, boundaries 0 violations, check:dox clean. Live in headless Chromium against :3001 plus the API: Hiragana asked "a" with an empty grid and choices ん/う/あ/い, a wrong tap revealed あ with its subtitle and the character drawn in the square, the continue tap advanced to 2/46, a correct tap stamped and auto-advanced; Kanji N5 asked "day; sun" and revealed 日 with にち・ニチ・ジツ・ひ・-び・-か・day; sun・4画, the answer ringed ai and the tap ringed 朱; draw and say each still show あ with the ghost on. Screenshots in /tmp/t168-shots. No server rows were written, so local.db needed no cleanup. Docs: the drill row in apps/desktop/AGENTS.md now describes the cue/reveal contract, the draw-only sweep, the accepted trade and the three drill seams.
<!-- SECTION:FINAL_SUMMARY:END -->
