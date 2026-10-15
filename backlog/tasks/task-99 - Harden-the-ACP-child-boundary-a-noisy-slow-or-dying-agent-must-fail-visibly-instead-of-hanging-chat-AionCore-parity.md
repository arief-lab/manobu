---
id: TASK-99
title: >-
  Harden the ACP child boundary: a noisy, slow, or dying agent must fail visibly
  instead of hanging chat (AionCore parity)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-22 03:45'
updated_date: '2026-09-22 06:53'
labels: []
dependencies: []
ordinal: 778000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A live user could not get any answer from /ai: their ~/.local/bin/opencode wrapper prints a mise notice to stdout before exec, the ACP transport parses every stdout line as JSON, died on line 1, the initialize handshake never resolved, and the chat UI hung with no error and no log line. This is not machine-specific: asdf/mise/nvm/volta wrappers, Windows .cmd/.ps1 shims, and any CLI that prints a startup notice all hit the same path, so the packaged app is fragile for a normal install, not just this PC. AionCore, the upstream we modelled the chat surface on, already solves the whole class: its reader loop skips blank lines and drops+reports unparseable lines instead of dying, it bounds the post-spawn handshake with a retryable error, it strips and pins the child environment at spawn, and it peeks stderr into a redacted exit event so a dead child is surfaced rather than silent. Our packages/acp does none of the four: session.ts awaits initialize with no timeout and direct-cli.ts:77 spawns with a raw env: { ...process.env }.

PREMISE CORRECTION (measured during execution, recorded here so the task reads true): the SDK's ndJsonStream already skips blank lines and, on a JSON.parse failure, logs and continues, so a one-off wrapper banner did not by itself kill the handshake. The durable defect is tolerance without a bound: a persistently noisy child (the wrapper re-emitting its notice ~12 lines/s forever) flooded a 96 MB dev log with 116,285 parse errors, burned 28% CPU per child, and never surfaced as a failure, while a child that never answers still wedged the handshake with no timeout. AC#1 and AC#2 were re-worded to that proven behaviour before finalization.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The engine owns the stdout line reader between child.stdout and ndJsonStream: a blank line is skipped and a non-protocol line is counted and reported by our framer, while valid JSON-RPC frames later on the same stream still complete the handshake (the SDK's own tolerance is no longer the only guard)
- [x] #2 Junk is bounded, not tolerated forever: crossing 50 non-protocol lines inside a 5s window fails the transport with a typed retryable error naming the count and window, and each distinct junk line is reported once as an [acp] dropping non-protocol agent stdout line warning
- [x] #3 The initialize + session/new|load handshake is bounded by a configurable timeout (engine option handshakeTimeoutMs, default 30s); on expiry the failure is a typed, retryable error that reaches the client, and the pooled session key is released rather than wedged
- [x] #4 Every subsequent send on a hung pool key surfaces an error instead of awaiting the same never-resolving promise forever
- [x] #5 The agent child is spawned with protocol-safe environment hygiene (NO_COLOR=1, TERM=dumb, and inherited debug/instrumentation vars stripped) and the raw process.env passthrough is gone
- [x] #6 A bounded stderr ring replaces the discard, and its redacted tail rides the failure path (| stderr: ...) so a crashed or unauthenticated agent says why instead of hanging; no secret value can reach a status frame or an error row
- [x] #7 A regression test drives a real child that emits junk on stdout then speaks valid ACP, and a second case covers a child that never answers
- [x] #8 packages/acp/AGENTS.md records the new transport and lifecycle contract
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
PROVEN PREMISE CORRECTION (measured, not inferred):
- The SDK already tolerates junk. node_modules/@agentclientprotocol/sdk .../dist/stream.js ndJsonStream skips blank lines and, on JSON.parse failure, console.errors and CONTINUES. Live probe of the real ~/.local/bin/opencode acp through our exact transport: banner on stdout line 1, initialize result on line 2, parseErrors=1 in 5s, handshake fine. So AC#1 as written is already satisfied upstream; "the transport dies on line 1" is false.
- The actual defect measured on this machine: the user wrapper, when spawned non-interactively by the sidecar, emits the same non-JSON notice line forever (~12/s per child). Two such children have been running 2h20m at 28% CPU each, /proc/<pid>/io wchar growing ~5 KB/s each, producing a 96 MB dev log (116,285 "Failed to parse JSON message" and climbing) and a handshake that never completes. Zero "ACP agent ready" lines in the entire log.
- So tolerance without a bound is the bug: a persistently noisy child floods logs unboundedly and never surfaces as a failure.

