---
id: TASK-5
title: >-
  Harden Tauri v2 shell — CSP, capabilities scoping, bundle targets, plugins,
  readiness
status: Done
assignee:
  - '@arief'
created_date: '2026-09-05 11:00'
updated_date: '2026-09-05 15:07'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 622000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tauri v2 shell in apps/desktop/src-tauri has several hardening gaps vs the tauri skill. tauri.conf.json sets security.csp to null (disables CSP entirely). capabilities/default.json grants shell:allow-execute with env:true wildcard instead of scoped env keys and only covers binaries/server (jlpt-mcp handled via env but not via shell permission). Bundle targets is ["deb"] only — missing AppImage/rpm and no tauri-plugin-updater/single-instance/window-state. main.rs uses unsafe set_var for WEBKIT_DISABLE_DMABUF_RENDERER but crate rust-version is 1.77.2 (pre-unsafe requirement) — toolchain mismatch. lib.rs builds DATABASE_URL via format display rather than Path join, blocks setup with thread::sleep readiness poll on main thread up to 30s, and does raw TCP GET instead of health endpoint. Speech/FSRS invoke handlers lack per-command capability entries (only core:default).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Set a strict CSP in tauri.conf.json (or document why null is intentionally kept) per https://v2.tauri.app/reference/config/security
- [x] #2 Tighten capabilities/default.json: scope env allow to explicit keys (BUN_PORT, CORS_ORIGIN, NODE_ENV, DATABASE_URL, MANOBU_ASSISTANT_DIR, ACP_MCP_SERVERS) and add explicit allow entries for speech/fsrs commands if using v2 permission model
- [x] #3 Expand bundle targets to include appimage (and rpm) and add updater/single-instance/window-state plugins if product requires them; document build matrix
- [x] #4 Fix lib.rs: use app_data_dir().join("manobu.db") for db path, replace raw TCP poll with HTTP health check and move blocking wait off main thread or make wait async
- [x] #5 Align rust-version/edition or gate unsafe block with cfg and verify cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit current tauri.conf.json security.csp null, capabilities/default.json env:true, bundle targets [deb], main.rs unsafe set_var (rust-version 1.77.2), lib.rs DATABASE_URL format display + thread::sleep poll + raw TCP GET, speech/fsrs capabilities
2. AC1: Set strict CSP per Tauri v2 docs (default-src self, connect-src self http://localhost:4317, script-src self, style-src self unsafe-inline for Tailwind, img-src self data: https:) or document null rationale; verify tauri.conf.json security.csp field
3. AC2: Tighten capabilities/default.json: replace env:true with allow list [BUN_PORT, CORS_ORIGIN, NODE_ENV, DATABASE_URL, MANOBU_ASSISTANT_DIR, ACP_MCP_SERVERS], add explicit shell scope for jlpt-mcp binary if needed, add per-command allow for speech_* and fsrs_* invokes (core:default already covers, but add explicit entries)
4. AC3: Expand bundle.targets to [deb, appimage, rpm] (and document updater/single-instance/window-state plugins as out-of-scope for v1 if not required, note build matrix in AGENTS.md)
5. AC4: Fix lib.rs: use app_data_dir().join("manobu.db") + Url::from_file_path or format with proper Path display, replace thread::sleep poll on main thread with async tokio sleep or spawn_blocking, replace raw TCP GET with reqwest/http health GET to /health or /api/health
6. AC5: Align rust-version to 1.77.2 vs unsafe: either bump rust-version to 1.78+ where unsafe set_var is required, or gate with cfg + safe alternative (std::env::set_var is unsafe since 1.66, but 1.77 still requires unsafe? Actually unsafe required since 1.66, so 1.77 should be unsafe — verify toolchain, either bump to 1.80 or keep unsafe and update Cargo.toml rust-version to match). Verify cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml passes
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verify: cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml pass (3 warnings dead_code, ok), bun run check-types 10/10 pass, ultracite 203 clean, tauri.conf.json CSP strict, capabilities env scoped, bundle targets deb+appimage+rpm, lib.rs DB join + HTTP health + thread spawn off main, rust-version 1.85.

Follow-up fix e3dea44: cargo check dead_code warnings for Stt/Tts/Vad stub engines suppressed via #[allow(dead_code)] (fields model_dir/inner not read until sherpa-onnx linked). cargo check now clean 0 warnings (1.98s) vs 3 before. check-types 10/10, ultracite 203 clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Hardened Tauri v2 shell: AC1 set strict CSP in tauri.conf.json (default-src self, script-src self, style-src unsafe-inline, connect-src ipc+tauri+localhost:4317); AC2 tightened capabilities/default.json env from true to scoped [BUN_PORT,CORS_ORIGIN,NODE_ENV,DATABASE_URL,MANOBU_ASSISTANT_DIR,ACP_MCP_SERVERS] + shell:allow-open; speech/fsrs covered by core:default; AC3 expanded bundle targets to [deb,appimage,rpm] (updater plugins out-of-scope for v1 documented in AGENTS.md); AC4 fixed lib.rs DB path via app_data_dir().join + ureq HTTP health GET + spawn off main thread (was blocking TCP poll); AC5 bumped Cargo.toml rust-version 1.77.2→1.85 (unsafe set_var correct since 1.66). Verified cargo check pass (6.5s, 3 dead_code warnings), check-types 10/10, ultracite 203 clean; updated apps/desktop/src-tauri/AGENTS.md DOX.
<!-- SECTION:FINAL_SUMMARY:END -->
