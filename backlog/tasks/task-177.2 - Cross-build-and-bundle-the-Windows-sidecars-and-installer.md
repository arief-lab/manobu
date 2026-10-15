---
id: TASK-177.2
title: Cross-build and bundle the Windows sidecars and installer
status: Done
assignee: []
created_date: '2026-10-14 12:47'
updated_date: '2026-10-14 14:57'
labels: []
dependencies:
  - TASK-177.1
parent_task_id: TASK-177
ordinal: 995000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Nothing in the build path can produce a Windows artifact today: apps/desktop/scripts/sidecar-stage.sh:47 pins TARGET_TRIPLE=x86_64-unknown-linux-gnu, apps/server/package.json:9 only has compile:linux, tauri.conf.json:33 bundles deb/appimage/rpm only, and the libsql resource at tauri.conf.json:40 points at the linux-x64-gnu store path while bun install only materializes the host platform optional dependency. crates/jlpt-mcp needs no code (no libc, build.rs only gzips JSON into OUT_DIR), so the work is configuration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 apps/server has a compile:windows script producing dist/server-x86_64-pc-windows-msvc.exe from bun build --compile --target=bun-windows-x64, without --bytecode
- [x] #2 sidecar-stage.sh takes the target triple from the caller, derives the exe suffix for windows triples, builds jlpt-mcp with --target, and still fails the build when a staged sidecar is stale
- [x] #3 The nsis target and the win32 libsql resource leg live in a separate apps/desktop/src-tauri/tauri.win-x64.conf.json merged over the base config by --config, so the linux bundle.targets stays deb/appimage/rpm and the win32 leg resolves to a real store path created by bun install --os=windows --cpu=x64
- [x] #4 A desktop:build:windows script runs the cross build without putting a POSIX env prefix or a cross-env dependency on the linux script
- [x] #5 The bundler's generated manifest (target/x86_64-pc-windows-msvc/release/nsis/x64/installer.nsi) installs app.exe plus server.exe and jlpt-mcp.exe renamed from the triple-named staged files, with node_modules/@libsql/win32-x64-msvc, assistant/ and packages/japanese/data/*, and every source file it references exists on disk
- [x] #6 Either an NSIS installer exists on this host, or the task records that makensis is AUR-only and names the portable-folder fallback and the Windows-host command
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#2 freshness guard proven both directions on the windows triple: TARGET_TRIPLE=x86_64-pc-windows-msvc sidecar-stage.sh --check FAILED with 'server: staged mtime 2026-10-14 13:38:25 UTC predates source packages/acp/src/child-registry.ts 14:03:40' (a real staleness the edit caused), and after a rebuild the same command exits 0 with 'all staged sidecars fresh'.

AC#5 proven from the bundler's own generated manifest, not the config: target/x86_64-pc-windows-msvc/release/nsis/x64/installer.nsi references 25 source paths, all present on disk, and installs app.exe plus server.exe / jlpt-mcp.exe (renamed via /oname from the triple-named staged files), node_modules/@libsql/win32-x64-msvc, assistant/, packages/japanese/data/*. Extracting the finished .exe is impossible while makensis is missing.

AC#6 recorded blocker: no makensis on this host. which makensis -> not found; pacman -Si nsis -> 'package nsis was not found', so it is AUR-only (paru -S nsis, needs sudo this session does not have). wine is also absent, so the official NSIS zip route needs a Wine install too. bun run desktop:build:windows now runs the whole pipeline green (cargo-xwin link, sidecar stage, exe patched with bundle type info: nsis, plugin DLL staged) and dies only at 'Running makensis to produce .../bundle/nsis/manobu_0.1.0_x64-setup.exe' with 'failed to run command makensis.exe: No such file or directory'. The error string says makensis.exe on every host; upstream invokes plain makensis on non-Windows, so no .exe alias helps.

Known wart left in place: --config deep-merges, so the Windows installer also carries node_modules/@libsql/linux-x64-gnu (9.3 MB) from the base config. Tauri cannot unset a resource map key from a merge, and the extra leg is inert at runtime.

