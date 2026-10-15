---
id: TASK-180
title: >-
  Packaged app runs unicode61: ship the vaporetto tokenizer assets and resolve
  them in the bundle layout
status: Done
assignee: []
created_date: '2026-10-14 18:44'
updated_date: '2026-10-14 19:27'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 999000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while verifying TASK-178 on the delivered AppImage. A fresh packaged install printed an N5 real paper 15-16 小問 short and blamed `contentExhausted`; 文脈規定 and 文の組み立て landed zero while every store-backed 大問 landed whole. Cause: the sqlite-vaporetto tokenizer never loads in a bundle, so `apps/server/src/services/exam-mask.ts` cannot segment Japanese and reports every derived candidate unmaskable (`apps/server/src/services/content-tokenizer.ts:26`). Two independent defects: the assets were never listed in `bundle.resources`, and the packaged branch of the resolver was unreachable by construction.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 - The bundle carries the assets: apps/desktop/src-tauri/tauri.linux.conf.json:5 maps "resources/vaporetto": "resources/vaporetto" (ext/libsqlite_vaporetto.so 6.8 MB + model/bccwj-suw+unidic_pos+kana.model.zst 32 MB), and the `bundle resources carry the tokenizer assets` block in apps/server/test/bundle-resources.test.ts goes RED when that line is removed (proven red-then-green in this task). The leg is in the Linux platform file, not tauri.conf.json, because the config merge can only ADD: declaring it in the base would push 39 MB of unloadable Linux bytes into the Windows NSIS installer. That placement is pinned by `keeps the leg on the platform whose loader can open it` (apps/server/test/bundle-resources.test.ts:207).
- [x] #2 - The resolver finds the packaged layout: `assetRootFor` (packages/db/src/vaporetto.ts:60) returns the asset root for the repo marker AND for `<resource dir>/resources/vaporetto/ext`, pinned by packages/db/test/vaporetto-layout.test.ts. The old branch returned a fake repo root that VAPORETTO_EXT_DIR/VAPORETTO_MODEL_DIR (packages/db/src/vaporetto.ts:91) then re-appended the repo path to, so a bundle that DID stage the assets still booted unicode61.
- [x] #3 - A packaged boot prints a full paper: the sidecar launched from its own resource dir against a fresh database logs `[db] migrations applied (tokenizer=vaporetto, vaporetto=true)` and exam.assemble for N5 real answers ready=true, totalSlots=91, shortfall=0, unfilledBlocks=[], contentExhausted=false. Negative control: with the staged assets moved aside the same boot logs unicode61 and the paper comes up short again.
- [x] #4 - The silent failure is written down where the next reader meets it: apps/desktop/src-tauri/AGENTS.md Bundling and packages/db/AGENTS.md vaporetto resolution both state that a missing tokenizer freezes FTS at unicode61 and drains 文脈規定 and 文の組み立て into a `contentExhausted` receipt.
- [x] #5 - Windows stays open and is stated, not hidden: `sqlite_vaporetto.dll` (EXT_FILENAME_BY_PLATFORM, packages/db/src/vaporetto.ts) has never been cross-built, the NSIS bundle does not carry a Linux .so, so TASK-177's installer keeps this hole until a dll is produced.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Measured on the delivered AppImage (TASK-178's own artifact), all against a clean database:\n\n1. Running desktop sidecar: exam.assemble N5 real -> ready=false, 76/91, shortfall=15, contentExhausted=true, unfilledBlocks=[]; landed types carried every store-backed 大問 (discourse-cloze 5, word-spelling 8, sentence-paraphrase 5, short/medium/info 3/2/1, all four 聴解 shapes 24) but context-cloze 0 and star-ordering 0.\n2. The same data tree and pools are shipped (examCorpus() reports vocab N5:698 / grammar N5:77 in both the repo and the extracted AppImage), so the bundle-of-JSON leg from TASK-178 was NOT the cause.\n3. The packaged binary alone, cwd = its resource dir, MANOBU_DATA_DIR = its own tree, logs [db] migrations applied (tokenizer=unicode61, vaporetto=false) and assembles 75/91. With SQLITE_VAPORETTO_EXT/SQLITE_VAPORETTO_MODEL pointed at the repo assets the SAME binary on the SAME tree logs vaporetto=true and assembles 91/91 ready.\n4. Staging resources/vaporetto into the bundle without any env did NOT fix the old resolver (still unicode61): the packaged branch returned join(dir,'resources/vaporetto','..','..','..') and the callers re-appended the repo path. Fix = return the asset root; exports renamed VAPORETTO_EXT_DIR / VAPORETTO_MODEL_DIR; negative control (staged dir moved aside) returns to unicode61.\n\nChanged: packages/db/src/vaporetto.ts (assetRootFor + __test__ seam), packages/db/test/vaporetto-layout.test.ts (new), apps/desktop/src-tauri/tauri.conf.json:40, apps/server/test/bundle-resources.test.ts (new describe block; verified red with the config line deleted), and the three AGENTS.md notes. Tests: packages/db 42/0, apps/server 725/0, mutation-gate --check 217 anchors, ultracite clean.

Placement correction after the first rebuild: the leg was declared in apps/desktop/src-tauri/tauri.conf.json (base config), but Tauri deep-merges platform files over the base and a merge can only ADD, so a base declaration would have carried 39 MB of Linux-only `.so`+model into the Windows NSIS installer, where no loader can open them. It now lives in the new apps/desktop/src-tauri/tauri.linux.conf.json:5 (`"resources/vaporetto": "resources/vaporetto"`), and the guard test reads all three configs (`CONFIGS`, apps/server/test/bundle-resources.test.ts:45-49) with a dedicated assertion `keeps the leg on the platform whose loader can open it` (apps/server/test/bundle-resources.test.ts:207) that fails if the destination appears in the base. The Linux output is byte-identical either way (130,367,496 B deb before and after); only the Windows bundle changes.

