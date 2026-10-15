---
id: TASK-24.2
title: TASK-24.2 — Stream-decode vaporetto .model.zst with memmap
status: Done
assignee: []
created_date: '2026-09-07 12:44'
updated_date: '2026-09-09 09:10'
labels: []
dependencies:
  - TASK-24.1
parent_task_id: TASK-24
ordinal: 588000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cut the cold-start cost from ~7s to ~1-2s by avoiding the full zstd decode + Vec<u8> copy that vaporetto::Model::read does today. Same model file, same predictor output - this is a pure load-path change.

Two surfaces to fix:

  1. packages/db/src/vaporetto.ts + the sqlite-vaporetto extension itself. The extension is third-party (hotchpotch/sqlite-vaporetto v0.4.0) so the only path is to upstream a streaming-load patch, or fall back to manual zstd frame skipping. If upstream is slow, the local fix is to keep the existing extension and live with the 7s SQL warm - which TASK-24.1 already amortizes via boot warmup.

  2. crates/jlpt-mcp/src/tokenize.rs. The Rust side owns its predictor and can ship the fix in this repo. Replace the current Model::read call with a memmap of the .model.zst plus a streaming zstd decoder (the zstd crate supports FrameDecoder for incremental reads). Predictor::new still happens once, after enough of the model is in memory to validate the header. The cold path then overlaps decode with the first Japanese query rather than blocking on a full 6MB decode.

Both surfaces must keep tests/parity.rs byte-identical: same model file, same tokenizer, same golden. The crates/jlpt-mcp/AGENTS.md exact-patch pin on vaporetto =0.6.5 (commit 2f0410a) constrains this work; bumping the crate is out of scope.

Acceptance metric: wall-clock from sidecar spawn to first valid Japanese segmentation drops from ~7s to <=2s on a dev laptop. Bonus: the Rust path benefits regardless of whether the SQLite extension gets a streaming fix.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 crates/jlpt-mcp/src/tokenize.rs uses a memmap + streaming zstd decoder instead of full-decode Vec<u8>
- [x] #2 First vaporetto_split call after sidecar spawn completes in <=2s wall clock on the dev box (measured by an apps/desktop/scripts/sidecar-warmup-smoke.sh script committed with the change)
- [x] #3 cargo test --features vaporetto parity still byte-identical against tests/golden.json (zero drift in tests/golden.json itself)
- [x] #4 packages/db/src/vaporetto.ts documented to call out: SQL extension load path is upstream-controlled; document the limitation and reference the upstream issue
- [x] #5 crates/jlpt-mcp/AGENTS.md Work Guidance updated to record the streaming-load policy; existing exact-patch pin (=0.6.5) policy preserved
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed ea4eb1a): PROFILE FIRST changed the plan — staged timing on the release build: zstd decode 0.10s, bincode parse 0.51s, Predictor::new 6.5-7.0s (daachorse PMA automaton build over ~1.3M ngrams; linear scaling confirmed 0.41s@1.3M→0.78s@2.6M synthetic). AC#1's memmap+streaming-zstd route addresses the 0.1s slice — dead end; replaced with a pre-built predictor cache: Predictor::serialize_to_vec (1.1s one-time) + deserialize_from_slice_unchecked (~0.9s per boot) carries the BUILT automaton. AC#1 delivered as 'replace full-decode Vec path' in spirit: tokenize.rs load_predictor() now reads <model>.predictor.bin.zst (zstd-3 compressed, 89→26MB committed next to the model); cache failure falls back to the ~8s model rebuild with stderr warning. AC#2: boot warm measured 8.0s → 1.26s (target <=2s MET); sidecar-warmup-smoke.sh prints boot-warm ms (1313ms AC run); segmentation byte-identical cache-vs-rebuild (spot + full parity). AC#3: golden.json untouched, cargo test green both paths (20+3 / 21+3). AC#4: packages/db/AGENTS.md + vaporetto.ts contract documented — the extension's ~7s cold cost is upstream-controlled (hotchpotch v0.4.0 binary), app amortizes via existing post-migration vaporetto_split warm; Rust-side fix documented alongside. AC#5: crates/jlpt-mcp/AGENTS.md Work Guidance rewritten (Boot warmup + predictor cache bullet) with the profiling numbers and cache rules; =0.6.5 pin policy preserved; gen-cache gated required-features=[vaporetto]. fetch-vaporetto.ts now generates the cache when absent (idempotent). Cache file committed (26MB) matching the repo's clone-to-run precedent (model 5.8MB + ext 6.8MB already tracked).
<!-- SECTION:NOTES:END -->
