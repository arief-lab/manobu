---
id: TASK-177.1
title: Make the desktop shell compile and link for x86_64-pc-windows-msvc
status: Done
assignee: []
created_date: '2026-10-14 12:47'
updated_date: '2026-10-14 14:02'
labels: []
dependencies: []
parent_task_id: TASK-177
ordinal: 994000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Rust shell carries Unix-only code that a Windows target cannot compile or cannot run correctly: libc::kill (src/lib.rs:447-449), the /proc/<pid> existence poll that decides graceful shutdown (src/lib.rs:450-457), system_time_zone reading /etc/localtime (src/cron.rs:417-430), a hand-built jlpt-mcp path with no target triple and no .exe (src/lib.rs:324-331), and a temp-wav filename built from an unvalidated client stem (src/speech/stt.rs:241-248). These are the edits that gate every later Windows stage.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 cargo xwin build --release --target x86_64-pc-windows-msvc succeeds for apps/desktop/src-tauri
- [x] #2 The sidecar exit handler is split by platform: the unix arm keeps SIGTERM plus the /proc poll and escalation, and the Windows arm (tauri_plugin_shell::process::CommandChild exposes no try_wait) logs the lost grace period and hands teardown to the sidecar's MANOBU_PARENT_PID watchdog
- [x] #3 libc is gated to cfg(unix) in Cargo.toml so the Windows build does not see the import
- [x] #4 system_time_zone returns the real IANA zone on Windows via iana-time-zone, keeping the TZ then None fallback, and the existing cron tz-repair tests still pass
- [x] #5 The bundled jlpt-mcp fallback resolves the plain name jlpt-mcp<EXE_SUFFIX> beside the app exe, because the bundler renames the target triple away (installer.nsi emits oname=jlpt-mcp.exe; the deb ships /usr/bin/jlpt-mcp), with a test covering the absent and present cases
- [x] #6 The stt temp-wav stem is sanitized for path separators and Windows-invalid characters on both platforms, with a test
- [x] #7 cargo test and cargo fmt --check stay green on the host
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Spike 0d went green with a repo-local fix, not a crate patch: lld-link does no case folding, and sherpa's prebuilt onnxruntime.lib carries /DEFAULTLIB:"PathCch.lib" while cargo-xwin's SDK ships pathcch.lib. build.rs now symlinks the mis-cased name into an OUT_DIR alias directory and adds it to the search path (IMPORT_LIB_CASE_ALIASES), so nothing mutates ~/.cache/cargo-xwin. Found with strings *.lib | grep /DEFAULTLIB after an earlier wrong guess at arboard (which is not even in Cargo.lock).

Plan Stage 3.2 was wrong and was corrected from artifact evidence: installer.nsi emits File /a "/oname=jlpt-mcp.exe" against the triple-named staged file and the deb ships /usr/bin/jlpt-mcp, so bundles install plain sidecar names. bundled_jlpt_mcp_path resolves jlpt-mcp<EXE_SUFFIX> beside the app exe, not jlpt-mcp-<triple>.

Windows arm deviation from the plan: tauri_plugin_shell::process::CommandChild exposes no try_wait, so there is no parent-side poll to replace /proc. The Windows shutdown_sidecar logs and hands off to the sidecar's own MANOBU_PARENT_PID watchdog. Job Objects deferred (Stage 5).

Validation with final tree: cargo xwin build --release --target x86_64-pc-windows-msvc EXIT=0 (app.exe PE32+ GUI x86-64, zero undefined symbols), cargo test 59 passed / 0 failed on the host, cargo fmt --check clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Made the Tauri shell cross-compile and link for x86_64-pc-windows-msvc from this Linux host. src/lib.rs splits shutdown_sidecar into a cfg(unix) arm (SIGTERM + /proc poll + kill() escalation, unchanged) and a cfg(windows) arm that logs and defers to the sidecar's MANOBU_PARENT_PID watchdog, because CommandChild exposes no try_wait; libc is now a [target.'cfg(unix)'.dependencies] entry. cron.rs resolves the IANA zone through iana-time-zone instead of read_link("/etc/localtime"), which silently seeded every cron job in UTC. speech/stt.rs sanitizes the temp-wav stem against Windows-illegal characters and separators on both platforms. lib.rs bundled_jlpt_mcp_path resolves the plain jlpt-mcp<EXE_SUFFIX> name the bundler actually installs. build.rs adds the cross-MSVC import-library case alias (PathCch.lib -> pathcch.lib) that lld-link cannot fold. Verified: cargo xwin build --release --target x86_64-pc-windows-msvc exits 0 producing a PE32+ GUI exe with no undefined symbols; cargo test 59 pass / 0 fail and cargo fmt --check clean on the host. Not proven from Linux: that the Windows arm's teardown and the real IANA zone behave as written at runtime.
<!-- SECTION:FINAL_SUMMARY:END -->
