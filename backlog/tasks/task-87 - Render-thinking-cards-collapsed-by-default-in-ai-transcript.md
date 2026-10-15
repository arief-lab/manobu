---
id: TASK-87
title: Render thinking cards collapsed by default in /ai transcript
status: Done
assignee:
  - '@arif'
created_date: '2026-09-21 06:51'
updated_date: '2026-09-21 08:40'
labels:
  - ui
  - chat
dependencies: []
ordinal: 708000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Request (live smoke 2026-09-21)

The /ai transcript renders agent thinking fully expanded with raw content (the model literally quotes its tool instructions on screen). AionUi convention is thinking as a collapsed-by-default strip; raw reasoning is noise for a learner.

Keep thinking in the data model and replay (debugging/agent-transparency value) — this is a RENDERER change only, no wire or DB change.

## Acceptance criteria

1. AC#1: Thinking cards render collapsed by default: a one-line summary strip (e.g. "Thought for Ns" or first-line preview), expandable on click.
2. AC#2: During a live stream the strip shows streaming state and auto-collapses once the real answer (text card) arrives in the same turn.
3. AC#3: Expanded view still shows the full thinking content on demand (both live and replayed history).
4. AC#4: No changes to the wire frames or persisted rows; goldens untouched.

## Implementation direction

Renderer-only in chat-card-switch.tsx thinking row (packages/chat-session) and the thinking card body (packages/ui, TASK-81.3 subcomponents). Collapse state local per card id.

## Labels
ui, chat
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Thinking cards render collapsed by default as a one-line strip (chevron + 'Thinking...'/'Thought'), expandable on click
- [ ] #2 Live stream shows streaming state on the strip and auto-collapses once the same turn's text card arrives
- [ ] #3 Expanded view shows the full thinking content on demand, live and replayed
- [ ] #4 No changes to wire frames or persisted rows; goldens untouched
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. packages/ui: shadcn add collapsible (Base UI variant, done via CLI) as the shared primitive.
2. packages/chat-session: new parts/acp-thinking-part.tsx - ThinkingPart(card-ish props: text, isStreaming, answered). Collapsed-by-default strip (button trigger: 'Thinking…' while streaming / 'Thought for Ns' after; chevron), expanded shows raw thinking as plain mono text (no markdown of reasoning). Auto-collapse when the answer (text card, same msg_id) arrives unless the user toggled manually (ref latch).
3. message-transcript: useMemo Set of msg_ids that have a text card; pass hasAnswered through ChatCardRow -> ChatCardSwitch; thinking row renders ThinkingPart instead of TextPart. No engine/wire/golden changes.
4. Tests: extend chat-card-switch.test.tsx (collapsed default, expand on click, auto-collapse on answer, replayed history). Verify: bun run check-types, bun x ultracite check, bun run test in packages/chat-session + packages/ui.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Renderer-only, as scoped. New parts/acp-thinking-part.tsx (AcpThinkingPart) over a new @manobu/ui Collapsible (Base UI registry variant, packages/ui/src/components/collapsible.tsx); chat-card-switch thinking row now renders it instead of TextPart; message-transcript computes answeredTurnMsgIds(messages) once and passes answered per row. No engine, wire, persistence or golden change (AC#4): 139 chat-session + 143 ui + 391 desktop tests pass, goldens untouched.
Collapse state is one value: readerChoice ?? (isStreaming && !answered). Live turns read expanded and collapse when the turn's answer card lands; replayed history starts collapsed; a reader toggle wins for the rest of the turn. The strip shows 'Thinking...' / 'Thought' + chevron and deliberately does NOT preview the first line of reasoning (that would keep the raw content on screen, which was the complaint). Full text renders in a scrollable pre when expanded.
Browser-verified on the vite :3001 harness (TASK-42 rule) at /dev/chat-history with a seeded transcript: collapsed frame shows no reasoning text, click expands to the full text with the chevron rotated.
FINDING (out of scope, latent repo bug): packages/ui/src/styles/globals.css only @sources apps/** and packages/ui/**, so Tailwind never scanned packages/chat-session. Chat-card utilities worked only by coincidence (an app/ui file using the same class). Fixed for this task by adding @source ../../../packages/chat-session/src/**/*.{ts,tsx} to apps/desktop/src/index.css; rotate-90/max-h-64 went from absent to present in the served CSS. Other chat-session classes that were silently unstyled may now change appearance; and any other non-scanned package (speech, agent, skills) has the same hole.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Renderer-only collapse for thinking cards, as scoped. New AcpThinkingPart (packages/chat-session/src/parts/acp-thinking-part.tsx) over a new Base UI Collapsible primitive (packages/ui/src/components/collapsible.tsx, shadcn registry); the chat-card-switch thinking row renders it instead of TextPart; message-transcript computes answeredTurnMsgIds(messages) once and passes answered per row. Collapse state is one derived value: readerChoice ?? (isStreaming && !answered), so live turns expand while thinking and auto-collapse when the turn's answer card lands, replayed history starts collapsed, and a reader toggle wins for the rest of the turn. The strip shows 'Thinking...'/'Thought' + chevron and deliberately does not preview the first line of reasoning (that would keep the raw content the complaint was about). AC#4 held: no engine, wire, persistence or golden changes; 139 chat-session + 143 ui + 391 desktop tests pass, check-types 13/13, ultracite clean on changed files. Browser-verified on the vite :3001 harness at /dev/chat-history: collapsed frame shows no reasoning text, click expands to the full text with the chevron rotated. Caveat: the AC#2 live transition is proven by state-derivation tests and browser replay, not by a real streamed agent turn. FINDING beyond this task: globals.css never @scanned packages/chat-session, so chat utilities were unstyled unless an app/ui file coincidentally used the same class; fixed here with an @source line in apps/desktop/src/index.css (see task notes for the wider audit follow-up).
<!-- SECTION:FINAL_SUMMARY:END -->
