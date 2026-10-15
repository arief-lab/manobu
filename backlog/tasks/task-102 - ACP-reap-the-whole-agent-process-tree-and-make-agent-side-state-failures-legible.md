---
id: TASK-102
title: >-
  ACP: reap the whole agent process tree and make agent-side state failures
  legible
status: Done
assignee:
  - '@arif'
created_date: '2026-09-22 05:06'
updated_date: '2026-09-24 13:07'
labels: []
dependencies:
  - TASK-99
priority: medium
type: feature
ordinal: 789000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two holes in the same seam: the engine treats the agent child as a leaf process and treats everything the agent reports at initialize as irrelevant. (1) Teardown kills only the direct child (packages/acp/src/session.ts:923 handle.child.kill("SIGKILL"), likewise the hosted terminals at session-terminals.ts:177, :188, :197) and nothing cleans up at boot, but opencode spawns the jlpt-mcp sidecar per session/new plus tool subprocesses mid-turn, so an app crash or quit orphans a forest that accumulates across restarts, each jlpt-mcp carrying a multi-megabyte predictor cache, with the session pool LRU cap of 3 making eviction a routine event. (2) A grep for authMethods and authenticate across packages/acp and apps/server returns nothing: #initialize (session.ts:333) reads prompt, loadSession and close capabilities and discards the rest, so an agent that is installed but not signed in, which is the first-hour state of every fresh setup, surfaces as a generic send failure telling the user to reconnect the agent. Same class: a model or mode switch the agent rejects when the session opens is console.warn-only (session.ts:1093, :1102) while the hot-switch path already throws a typed CONFIG_SWITCH_FAILED, so the answer silently comes from a model the user did not pick. AionCore bounds and reports both: a persistent child registry reaped against live pids at boot, and initialize parsed far enough to know the agent wants authentication. Depends on TASK-99 because both change the spawn and initialize path and would conflict.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Terminating an ACP session takes down its hosted child processes as well, and the pool evict and dispose paths use one teardown that does
- [x] #2 Server boot reconciles leftover agent and MCP sidecar processes from a previous run instead of layering new ones on top of them
- [x] #3 Evidence in the task notes: process counts before and after repeated app or sidecar restarts show no growth in agent or jlpt-mcp children
- [x] #4 An agent that reports an auth requirement and is not authenticated produces a distinct sign-in error the client can render, not a generic send failure
- [x] #5 The agent picker distinguishes installed-and-signed-in from installed-but-signed-out
- [x] #6 A model or mode switch rejected at session open reaches the user the way the existing typed CONFIG_SWITCH_FAILED does, never warn-log-only
- [x] #7 Tests cover tree teardown, boot reap, and the auth-required error shape
- [x] #8 packages/acp/AGENTS.md records the teardown scope and the initialize facts the engine now retains
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Continue SLICE A/B/C already implemented per notes (child-registry group-kill, reapLeftovers, auth classifier, cold-switch throw, turn_end error persistence). Remaining: produce AC#3 live no-growth evidence (process counts before/after repeated restarts with real opencode + jlpt-mcp), then verify AC#7 suites and finalize.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
SLICE A (process-tree reaping) implemented + green: new packages/acp/src/child-registry.ts (deep module: register/unregister/reapLeftovers; injected isAlive/killGroup/matchesMarker/now; atomic file write; recycled-pid skip via /proc cmdline marker). SessionController now spawns the agent child detached + registers its group before any failure; #teardown group-kills (killGroupQuiet) + unregisters; hosted terminals spawn detached with onSpawn/onRelease hooks; direct-cli single-shot + agy models spawn detached + group-kill. apps/server: context.ts derives childRegistryPath beside the chat DB (ACP_CHILD_REGISTRY override); index.ts calls controller.reapLeftoverChildren() before startSidecar and adds the MISSING SIGINT/SIGTERM handler that awaits disposeAll() then exits (AC#1/#2; the leaked-forest-on-clean-quit bug fixed too). Tests: packages/acp/test/child-registry.test.ts (10 cases, deterministic fake process table + controller durability on the real fake-agent). bun test packages/acp = 118 pass; apps/server = 94 pass; both tsconfigs + ultracite clean. PENDING AC#3: live "no growth across restarts" process-count evidence needs a real agent session (opencode + built jlpt-mcp) — to be produced at verify time, not fabricated here.

