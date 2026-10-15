---
id: TASK-23.28
title: >-
  Fix lib/kanji.ts URL prefix — /kanji 404s, server answers on /api/kanji
  (SCR-09 readings/vocab degrade)
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-08 20:17'
updated_date: '2026-09-08 20:35'
labels:
  - bug
  - frontend
  - server
dependencies: []
references:
  - apps/desktop/src/lib/kanji.ts
  - apps/server/src/routes/jap-data.ts
parent_task_id: TASK-23
priority: high
type: bug
ordinal: 559000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
lib/kanji.ts builds fetch URLs as `${baseUrl}/kanji?…` and `${baseUrl}/grammar?…`, but the Hono server mounts createJapDataRoute() under /api (apps/server/src/index.ts: apiRoute.route("/", createJapDataRoute()) then app.route("/api", apiRoute)). Live-verified during TASK-23.5.2: GET /kanji?character=食 → 404, GET /api/kanji?character=食 → 200. Result: KanjiDetail's Readings and VocabRows silently fall back to empty (lookupKanji returns null on !res.ok) on every /kanji/detail view — the surface ships broken-looking with no error surfaced. Likely introduced when the /api mount was added (1a67bba server slim-down) without updating the desktop client URLs. Fix options: (a) change lib/kanji.ts URLs to /api/kanji + /api/grammar (client-side, matches the kanjivg.ts precedent from 23.5.2), or (b) additionally mount jap-data at root server-side for compat. Option (a) is the clean fix — one file, two URL strings; option (b) only if external consumers of the unprefixed paths exist (none found).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 lookupKanji('食') returns a full entry (on/kun readings, meaningsEn, strokeCount) against the live server — no more silent null
- [x] #2 vocabContaining('食') returns corpus rows against the live server
- [x] #3 /kanji/detail?character=食 shows Readings (on/kun toggle populated) and VocabRows (or their genuine empty state) — browser-verified
- [x] #4 bun test in apps/desktop passes (kanji.test.ts URL expectations updated if they pin the path)
- [x] #5 No regression: GET /api/kanji/stroke keeps working; grep shows no remaining unprefixed /kanji or /grammar fetch URLs in apps/desktop/src
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Client-side fix (option a): lib/kanji.ts:53 /kanji → /api/kanji; lib/kanji.ts:74 and lib/mock.ts:91 /grammar → /api/grammar — matches the kanjivg.ts precedent. 2. Also fix lib/cards.ts (/cards, /cards/due, /cards/grade → /api/…): server mounts createCardsRoute under /api at index.ts:375-376 — same bug class, found during scope walk; AC#5's 'no remaining unprefixed URLs' requires it. 3. Update stale header comment in kanji.ts (GET /kanji → /api/kanji). 4. Verify: live server curl for /api/kanji, /api/grammar, /api/cards/due; browser-verify /kanji/detail?character=食 Readings+VocabRows; bun test apps/desktop (kanji.test.ts server-gated tests already skip without window.VITE_SERVER_URL, no path pins to update). 5. Extend kanji.test.ts AC#5 guard: grep-level assertion is a docs/AGENTS matter; instead verify via grep in finalization notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope grew past the original one-line URL fix — the 404 was masking a second defect. Findings: (1) Client URLs fixed in lib/kanji.ts (/kanji→/api/kanji, /grammar→/api/vocab), lib/mock.ts (fetchGrammarLevel → /api/grammar), lib/cards.ts (/cards*→/api/cards* — same bug class found in scope walk, server mounts cards under /api too). (2) /api/grammar was reading data/n5.json (VOCAB files: word/reading/meaning) and casting to the grammar shape (id/pattern/meaning_en) — first live browser pass crashed with 'Cannot read properties of undefined (reading includes)' because vocabContaining mapped g.pattern→undefined then called .word.includes. Real grammar data lives in data/grammar/n*.json. Fix: server /api/grammar now reads getGrammarFile()=data/grammar/n*.json (mock.ts consumer gets correct patterns like 'Noun + です'), and a new GET /api/vocab?level= serves data/n*.json for vocabContaining. Dead GrammarEntry interface removed from lib/kanji.ts (no consumers). (3) Verified live: curl /api/vocab N5 → 東/ひがし rows; /api/grammar N5 → desu-polite-copula pattern; browser /kanji/detail?character=食 shows on readings ショク/ジキ + kun toggle く.う/く.らう/た.べる/は.む + 12 vocab rows (食堂/食べ物/食べる/食事/食料品…) with Save buttons, no error banner; stroke route still 200; old /kanji still 404 by design. bun test 218 pass/0 fail; tsc clean; ultracite clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the SCR-09 data pipeline, which turned out to be two stacked bugs: (1) desktop fetch URLs missing the /api prefix (lib/kanji.ts, lib/mock.ts, lib/cards.ts — every desktop fetch now /api-prefixed, matching the server mount); (2) the server /api/grammar route actually served the VOCAB files (data/n*.json) cast to the grammar shape, crashing vocabContaining on g.pattern→undefined and feeding mock.ts wrong data. Server now splits /api/grammar (data/grammar/n*.json, pattern shapes for mock.ts) from new /api/vocab (data/n*.json for vocabContaining); dead GrammarEntry removed. Verified: browser /kanji/detail?character=食 shows on/kun readings (ショク/ジキ, く.う/く.らう/た.べる/は.む) + 12 vocab rows with Save, no error; curl /api/vocab + /api/grammar return correct shapes; stroke route regression-checked 200; bun test 218/0; tsc + ultracite clean. Old /kanji 404 remains by design (no external consumers).
<!-- SECTION:FINAL_SUMMARY:END -->
