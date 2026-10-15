---
id: TASK-89
title: Audit Tailwind @source coverage for all shared packages shipping JSX
status: Done
assignee:
  - '@arif'
created_date: '2026-09-21 08:46'
updated_date: '2026-09-21 09:07'
labels:
  - bug
  - ui
  - chat
dependencies: []
ordinal: 740000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/ui/src/styles/globals.css only @sources apps/** and packages/ui/**, so any other shared package shipping Tailwind utility classes in JSX is invisible to the scanner: its classes land in the served CSS only by coincidence when an app or ui file happens to use the same class. TASK-87 found this for packages/chat-session (rotate-90 and max-h-64 were absent from the CSS until an explicit @source line was added to apps/desktop/src/index.css) and fixed just that package. Other candidates (speech, agent, skills, anything else under packages/ with .tsx) likely share the hole, and chat-session classes that were silently unstyled before the fix may now visibly change appearance, so a regression sweep of /ai and chat surfaces is part of the job. See the FINDING note in TASK-87 implementation notes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every package under packages/ that ships JSX with Tailwind utility classes is identified (a repo-wide grep for class=/.cn( in packages/*/src/**/*.tsx is enough to enumerate them)
- [ ] #2 Each such package has an explicit @source line in the consuming app CSS (apps/desktop/src/index.css or equivalent), or is verified to need none, with the reason recorded
- [ ] #3 The doc note in apps/desktop/src/AGENTS.md about adding @source lines for new shared JSX packages is updated to reflect the final list
- [ ] #4 Visual regression sweep on /ai, /dev/chat-history and any newly-covered package surface: no previously-unstyled class changes appearance unexpectedly; screenshots or a written pass statement recorded in the task notes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Enumerate (done): only packages/ui and packages/chat-session ship JSX+utility classes; agent/skills/speech/acp/... have zero .tsx and zero className/class=/cn(. desktop is the only CSS-consuming app (server is JSON API); chat-session consumers are all under apps/desktop and share its single index.css entry.
2. AC#2 outcome: no new @source lines needed. ui is covered by globals.css '../**'; chat-session by index.css line 7 (TASK-87). Record the per-package reason (need none: no JSX shipped).
3. Deterministic regression check: build the desktop CSS, diff the utility set WITH vs WITHOUT the chat-session @source line, to enumerate exactly which classes the TASK-87 fix newly applied and confirm they are benign.
4. Browser sweep on vite :3001 (TASK-42 rule): load /ai (needs sidecar on BUN_PORT=4317) and /dev/chat-history (seeded localStorage), screenshot both, confirm chat surfaces render coherently; record pass statement + any newly-styled classes.
5. AC#3: update the @source note in apps/desktop/src/AGENTS.md to state the final covered list and the rule for future packages.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AUDIT RESULT (AC#1/#2): find over packages/ shows ONLY ui (34 tsx) and chat-session (17 tsx) contain .tsx; grep for className=|class=|cn(|hono/jsx|React.createElement across every other package (agent, skills, speech, acp, api-contract, db, env, japanese, srs, config, jlpt-mcp) returns NONE. So the complete set of packages shipping JSX utility classes is {ui, chat-session}. Coverage: ui via globals.css '../**'; chat-session via apps/desktop/src/index.css line 7 (TASK-87). desktop is the only CSS-consuming app (server = JSON API); all chat-session consumers are apps/desktop routes sharing that one index.css. No new @source lines needed; reason recorded in apps/desktop/src/AGENTS.md:26 (AC#3).

REGRESSION SWEEP (AC#4): (a) Deterministic build diff - ran vite build with vs without the chat-session @source line; the emitted CSS differs by EXACTLY 5 selectors, 0 removals, 0 modifications. Added: .max-h-64 .rotate-90 .space-y-1 (real, used by acp-thinking-part + chat-card-switch PlanChecklist) + .start-1 and bare .transition (Tailwind lexical false-positives: the literal 'start-1' appears as a msg_id string in chat-engine-golden.test.ts:39, which the src/**/*.{ts,tsx} glob scans; both emit unused rules, harmless). (b) Browser run on vite :3001 (TASK-42 rule, system chromium) at /dev/chat-history with a seeded {messages:[thinking,text,plan]} blob: collapsed strip hides reasoning (true), answer visible (true), Thought label present (true), click expands to full reasoning (true); computed styles confirm the newly-applied utilities take effect - pre max-height 256px (max-h-64), overflow-y auto, plan li margin-bottom 4px (space-y-1), chevron CSS rotate property none->90deg on expand (rotate-90; note v4 uses the standalone 'rotate' property, not 'transform'). /ai renders with no error boundary; its only non-2xx is 404 /rpc/chat/slashCommands, which apps/server/AGENTS.md documents as EXPECTED on a fresh conversation (useSlashCommands degrades to []), unrelated to styling. PASS: no previously-unstyled class changed appearance unexpectedly; the fix is strictly additive.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Tailwind @source coverage audited repo-wide. Finding: only packages/ui and packages/chat-session ship JSX utility classes; every other packages/* (agent, skills, speech, acp, api-contract, db, env, japanese, srs, config) has no .tsx and no className/class=/cn( - verified by find + grep. ui is covered by globals.css '../**', chat-session by the index.css @source line added in TASK-87, so NO new @source lines are required. apps/desktop is the sole CSS-consuming app. AC#4 regression proof is two-fold: a vite-build diff shows the chat-session @source line adds exactly 5 selectors (3 real thinking/plan utilities + 2 harmless lexical false-positives from a test msg_id), with zero removals/modifications; and a headless-browser run on /dev/chat-history confirms the newly-styled utilities apply at runtime (max-h-64->256px, space-y-1->4px, rotate-90->rotate:90deg on expand) and the collapsed/expanded thinking behavior is intact. /ai's lone 404 (slashCommands NOT_FOUND on a fresh convo) is pre-existing and documented. Doc note in apps/desktop/src/AGENTS.md updated with the final list. Docs-only change; no source/config/test touched.
<!-- SECTION:FINAL_SUMMARY:END -->
