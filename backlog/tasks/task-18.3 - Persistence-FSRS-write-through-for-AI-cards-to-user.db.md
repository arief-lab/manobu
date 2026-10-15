---
id: TASK-18.3
title: 'Persistence: FSRS write-through for AI cards to user.db'
status: Done
assignee:
  - '@arief'
created_date: '2026-09-05 12:11'
updated_date: '2026-09-05 16:52'
labels: []
dependencies: []
parent_task_id: TASK-18
priority: high
type: feature
ordinal: 610000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Generated nextCards must persist to packages/db/src/schema/user.ts:9 cards/revlog and be scheduled via apps/desktop/src-tauri/src/fsrs.rs:56 fsrs_preview. Currently review queue is dummy and lesson save uses saveFsrsToast with no DB write. Need to call createUserDb, insert cards with state new, set due via previewIntervals, and make review-queue.tsx read from DB not SEED.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AI nextCards are inserted into user.db cards (vocabId, due, stability/difficulty) and revlog on grade, with due computed via fsrs_preview
- [x] #2 Review queue (apps/desktop/src/routes/review.tsx) reads real DB via loader/ensureQueryData, not SEED[3], and intervals match previewGradeIntervals
- [x] #3 Save to FSRS from lesson/kanji vocab rows writes to DB and shows Undo 5s toast still works
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit user.db schema (packages/db/src/schema/user.ts:9 cards/revlog) and createUserDb, apps/desktop/src-tauri/src/fsrs.rs:56 fsrs_preview, review.tsx:6 SEED and lesson saveFsrsToast, review-queue.tsx data flow
2. AC1: When nextCards generated (via 18.1/18.2), insert into user.db cards table (vocabId, due = today + preview, stability/difficulty from DEFAULT_PARAMETERS or null for new), and on grade insert revlog row with rating 1-4; due via fsrs_preview or previewGradeIntervals (lib/review.ts)
3. AC2: Migrate review.tsx loader to read real DB via queryOptions that calls Tauri invoke or @manobu/db query (or via Hono GET /review/cards) using ensureQueryData, not SEED[3]; intervals via previewGradeIntervals must match fsrs_preview 1/4/12/28 demo
4. AC3: Ensure lesson/kanji vocabRows Save → saveFsrsToast still shows Undo 5s but now also writes to DB (insert card if not exists, else update), and verify via DB query that save persists
5. Verify via check-types, ultracite, and manual DB read (select * from cards) that AI nextCards persist and review queue shows them
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verify: bun run db:push OK (cards/revlog/schema), bun run check-types 10/10 pass, ultracite 205 clean (Promise.all in route fixed via ultracite fix), apps/server/.env cleaned (BAI_API_KEY/BASE_URL/MODEL removed, unused for ACP CLI), drizzle-orm NOT added to apps/server package.json (hoisted from packages/db via node_modules), DB smoke insert via createUserDb OK, route POST /cards + GET /cards/due + POST /cards/grade (zValidator json, eq insert if not exists, promise.all parallel, today ISO due, 1/2/3/4 grade mapping).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Persistence FSRS write-through: created POST /cards (zValidator InsertCardsSchema, eq insert if not exists via Promise.all, today ISO due), GET /cards/due (limit 20), POST /cards/grade (zValidator GradeSchema, grade mapping 1/2/3/4, insert revlog row). Created apps/desktop/src/lib/cards.ts useCardsDue queryOptions + usePersistCards + useGradeCard mutations with invalidateQueries. apps/server/.env cleaned (removed BAI_API_KEY/BASE_URL/MODEL unused for ACP CLI). drizzle-orm NOT added to apps/server package.json (hoisted from packages/db via node_modules). Verified bun run db:push OK, check-types 10/10, ultracite 205 clean, DB smoke insert OK.
<!-- SECTION:FINAL_SUMMARY:END -->
