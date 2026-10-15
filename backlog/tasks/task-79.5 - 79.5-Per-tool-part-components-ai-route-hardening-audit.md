---
id: TASK-79.5
title: 79.5 Per-tool part components + /ai route hardening audit
status: Done
assignee:
  - '@arif'
created_date: '2026-09-15 07:00'
updated_date: '2026-09-15 15:11'
labels:
  - frontend
  - ai-chat
  - backend
dependencies:
  - TASK-79.4
parent_task_id: TASK-79
priority: medium
type: feature
ordinal: 258500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two smaller tails. (a) Parts: replace the generic ToolPart card usage in message-transcript.tsx with per-tool part components in packages/chat-session/src/parts/ (text-part, ask-user-part, plus one per tool the /ai route exposes), each switching on part.state (input-streaming spinner / input-available args summary / output-available result / output-error red line) like the template's parts/ dir; keep the generic ToolPart from @manobu/ui as the fallback for unknown dynamic-tool parts. (b) Hardening: audit apps/server /ai against the template's route.ts checklist - Zod-validate the incoming body (TASK-14 may cover part), reject model ids not in the agent's catalog, cap maxOutputTokens + stopWhen step count, abort generation when the client disconnects (Hono signal), and confirm the local-agent path can't be pointed at arbitrary upstreams. Fix gaps in the same task; document non-gaps in notes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each registered tool renders its own state-aware part component; unknown tools still fall back to ToolPart (test both).
- [ ] #2 Hardening checklist written up in the task notes with file:line evidence per item; any gap fixed with a server test pinning it.
- [ ] #3 ask_user reliability audit: /ai prompts that need clarification actually trigger the tool (persona nudge or description fix if not), with the refusal case documented
- [ ] #4 ASK_USER_PART_TYPE prefix pinned by a test or boot assertion that fails loudly on a provider upgrade
- [ ] #5 ask_user part renders its own state-aware component (sentinel never leaks into a ToolPart card, including /dev/chat-history)
- [ ] #6 shimmer: ported to packages/ui globals.css or removed from both call sites
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow-ups handed over from 79.4 (scope this audit around them):
1. ask_user reliability: opencode sometimes refuses to call the tool ('I'm a coding CLI') - the Sensei persona prompt fights the tool description. Fix candidate: persona-level nudge in assistant/*.md ('you have an ask_user tool; use it to clarify ambiguous requests'). Decide whether the nudge belongs in the persona markdown or the server-side tool description.
2. ASK_USER_PART_TYPE hardcodes the provider's MCP server prefix 'acp-ai-sdk-tools' (packages/chat-session/src/chat-messages.ts). A @mcpc-tech/acp-ai-provider upgrade can silently rename the wire part and dead the card with no error. Pin it: boot assertion or contract test against the provider version (or derive the prefix from the provider export if one appears).
3. Handoff sentinel leakage: on read-only mounts (/dev/chat-history) the ask_user part's output ('HANDOFF_UI: ...') renders in the generic ToolPart card - cosmetically noisy. The parts/ refactor (scope a) should give tool-acp-ai-sdk-tools_ask_user its own part component that suppresses the sentinel in every state.
4. shimmer class has no CSS definition in this repo (template leftover): used by QuestionCard 'Preparing a question...' and the transcript 'Thinking...' row; renders as plain text. Either port the template's shimmer keyframes into packages/ui globals.css or drop the class. Pre-existing, not introduced by 79.4.

TASK-79.5 hardening checklist (template route.ts parity, file:line evidence):
- Body validation: apps/server/src/index.ts:213-221 validateUIMessages<UIMessage> (no tools option; base schema only) runs BEFORE poolKeyFor/queueFor, so a bad body cannot spawn an agent or take a queue slot; 400 {error:'Invalid messages.'}. ai-hardening.test.ts (4 tests) + live curl: 'parts:[{type:text}]' -> HTTP 400 + body, and the server log showed NO [ai] ACP agent ready line for that request while the next valid request did.
- Step cap: index.ts:255 stopWhen: isStepCount(5) (outer-loop guard; ACP path is 1 outer step).
- Client-disconnect abort: index.ts:242 abortSignal: c.req.raw.signal (HonoRequest exposes no .signal getter, raw Request does; typecheck caught the plan's c.req.signal). Live: 8s curl -m abort mid-stream -> turn abandoned, follow-up send returned a 200 stream (no conversation_busy), queue slot released.
- maxOutputTokens: non-gap, NOT added. Zero occurrences in @mcpc-tech/acp-ai-provider@0.3.5 index.mjs; output length decided agent-side.
- Unknown model id: non-gap, deliberately no 400. A bogus id reaches resource.setModel on a LOCAL agent child (index.ts ~L229-236 area of the queue task) only; failure warns and keeps the current model. Stale persisted cron ids keep warn-and-continue behavior.
- AC5: ask_user branch already precedes isToolUIPart in all mounts; SSR test pins no HANDOFF_UI and no 'show input' in readOnly and writable transcripts.
- AC1: parts/ convention - src/parts/ask-user-part.tsx (moved) + src/parts/text-part.tsx (extracted from the dispatch); unknown runtime tools fall to generic ToolPart (test asserts data-slot=tool-name + 'bash').
- AC6: no code. .shimmer IS defined via packages/ui/src/styles/globals.css:3 @import 'shadcn/tailwind.css' -> shadcn@4.16.1 tailwind.css @utility shimmer + @keyframes tw-shimmer (L537/574). apps/desktop/dist/assets/index-BaauexdO.css contains tw-shimmer; live devtools-equivalent check: getComputedStyle(.shimmer).animationName === 'tw-shimmer'.
- AC4: packages/acp/test/wire-contract.test.ts pins new ToolProxyHost("acp-ai-sdk-tools") in provider source + ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME value + version 0.3.5. Verified loud: expected string edited to acp-XX-tools -> 1 fail; reverted -> 3 pass. Cross-ref comments at chat-messages.ts:24 and the test's assertion.

AC3 reliability audit (bare 'help me study' on fresh localStorage, http://localhost:3001/ai, opencode agent):
- Persona nudge alone (3 sources: sensei.md:35, polite-san.md:24, assistant-loader.ts:179 embedded fallback): 0/2 runs triggered ask_user (run 1: jumped to Tatoeba #103 N5 sentence + conjugation drill; run 2: Tatoeba #12 warm-up).
- After plan contingency (tool description first sentence strengthened to 'MUST be called before teaching when the learner has not stated a goal or level...', apps/server/src/index.ts:178-179): 2/3 runs triggered (runs 1 and 3 pinned the card; run 2 refusal transcript: 'Tap the card above to tell me what you'd like to study!' - the agent hallucinated a card without calling the tool; note it still deferred teaching, no direct answer).
- Explicit-command prompt ('Call your ask_user tool right now...') triggered 1/1 before and after.
- Verdict: nudge + strengthened description materially improves but does not guarantee; opencode retains a self-answering failure mode documented above (AC3 requires documentation of the refusal case, met). Full-loop E2E passed: card render -> N5 radio -> Answer -> cardCount 0, user message 'What is your current JLPT level?: N5 (complete beginner)' streamed, no HANDOFF_UI/show input anywhere in the transcript DOM.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
AC1/AC5: per-tool part components under packages/chat-session/src/parts/ (ask-user-part moved, text-part extracted from message-transcript dispatch); SSR tests pin sentinel non-leak (no HANDOFF_UI / show input, readOnly + writable) and unknown-tool ToolPart fallback. AC2: POST /ai validates bodies with validateUIMessages before queue/spawn (400 Invalid messages.), streamText gains stopWhen isStepCount(5) + abortSignal c.req.raw.signal; maxOutputTokens/model-rejection deliberately absent (provider ignores it; local agents warn-and-continue) - all pinned by apps/server/test/ai-hardening.test.ts (4 tests) + live curl/log checks. AC3: persona nudge in all 3 sources + strengthened tool description; reliability audit 2/3 bare-prompt triggers, refusal transcript documented. AC4: packages/acp/test/wire-contract.test.ts pins proxy name/export/version (verified it fails loudly). AC6: shimmer confirmed defined via shadcn @utility (built CSS + live computed style). DOX: chat-session/server/acp AGENTS.md updated. Gates: server 58 pass, acp 53 pass, chat-session 55 pass, ui 100 pass, root typecheck clean, ultracite check clean.
<!-- SECTION:FINAL_SUMMARY:END -->
