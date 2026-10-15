---
id: TASK-49
title: >-
  Vaporetto FTS migration hang on fresh db — SQLITE_VAPORETTO_EXT loaded blocks
  applyContentMigrations >60s
status: Done
assignee: []
created_date: '2026-09-09 15:52'
updated_date: '2026-09-09 20:18'
labels:
  - bug
  - tooling
  - db
dependencies: []
priority: high
ordinal: 543000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Discovered during TASK-48's squat E2E (2026-09-09): with SQLITE_VAPORETTO_EXT at its default dev location (ext .so + 27MB .predictor.bin.zst present), applyContentMigrations('file:<fresh.db>') via bun direct-run NEVER returns — >60s inside vaporetto DDL, synchronous (an 8s abort timer armed before the call never fires, so the event loop is blocked, not awaiting). unicode61 path (ext env unset) completes in <0.1s. Production/dev boots today are unaffected because the sidecar env has no SQLITE_VAPORETTO_EXT — boots log 'migrations applied (tokenizer=unicode61, vaporetto=false)' — but that means the vaporetto FTS quality TASK-23.1 shipped is NOT actually active in dev boots, and flipping the env on bricks boot. Suspects: the extension's tokenizer module lazily stream-decodes the 27MB zstd predictor on first tokenize invocation, or a native deadlock between the extension load and FTS5 module registration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Root cause identified: bisect which statement inside createContentDatabase blocks when the vaporetto extension is loaded (candidates: loadExtension native call, CREATE VIRTUAL TABLE ... tokenize=vaporetto in 0002, first INSERT through the vaporetto tokenizer, zstd predictor stream-decode) — document the exact blocking call in migrate.ts or vaporetto.ts
- [x] #2 Fix the hang so applyContentMigrations on a fresh db with SQLITE_VAPORETTO_EXT + model present completes in bounded time (either load the tokenizer lazily so DDL never triggers synchronous decode, pre-decode the predictor outside the migration path, or bound + escape the decode) — unicode61 path stays byte-identical
- [x] #3 Regression guard: a test or script check that runs applyContentMigrations on a fresh temp db twice — once with ext env unset (unicode61, vaporetto=false) and once with the ext present (vaporetto=true) — and asserts both finish under a strict wall-clock bound (e.g. 10s), failing with the blocking statement named
- [x] #4 End-to-end proof: boot the compiled sidecar with the ext env set and confirm [db] migrations applied (tokenizer=vaporetto, vaporetto=true) within normal boot time, and that a vaporetto-tokenized FTS query returns correct matches (TASK-23.1 semantics restored in dev)
- [x] #5 bun run test + check-types + ultracite clean in every touched package
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed f5ed4d2): AC1 — bisect: loadExtension 3ms (innocent); INSERT through tokenizer 2ms; the blocking call is FTS5 x_create → upstream build_predictor → load_model + Predictor::new, a ~58MB model parse (~6.5s) per CREATE VIRTUAL TABLE — measured 19.4s (0002: 3 tables) + 26.3s (0003: 1) + 6.4s (0004: 1) ≈ 52s per fresh db, event-loop blocked so timers never fire. ALSO paid per CONNECTION first-touch (reopen test: 6.5s before first query). AC2 — fork-patch: third_party/sqlite-vaporetto-v0.4.0-predictor-cache.diff adds a process-global Arc<Predictor> cache (Mutex<HashMap<config-key, Arc>>, mirrors upstream's SCALAR_TOKENIZER_CACHE thread-local pattern but global since libsql may call from any thread); vaporetto_x_create clones the Arc. scripts/build-vaporetto-ext.ts reproduces the artifact deterministically (clone v0.4.0 → apply patch → cargo build --release with SQLITE_VAPORETTO_EMBED_MODEL pointing at our model.zst = equivalent to upstream -with-model so no env needed) and installs sha256-verified into resources/vaporetto/ext/. Measured: cold create 6.4-6.8s ONCE per process, subsequent creates 0-1ms, reopen first-touch 6.5s→1ms, fresh-db migration 52s→~7s. AC3 — packages/db/test/vaporetto-migrate-perf.test.ts: unicode61 <5s (forces disable via nonexistent ext path — empty string is falsy in the resolver and does NOT disable), vaporetto <30s (per-table rebuilds blow straight past), second-connection first-touch <2s (cache proof); vaporetto cases skipIf ext/model absent. AC4 — compiled sidecar on fresh db logs '[db] migrations applied (tokenizer=vaporetto, vaporetto=true)' in ~15s boot; word-aware semantics proven: MATCH '特許' → 東京特許許可局 (1 row, 1ms) — TASK-23.1 now genuinely live in dev (previously every dev boot silently ran unicode61!). AC5 — db 18/0 (incl 3 guard tests + fts5-perf now running vaporetto=true), server 22/0, desktop tsc+ultracite clean, ultracite clean db package. NOTE: stale packages/db/dist/ (tsc -b output, gitignored) broke bun test's substring path filter — removed; regenerate dist only for actual builds. Dev-boots behavior change: ext now loads by default in dev (dev dir fallback in resolveVaporettoExtPath), so boots pay ONE 6.5s predictor build — acceptable; the SIDECAR cold-start impact should be tracked when TASK-24 (warm boot) resumes.

FOLLOW-UP COMPLETION (committed 58087a0, 2026-09-10): the path-resolution half found during verification is now fixed. (1) Compiled-binary ext resolution: vaporetto.ts walked the repo root from import.meta.url — dead in /$bunfs binaries — then through TWO miscounted '..' chains (the exe FILE is a segment: target/debug/server needs SIX ups to the repo root; I wrote 4 then 5, both wrong). Final: ancestor walk from BOTH exe-dir and cwd checking for the marker dir + packaged resources/vaporetto fallback. Live proof: compiled sidecar boots '[db] migrations applied (tokenizer=vaporetto, vaporetto=true)'. (2) Tokenizer upgrade for EXISTING dbs: user_version said 'applied' so unicode61-era dbs never re-ran 0002-0004; upgradeFtsTokenizerToVaporetto now detects the DDL mismatch and re-applies them (pre-dropping six FTS tables + eleven triggers, skipping ALTER statements via a comment-aware line filter). Live proof on the dev manobu.db: '[migrate] tokenizer upgrade: unicode61 → vaporetto' then MATCH 特許/東京 → real hits. (3) 'again' sub-day intervals floor to TODAY (grade-loop test caught 0.5d landing tomorrow). Every change re-validated: db 21/0, server 27/0, desktop 232/0, repo checks 12/12 + 9/9, ultracite clean. Methodology lesson encoded in the commit: unit probes under plain bun never exercise /$bunfs resolution — only the live sidecar oracle (the migrations log line) validates compiled-binary behavior; I trusted the probes twice and was wrong twice.
<!-- SECTION:NOTES:END -->
