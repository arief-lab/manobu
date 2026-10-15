---
id: TASK-176
title: 'Mutation gate: a killed run leaves its in-flight mutation in the tree'
status: Done
assignee: []
created_date: '2026-10-14 10:42'
updated_date: '2026-10-14 10:49'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 992000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An interrupted full gate run skipped the restore in scripts/mutation-gate.ts and left apps/server/src/chat-persistence.ts:121 holding the host-tool-claim-not-carried mutation for days. The symptom was a pre-commit anchor failure reading as "the seam moved", which is the wrong diagnosis: the seam is fine, the file is dirty, and a run started against it would score the mutation against code its anchor does not describe. AGENTS.md told the reader this could not happen ("every file is restored in a finally"), which is exactly the claim a SIGKILL falsifies.

Context a future agent cannot recover from the code: the first fix installed SIGINT/SIGTERM handlers and they had to be thrown away. runTests blocks inside spawnSync for the entire window in which a file is mutated, and a JS signal handler cannot fire there. Measured 2026-10-14: SIGTERM at t=1s of a 4s spawnSync printed nothing from the handler and the process exited 0. So recovery has to be an on-disk journal written BEFORE the mutating write, which also covers SIGKILL and a machine losing power.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A run killed mid-mutation leaves .cache/mutation-gate-journal.json, and the next scripts/mutation-gate.ts --check restores the file, prints which file it recovered, exits on all anchors resolving, and leaves the git tree clean
- [x] #2 A mutating run refuses to start (exit 1) when git status --porcelain reports any selected seam file dirty, names the files, and tells the reader how to restore or override; --allow-dirty proceeds
- [x] #3 The dirty check fails closed: if git status itself errors, the run exits 1 rather than reporting the seam files clean
- [x] #4 The journal is consumed by the restore: an uninterrupted run leaves no .cache/mutation-gate-journal.json behind
- [x] #5 Recovery runs before the --check anchor resolution, so a leftover mutation is never reported as a stale seam
- [x] #6 The root AGENTS.md mutation-gate paragraph no longer claims the finally guarantees a clean tree, and documents the journal and the dirty-run refusal
- [x] #7 bun x ultracite check, bun run check-types, bun run check:dox pass, scripts/mutation-gate.ts --check resolves every anchor, and a seam run still gets CAUGHT on an unmuted-clean tree
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Journal the pre-mutation content to .cache/mutation-gate-journal.json BEFORE the mutating write, and delete it in the restore path, so a death between the two has a restore that is a no-op.
2. Heal at the very top of main(), before the --check anchor resolution, so a leftover never reads as a stale seam.
3. Refuse a mutating run when git status --porcelain reports a selected seam file dirty; --allow-dirty overrides; a git status failure exits 1 (fail closed).
4. Drop the signal handlers: measured that they cannot fire while spawnSync blocks.
5. Rewrite the root AGENTS.md mutation-gate paragraph to match what the code now does.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in scripts/mutation-gate.ts: JOURNAL const + journalFor/healJournal above applyOnce; applyOnce journals before writeFileSync; evaluate's finally restores then rmSync(JOURNAL); seamFiles/dirtySeamFiles + the !allowDirty refusal in main(); --allow-dirty flag added.

Evidence (all on the real gate, 217 anchors):
- SIGKILL (exit 137) mid-seam on host-tool-claim-not-carried left apps/server/src/chat-persistence.ts containing the mutation AND .cache/mutation-gate-journal.json present.
- bun scripts/mutation-gate.ts --check then printed 'recovered a mutation left by a killed run: apps/server/src/chat-persistence.ts restored from .cache/mutation-gate-journal.json' followed by 'all 217 seam anchor(s) resolve'; git tree clean, journal consumed.
- Dirty seam file with no journal: run refused, exit 1, named the file.
- --allow-dirty: proceeded and wrote nothing when the anchor did not resolve.
- Clean single-seam run and the 7-seam 'label' filter run: every seam CAUGHT, no journal residue.
- Signal-handler approach was implemented first and thrown away: /tmp probe (SIGTERM at t=1s of a 4s spawnSync) printed nothing from the handler and exited 0.

Post-refactor re-verification on the committed code (7be6377):
- SIGKILL evidence was gathered before the last two edits; the heal path was then re-proven by planting the exact leftover (chat-persistence.ts mutated + a journal holding HEAD content). bun scripts/mutation-gate.ts --check printed 'recovered a mutation left by a killed run: apps/server/src/chat-persistence.ts restored from .cache/mutation-gate-journal.json', then 'all 217 seam anchor(s) resolve'; git status for the file clean, journal consumed.
- Stale journal (target file absent): printed 'dropped a journal for ...: that file is gone', consumed the journal, created no file. The existsSync guard was added because writeFileSync would otherwise resurrect a deleted source path from a stale record.
- Torn (empty) journal: dropped silently, run continued.
- Fail-closed git status: GIT_DIR=/nonexistent-git-dir bun scripts/mutation-gate.ts sidecar exited 1 with '! git status failed (...); cannot prove the seam files are clean' instead of reporting clean.
- Dirty seam file: exit 1 naming apps/desktop/src/lib/sidecar-ready.ts and the restore/override instructions; --allow-dirty proceeds.
- Clean seam run host-tool-claim-not-carried: 'all 1 mutation(s) caught', no journal residue. bun x ultracite check, standalone tsc --noEmit on the script, bun run check-types (14/14), bun run check:dox, bun scripts/mutation-gate.ts --check (217 anchors) all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
scripts/mutation-gate.ts now survives being killed mid-seam. applyOnce writes the pre-mutation content to .cache/mutation-gate-journal.json before mutating (journal first, restore second, unlink third), and main() applies any journal before it does anything else, including --check, so a leftover heals instead of reporting a stale anchor; a journal whose target file is gone is dropped rather than written back. A mutating run additionally refuses to start when git status --porcelain names a selected seam file dirty (--allow-dirty overrides), and it exits 1 rather than reporting clean if git status itself fails. Recovery is a journal and not a signal handler because runTests blocks in spawnSync for the whole window a file is mutated, measured: SIGTERM at t=1s of a 4s spawnSync never ran the handler and exited 0.

Verification: planted leftover healed by --check with 'recovered a mutation left by a killed run' then 'all 217 seam anchor(s) resolve' and a clean tree; stale and torn journals dropped with no file resurrected and no residue; GIT_DIR=/nonexistent-git-dir run exited 1 on the fail-closed message; dirty seam file refused with exit 1 naming it; host-tool-claim-not-carried re-run on a clean tree reported 'all 1 mutation(s) caught' with no journal left. bun x ultracite check, tsc --noEmit on the script, bun run check-types (14/14), bun run check:dox all green. Root AGENTS.md mutation-gate paragraph rewritten (the 'a crash never leaves the tree dirty' claim was false). Committed as 7be6377.
<!-- SECTION:FINAL_SUMMARY:END -->
