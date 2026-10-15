---
id: TASK-177
title: Ship a Windows x64 build of the desktop app
status: In Progress
assignee: []
created_date: '2026-10-14 12:46'
updated_date: '2026-10-14 19:27'
labels: []
dependencies: []
ordinal: 993000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The app ships Linux only: bundle.targets is ["deb","appimage","rpm"] (apps/desktop/src-tauri/tauri.conf.json:33) and scripts/sidecar-stage.sh:47 hardcodes TARGET_TRIPLE=x86_64-unknown-linux-gnu. The owner wants a Windows .exe, built by cross-compiling on this Linux host (decided 2026-10-14) with cargo-xwin for the MSVC SDK and NSIS for the installer. Scope agreed: boot-critical plus voice, deferring the vaporetto sqlite extension. Voice is in scope because sherpa-onnx-sys does not compile C++ for the host, it downloads a prebuilt archive for the target triple, win-x64 static /MT included (sherpa-onnx-sys-1.13.7/build.rs:366-370), so TTS is reachable from a cross build.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 cargo xwin build --release --target x86_64-pc-windows-msvc links the desktop shell; the only remaining Unix-only code is behind cfg(unix), and libc is a cfg(unix)-gated dependency
- [x] #2 apps/desktop/scripts/sidecar-stage.sh stages server-x86_64-pc-windows-msvc.exe and jlpt-mcp-x86_64-pc-windows-msvc.exe for a caller-supplied triple, and the existing sha256 plus mtime freshness guard passes for that triple
- [x] #3 The Windows artifact ships node_modules/@libsql/win32-x64-msvc beside the server exe, proved from a build output (the bundler's generated installer.nsi, and the portable folder assembled from it), not by reading tauri.conf.json
- [x] #4 The WebView2 origin http://tauri.localhost appears in both the sidecar CORS origin list and app.security.csp connect-src
- [x] #5 Windows runtime parity: the bundled jlpt-mcp fallback resolves the plain name the installer actually writes (jlpt-mcp.exe beside the exe, per the /oname in installer.nsi), PATH handling splits on ; and honors PATHEXT on win32, cron resolves the IANA zone without /etc/localtime, and an MCP stdio target containing spaces is not truncated
- [x] #6 The Windows build command produces an NSIS installer on this host, or, if makensis is unavailable, produces a portable folder and records the exact command that would produce the installer on a Windows host
- [x] #7 The owning AGENTS.md files document the Windows arm and bun run check:dox passes
- [x] #8 The final report separates what is proven from Linux (compile, link, staged layout, installer contents) from what is not proven without a Windows machine (libsql and sherpa loading, CORS handshake, sidecar boot, voice output), and does not claim the app was run
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Route: cross-compile on this Linux host. Stage 0 spikes (results below) gate everything. Stage 1 make the Rust shell compile and link: cfg(unix) the libc::kill at src/lib.rs:447-449 and the /proc poll at :450-457, replace the windows arm with child.try_wait()/kill. Stage 2 build config: apps/server compile:windows script, sidecar-stage.sh triple parameterization, tauri.conf.json nsis target + win32 libsql resource leg + CSP origin, desktop:build:windows. Stage 3 runtime parity: CORS origin, jlpt-mcp fallback name, PATH_SEP and PATHEXT which(), child-registry basename and kill-by-pid, iana-time-zone in src/cron.rs:417-430, toMcpServer whitespace split at packages/acp/src/mcp.ts:180-204, sanitize the stt temp-wav stem. Stage 4 verify the bundle layout by extracting the artifact. Deferred: sqlite_vaporetto.dll, Job-Object child reaping, non-ASCII APPDATA FFI, MSI, signing, CI.
Spike verdicts 2026-10-14: (0c) bun cross-compile GREEN, bun build --compile --target=bun-windows-x64 produced a 97MB PE32+ binary. (0a) cargo check --target x86_64-pc-windows-msvc FAILED before the libc::kill site, at C build scripts ring v0.17.14 and bzip2-sys v0.1.13 because cc-rs had no Windows-targeted headers: fixed by cargo-xwin 0.23.1 (installed to ~/.cargo/bin) plus its MSVC CRT/SDK cache. (0b) NSIS is not in Arch extra, only AUR (maintainer xantares, makedepends scons + mingw-w64-gcc + mingw-w64-zlib), so makensis needs a sudo password to install; the PE-plugin worry is resolved: NSIS Source/Plugins.cpp:127 GetExports parses the PE export table from bytes rather than dlopen, so a Linux makensis can read tauri's downloaded nsis_tauri_utils.dll, and tauri-bundler invokes Command::new("makensis") on non-Windows hosts (nsis/mod.rs:706-708) with /usr/share/nsis as the Linux default (:218-221).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#6 outcome: no installer on this host (makensis missing, nsis is AUR-only). Portable folder produced instead at apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/portable/manobu (314 MB) plus manobu-win-x64-portable.zip (100 MB, 152 files), laid out to match installer.nsi: app.exe, server.exe, jlpt-mcp.exe, assistant/, node_modules/@libsql/win32-x64-msvc/, packages/japanese/data/. 20 of the 23 /oname targets are present; the 3 absent are the linux libsql leg the deep merge drags into the installer and which is dead weight on Windows.

