---
id: TASK-151
title: 'Make the desktop release build compile and stage both sidecars, or fail'
status: Done
assignee:
  - '@Buffy'
created_date: '2026-09-28 03:17'
updated_date: '2026-10-12 19:45'
labels:
  - appimage
  - release
  - build
  - tauri
dependencies:
  - TASK-150
references:
  - doc-24
priority: low
type: task
ordinal: 916000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The release path never touches the two binaries the packaged app runs on. apps/desktop/src-tauri/tauri.conf.json:33-35 declares externalBin `../../../apps/server/dist/server` and `../../../crates/jlpt-mcp/dist/jlpt-mcp`, and `beforeBuildCommand` at :10 is `bun run build`, which is the vite build for the frontend. Nothing compiles the Bun sidecar or the Rust crate, and nothing verifies that what is already sitting in src-tauri/binaries is current. The QA pass measured the consequence: both staged sidecars were dated Sep 10 against a Sep 28 tree, and crates/jlpt-mcp/target/release/ did not exist. An AppImage built today launches cleanly and silently runs an old agent: no `start_exam`, no TASK-138 corpus picker, and no error anywhere, because the old binary is a perfectly valid binary.

This is the same failure class apps/desktop/AGENTS.md:149 already records for the offline card fallback, where an unanalyzable dynamic import shipped a bundle that worked in vite dev and silently degraded in the Tauri build. The property to buy is that a stale sidecar cannot be packaged without the build stopping. doc-24 F-2 is the finding, and doc-24's release gate treats this task as the first item.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The release path compiles apps/server and the jlpt-mcp crate in release profile, and stages both at the exact paths externalBin names
- [x] #2 The build fails when a staged sidecar is older than the newest source that produces it, or when its hash does not match the freshly built artifact
- [x] #3 Running the new guard against the current tree fails, proving the Sep 10 artifacts cannot pass it by accident
- [x] #4 The failure names which sidecar is stale and what it compared, so the reader is not left guessing
- [x] #5 The documented release recipe, followed exactly as written, produces the staged binaries it claims (README.md:99 and apps/desktop/AGENTS.md:18 are the current wording)
- [x] #6 A bundle built by this path is verified to contain the current sidecar, by checking the packaged binary rather than the source tree
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Prove the packaging toolchain exists before anything else (cargo, tauri CLI, appimagetool) - AC#6 depends on a real build. 2. Write one staging script the release path runs: apps/server compile:linux, cargo build --release -p jlpt-mcp, copy both to the externalBin-named paths with the target triple. 3. Same script gains the guard: staged-vs-fresh sha256 must match AND staged mtime must not predate the newest producing source; failure names the sidecar and both facts (AC#2/#4). 4. Run the guard check-only against the current Sep 10 artifacts first - it must exit non-zero (AC#3). 5. Wire it into beforeBuildCommand and fix the documented recipe (README + desktop AGENTS) so the recipe AS WRITTEN produces the staged binaries (AC#1/#5). 6. Run tauri build, extract the AppImage, sha256 the packaged sidecars against the fresh ones (AC#6). One commit, no push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-12 (execution): steps 1-4 done. Toolchain proven (cargo 1.96.0, tauri-cli 2.11.4; linuxdeploy AppImage plugin cached at ~/.cache/tauri; appimagetool not needed on PATH). Staging script written at apps/desktop/scripts/sidecar-stage.sh: stage mode runs apps/server compile:linux + cargo build --release, copies the crate binary to crates/jlpt-mcp/dist/jlpt-mcp-<triple> (the server compile output already lands at the externalBin-named path), then guards each staged binary (sha256 vs build output; mtime not predating newest producing source - server: apps/server/src + the eight bundled @manobu package src trees; jlpt-mcp: crate tree + the build.rs:19-47 corpus list). --check runs the guard only. Guard proven red on the pre-existing tree (missing server binary + missing crate build output, exit 1, sidecars named) and red on a touched embedded corpus file (staged-vs-source mtime pair printed); green after a full stage. Wired as beforeBuildCommand (tauri.conf.json:10 'bun run build && bash scripts/sidecar-stage.sh'); recipe fixed in README.md:111, apps/desktop/AGENTS.md (sidecar bullet), apps/desktop/src-tauri/AGENTS.md desktop:build line (binaries/ wording was wrong: externalBin resolves the dist paths). Caveat under test now: dpkg-deb and rpmbuild are absent on this Arch host, so the full deb+AppImage+rpm build may stop at bundler tool checks; AC#6 verification targets the AppImage.

AC#6 evidence: byte-equality packaged-vs-fresh is impossible (bun --compile is not byte-reproducible across runs; linuxdeploy patches RUNPATH $ORIGIN/../lib into every packaged binary), so verification is functional on the recipe-built AppImage: packaged jlpt-mcp initialize reports 0.6.0 and tools/list carries drill_candidates (Sep 10 sidecar: 0.4.0, tool absent); packaged server POST /rpc/exam/start reaches the oRPC handler (400 Input validation failed) while the Sep 10 sidecar answers 404 (rpc.ts did not exist in that build). NO_STRIP=true baked into desktop:build (linuxdeploy#272: its bundled 2024 strip cannot read Arch .relr.dyn sections). Full recipe run exited 0 producing deb+AppImage+rpm (tauri 2.11 writes deb/rpm natively; no dpkg/rpmbuild needed). Committed b36228d, not pushed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
beforeBuildCommand now runs apps/desktop/scripts/sidecar-stage.sh: compiles apps/server (compile:linux) and crates/jlpt-mcp (cargo release), stages both at the externalBin-named dist paths, and guards each staged binary (sha256 vs build output; mtime vs newest producing source including the build.rs corpus list); a stale or missing sidecar names itself with both facts and fails tauri build. Recipe wording fixed (README, desktop AGENTS, src-tauri AGENTS) and desktop:build carries NO_STRIP=true. Verified: guard red on the pre-existing tree and on a touched corpus file, green after staging; the full documented recipe produced all three Linux bundles; the extracted AppImage packages current sidecars by functional probe (jlpt-mcp 0.6.0+drill_candidates, server /rpc/exam/start routed), markers the Sep 10 binaries both lack.
<!-- SECTION:FINAL_SUMMARY:END -->
