---
id: TASK-100
title: 'Chat: a message submitted while a turn is streaming is silently destroyed'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-22 05:05'
updated_date: '2026-09-22 12:29'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 790000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The composer stays enabled during a streaming turn, so a learner can type a follow-up and press Enter, and the text disappears with no error, no toast and no draft left behind. The engine ignores the send while isSending, but the provider clears the input unconditionally afterwards, so the caller wipes what the callee refused to accept. Anyone who has ever typed ahead into a busy chat loses their message on first use. AionUi queues these submissions into a persisted command queue instead of dropping them. apps/server/AGENTS.md rules out server-side queueing for CONVERSATION_BUSY (a client bug, not a queue candidate), but nothing here records the client-side data loss as a decision, and refusing the send is not the same as discarding the text.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Submitting while a turn is in flight never loses text: the message is either queued and delivered when the turn settles, or left in the composer with a visible reason
- [x] #2 Every submit path behaves the same (Enter and the send control), and neither can clear the composer on a rejected send
- [x] #3 The composer draft persists across reload for a message that was never accepted
- [x] #4 Switching persona or starting New Chat keeps its current identity-reset semantics and is not treated as this bug
- [x] #5 A test covers the in-flight submit path and asserts the text survives
- [x] #6 packages/chat-session/AGENTS.md records the accepted-send contract between the provider and the engine
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
MEASURED STARTING POINT (read in this session, not inferred):
- The refusal and the clear live in two different modules and never talk. packages/chat-session/src/use-chat-engine.ts:321-323 is the guard ('if (!trimmed || isSending) return;'), and packages/chat-session/src/provider.tsx:278-284 is the wipe ('engineSend(text); setInput("");') - engineSend returns void, so the provider cannot see the refusal it just caused. The same unconditional clear also fires on the server-rejected path (chat.send -> CONVERSATION_BUSY -> use-chat-engine.ts:345-352 .catch), and because the persist effect writes 'input' into manobu:chat:v1 (provider.tsx:149-169), the wiped draft is persisted empty: the text is gone after a reload too.
- Surfaces: /ai (apps/desktop/src/routes/ai.tsx:610-633) keeps the textarea ENABLED while streaming and swaps the submit button for a Stop control, so Enter is the loss path; apps/desktop/src/features/ask-sensei/panel.tsx:67 and apps/desktop/src/routes/learn/conversation/$sessionId.tsx:59 disable the textarea instead (so they cannot hit it today, but share the same provider glue). No toast/frame exists for a refused send: the only feedback is the header dot (apps/desktop/src/routes/ai.tsx:451-458).