Windows run-checklist for the owner (this is the only way AC#8's unproven half closes; each step needs a screenshot): 1. Unblock the zip (Mark of the Web) and run app.exe from the folder, not from a zip preview. 2. WebView2 Runtime must be present (the portable folder has no download bootstrapper, unlike the installer). 3. First boot: the setup rail must read backend reachable, not backend unreachable; if it is unreachable, hit http://127.0.0.1:4317/ in a browser and check the CORS origin list, because http://tauri.localhost is the origin WebView2 sends and the one thing Linux cannot test. 4. Ask Sensei must answer, which proves opencode was found on PATH through the win32 PATHEXT walk. 5. /setup must offer the voice download and skip it cleanly. 6. Exam listening must actually play audio after that download, which is the sherpa-onnx Supertonic path that this host only proved links, not runs. 7. In the vocab/kanji tools, jlpt-mcp must return entries; an empty result means either the sidecar name lookup or the quoted ACP_MCP_SERVERS target broke. 8. Expect degraded search: sqlite_vaporetto.dll is not built for Windows (Stage 5), so tokenizer-backed lookup falls back to unicode61. 9. Quit the app and check Task Manager for an orphaned server.exe or opencode, which is the deferred Job-Object gap.

Remaining owner decisions: install makensis to get the real installer (paru -S nsis needs sudo; a prebuilt npm makensis package avoids sudo but is a third-party binary supply choice), and run the checklist above on a Windows machine. Nothing further in this task is agent-actionable from Linux.

AC#7 doc pass: apps/desktop/src-tauri/AGENTS.md (Windows bundling, the build.rs PathCch alias, the platform-split shutdown_sidecar, desktop:build:windows prerequisites, test count 52 to 59), apps/desktop/AGENTS.md (desktop:build:windows plus the TARGET_TRIPLE switch in sidecar-stage.sh), apps/server/AGENTS.md (per-target libsql legs and path-bootstrap platform awareness), packages/acp/AGENTS.md (pathCandidates, the quoted stdio target grammar, and the child-registry killTarget/windowsGroupReapWarning reap contract), crates/AGENTS.md (a Windows target needs no crate code, cargo xwin build output path). Root AGENTS.md left unchanged on purpose: it has no Verification section listing app builds, so there was no line to extend. bun run check:dox green.

AC#6 is now satisfied on its first disjunct: with the owner-installed makensis (v3.13) desktop:build:windows produces the real installer manobu_0.1.0_x64-setup.exe (71 MB, per-user install, WebView2 download bootstrapper). The portable folder stays as the no-installer route for a quick first boot. Remaining open work is unchanged and owner-side: run the 9-step checklist on a Windows machine, since nothing about runtime behaviour is observable from this host.

Self-contained route taken: the delivered installer now embeds the WebView2 runtime (offlineInstaller, silent), so the 275 MB manobu_0.1.0_x64-setup.exe installs with no internet on the target at all. Prerequisite for the owner's Windows run drops by one: WebView2 presence is no longer a variable, and the run-checklist step 2 is now covered by the installer itself.

Installer regenerated on this host after TASK-179 and TASK-180: manobu_0.1.0_x64-setup.exe, 288,798,980 B, delivered to ~/Downloads (the 01:18 build kept as `.pre-task180`). Proven from the generated target/x86_64-pc-windows-msvc/release/nsis/x64/installer.nsi: 232 distinct `packages/japanese/data/reading/*.json` entries (116 files, including the new n4-usage.json, n5-bunshou.json and n4-bunshou.json), `data/verbs-n5.json`, 8 `@libsql/win32-x64-msvc` lines, and 0 `vaporetto` paths. That last count is the point of TASK-180's placement decision: the tokenizer leg sits in `tauri.linux.conf.json`, so the installer does not pay 39 MB for a Linux `.so` it cannot load. It also means AC#8's unproven list grows one item that is now known rather than pending: a Windows install boots unicode61 and prints a short real paper (an N5 paper 15-16 小問 short, blaming `contentExhausted`) because `sqlite_vaporetto.dll` has never been cross-built. That is authoring/packaging work, not a Windows-host test gap, and it belongs to this task until the dll exists; when it does, the leg goes in `tauri.win-x64.conf.json`, not the base config. The base config's `@libsql/linux-x64-gnu` leg still rides into the Windows bundle as recorded dead weight (8 lines).
<!-- SECTION:NOTES:END -->
