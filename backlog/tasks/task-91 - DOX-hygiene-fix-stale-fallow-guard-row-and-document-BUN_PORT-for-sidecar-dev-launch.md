---
id: TASK-91
title: >-
  DOX hygiene: fix stale fallow guard row and document BUN_PORT for sidecar dev
  launch
status: Done
assignee:
  - '@arif'
created_date: '2026-09-21 08:51'
updated_date: '2026-09-21 08:54'
labels:
  - docs
dependencies: []
ordinal: 742000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two stale docs spots found while working TASK-87. (1) Root AGENTS.md line ~141 tells agents to run `fallow guard <files>` before changing a file, but the installed fallow has no guard subcommand (`unrecognized subcommand`), so agents following the doc hit a dead end; the pre-push `fallow audit` gate itself is fine. (2) The sidecar port is read from BUN_PORT (apps/server/src/index.ts, default :3000, sidecar :4317), NOT PORT. Manual dev launches that export PORT=4317 silently serve :3000 and /ai hangs on the loader because the desktop expects :4317; neither apps/server/AGENTS.md verification/launch notes nor the root doc mention this, so the fact lives only in a source comment.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Root AGENTS.md no longer lists fallow guard: the table row is removed or replaced with a command the installed fallow actually offers (verify with fallow --help), and any other guard mentions across AGENTS.md files are updated the same way
- [ ] #2 apps/server/AGENTS.md states that bun serves on BUN_PORT (default :3000, desktop sidecar :4317) and that PORT is ignored, placed where an agent launching the sidecar for dev or smoke would read it
- [ ] #3 Both edits are docs-only: no source, config, or test changes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Root AGENTS.md: replace the fallow guard row with the real command fallow list --boundaries (verified against fallow --help and a live run: 18 zones, rules, per-zone globs).
2. apps/server/AGENTS.md Scripts section, under dev: document that the port comes from BUN_PORT (src/index.ts: sidecar :4317, smoke :4399, default :3000) and PORT is ignored.
3. Docs-only: git status check that no source/config/test files changed; re-grep AGENTS.md files for remaining guard mentions.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root AGENTS.md:141 guard row replaced with 'fallow list --boundaries' — confirmed the command exists (fallow --help lists it under Project inspection) and runs clean here (18 zones, 17 rules, per-zone file globs printed). Repo-wide grep for 'fallow guard' across AGENTS.md files now returns none. apps/server/AGENTS.md Scripts section gained a Port bullet stating bun reads BUN_PORT not PORT (src/index.ts:191 Number(process.env.BUN_PORT ?? 3000)); cross-checked the sidecar really sets BUN_PORT=4317 (src-tauri/src/lib.rs:177 .env(BUN_PORT, SIDECAR_PORT), dev comment line 18). git status confirms docs-only: exactly the two AGENTS.md files modified, no source/config/test touched.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Two stale DOX spots fixed, docs-only. (1) Root AGENTS.md fallow table no longer advertises the non-existent 'fallow guard <files>' row; it now points to 'fallow list --boundaries', the real command that prints the boundary zones, their rules, and per-zone file globs (verified via fallow --help and a live run: 18 zones, 17 rules). (2) apps/server/AGENTS.md Scripts now carries a Port bullet: the server reads BUN_PORT (default :3000; Tauri sidecar :4317 via lib.rs, smoke :4399) and PORT is ignored, so a manual sidecar-port dev launch must be 'BUN_PORT=4317 bun run dev' or the desktop's /ai loader hangs. Verified: repo grep finds no remaining 'fallow guard'; BUN_PORT=4317 confirmed in src-tauri/lib.rs:177; git status shows only the two AGENTS.md files changed (AC#3).
<!-- SECTION:FINAL_SUMMARY:END -->