PLAN (branch: keep the text in the composer + a visible reason; no client queue - see the decision note):
1. packages/chat-session/src/use-chat-engine.ts: make the accept/refuse answer part of the seam. 'send(text): SendOutcome' where 'SendOutcome = "accepted" | "refused-busy" | "refused-empty"' (a literal union, not a boolean bag); the two early-return arms report which one fired. The guard stays the single authority on busy (it also protects regenerate() and the transcript suggestion chips).
2. New pure module packages/chat-session/src/composer-send.ts: 'planComposerSend({ isSending, text })' -> { clearInput, notice, submit } plus 'sendNoticeFor(outcome)'. This is where the accepted-send contract lives as data, so the rule is testable without a DOM (this workspace has no DOM test env: packages/chat-session/src/use-chat-engine.test.tsx:5-7).
3. provider.tsx: the send/onSubmit/Enter paths apply the plan instead of clearing unconditionally - engineSend(text) + setInput('') only when accepted; on refusal the draft stays and 'submitNotice' state records the reason. Expose it on the state slice (ChatSessionState.sendNotice: string | null) and clear it on accepted send, on reset() and on the agent/persona identity resets (AC#4).
4. Render the reason in all three composer footers (routes/ai.tsx, features/ask-sensei/panel.tsx, routes/learn/conversation/$sessionId.tsx) as one small 'aria-live="polite"' line, no em dash, text-destructive on a plain surface (contrast contract, AGENTS.md).
5. Tests: composer-send.test.ts pins the decision table (busy -> no clear + notice, empty -> no clear + no notice, accepted -> clear + no notice) and the in-flight case asserts the text survives; persistence.test.ts gets the reload leg (a never-accepted draft round-trips through manobu:chat:v1). Route React wiring stays verified by type-check + the running app, per the repo's existing convention (apps/desktop/test/slash-menu.test.ts:19-21).
6. Verify: bunx tsc --noEmit for packages/chat-session + apps/desktop, bun test packages/chat-session, bun x ultracite check on the touched dirs, then drive it in the running app.
7. DOX: packages/chat-session/AGENTS.md records the accepted-send contract (AC#6) and apps/desktop/AGENTS.md:39 gets corrected - it currently documents the lossy behaviour as the contract ('send() no-ops while isSending').
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PLAN DRIFT (shipped shape differs from the written plan, deliberately):
- Step 2 became two pure functions instead of one: classifySend({isSending, text}) -> SendOutcome and planComposerSend(outcome) -> {clearInput, notice}. The engine already owns the busy check, so the provider consumes the engine's verdict rather than re-deriving it; a single planComposerSend({isSending,text}) would have put the same rule on both sides of the seam.
- Step 4 became one mount point. <SendNotice/> is rendered inside MessageTranscript (packages/chat-session/src/message-transcript.tsx) instead of editing three route footers, so no surface can ship the draft without the reason. Consequence: the scroller needed a flex h-full min-h-0 flex-col wrapper because MessageScroller is size-full.
- send-notice.tsx stays internal (no package subpath added/removed from package.json): no external consumer.
- Step 5's persistence.test.ts reload leg was NOT added; AC#3 is proven in the running app instead (draft survives reload), which is the stronger evidence and matches the repo convention of verifying route behaviour with type-check + browser.

VERIFICATION:
- bun test packages/chat-session: 162 pass / 0 fail / 383 expect() calls.
- bunx tsc -p packages/chat-session/tsconfig.json --noEmit: clean. apps/desktop bun run check-types (tsc + vite build): clean.
- bun x ultracite check packages/chat-session: 50 files, no errors.
- Live Playwright drive of /ai (chromium, sidecar 127.0.0.1:4317 + vite 3001), all 7 assertions true: composer visible; turn started (thinking indicator); text survives the refused send; visible reason shown; draft survives reload; accepted send clears the draft; notice gone after an accepted send. Screenshot checked: one text-destructive line above the composer border, typed-ahead text still in the textarea, no layout overflow.
- Unexplained during the drive: 3x "Failed to load resource: 404" console entries, consistent with the documented NOT_FOUND-tolerant chat.slashCommands fetch on a fresh conversation. Not investigated; no TASK-100 path depends on it.

LIVE-RUN CONTEXT (found while re-verifying, not caused by this change):
- The :4317 sidecar that served the first live run was the 9h-old `bun run --hot` process, i.e. it still held the PRE-TASK-99 @manobu/acp code (hot reload watches apps/server/src, not packages/acp). Restarted the turbo dev run so the hardened child transport is what served the final evidence.
- On the restarted sidecar the default agent's turn ends with a single `{"stopReason":"error"}` finish frame and no text frames, so the transcript stays empty. The refused-send window is still a real in-flight turn (isSending true, Stop control rendered for ~30s), which is what AC#1/#2/#3 are about; all 7 assertions re-passed after the restart, and the screenshot was re-checked.
- The 3x console 404 during the run is the documented chat.slashCommands NOT_FOUND ("No session for this conversation yet"), visible in the server log for every fresh conversation. Pre-existing, tolerated by the client.
- Worth a look separately (NOT part of this task, no task created): after the stream closes, the engine's subscribe loop reconnects in a tight loop and each replay re-delivers the finish frame (one probe run counted ~33k WS frames in 20s), and a turn that ends in stopReason error renders no error row, so the learner sees a silent empty transcript. Both are outside TASK-100's scope and predate it.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A submission that the engine refuses no longer destroys the draft. The accept/refuse verdict is now part of the seam: use-chat-engine.ts `send(text): SendOutcome` ("accepted" | "refused-busy" | "refused-empty") reports what its guard decided, and provider.tsx consumes it through the new pure rule module composer-send.ts (`classifySend` + `planComposerSend(outcome) -> {clearInput, notice}`), so `setInput("")` only runs on an accepted send. The reason for a refusal reaches the learner through ChatSessionState.sendNotice, rendered by send-notice.tsx's `aria-live="polite"` line mounted inside MessageTranscript (one mount point, so no surface can ship the draft without the reason; the scroller gained a flex h-full min-h-0 wrapper because MessageScroller is size-full). The notice clears on an accepted send and on every identity reset (New Chat, agent, persona). apps/desktop/src/routes/ai.tsx's stale comment and apps/desktop/AGENTS.md:39, which both documented the lossy behaviour as the contract, now describe the refusal; packages/chat-session/AGENTS.md records the accepted-send contract.

Verified: bun test packages/chat-session -> 162 pass / 0 fail (composer-send.test.ts pins the decision table and the in-flight case asserts the text survives; send-notice.test.tsx pins the idle no-live-region branch). bunx tsc --noEmit clean for packages/chat-session and apps/desktop (check-types: tsc + vite build). bun x ultracite check packages/chat-session: 50 files, no errors. Live Chromium drive of /ai against the restarted sidecar, all 7 assertions true: composer visible, turn in flight, text survives the refused send, visible reason shown, draft survives reload, accepted send clears the draft, notice gone after an accepted send; screenshot inspected. Second live pass for the other submit path: the send control is absent while streaming (it is the Stop button, so it cannot submit), the draft survives a Stop click, and clicking Send when idle clears it and drops the notice.
<!-- SECTION:FINAL_SUMMARY:END -->