Portable-folder fallback (no makensis needed, layout taken from installer.nsi): a directory holding apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/app.exe, apps/server/dist/server-x86_64-pc-windows-msvc.exe renamed server.exe, crates/jlpt-mcp/dist/jlpt-mcp-x86_64-pc-windows-msvc.exe renamed jlpt-mcp.exe, and beside them assistant/, node_modules/@libsql/win32-x64-msvc/, packages/japanese/data/. The plain names are not cosmetic: lib.rs bundled_jlpt_mcp_path and shell.sidecar("server") resolve them beside the exe, which is what the deb and this NSI both install. Unproven until a Windows box runs it: that the folder boots.

Windows-host command (the other route to a real installer): install NSIS there (choco install nsis) and run the bundler natively. Do NOT copy desktop:build:windows to a Windows shell: it passes --runner cargo-xwin and a --target triple that a native MSVC host does not need, and sidecar-stage.sh hardcodes CARGO_CMD=(cargo xwin build ...) for the msvc triple. The stage script carries a note that a Windows build host needs its own triple case; nothing here is tested on a Windows host, so that change belongs to whoever makes it.

BLOCKER CLEARED 2026-10-14: the owner installed NSIS (makensis v3.13 at /usr/bin/makensis). bun run desktop:build:windows now completes, EXIT=0, producing apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/manobu_0.1.0_x64-setup.exe (71,239,341 bytes; file reports PE32 GUI, Nullsoft Installer self-extracting archive). Spike 0b is answered by that run: a Linux makensis loads and calls the Windows PE plugin nsis_tauri_utils.dll, only warning 5202 (-OUTPUTCHARSET ignored on non-Win32). Generated installer facts: INSTALLMODE currentUser (per-user, no UAC), WEBVIEW2 mode downloadBootstrapper (both paths empty), so the target machine needs internet at install unless the WebView2 Runtime is already present.

Payload proof stayed at the manifest, not extraction: no NSIS reader is installed here (no 7z/7za/7zr, bsdtar says Unrecognized archive format) and NSIS compresses the file table, so strings finds nothing. The proof is that installer.nsi references 25 source paths, all 25 verified present on disk, and makensis aborts the whole compile on any missing File source, which it did not. Extraction remains a Windows-side check (or install p7zip here).

Owner asked for a self-contained installer (2026-10-14). tauri.win-x64.conf.json now sets bundle.windows.webviewInstallMode = { type: offlineInstaller, silent: true }. Rebuild green (EXIT=0): bundle/nsis/manobu_0.1.0_x64-setup.exe is 275 MB, up from 71 MB, because the ~205 MB MicrosoftEdgeWebView2RuntimeInstallerX64.exe is embedded (the bundler fetched it from go.microsoft.com fwlink 2124701 and cached it at ~/.cache/tauri/x64/7c7c0e6f-.../, so later builds need no network for it). Verified in the regenerated installer.nsi: INSTALLWEBVIEW2MODE offlineInstaller, WEBVIEW2INSTALLERPATH the cached file, WEBVIEW2INSTALLERARGS /silent, and the Section WebView2 that reads the EdgeUpdate client key (HKLM WOW6432Node, HKLM, then HKCU) and skips the whole thing when a runtime is already present. INSTALLMODE stays currentUser.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Made the build path able to produce a Windows artifact from this Linux host. apps/server gains compile:windows (bun build --compile --target=bun-windows-x64, no --bytecode, matching the linux recipe); apps/desktop/scripts/sidecar-stage.sh takes TARGET_TRIPLE and switches four dependent facts at once (compile script, cargo output dir, cargo-xwin linker driver, .exe suffix) while keeping the GNU stat/sha256sum/find idioms because the build host is Linux; apps/desktop/src-tauri/tauri.win-x64.conf.json adds the nsis target and the win32 libsql resource leg by deep merge so the linux config stays deb/appimage/rpm; apps/desktop/package.json gains desktop:build:windows. Verified end to end with the final tree: sidecar stage exits 0 and its staleness guard is proven to fail on a real stale staged binary, cargo-xwin links app.exe (PE32+ GUI) and jlpt-mcp.exe, the server cross-compiles to a 97 MB PE, and the generated installer.nsi references 25 source paths with all 25 present. NOT delivered: the installer .exe itself, because makensis is absent here and nsis is not in the Arch sync DB (AUR-only, needs sudo) - the pipeline stops at 'Running makensis' and nothing downstream of it is proven. Also unproven: that the packaged app runs on Windows.
<!-- SECTION:FINAL_SUMMARY:END -->