PLAN:
1. packages/acp: own the stdout line reader between child.stdout and ndJsonStream (no more raw Readable.toWeb passthrough). Skip blank lines, forward JSON, count junk, and fail the transport when junk exceeds a bounded rate/window instead of logging forever; report the dropped line once per kind.
2. Bound the handshake (initialize + session/new|load) with a configurable timeout; on expiry throw a typed retryable error, tear the child down, and ensure the server pool key settles rather than wedging (apps/server/src/context.ts acpInit).
3. Spawn env hygiene: NO_COLOR=1, TERM=dumb, strip inherited instrumentation vars; drop the raw { ...process.env } passthrough at session.ts:262.
4. Replace the child.stderr?.resume() discard (session.ts:271) with a bounded ring; surface a redacted tail on the failure path so a launcher that is stuck resolving shows why.
5. Tests: noisy-then-valid child answers; persistently noisy child trips the junk bound; silent child trips the handshake timeout; the pool key settles and a later send errors visibly.
6. Verify: bunx tsc -p packages/acp/tsconfig.json --noEmit, bun test packages/acp, bun x ultracite check. DOX pass on packages/acp/AGENTS.md (+ apps/server for the pool-key rule).
7. Re-word AC#1/AC#2 to the proven behaviour (bounded tolerance + our own reporting) before finalization.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Machine-side mitigation landed (outside the repo, so not part of this task): ~/.local/bin/opencode no longer runs `mise use -g` per launch (it wrote a notice to stdout AND blocked on the open protocol stdin, spinning at 28% CPU forever). Now: `mise where` quiet check, `mise use -g` only if missing, both </dev/null >/dev/null, then exec. Original kept at ~/.config/mise/opencode-wrapper.orig. Proof after the change: engine probe handshake 3.0s (was never), junk stdout lines 0 (was 123,776), reply "READY", and `MANOBU_SMOKE_AGENT=opencode bun run smoke:mcp` = ALL CONVERSATIONS PASSED with "[ai] ACP agent ready" markers (zero occurrences before) and real jlpt-mcp child spawns. Confirms AC#3/#4 remain the durable fix: a wedged child still hangs the handshake forever today.

Landed as packages/acp/src/session-child.ts (internal module, no package subpath) + wiring in session.ts. Four jobs: (1) tolerantStdout() owns the line framer between child.stdout and ndJsonStream, skips blanks, forwards protocol lines verbatim, reassembles split lines, and bounds junk at 50 non-protocol lines per 5s window -> AcpStdoutJunkError (retryable) through the SDK's readable-error path, with one [acp] warning per distinct junk kind; (2) withTimeout() + the handshakeTimeoutMs engine option (default 30s) bounds initialize + session/new|load, on expiry AcpHandshakeTimeoutError carries the child's redacted stderr and ensureSession's catch tears the child down so the apps/server acpInit key settles in its existing finally (no server change needed for AC#4 - the wedge was the never-settling promise, which the budget removes); (3) agentChildEnv() strips CLAUDECODE/FORCE_COLOR/NODE_DEBUG/NODE_INSPECT_RESUME_ON_START/NODE_OPTIONS and pins NO_COLOR=1 + TERM=dumb on a copy (parent env untouched); (4) captureStderr() replaces child.stderr?.resume() with a 64KiB ring, redacted on push so the ring never holds a secret, surfaced as '| stderr: <tail<=2000>' by failureDetail() on both the handshake failure and #markDead.
Design gotcha worth recording: a ReadableStream pull() that enqueues nothing is NOT re-invoked (no read request is pending), so a filtering source must keep draining inside pull until it enqueues, errors or closes. The first version returned after each chunk and all four tolerantStdout unit tests hung; the fix also had to forward every line of a chunk (not stop at the first enqueued one) or a multi-frame chunk truncates the stream - that regression cost 5 pre-existing tests before child-transport.test.ts pinned it.
Verification (fresh): bunx tsc -p packages/acp/tsconfig.json --noEmit exit 0; bun x ultracite check packages/acp -> 44 files, 0 errors; bun test packages/acp -> 108 pass / 0 fail / 416 expects (new: child-transport.test.ts 11 cases + 3 wire cases in session.test.ts - banner dropped, flood fails in 607ms instead of hanging, silent child trips the 150ms budget with '| stderr:' and no sk-secret leak); bun test apps/server -> 82 pass / 1 skip / 0 fail. Real-agent proof: MANOBU_SMOKE_AGENT=opencode bun run smoke:mcp -> ALL CONVERSATIONS PASSED, 2x '[ai] ACP agent ready: opencode', real jlpt-mcp spawns, and a direct engine probe against real 'opencode acp' (applyLaunchPolicy spec, new transport) completed the handshake + a 6-frame end_turn reply with zero junk-line warnings. DOX: packages/acp/AGENTS.md gained the session-child.ts local contract, the suite in Verification, the smoke result, and the Child DOX Index module row.

