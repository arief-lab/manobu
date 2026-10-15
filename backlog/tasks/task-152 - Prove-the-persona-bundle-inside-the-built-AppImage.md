---
id: TASK-152
title: Prove the persona bundle inside the built AppImage
status: Done
assignee:
  - '@Buffy'
created_date: '2026-09-28 03:17'
updated_date: '2026-10-13 01:50'
labels:
  - appimage
  - release
  - assistant
dependencies:
  - TASK-151
references:
  - doc-24
priority: low
type: task
ordinal: 917000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The persona directory is packaged but nobody has seen it resolve in a packaged app. tauri.conf.json maps `../../../assistant` to the `assistant` resource; apps/server/src/assistant-loader.ts:84 reads `MANOBU_ASSISTANT_DIR` first and otherwise probes dev and binary paths, ending at the message on :212, "no assistant/*.md found (MANOBU_ASSISTANT_DIR unset, dev/binary paths missed): using embedded Sensei fallback". That fallback printed during the QA pass, and the local apps/server/.env value pointed at /home/arif/Projects/... while the repo lives at /home/arif/Work/Projects/..., so dev has been running on the embedded persona while looking like it was running on the files.

The release risk is the silent half of this: an AppImage whose resource path does not resolve boots fine and teaches from one hard-coded persona, and the log line is the only trace. The question this task answers is empirical, not code: does the shipped bundle actually resolve its personas on a machine with no repo checkout? Correcting the stale dev .env is a side effect, and .env is never committed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The sidecar log at boot states which persona directory it resolved, and the embedded fallback is distinguishable from a resolved directory in that line
- [x] #2 A built AppImage run without the repo checkout loads a persona from the bundled assistant resource and reports the resolved path
- [x] #3 The dev apps/server/.env value points at a path that exists, or the variable is dropped in favour of the dev probe
- [x] #4 A missing persona bundle is not silently survivable: the app still boots on the fallback, and the task records what a user would see if it happened
- [x] #5 The list of personas the packaged app offers matches the files actually shipped in the bundle
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Empirical verification, no product-code change expected. The loader already prints the resolved dir + slugs at boot (assistant-loader.ts:206) vs the distinct fallback warning (:212) — AC#1 is proven by capturing both lines in real runs, not by editing.

1. AC#2 + AC#5 + AC#1(resolved leg): extract the built AppImage (apps/desktop/src-tauri/target/release/bundle/appimage/manobu_0.1.0_amd64.AppImage) with --appimage-extract into a temp dir OUTSIDE the repo checkout. Boot the packaged server binary with the env lib.rs would hand it (MANOBU_ASSISTANT_DIR=<extract>/usr/lib/manobu/assistant, DATABASE_URL + CORS_ORIGIN + BUN_PORT to /tmp-local values), poll readiness, capture the [assistant] loaded line: it must name the temp path and the bundled slugs. Then GET /assistants and diff the returned slugs against ls <extract>/usr/lib/manobu/assistant/*.md AND against repo assistant/*.md (polite-san, sensei).
2. AC#4(missing bundle): in that same /tmp extraction, rename the assistant resource dir away, unset/point MANOBU_ASSISTANT_DIR at the missing dir, reboot the packaged server: expect the :212 fallback warning, boot still succeeds, GET /assistants serves exactly the embedded sensei. Record in task notes what the user would see (app teaches from one hardcoded Sensei; the only trace is the sidecar stderr warning; the persona picker loses polite-san).
3. AC#3: fix apps/server/.env MANOBU_ASSISTANT_DIR to the real repo path /home/arif/Work/Projects/mano/manobu-gg/assistant (file is gitignored, never committed; .env.example:48 documents the raw var).
4. Closeout: re-check the DOX chain (apps/server/AGENTS.md Personas section already documents resolution order; likely no doc change), ultracite/gates if any tracked file changes, one commit only if a tracked file changes, backlog finalization + Done.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification (all empirical, packaged binary from apps/desktop/src-tauri/target/release/bundle/appimage/manobu_0.1.0_amd64.AppImage extracted to /tmp/t152-verify/squashfs-root, no repo access):
- AC#1: the two boot lines are structurally distinct and both were captured live. Resolved: "[assistant] loaded 2 persona(s) from <dir>: polite-san, sensei" (assistant-loader.ts:206). Fallback: "[assistant] no assistant/*.md found (MANOBU_ASSISTANT_DIR unset, dev/binary paths missed) — using embedded Sensei fallback" (:212, console.warn). No code change needed.
- AC#2: packaged server booted with env -i (HOME=/tmp fakehome, only the vars lib.rs hands it incl. MANOBU_ASSISTANT_DIR=<extract>/usr/lib/manobu/assistant, BUN_PORT=4399) OUTSIDE any repo checkout: printed the loaded line naming /tmp/t152-verify/squashfs-root/usr/lib/manobu/assistant: polite-san, sensei.
- AC#3: apps/server/.env MANOBU_ASSISTANT_DIR was /home/arif/Projects/mano/manobu-gg/assistant (that stale checkout exists on disk but has NO assistant/ dir, so the env probe was skipped and dev silently fell through to the import.meta.dir probe). Value now points at /home/arif/Work/Projects/mano/manobu-gg/assistant; dev boot (BUN_PORT=4398 bun run src/index.ts) printed the loaded line with that path. .env is gitignored, not committed.
- AC#4: with <extract>/usr/lib/manobu/assistant renamed away and MANOBU_ASSISTANT_DIR pointing at the missing dir, the packaged server still boots and serves (GET / -> 200). What a user would see: the app opens normally, chat works, but every conversation is taught by the one hard-coded Sensei persona and GET /assistants returns only {id: "sensei", description: null} - Polite-san disappears from the persona picker. The ONLY trace is the console.warn line in the sidecar's stderr, which the UI never surfaces. Not silent, but unglamorous: the degradation is visible only as a missing picker entry.
- AC#5: GET /assistants on the packaged run returned exactly polite-san + sensei; ls of the bundle's assistant dir is exactly polite-san.md + sensei.md; diff -r bundle vs repo assistant/ = identical.
Scratch /tmp/t152-verify removed after the run. No tracked file changed (only the gitignored .env), so no commit and no lint/test gate applies.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Proved the persona bundle resolves inside the built AppImage, empirically. Extracted manobu_0.1.0_amd64.AppImage to /tmp and booted the packaged sidecar with env -i (no repo checkout anywhere in the resolution path): it printed "[assistant] loaded 2 persona(s) from /tmp/.../usr/lib/manobu/assistant: polite-san, sensei" and GET /assistants served exactly the two bundled files, identical to the repo (diff -r clean) (AC#1, #2, #5). Hiding the bundle dir and rebooting: the server still boots, the distinct fallback warn (:212) prints, and the app degrades to the single embedded Sensei with Polite-san gone from the picker and no UI surface for the warning (AC#4, recorded). Fixed apps/server/.env's MANOBU_ASSISTANT_DIR, which pointed at the stale pre-move checkout /home/arif/Projects/... (a directory that exists but carries no assistant/), so dev had been falling through to the import.meta.dir probe; it now pins the real repo path and a dev boot prints the loaded line with it (AC#3). No tracked-file change, no commit; .env is gitignored.
<!-- SECTION:FINAL_SUMMARY:END -->
