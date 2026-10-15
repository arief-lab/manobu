---
id: TASK-24.1
title: TASK-24.1 — Warm jlpt-mcp vaporetto predictor at Tauri boot
status: Done
assignee: []
created_date: '2026-09-07 12:44'
updated_date: '2026-09-09 08:09'
labels: []
dependencies: []
parent_task_id: TASK-24
ordinal: 587000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move the ~7s vaporetto model cold-start off the first user search and into the sidecar spawn phase, so the splash screen absorbs it.

Today crates/jlpt-mcp/src/tokenize.rs uses OnceLock to lazily load the .model.zst on first vaporetto_active() call, which only happens when search_vocab/search_grammar/search_kanji/search_pitch_accent runs against a Japanese query. Users hitting /listen, /lesson, /jlpt-mock all pay this on the first interaction.

Change: invoke the vaporetto_split debug tool (or a new dedicated warmup tool) from apps/desktop/src-tauri/src/lib.rs immediately after the jlpt-mcp sidecar boots. Do it on the boot thread (spawn_blocking or a dedicated thread) so the sidecar readiness poll at /health is not blocked, and so the Tauri window can still open while the warm runs. Surface progress to the splash via a new speech-status field if needed (mirrors ensureVad boot pattern in __root.tsx from TASK-21.3).

packages/db side: packages/db/src/migrate.ts already calls SELECT vaporetto_split on a dummy arg after migration - that path is already warm. No change there unless the SQL extension warm needs to be re-verified after sidecar warm races with the first query.

Keep this small: a single warmup call from lib.rs, no model changes, no parity-golden regeneration. The Rust parity-golden policy in crates/jlpt-mcp/AGENTS.md still applies; running warmup does not change the bit-stream output.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 apps/desktop/src-tauri/src/lib.rs invokes a warmup command against jlpt-mcp during boot, off the readiness-poll thread
- [x] #2 jlpt-mcp binary exposes a warmup JSON-RPC method (tools/call vaporetto_warmup or equivalent) that loads the predictor once and returns the elapsed ms; cold + warm path covered by tests/parity.rs
- [x] #3 First Japanese search after sidecar spawn returns within 500ms wall clock (was ~7s cold) — verified by a sidecar-smoke script in apps/desktop/scripts/
- [x] #4 cargo test --features vaporetto still passes parity against tests/golden.json unchanged
- [x] #5 apps/desktop/AGENTS.md + src-tauri/AGENTS.md updated to record the boot warmup contract
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 886cac3): AC#1's literal mechanism (lib.rs invokes warmup against jlpt-mcp) is UNIMPLEMENTABLE as written — audited packages/acp/src/mcp.ts + index.ts: Tauri only exports ACP_MCP_SERVERS; the ACP agent (opencode) spawns the jlpt-mcp stdio process per session/new, so a lib.rs-side warmup would load a throwaway predictor instance, not the agent's. Warm semantics achieved INSIDE the binary instead: main() spawns a background thread calling tokenize::warm() before the RPC loop serves. AC#2: vaporetto_warmup tool added ({warmed, elapsed_ms, model_active}; cold call reports the decode, re-call is OnceLock hit <100ms) + parity test vaporetto_warmup_reports_load_once (cold+warm covered, model-inactive boxes skip). AC#3: apps/desktop/scripts/sidecar-warmup-smoke.sh — measured: initialize 6.4s / boot warm 8.0s (overlapped, warm non-blocking), post-warm first search_vocab 10ms (>>500ms margin). Gotcha recorded: smoke holds stdin open past warm — RPC EOF mid-warm tears down the loop before queued responses flush. AC#4: golden.json untouched; cargo test green both paths (20+3 default, 21+3 vaporetto). AC#5: crate AGENTS.md Boot-warmup bullet (mechanism + architecture note) + src-tauri AGENTS.md ACP_MCP_SERVERS NOTE. Also verified: packages/db fts5-perf.test.ts 15/15 (<100ms warmed-connection assertion holds). Boot-warm timing on this box: ~8.0-8.3s release (zstd decode of 5.8MB model.zst — TASK-24.2's memmap/streaming path targets this number).

AC#1 recorded as satisfied-in-spirit: boot-phase warm exists (inside jlpt-mcp main()), but NOT via a lib.rs invocation — see architecture note in implementation notes + both AGENTS.md. Decision trail kept for TASK-24 review.
<!-- SECTION:NOTES:END -->
