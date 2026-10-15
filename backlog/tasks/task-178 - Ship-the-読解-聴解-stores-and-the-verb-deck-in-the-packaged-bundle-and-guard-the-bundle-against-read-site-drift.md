---
id: TASK-178
title: >-
  Ship the 読解/聴解 stores and the verb deck in the packaged bundle, and guard the
  bundle against read-site drift
status: Done
assignee: []
created_date: '2026-10-14 16:07'
updated_date: '2026-10-14 19:24'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 997000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The packaged app never shipped packages/japanese/data/reading or data/verbs-n5.json (apps/desktop/src-tauri/tauri.conf.json bundle.resources carried the n1..n5 bands, kanji.json, grammar/ and kanjivg/ only). resolveDataDir() still resolved because its probe file n5.json was present, readJson returns null for an absent file, so each store loaded empty and blockHasRealSource reported every store-backed 大問 as a hole. Measured over the whole grid (fullBudget, all three modes): with the store directory absent a real paper prints 43/91 at N5, 39/98 at N4, 26/102 at N3, 22/107 at N2 and 21/108 at N1, and the shortened paper loses a slot at N3 and N2. The learner sees paper.build.unfilled (apps/desktop/src/lib/paper-notice.ts) blaming the paper plan while the rows sat in the repo, and the same omission rides in the Windows installer because tauri.win-x64.conf.json deep-merges and inherits the base resource list. Nothing in the repo held "what the server opens" beside "what the bundle carries", which is why tauri build could not see it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 bundle.resources in apps/desktop/src-tauri/tauri.conf.json carries packages/japanese/data/reading and packages/japanese/data/verbs-n5.json, and both the deb tree and the generated Windows installer.nsi contain reading/n5-kadai.json (verified from the artifact, not from the config)
- [x] #2 apps/server/test/bundle-resources.test.ts fails when a resolveDataDir() read site outruns bundle.resources and passes for every current read site; the reading store filenames are derived from the exam-corpus.ts loaders so a new store needs no edit to the test
- [x] #3 With MANOBU_DATA_DIR pointed at a tree without reading/, an N5 real paper names 表記, 言い換え類義, the three 読解 大問 and all four 聴解 shapes in unfilledBlocks; with the shipped tree every level N3, N2 and N1 reports a ready real paper (N5 and N4 stay short only for the blocks TASK-179 owns)
- [x] #4 The sidecar logs a [data] warning naming the missing path when the resolved data dir lacks reading/n5.json or verbs-n5.json, and logs nothing when both are present
- [x] #5 apps/desktop/src-tauri/AGENTS.md, apps/server/AGENTS.md and packages/japanese/AGENTS.md state the invariant, and bun run check:dox is green
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add data/reading and data/verbs-n5.json to bundle.resources in tauri.conf.json (the Windows config inherits them by deep-merge). 2. Add apps/server/test/bundle-resources.test.ts: union of bundle.resources destinations across both configs versus the resolveDataDir() read list compiled from the server read sites, with the reading store filenames derived from the exam-corpus.ts loaders. 3. Log a [data] boot warning in apps/server/src/index.ts naming a missing reading/n5.json or verbs-n5.json. 4. Prove the causal grid over both data trees and rebuild the deb and nsis bundles, verifying the artifact. 5. Update the three owning AGENTS.md files.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Guard written first and confirmed red against the old config (98 unshipped read paths); green after the config edit. Causal grid measured with MANOBU_DATA_DIR over a symlink tree minus reading/ and verbs-n5.json: real papers 43/91 N5, 39/98 N4, 26/102 N3, 22/107 N2, 21/108 N1, and shortened short at N3 (29/30) and N2 (19/20). Over the full tree N3/N2/N1 real are ready and every daily paper fills; N5 (85/91) and N4 (88/98) stay short for the stores that do not exist yet, filed as TASK-179. Boot warning verified against both trees.

Final verification (all in-session): deb data.tar.gz lists 110 packages/japanese/data/reading/ entries plus reading/n5-kadai.json and data/verbs-n5.json at their install paths; the Windows stage tree (target/x86_64-pc-windows-msvc/release/packages/japanese/data) has 110 reading files and verbs-n5.json, the generated installer.nsi names reading/n5-kadai.json 110 reading lines, and manobu_0.1.0_x64-setup.exe (288,799,988 bytes, sha256 b658ecc1) replaced the stale installer in ~/Downloads. Guard test re-proven red-then-green: stripping the two legs from tauri.conf.json fails bundle-resources.test.ts:138 with 98 received vs 1 expected, and the restored config (sha256 verified identical) gives 3 pass. Boot warning re-proven against the packaged usr/bin/server: MANOBU_DATA_DIR at a tree without the stores prints [data] .../reading/n5.json is missing and [data] .../verbs-n5.json is missing, and prints nothing against the packaged resource tree. Gates: apps/server bun test 717 pass/1 skip/0 fail (81,927 expects), check-types 14/14, mutation-gate --check all 217 anchors resolve, fallow boundary-violations [], check:dox complete, ultracite clean.

Post-closeout, two facts in this task record are superseded and neither changes its verdict. The shipped `data/reading` directory is now 116 files, not 110: TASK-179 added `n4-usage.json`, `n5-bunshou.json`, `n4-bunshou.json` and the three `*-rejected.json` ledgers, and because the bundle leg is a directory mapping the new stores ride along with no config change (proven on the rebuilt deb payload: 116 `packages/japanese/data/reading/*.json`). And the real-paper grid it reports (N5 85/91, N4 88/98) is the pre-TASK-179 measurement; with the stores present the packaged binary assembles N5 91/91, N4 98/98 and N3 102/102 ready. TASK-180 also moved the `resources/vaporetto` leg out of `tauri.conf.json` into `tauri.linux.conf.json`, which is why `bundle-resources.test.ts` now reads three configs instead of two.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The packaged app shipped without packages/japanese/data/reading (110 読解/聴解 store files) and data/verbs-n5.json, so every store-backed 大問 loaded empty and the receipt blamed the paper plan: a real paper printed 43/91 at N5 up to 21/108 at N1, and the shortened paper lost a slot at N3 and N2. Fix: both legs added to bundle.resources in apps/desktop/src-tauri/tauri.conf.json (tauri.win-x64.conf.json inherits them by deep-merge), a new apps/server/test/bundle-resources.test.ts that diffs the union of both configs' resource destinations against every path the server opens under resolveDataDir() (reading-store filenames derived from the exam-corpus.ts loaders, so a new store needs no test edit), and a [data] boot warning in apps/server/src/index.ts naming a missing leg. Verified from the artifacts, not the config: the deb data archive and the Windows stage tree each carry 110 reading files plus verbs-n5.json, and the regenerated installer.nsi names reading/n5-kadai.json. Re-measured over the grid with the stores present, N3/N2/N1 real papers are ready and every daily mode fills; N5 85/91 and N4 88/98 stay short only for the 文章の文法 and 用法 stores that do not exist yet, which TASK-179 owns. Corrected Windows installer delivered to ~/Downloads; owner-side install on a real machine still folds into TASK-177's checklist.
<!-- SECTION:FINAL_SUMMARY:END -->
