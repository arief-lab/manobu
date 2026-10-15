---
id: TASK-47
title: >-
  Dev-hygiene sweep 2 — persona staging race, latent data-watch gap, cold-start
  fallback noise
status: Done
assignee: []
created_date: '2026-09-09 14:37'
updated_date: '2026-09-09 15:08'
labels:
  - bug
  - tooling
dependencies: []
priority: medium
ordinal: 545000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three follow-ups from TASK-46's own implementation (filed same-day, same species: tooling that misleads). (1) RACE: sidecar-dev.sh now syncs personas to target/debug/assistant, but tauri's build script ALSO stages bundle.resources there during the same boot — two writers, one dir; invisible today (identical content) but fragile: if the stager replaces rather than merges, the sync is clobbered. (2) LATENT: the new find-based staleness watch covers src/** code only — correct today because data loads at request time, but if anyone bakes data into the bundle the watch misses it; needs a documenting comment at minimum. (3) NOISE: fetchJsonWithFallback now warns on every cold boot where the sidecar hasn't bound yet (query fires before health) — users may read the [server-fetch] warning as an error; suppress connection-refused specifically, keep status/parse warnings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Persona sync no longer races tauri resource staging: either assistant/ is removed from bundle.resources in dev builds (sync-owned binaries/assistant is the only dev copy) or the stager+sync writers are otherwise serialized/proven non-clobbering — verified by a clean .nit start (rm -rf target/debug/assistant first) where the synced copy survives boot
- [x] #2 sidecar-dev.sh documents (comment) the watch boundary: src/** covers code only; runtime-read files outside src (assistant/*.md, japanese data via MANOBU_DATA_DIR) are intentionally not rebuild triggers — data must stay request-time-loaded, never baked into the bundle
- [x] #3 fetchJsonWithFallback suppresses the connection-refused/ECONNREFUSED class at cold start (sidecar not yet bound) — either silent for that error class or gated behind a dev flag; real HTTP-status and parse failures still warn
- [x] #4 A cold-start console check shows zero [server-fetch] warnings on a normal dev boot (sidecar healthy, routes live)
- [x] #5 bun run test + check-types + ultracite clean (apps/server, apps/desktop)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed ae03d75): AC1 — repro first: tauri does NOT restage bundle.resources on recompile (drifted staging file survived a forced cargo rebuild), and lib.rs dev resolution reads target/debug (exe parent). Conclusion: binaries/assistant was read by nothing (packaged bundles read repo root via tauri.conf.json resources) — the dual-sync raced tauri's stager for zero benefit. Fix: sidecar-dev.sh syncs staging ONLY; binaries/assistant deleted. Clean-wipe E2E: rm -rf target/debug/assistant → sync → boot → staging MATCHES repo root, '[assistant] loaded 2 persona(s)'. AC2 — WATCH BOUNDARY comment added to the bun-rebuild block: src/** covers code only; personas refresh via sync; japanese data loads at request time via MANOBU_DATA_DIR; baking data into the bundle requires extending the watch. AC3+4 — isColdStartUnavailability() in server-fetch.ts covers all three engines' conn-refused phrasings (Failed to fetch/Chromium, Load failed/WebKitGTK, NetworkError/Gecko, ECONNREFUSED/Unable to connect/Bun, fetch failed/undici). Behavioral proof under Bun: connection-refused silent; HTTP 404 still warns. First attempt missed Bun's 'Unable to connect' phrasing — caught by the same bun -e behavioral probe. AC5 — server 22/0 (75s), desktop 234/0, ultracite clean both (85 desktop files), tsc -b clean both packages. E2E note: first clean-slate attempt failed with 'Is port 4317 in use?' — leftover sidecar from the repro boot, harness mistake not a regression; rerun after killing stragglers was green. Docs: apps/desktop/AGENTS.md persona contract corrected (staging-only, binaries/assistant removed, watch boundary).
<!-- SECTION:NOTES:END -->