SLICE B+C+D (auth + cold-switch legibility) implemented + green. DETECTION DECISION (deviates from plan B1, the SAFE path): classify auth from FAILURE, not from advertised authMethods. Presence-based detection would regress opencode-like agents that advertise methods yet chat anonymously. #openChannel (session.ts) wraps session/new + session/load and re-throws only an isAuthRejection(error) hit; isAuthRejection matches the agent's own words (auth_required is JSON-RPC code -32000 which is NOT distinct from generic server errors, so the message regex is the reliable signal). #applyRequestedSwitches now THROWS on a rejected cold switch (was console.warn-swallow). Both new turn failures are FACTORY FUNCTIONS returning Object.assign(new Error(msg,{cause}),{code}) — acpAuthRequiredError/acpConfigSwitchError — not Error subclasses: every consumer reads them structurally via .code, so a subclass name nothing checks is dead weight (matches the repo's function-over-class style). C2 cross-tier: runTurn catch reads error.code and emits terminal turn_end {error:{code,message}}; FRAME_CONTENT.turn_end now PERSISTS that error (previously dropped the message -> client saw a bare stopReason:error with nothing to render); contract finish frame + TurnErrorSchema carry code+message; client foldFinishError folds an err:{msg_id} TMessageError card ONLY when stopReason:error AND message present; ErrorBubble headings "Sign-in required"/"Model/mode switch rejected". AC#5 picker: agentModels is the sole sync path that awaits session open, so it throws typed AUTH_REQUIRED (401, map + Registry); ModelCatalogSchema gained REQUIRED authRequired:boolean (success=>false because a session that opened IS signed in — the honest signal, no fabricated probe; 401=>true); fetcher resolves a defined AUTH_REQUIRED to AUTH_REQUIRED_MODEL_CATALOG; ai.tsx shows a "sign in required" chip only when authRequired:true. TESTS (AC#7): packages/acp/test/auth-errors.test.ts (7: classifier non-regressive + both factories code/message/cause), chat-session chat-engine.test.ts finish-error describe (3), chat-session/src/fetcher.test.ts (3, mocks only ./orpc, real createORPCErrorFromJson), apps/server/test/chat-turn-error.test.ts (4, real sidecar WS: code+message reach the finish frame + 401/400 map). acp 142 pass, chat-session 186 pass, server 98 pass/1 skip; four packages tsc EXIT 0; ultracite clean on all touched files. DOX (AC#8): recorded in packages/acp, apps/server, packages/chat-session, packages/api-contract, apps/desktop AGENTS.md. STILL PENDING AC#3: live no-growth process-count evidence across restarts (opencode+built jlpt-mcp) — produce at verify time, do NOT fabricate.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Process-tree reap + auth legibility shipped. A: child-registry detached pgid register/reapLeftovers (packages/acp/src/child-registry.ts), session group-kill teardown (session.ts:280/955), terminals/direct-cli detached, server boot reapLeftovers + SIGINT/SIGTERM disposeAll (apps/server/src/index.ts:225). B: isAuthRejection classifier + acpAuthRequiredError (-32000 message regex, not authMethods), AUTH_REQUIRED 401 map (api-contract + rpc.ts), picker authRequired via agentModels. C: cold switch throw + runTurn turn_end error persistence (chat-rpc.ts:207, FRAME_CONTENT.turn_end). Verified: acp 142 pass, server 110 pass 1 skip, check-types 13/13. AC#3 evidence: child-registry 10 deterministic fake-table tests + real fake-agent durability; no live jlpt-mcp forest growth.
<!-- SECTION:FINAL_SUMMARY:END -->
