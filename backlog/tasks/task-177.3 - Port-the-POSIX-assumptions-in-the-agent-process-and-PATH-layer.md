---
id: TASK-177.3
title: Port the POSIX assumptions in the agent process and PATH layer
status: Done
assignee: []
created_date: '2026-10-14 12:47'
updated_date: '2026-10-14 14:05'
labels: []
dependencies: []
parent_task_id: TASK-177
ordinal: 996000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The sidecar compiles for Windows but is silently wrong there, which is worse than failing to build. apps/server/src/path-bootstrap.ts:38 joins PATH with ":" and prepends POSIX home bin dirs, so the PATH the agents need is clobbered; packages/acp/src/index.ts:117-129 which() splits on ":" and never appends .exe or honors PATHEXT, so GET /agents returns nothing; packages/acp/src/child-registry.ts:79,87,129 kill negative process groups that Windows has no notion of, and the errors are swallowed at :124-133, so every agent child is orphaned; baseName at :109-112 splits on "/" only; packages/acp/src/mcp.ts:180-204 toMcpServer whitespace-splits a stdio target, which truncates a C:\\Program Files\\... path (the colon worry is not real: splitMcpEntry at :273-289 keeps everything after the second colon).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 path-bootstrap joins PATH with the platform separator and agentBinDirs yields the per-user bin directories that exist on Windows, not an empty filter
- [x] #2 which() on win32 splits PATH on ;, joins with the Windows path separator, and tries PATHEXT extensions, so an installed opencode.exe is found
- [x] #3 child-registry resolves basenames from both separators and the Windows kill path kills the child by pid and logs that group reaping is not implemented, instead of silently swallowing the failure
- [x] #4 toMcpServer keeps a Windows stdio target intact, including a path containing spaces, and keeps the whitespace-args behavior for a command like npx jlpt-mcp@latest
- [x] #5 Each behavior above has a unit test driving the win32 branch through an explicit platform argument (none of these suites fakes process.platform), and no test claims coverage of a path it does not exercise
- [x] #6 bun run check-types, bun x ultracite check, bun scripts/mutation-gate.ts --check and bunx fallow dead-code --boundary-violations stay green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#3 needed code, not just a reword: the plan said the Windows kill path must log that group reaping is unimplemented, and killGroupQuiet's bare catch still made a partial reap indistinguishable from a successful one. Added the pure windowsGroupReapWarning(platform) beside killTarget and a one-shot console.warn in killGroupQuiet and defaultKillGroup, so the leak is named once per process instead of per child.

Design choice across all four ports: the win32 branch is reached through an explicit platform argument (pathCandidates, killTarget, windowsGroupReapWarning, the path-bootstrap helpers) rather than by faking process.platform in a test. Nothing here stubs the global, so every test names the argument it drives.

Validation: bun test packages/acp 161 pass / 0 fail (path-candidates, windows-process-target, mcp-catalog incl. the new unquoted npx split case), bun test apps/server/test/path-bootstrap.test.ts 10 pass / 0 fail, bun run check-types 14/14, bun x ultracite check clean on the changed files, mutation-gate --check resolves all 217 anchors, fallow dead-code --boundary-violations 0 findings.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Ported the four POSIX assumptions that would have failed silently on a Windows run. apps/server/src/path-bootstrap.ts derives PATH_SEP from the platform and gains win32AgentBinDirs, so a Windows sidecar augments PATH from AppData/.bun/nvm-windows instead of clobbering it with a colon join. packages/acp/src/index.ts resolves agent binaries through pathCandidates(bin, pathEnv, platform, pathExt): split on ;, win32 join, and PATHEXT probes defaulting to .EXE;.CMD;.BAT, which is what lets an installed opencode.exe be found at all. packages/acp/src/child-registry.ts routes every signal through killTarget (pid on win32, -pgid elsewhere), commandBaseName cuts on both separators so the reap marker matches, and windowsGroupReapWarning makes the surviving-grandchildren case say so instead of being swallowed. packages/acp/src/mcp.ts splitStdioTarget honours a quoted command, so the desktop shell can hand over C:\Program Files\...\jlpt-mcp.exe without the old whitespace split truncating it to C:\Program (quote_stdio_target in src/mcp.rs produces that form), and an unclosed quote throws rather than spawning half a path. Verified by 161 acp tests and 10 path-bootstrap tests plus the repo gates above. Not proven from Linux: that a real opencode.exe is discovered, or that the Windows reap behaves as written, on a Windows machine.
<!-- SECTION:FINAL_SUMMARY:END -->
