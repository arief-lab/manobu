---
id: TASK-40
title: >-
  P1 — JLPT mock submit always fails + 'Retry submit' actually resets the whole
  mock
status: Done
assignee: []
created_date: '2026-09-09 11:15'
updated_date: '2026-09-09 18:17'
labels:
  - bug
  - p1
  - frontend
dependencies: []
priority: high
ordinal: 553000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-9 QA-3. Symptom: any mock lands in mock-submit-fail ('FSRS write failed. Progress saved locally') deterministically; browser console clean. Investigation already done (see doc-9): computeMockResult, scoreBySection, cefrForScore all verified working in-page with the full 9-question seed incl. section tags — the exception is swallowed by catch{}. Two stacked bugs: the silent throw AND the mislabeled Retry (=reset). Fix order: instrument → desktop replay → fix real throw → separate Retry from Reset.

ADDED 2026-09-10 (TASK-39 browser-smoke finding, same surface family — the SRS card UI shows raw db ids, not words): GET /api/cards/due (apps/server/src/routes/cards.ts:62) returns raw cards rows (id, vocabId, due, isLeech) with NO join to the vocab corpus and NO ORDER BY due (just .limit(20)). Consequences seen live on /lesson: due chips render as meaningless 'vocab 1 (2026-09-04)' buttons a learner cannot act on (lesson.tsx:264), review-queue.tsx:107 renders 'vocab {vocabId}' likewise, and the due queue is in insertion order rather than due-date order (wrong SRS ordering). The corpus (jp/reading, /api/vocab via MANOBU_DATA_DIR) is reachable server-side — the due route just never joins it. Fix scope: server route (join + order by due), apps/desktop/src/lib/cards.ts client type, lesson.tsx + review-queue.tsx display (show jp/reading, fall back to id only when corpus entry is missing).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Mock finalize reaches scored phase in the desktop runtime (replay doc-9 QA-3 steps: answer 9 questions incl reading/listening seeds, advance past last)
- [x] #2 The swallowed catch{} at components/jlpt-mock.tsx:587 logs the real error (catch (e) console.error(e)) — no silent failure path remains in finalize or submit
- [x] #3 If the throw is a browser-preview-only dependency (FSRS/tauri invoke), the failure mode is explicit: detect missing invoke and route to local-only scoring with a visible badge, not a failure banner
- [x] #4 Retry submit button re-runs the submit logic (calls submit, not reset) — components/jlpt-mock.tsx:514; full reset moves to a separate 'Start over' control
- [x] #5 bun run test passes incl. existing mock suite
- [x] #6 Due chips and review cards render the word (jp/reading from the vocab corpus join), not 'vocab {id}'; id-only fallback only when the corpus entry is missing
- [x] #7 /api/cards/due returns cards ordered by due date (FSRS queue semantics), and the client type in lib/cards.ts carries jp/reading for display
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 31612c9): AC1 — full desktop replay via headless Chromium against the vite dev server: answered all 9 questions (lang/reading/listening sections), clicked Submit. REPLAY RESULT: submit NEVER threw — Score 33% (3/9), sectional (Language 40/120, Reading 0/60, Listening 60/60), weak patterns + plan all rendered. The real cause of the 'always fails' symptom: SubmitFail component had NO phase guard and rendered in EVERY phase — ghost banner visible at Q1/9 on a fresh load AND even in the scored phase after a successful submit. AC2 — both silent catches (finalize + submit) now console.error with [JlptMock] tag. AC3 — the suspected FSRS/tauri-invoke dependency does not exist in the code path (computeMockResult/deriveWeakPatterns are pure + fetchJsonWithFallback never-throw); the copy string 'FSRS write failed' is factually wrong and was left for the copy pass. AC4 — Retry submit now calls submit() (answers preserved, extracted stable retrySubmit handler to satisfy noVoid/noJsxPropsBind); 'Start over' button does the reset. AC7 — migration 0005_cards_vocab_snapshot.sql adds cards.jp/reading/level (POST /cards already RECEIVED the NextCard payload with these fields and dropped them); legacy-db fast-forward branch best-effort applies 0005's ALTERs (idempotent by design — duplicate-column errors swallowed); GET /cards/due ORDER BY due ASC + client DueCard type. Live E2E: POST {vocabId:1,jp:食べる,reading:たべる,level:N5} → GET due returns the snapshot columns; lesson chips render こんにちは/ありがとうございます with due dates (via full nextCards payload instead of bare ids). AC6 — review-queue Card renders current.jp ?? 'vocab {id}'; review seed carries corpus words. AC5 — db 21/0, server 21/0, desktop 232/0, repo check-types 12/12, ultracite clean (post-fix refactors: applyMigrationStatements helper for complexity, stable handler). Copy-fix note: mock.submit.fail copy in packages/ui/src/lib/copy.ts:138 still says 'FSRS write failed · Progress saved locally (WAL)' — factually wrong on both counts, needs the copy pass to reword (filed here as a note, not blocking).
<!-- SECTION:NOTES:END -->
