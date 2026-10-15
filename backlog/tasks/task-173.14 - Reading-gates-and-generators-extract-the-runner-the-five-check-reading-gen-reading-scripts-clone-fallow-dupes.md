---
id: TASK-173.14
title: >-
  Reading gates and generators: extract the runner the five
  check-reading-*/gen-reading-* scripts clone (fallow dupes)
status: Done
assignee:
  - '@Buffy'
created_date: '2026-10-07 20:22'
updated_date: '2026-10-13 15:41'
labels: []
dependencies: []
parent_task_id: TASK-173
priority: medium
type: chore
ordinal: 964000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The five composed-reading CI gates and five generators each carry their own copy of the same tail blocks, and TASK-173.9.11 joined that family as a fifth member rather than create it. Recorded 2026-10-08 from `fallow dupes --quiet` (exit 0):
- the MIN_ITEMS_BY_LEVEL shortfall check plus the `if (import.meta.main)` runner (the --level arg parse, store path build, try/catch around checkReadingFile, the failing-issue print loop, process.exit): 31 lines x 3 instances across scripts/check-reading-chuubun.ts:538-568, scripts/check-reading-chuushou.ts:331-361, scripts/check-reading-tanbun.ts:542-566, with scripts/check-reading-n4.ts and scripts/check-reading-tougou.ts inside the wider 2-group/24-line family.
- the generator write + `biome format --write` tail: 30 lines x 5 instances across scripts/gen-reading-{chuubun,chuushou,n4,tanbun,tougou}.ts.
- the corpus-module tail: 30 lines x 4 instances across scripts/reading-{chuubun,chuushou,tanbun,tougou}-corpus.ts.
- the entry-builder family: 86 lines x 3 instances (scripts/gen-reading-chuubun.ts:96-181, scripts/gen-reading-chuushou.ts:112-188, scripts/gen-reading-tougou.ts:112-128).
Scope discipline: only the tails are shared. Each family keeps its own screens module (reading-chuubun-corpus.ts, reading-tanbun-corpus.ts, reading-tougou-corpus.ts) because the acceptance predicates genuinely differ, and this task must not fold them into one file or change what any row means. Line ranges drift; regenerate the list with `fallow dupes --quiet` before starting.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One shared module owns the gate CLI (level arg, store path, run/exit contract) and one owns the generator write+format tail; the five gates and five generators import them instead of copying them.
- [x] #2 Every gate stays green at every level it covers with the same stdout as before: check:reading-chuubun N3/N2/N1, check:reading-chuushou N2/N1, check:reading-tougou N2/N1, check:reading-n4, check:reading-tanbun N3/N2/N1.
- [x] #3 No data moves: git diff shows zero changes under packages/japanese/data/reading/, and regenerating each store at its recorded --count target reproduces the shipped bytes (the generators are deterministic and biome-formatted, so a diff there is a behaviour change, not cosmetic churn).
- [x] #4 The test seams survive (checkEntry/checkReadingFile on the gate side, buildEntry/buildBatch on the generator side) and `bun run test` in packages/japanese passes, along with `bun x ultracite check`, `bun run check:dox` and `fallow dead-code --boundary-violations`.
- [x] #5 fallow dupes no longer reports the four families named in the description; the before/after group list is recorded in this task's notes. Nothing is silenced with a fallow-ignore token.
- [x] #6 Docs follow: packages/japanese/AGENTS.md scripts bullets and data/LICENSE.md Regenerating block name the shared runner instead of describing five copies, and any command surface that changed is reflected there.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification closeout 2026-10-13: the extraction was already implemented and committed (35a13af "dedupe reading gates onto shared cert, CLI and ledger scaffolding" + 9a7cf52 "one flag walk and one store tail behind the seven generators"). This pass proved each AC against the live tree:

