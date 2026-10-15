---
id: TASK-80.13
title: '80.9.4 Eval: adopt createSafeClient for the typed-error call sites'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-18 05:46'
updated_date: '2026-09-18 12:37'
labels:
  - orpc
  - ai-chat
  - frontend
dependencies:
  - TASK-80.8
documentation:
  - 'https://orpc.dev/docs/client/error-handling'
parent_task_id: TASK-80
priority: low
type: spike
ordinal: 691000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The TASK-80.8 oRPC docs audit noted orpc.dev/docs/client/error-handling offers createSafeClient(client) as the bulk alternative to per-call safe(promise): it wraps every procedure call so each returns [error, data] (or { error, data, definedError }) with the same typed inference safe() gives. TASK-80.8 AC#4 deliberately chose per-call safe() in packages/chat-session/src/fetcher.tsx because only the agent/persona/model queryFns need the typed NOT_FOUND-vs-network split; slashCommandsQueryOptions stays a bare call by design (NOT_FOUND-tolerant, retry: 0), and a createSafeClient over the whole client would make every call site (including the bare ones) destructure tuples, which the doc does not require when only some calls need it. This task is an EVALUATION: count the call sites that would gain typed-inferred errors from a safe client (engine, fetcher, cron-dispatch, sensei), weigh it against the noise of forcing [error, data] at sites that today never error-type, and record the verdict (stay per-call safe / mixed: safe client only for the catalog layer / adopt wholesale) in the implementation notes. No behavior change either way: this is ergonomics on the client side only, so it can be deferred indefinitely without risk; nothing in TASK-80.8's error contract depends on it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Implementation notes contain a call-site count + verdict (stay / mixed / wholesale) with the rationale; if mixed/wholesale, a follow-up implementation task is created and this closes notes-only
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Evaluation: createSafeClient vs per-call safe()

Evidence: orpc.dev/docs/client/error-handling + async-iterator-object (via MCP); installed beta.35 source (node_modules/.bun/@orpc+client@2.0.0-beta.35/dist/index.mjs) — safe() at L58-78 is a generic promise wrapper; createSafeClient at L114-134 is a recursive proxy: EVERY typescript-object member of the client subtree is wrapped in safe(), no per-procedure opt-out.

### Call-site inventory (production oRPC calls; 19 total)
**safe() today — 4 sites (typed-error split needed):**
1. chat-session/fetcher.tsx L18 acp.agents.list (NOT_FOUND → empty catalog, network → TanStack retry)
2. chat-session/fetcher.tsx L41 acp.assistants.list (same pattern)
3. chat-session/fetcher.tsx L65 acp.agents.models (same pattern)
4. desktop/lib/cron-dispatch.ts L33 chat.send (CONVERSATION_BUSY/typed 4xx must not crash the cron tick; only network failures rethrow)

**Bare by design — 15 sites (typed error not needed):** chat-session: fetcher L145 slashCommands (try/catch → [], retry:0), provider L354/L374 setConfigOption fire-and-forget, use-chat-engine L109 chat.subscribe (STREAMING AsyncIteratorObject — errors belong to the for-await loop, docs' own Error Handling section shows try/catch), parts/ ×3 answerAsk/confirm/killTerminal (fire-and-forget). desktop/lib: kanji-queries L80 kanji.list (retry:1), kanji L57/L94 + kanjivg L48 + lesson-cards L243 + mock L119 + next-cards L114 (try/catch → null/empty fallbacks), sensei L34 agents.list (dead sidecar = expected first-run state).

### Verdict: STAY (per-call safe()), no follow-up task
Only 4 of 19 call sites (21%) need the typed NOT_FOUND-vs-network split; 79% are bare by design. Three concrete reasons createSafeClient is the wrong shape here:
1. **The installed implementation has no opt-out**: createSafeClient(orpc) recursively wraps every procedure in the shared ContractClient (orpc.ts:37-40 single instance) — all 15 bare sites would change to safe-tuples ("[error, T]"), including the try/catch fallback sites that intentionally do not discriminate. The docs frame it as "if you use safe often"; 4/19 is not that.
2. **The streaming procedure breaks the shape**: chat.subscribe returns an AsyncIteratorObject; wrapped, it yields a tuple ("[error, iterator]") at start while per-frame errors still surface through the for-await loop (docs: AsyncIteratorObject Error Handling is try/catch, no retry) — two error surfaces for one call instead of one. use-chat-engine's drain loop is exactly that for-await shape today.
3. **No subtree covers the 4 safe sites without sweep**: they span orpc.acp (×3) and orpc.chat.send (×1); the only shared instance is the whole orpc client, so any createSafeClient(orpc) sweeps in slashCommands (bare) + subscribe (streaming) + all jap/learn fallbacks.
Confirming TASK-80.8 AC#4's deliberate choice of per-call safe() was correct; the doc's "bulk alternative" is for clients where MOST calls need typed errors, not this one. Re-evaluate only if: (a) the jap/learn surfaces start needing typed-error splits (then createSafeClient(orpc.jap) per-subtree), or (b) a second consumer package adopts typed errors on the same client tree. No follow-up task created (verdict is stay).

VALIDATION 2026-09-18: doc grounding confirmed via the oRPC MCP server (both doc refs on this task fetched live): (1) orpc.dev/docs/client/error-handling — the doc positions createSafeClient as 'reduces repetition if you use safe often' (bulk opt-in for clients where MOST calls need typed errors; 'if you use safe often' is the explicit trigger) and documents safe()'s dual tuple/object result form [error, data, definedError] / { error, data, definedError } — our 4 call sites already destructure the tuple form. (2) orpc.dev/docs/client/async-iterator-object — streaming procedures have their own error surface: 'Unlike traditional SSE, AsyncIteratorObjects do not retry automatically after an error' and the doc's own Error Handling example is try/catch around the for-await loop (plus the consumeAsyncIterator lifecycle-callback helper) — confirming the verdict's point 2: wrapping chat.subscribe (asyncIteratorObject) in safe would split one call across two error surfaces; the doc offers NO safe-wrapping recipe for stream procedures. Both quotes corroborate STAY; verdict unchanged. consumeAsyncIterator noted as a candidate for a FUTURE drain-loop ergonomics task only if the hand-rolled resume/abort logic in use-chat-engine.ts ever stops paying for itself — out of scope here.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Evaluated createSafeClient against the repo's oRPC call sites (docs + installed beta.35 source via MCP). 19 production call sites inventoried: only 4 (21%) need the typed NOT_FOUND-vs-network split that safe() gives (chat-session fetcher agents/assistants/models + desktop cron-dispatch chat.send); 15 are bare by design (fire-and-forget, try/catch fallbacks, and the streaming chat.subscribe whose per-frame errors belong to the for-await loop). Verdict: STAY per-call safe() — the installed createSafeClient recursively wraps the entire client with no per-procedure opt-out, and the 4 safe sites span two subtrees so no subtree wrap covers them without sweeping the bare + streaming sites. Confirms TASK-80.8 AC#4's original choice. No follow-up task; no code changed (spike closed notes-only).
<!-- SECTION:FINAL_SUMMARY:END -->
