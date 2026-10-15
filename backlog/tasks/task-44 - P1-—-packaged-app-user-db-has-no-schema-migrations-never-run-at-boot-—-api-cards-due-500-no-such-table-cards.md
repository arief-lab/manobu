---
id: TASK-44
title: >-
  P1 — packaged app: user db has no schema (migrations never run at boot) —
  /api/cards/due 500 'no such table: cards'
status: Done
assignee: []
created_date: '2026-09-09 12:41'
updated_date: '2026-09-09 13:35'
labels:
  - bug
  - p1
  - sidecar
dependencies: []
priority: high
ordinal: 547000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Discovered in TASK-43 E2E (12:39 sidecar log): GET /api/cards/due → LibsqlError SQLITE_ERROR no such table: cards. DATABASE_URL points at ~/.local/share/gg.manobu.app/manobu.db; packages/db/src/migrate.ts applyContentMigrations exists but nothing in the tauri boot (lib.rs) or server index.ts invokes it — dev boxes only worked because a developer ran migrations manually at some point. Options: run applyContentMigrations in server index.ts at boot (server owns the db), or a lib.rs setup hook that shells the migration step. Pick the server-side one (single owner, works for CLI runs too).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Fresh-install boot (empty DATABASE_URL file) ends with cards/revlog/settings tables present — migrations applied before the window serves /api/* db routes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 0efb30c): AC#1 — boot migration wired in src/index.ts BEFORE Bun.serve (applyContentMigrations(DATABASE_URL), try/catch: failure logs '[db] migration failed' and boots anyway — routes degrade individually, sidecar survives). E2E fresh-install proof: rm db file → compiled binary boot → '[db] migrations applied (tokenizer=unicode61, vaporetto=false)' (ext absent = graceful unicode61 fallback) → POST /api/cards {inserted:[1]} → GET /api/cards/due returns the card. AC#2 (implied by the fix): idempotency required for every-launch semantics — drizzle DDL has no IF NOT EXISTS so blind re-run threw 'table grammar already exists' on boot 2; solved with PRAGMA user_version (= applied count, MIGRATION_FILES.length) + legacy-db fast-forward (tables exist + version 0 → probe cards table → set version, skip). E2E: reboot on migrated db → zero migration failures, data intact, next insert id=2. MAJOR adjacent fix inside this task: migration SQL is now IMPORTED AS TEXT (with { type: 'text' }) — the old fs walk keyed on import.meta.url (/$bunfs in the compiled binary) silently skipped all 5 files and failed at post-apply verify ('no such table: vocab_fts'); bundled strings work in source + binary identically. ALSO fixed en route: sidecar-dev.sh cp -r → cp -rL (repo-root node_modules entries are RELATIVE symlinks into the .bun store — the -r copy left a dangling link next to the sidecar, boot failed ENOENT on the native module). Suites: packages/db 15/0 (fts5-perf), apps/server 22/0; tsc + ultracite clean. Docs: apps/server/AGENTS.md 'Boot migrations (TASK-44)' + packages/db/AGENTS.md TASK-44 bundled-SQL/user_version contract.
<!-- SECTION:NOTES:END -->