DOX closeout: apps/server/AGENTS.md gained the pool-key rule next to the warm-pool bullet ('the in-flight spawn key must always settle', naming handshakeTimeoutMs + the junk bound as the engine half, and correcting the stale 'src/index.ts' path for poolKeyFor/ensureAcp to src/context.ts). No apps/server code changed.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-22 05:42
---
Scope correction needs user approval: AC#1/#2 as written describe a fix the SDK already provides; the real gap is the missing bound on junk lines (96 MB log flood, 2h silent hang) plus AC#3-#6 which stand as written. Also filed nothing yet for the user-side mitigation: the wrapper needs mise use -g silenced, and chat stays dead on this PC until either that or item 2 lands.
---

created: 2026-09-22 06:52
---
AC#1/#2 re-worded to the proven behaviour and checked, per the plan's item 7; the description now carries the measured premise correction. The scope question raised in comment #1 is answered by the shipped bound (50 lines / 5s), which is what the SDK does not do.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
packages/acp now owns the child boundary. New internal module session-child.ts supplies: tolerantStdout(), an NDJSON line framer that skips blanks, forwards protocol lines verbatim, reassembles split lines, reports each distinct junk line once and fails the transport (AcpStdoutJunkError, retryable) past 50 junk lines in a 5s window; agentChildEnv(), which strips CLAUDECODE/FORCE_COLOR/NODE_DEBUG/NODE_INSPECT_RESUME_ON_START/NODE_OPTIONS and pins NO_COLOR=1 + TERM=dumb on a copy of the parent env; captureStderr(), a 64KiB ring redacted on push so a status frame or error row can never carry a secret, surfaced as '| stderr: ...' on the handshake failure and on #markDead; and withTimeout(), which bounds initialize + session/new|load by the configurable handshakeTimeoutMs (default 30s) and throws AcpHandshakeTimeoutError while ensureSession tears the child down, so the apps/server acpInit pool key settles in its existing finally instead of wedging the conversation. session.ts is the only wiring change; session-types.ts gained an @internal stderrTail.
Verified with: bunx tsc --noEmit (exit 0), bun x ultracite check packages/acp (44 files, 0 errors), bun test packages/acp (108 pass / 0 fail, incl. new child-transport.test.ts and 3 wire cases: banner dropped, flood fails in 607ms, silent child trips a 150ms budget with redacted stderr), bun test apps/server (82 pass / 1 skip / 0 fail), MANOBU_SMOKE_AGENT=opencode bun run smoke:mcp (ALL CONVERSATIONS PASSED, both ACP-ready markers, real jlpt-mcp spawns) and a direct engine probe of real 'opencode acp' through the new transport (handshake + 6-frame end_turn, zero junk warnings). DOX: packages/acp/AGENTS.md records the contract.
<!-- SECTION:FINAL_SUMMARY:END -->
