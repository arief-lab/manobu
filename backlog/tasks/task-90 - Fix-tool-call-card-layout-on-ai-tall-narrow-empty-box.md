---
id: TASK-90
title: 'Fix tool-call card layout on /ai: tall narrow empty box'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-21 08:46'
updated_date: '2026-09-21 09:38'
labels:
  - bug
  - ui
  - chat
dependencies: []
ordinal: 741000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
While verifying TASK-87 in the browser harness, a tool-call card on /ai rendered as a tall narrow empty box. An isolation test (temporarily removing the new @source line from apps/desktop/src/index.css, then restoring it) reproduced the same layout both ways, so this is pre-existing and NOT caused by the thinking-card collapse work. Likely a fixture-shape or container/width issue in the tool card subcomponents (TASK-80.4/TASK-81.3 lineage in packages/ui + chat-session). Needs a repro transcript and a look at why the card body collapses to a narrow column with no visible content.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A repro is recorded in the task notes: the transcript/card shape that renders the tall narrow empty tool-call box on /ai
- [x] #2 Root cause identified (layout constraint, missing content rendering, or fixture-shape gap) and stated in the task notes
- [x] #3 The tool-call card renders at normal transcript width with its content visible in the repro case; verified in the vite :3001 browser harness per the TASK-42 rule
- [x] #4 No regressions: chat-session, ui and desktop test suites pass, goldens untouched
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Repro: boot sidecar (BUN_PORT=4317) + vite :3001, load /ai, locate [data-slot=acp-tool-call-card], dump bounding box, innerText, child DOM and computed width constraints; read the replayed card row from user.db to capture the exact card shape (AC#1).
2. Diagnose: compare against Bubble/Message width chain (chat-card-switch AssistantBubble wraps the card; card is w-full) and the render branches in acp-tool-call-states (empty title/input/output vs diff vs image). State root cause in notes (AC#2).
3. Fix at the responsible layer, minimal; add/extend a test pinning the shape.
4. Re-verify in the :3001 harness: card at normal transcript width, content visible (AC#3); run chat-session + ui + desktop suites, goldens untouched (AC#4).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Repro (AC#1)

Seeded the persisted chat blob (`manobu:chat:v1`) with two real completed tool-call cards built verbatim from local.db rows 117/122 (conversation 5045c1a3, rg tool calls, `content` = [{type:"content",content:{type:"text",text:...}}], long titles, big rawOutput) plus a user card and a text card, and loaded /dev/chat-history on the vite :3001 harness (same renderer chain as /ai; the /ai WS replay does not trigger in headless). Measured with Playwright:

- card: w 0, h 816 (35 KB text) and w 0, h 801 (317 chars) -> invisible tall sliver
- bubble-content / bubble: w 22 (padding only); message-content: w 624 (space IS available)
- The even-smaller card collapses too, so the giant JSON `pre` is NOT the cause.
- A seeded `acp_permission` card collapses identically (w 0, h 1135). All four Card-based chat cards (tool-call, permission, ask, terminal) share the pattern.

## Root cause (AC#2)

Layout constraint, not a content gap. The ui `Card` carries `[container-type:inline-size]` (powers the `card_header` container query in globals.css). Inline-size containment makes the card's intrinsic inline size 0 for outer layout. `Bubble` is `w-fit` (fit-content) and `Bubble.Content` is `w-fit`, so the bubble sizes to the card's intrinsic contribution = 0, clamped to padding (22px); the card's own `w-full` then computes to 0 content width. Decisive experiment: setting `containerType = "normal"` on the card element in the live page jumps it from w 0 to w 477 with full content rendered; making bubble-content `width:100%` alone does nothing (the chain above it is still fit-content).

## Fix decision

Not a per-card `[container-type:normal]` override in four components (duplicates the workaround, keeps the 80%-fit bubble semantics, and silently kills the container query). Instead, at the chat-session dispatch layer: the four Card-based families are block transcript content and render in a stretched ghost bubble (Bubble w-full + ghost variant, Bubble.Content w-full). A definite parent width makes containment moot; text/thinking/plan keep the fit-content secondary bubble; cards keep their container query and design-system semantics.

## Implementation + validation

Fix landed in packages/chat-session/src/chat-card-switch.tsx: AssistantBubble gained a `stretch` mode (ghost variant, Bubble w-full items-stretch, Bubble.Content w-full); STRETCHED_TYPES = the four Card-based families (acp_tool_call, acp_permission, ask, acp_terminal_output). No ui changes; Card containment and its container query stay intact. Pinned by 6 new SSR tests in chat-card-switch.test.tsx.

Validation:
- Harness (vite :3001, /dev/chat-history, seeded blob): tool cards w 0 -> 622 (bubble 624), titles + JSON output pre visible (screenshot /tmp/t90-after.png); permission card w 0 -> 622.
- Suites: chat-session 145 pass, ui 143 pass, desktop 391 pass / 3 skip, 0 fail. Goldens untouched (git status shows only chat-card-switch.tsx/.test.tsx + AGENTS.md docs).
- ultracite check clean on changed files.
- DOX: packages/chat-session/AGENTS.md dispatch bullet documents STRETCHED_TYPES; packages/ui/AGENTS.md records the Card containment interface consequence.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the collapsed tool-call card: the ui Card's [container-type:inline-size] contributes 0 to a fit-content parent, so a w-full Card inside the w-fit assistant Bubble rendered at 0px width (all four Card-based chat families were affected). Fix in chat-session dispatch: the Card families now wrap in a stretched ghost bubble (STRETCHED_TYPES in chat-card-switch.tsx); no ui changes. Verified in the vite :3001 harness with real local.db cards (0 -> 622px, content visible, screenshot) and pinned by 6 SSR tests; chat-session 145, ui 143, desktop 391 tests pass, goldens untouched. DOX updated (chat-session + ui AGENTS.md).
<!-- SECTION:FINAL_SUMMARY:END -->