Final delivered-artifact proof, all three rebuilt against the final config (deb 02:06, rpm 02:14, AppImage 02:18) and read from the artifacts, not the staging trees: `bsdtar -tf` of the deb payload lists 8 `resources/vaporetto` entries, 116 `packages/japanese/data/reading/*.json` and `verbs-n5.json`; the same listing of the rpm gives 5 vaporetto files, 116 reading entries and `verbs-n5.json`; the AppImage extracted with `--appimage-extract` carries `usr/lib/manobu/resources/vaporetto/ext/libsqlite_vaporetto.so`, the BCCWJ+UniDic model, 116 reading files and the verb deck.

AC#3 re-run on the final AppImage binary (`usr/bin/server`, cwd = `usr/lib/manobu`, no vaporetto env, fresh database): `[db] migrations applied (tokenizer=vaporetto, vaporetto=true)` and `POST /rpc/exam/request` + `/rpc/exam/assemble` give N5 real ready=true 91/91 shortfall=0 contentExhausted=false unfilledBlocks=[], N4 98/98 ready, N3 102/102 ready. Owner-side UI proof on the same AppImage with a clean XDG profile: the paper screen reads "Paper ready / 3 sections · 91 items".

Delivery: `~/Downloads` holds the new `manobu_0.1.0_amd64.deb` (130,367,496 B), `manobu-0.1.0-1.x86_64.rpm` (130,386,723 B) and `manobu_0.1.0_amd64.AppImage` (220,154,360 B); the superseded 01:18 set is kept beside them as `.pre-task180`, not deleted.

Windows bundle re-proven after the placement move, from the generated script rather than the config: `bun run desktop:build:windows` regenerated target/x86_64-pc-windows-msvc/release/nsis/x64/installer.nsi, which names 0 `vaporetto` paths (against 232 distinct `data/reading/*.json` entries and 8 `@libsql/win32-x64-msvc` lines), so the Linux-only `.so`+model no longer rides into the installer. The same merge already carries the base config's `@libsql/linux-x64-gnu` leg into the NSIS bundle (8 lines), which is the pre-existing dead weight `apps/desktop/src-tauri/AGENTS.md` records and the reason a Linux-only leg belongs in `tauri.linux.conf.json`. New installer manobu_0.1.0_x64-setup.exe (288,798,980 B) delivered to ~/Downloads; the 01:18 build kept beside it as `.pre-task180`. Windows still has no `sqlite_vaporetto.dll`, so a Windows install boots unicode61 and prints a short real paper until one is cross-built.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A packaged install ran unicode61, so `apps/server/src/services/exam-mask.ts` could not segment Japanese and every derived candidate came back unmaskable: an N5 real paper printed 75-76/91 with 文脈規定 and 文の組み立て at zero and the receipt blamed `contentExhausted`, while every store-backed 大問 landed whole. Two independent defects, both now fixed.

1. The tokenizer assets were never bundled. `apps/desktop/src-tauri/tauri.linux.conf.json:5` maps `resources/vaporetto` to `resources/vaporetto`, which is where `packages/db/src/vaporetto.ts` walks for it and where `lib.rs` points the sidecar cwd. It is in the Linux platform file, not the base config, because a Tauri platform override only ever adds: declared in `tauri.conf.json` it would push 39 MB of Linux `.so`+model into the Windows installer, where no loader can open them. `apps/server/test/bundle-resources.test.ts:207` pins both halves of that (present in linux, absent in base).
2. Even staged, the packaged branch was unreachable: `assetRootFor` returned a fake repo root that `VAPORETTO_EXT_DIR`/`VAPORETTO_MODEL_DIR` re-appended the repo path to. It now returns the asset root, and `packages/db/test/vaporetto-layout.test.ts` pins both layouts (3 pass).

Proven at the artifact boundary, not from the config. Extracted AppImage `usr/bin/server`, cwd = its own resource dir, no vaporetto env, fresh database: `[db] migrations applied (tokenizer=vaporetto, vaporetto=true)` and `exam.assemble` gives N5 real 91/91 ready, N4 98/98, N3 102/102, each with shortfall=0, contentExhausted=false and unfilledBlocks=[]. Negative control (staged assets moved aside) returns to unicode61 and a short paper. The deb payload lists 8 vaporetto entries, 116 reading files and `verbs-n5.json`; the rpm lists 5, 116 and the verb deck; the regenerated `installer.nsi` names 0 vaporetto paths against 232 reading entries, which is the placement working. Owner-side UI on the AppImage with a clean XDG profile reads "Paper ready / 3 sections · 91 items".

Delivered to ~/Downloads: deb 130,367,496 B, rpm 130,386,723 B, AppImage 220,154,360 B, NSIS exe 288,798,980 B, with the superseded 01:18 set kept as `.pre-task180`. Windows keeps the hole until a `sqlite_vaporetto.dll` is cross-built (TASK-177), and an existing database whose FTS tables froze at unicode61 needs the upgrade path in `migrate.ts::upgradeFtsTokenizerToVaporetto` to run, which it does when the extension loads. Gates: bundle-resources 6/6, vaporetto-layout 3/3, apps/server reading/bunshou/youhou files 58/0, check-types 14/14, mutation-gate --check 217 anchors, fallow boundary-violations [], check:dox complete, ultracite clean.
<!-- SECTION:FINAL_SUMMARY:END -->