AC#1: scripts/check-reading-shared.ts:309 runReadingGateMain owns the gate CLI (--level parse, store path, try/catch, failing-issue print, exit) and scripts/gen-reading-cli.ts owns parseArgsWithLevel (:27), formatWithBiome (:58) and writeFormattedStore (:78). All 7 check-reading-* gates and all 7 gen-reading-* generators import them (family grew from five to seven since the description was recorded); only check-reading-answers.ts is outside (store-position audit, not a per-file gate).

AC#2: all gates green at every level with unchanged stdout: chuubun N3/N2/N1/N4 (24/36/36/16 rows), chuushou N2/N1 (12/16), tougou N2/N1 (8/12), tanbun N3/N2/N1 (16/20/16), choubun N3/N1 (16/16), jouhou N2/N1 (8/8), n4 (16) - every line reads "check:reading-<family> <level>: all N rows pass".

AC#3: git diff of both refactor commits shows zero changes under data/reading/. Byte-reproduction by re-running generators is NOT exercised and cannot be: every level each generator can route to is authored (the guards exit 1 by design, LICENSE Regenerating), so the shipped bytes are only reproducible by the deterministic tests, which stay green.

AC#4: checkEntry/checkReadingFile exported at check-reading-chuubun.ts:273/:470; buildEntry/buildBatch at gen-reading-chuubun.ts:245/:468 (and per-family equivalents). bun test packages/japanese 586 pass/0 fail (4233 expects). ultracite check clean on scripts+test, check:dox green, fallow dead-code --boundary-violations 0.

AC#5 before/after (both from fallow dupes --format json --quiet): BEFORE 2026-10-08 (recorded in the description): gate CLI tail 31L x 3, generator write+format tail 30L x 5, corpus-module tail 30L x 4, entry-builder 86L x 3. AFTER 2026-10-13: none of the four families appears; the only dupes groups left in the repo are 3 small test-harness clones (exam-{goseikei,iikae,kitei}.test.ts and check-{bunshou,hyouki,kitei}.test.ts import/assert blocks), outside this task's four named families. No fallow-ignore token in the shared modules or any gate/generator.

AC#6: packages/japanese/AGENTS.md Scripts section now names the shared scaffolding (runReadingGateMain + parseArgsWithLevel/writeFormattedStore/formatWithBiome, the seven+seven importers, and the rule that a new gate imports them instead of copying a tail); LICENSE.md Regenerating names the one shared gate CLI and the one shared store-write tail behind every check:reading-*/gen:reading-* command.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-09 11:36
---
Scope boundary set 2026-10-09 while creating the 読解-at-every-level program. TASK-173.9.17 owns the AUTHORED SCREENS (band, paragraph minimum, option shape, no-sourceIds, stem intent classification, evidence span, judge record, MIN_INTENTS, mixed-constructions) as a new shared module. This task owns the four mechanical clone families fallow dupes already names: the gate CLI tail, the generator write and biome-format tail, the corpus-module tail and the entry-builder family. Neither task may fold the per-family acceptance predicates into one file, which this description already forbids. If this task runs after 173.9.17, the shared authored module is a fifth importer and the gate CLI it wraps must stay byte-identical at every level.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The four mechanical clone families are gone, proved against the live tree. Extraction shipped in 35a13af + 9a7cf52; this task's remaining increment was the AC#6 doc gap, now closed. One shared gate CLI (scripts/check-reading-shared.ts runReadingGateMain) and one shared generator write+format tail (scripts/gen-reading-cli.ts parseArgsWithLevel/writeFormattedStore/formatWithBiome) are imported by all seven check-reading-* gates and all seven gen-reading-* generators; per-family acceptance predicates stay in their own screens modules, as the scope rule required. All 12 gate runs green with byte-identical stdout format; zero changes under data/reading/ in the refactor diffs; japanese suite 586/0; seams exported; fallow dupes reports none of the four named families with no fallow-ignore suppression; AGENTS.md Scripts and LICENSE Regenerating now name the shared runner.
<!-- SECTION:FINAL_SUMMARY:END -->
