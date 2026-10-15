---
id: TASK-162
title: 'Drill: first run defaults to draw mode, so a learner sees no answer options'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 08:28'
updated_date: '2026-09-28 13:42'
labels:
  - drill
  - ux
dependencies: []
priority: low
type: bug
ordinal: 927000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA walk 2026-09-28: opening the drill showed a stroke-tracing surface with no options and no hint that a choice existed. The answer-options mode was only reachable by picking "あ pick it".

The default is set in code: `type Mode = "draw" | "pick" | "say"` (apps/desktop/src/features/drill/drill-lab.tsx:228), `loadMode` reads the stored preference and falls back with `return "draw"` (:240), and the state seeds from it (`useState<Mode>(loadMode)` at :378). Options belong to "pick", so the first-run learner gets the mode that hides them.

Not a rendering bug. The question is whether the surface that a learner reaches without any stored preference should open on the most demanding mode.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The task records which mode a first-run learner should land on and why
- [x] #2 Whatever the default, the current mode is legible on arrival and the other modes are discoverable without prior knowledge
- [x] #3 A stored preference still wins over the default, so the change does not reset anyone
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Decision on AC#1 (which mode a first-run learner lands on)

Scoring "pick" as the new default, verified live (headless chromium at :3001, deck = Hiragana):

- `draw` is the current fallback (`drill-lab.tsx:240`). On arrival the learner sees the card, the 米字格 box with a faint ghost and one animated stroke, and no answer options at all. Zero instruction text anywhere on the page (`instruction: []`). That is the bug this task names.
- `say` needs a microphone and a working Tauri STT bridge; in a plain browser session `detectMic` degrades it to disabled. Cannot be the first-run default.
- `pick` is the only mode that answers with a tap on every deck, with no hardware and no stroke-order knowledge. So `pick` is the default.
- Caveat found while verifying, and it changes the wording of AC#2, not the default: `pick` prints the target character at `drill-lab.tsx:846-854` AND includes that same character among the four buttons (`:1359-1398`). Live read: `cardTop: "あ"` with `pickButtons: ["う","あ","ん","い"]`. So `pick` is a visual-match task, not recall. The instruction line must say "tap the character that matches the one above", not imply recall. Hiding the card-top character in pick mode would make it a recall task; that is a change to the drill design, outside the approved "default + legibility" scope, and is reported rather than silently done.

## Scope (user-approved: "Default + legibility")

1. Extract a pure `resolveMode(stored: string | null): Mode` beside a named `DEFAULT_MODE: Mode`, and have `loadMode` delegate to it. Precedence unchanged: a stored value wins over the default; an unreadable store falls back to the default.
2. `DEFAULT_MODE = "pick"`.
3. Per-mode instruction line (`MODE_INSTRUCTION`), rendered under the chips, naming what the ACTIVE mode actually asks. Honest per the caveat above.
4. Make the group label visible: replace `<legend className="sr-only">Answer mode</legend>` (`:737`) with a visible legend, chips wrapped in a row so the label sits above them.

## Tests (no source-text assertions; TASK-134)

- New `apps/desktop/test/drill-mode.test.ts`, pure seam via `__test__`: `resolveMode("draw")==="draw"` (stored precedence), `resolveMode(null|undefined-ish|garbage)===DEFAULT_MODE`, `DEFAULT_MODE==="pick"`, and `loadMode()` in the node test env (no `localStorage`) returns `pick`, which pins the unreadable-store branch.
- `MODE_INSTRUCTION` total over `Mode` (Record type) and one non-empty honest string per mode.

## Gate

Two mutation seams in `scripts/mutation-gate.ts`: flip `DEFAULT_MODE` to "draw" (must be caught), and break one stored-value arm in `resolveMode` (must be caught). Then `--check` + `bun run gate:mutation <id>` per seam.

## Verify live

Headless chromium: arrival lands on `pick` with visible options and the instruction line; a stored `manobu.drillMode=draw` still wins; screenshot both.

## Docs

`apps/desktop/AGENTS.md` drill-lab row: new default + why + the pick-is-a-match caveat + the legibility line.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC evidence.

#1 Landed-on mode: `pick`, `apps/desktop/src/features/drill/drill-lab.tsx:236 const DEFAULT_MODE: Mode = "pick"`. Reasoning is in the plan above (only mode answerable by tap on every deck, no mic, no stroke knowledge). Caveat recorded there too: pick prints its own answer at `:846-854`, so it is a match task.

#2 Legibility + discoverability, live in headless chromium at :3001 with a fresh profile. The group label is visible now, not `sr-only`: `<legend className="text-muted-foreground text-xs">Answer mode</legend>` (`:758`), chips in a row under it. One instruction line per mode renders below the chips (`MODE_INSTRUCTION` at `:258`, rendered at `:785-790` as `data-testid="drill-mode-instruction"` with `aria-live="polite"`). Arrival read: legend 67x15px, instruction "tap the character that matches the one above" 262x19px, chips ["✍ draw it","あ pick it <- ACTIVE","🎤 say it"], pickButtons ["い","う","ん","あ"]. Tapping say it -> "say this character out loud"; tapping draw it -> "trace each stroke over the faint guide". Screenshots /tmp/t162-shots/162-a-arrival.png and 162-b-stored-draw.png. Whole pick loop driven too: correct tap -> 朱 stamp + "1/46 mastered" -> auto-advance to い -> wrong tap -> phase wrong + "1 to redo" -> `drill-card-continue` advances to the next card.

#3 Precedence unchanged: `loadMode` (`:244`) delegates to the pure `resolveMode(stored)` (`:239`), which honours a stored mode and only then falls back. Live: tap draw it, reload -> `stored:"draw"`, "✍ draw it <- ACTIVE", no options. So the flip resets nobody.

Verification: `bun run test` (turbo) 10/10 tasks, desktop 488 pass / 0 fail; `bun x tsc --noEmit` clean in apps/desktop; `bun x ultracite fix` clean on the three changed files; `bun scripts/mutation-gate.ts --check` -> all 44 seam anchors resolve; seams `drill-first-run-lands-on-pick` and `drill-stored-mode-outranks-the-default` both CAUGHT; `bun run check:dox` clean. Docs: `apps/desktop/AGENTS.md` drill-lab row rewritten (new default, why, the match caveat, the legibility line, the two new test/gate names).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A learner with no stored preference now opens the drill in `pick`, the one mode that answers with a tap on every deck, and the surface says what it asks. `loadMode` was a hardcoded `return "draw"` fallback; it now delegates to a pure `resolveMode(stored)` beside a named `DEFAULT_MODE = "pick"` (`apps/desktop/src/features/drill/drill-lab.tsx:236-249`), so a stored choice still outranks the default and an unreadable store still degrades instead of throwing. Legibility: the `Answer mode` legend is visible instead of `sr-only` (`:758`) and a per-mode instruction line renders under the chips (`MODE_INSTRUCTION`, `:785-790`), worded honestly because pick prints its own target above the four choices, so it is a match, not recall.

Verified by driving the real surface in headless chromium: arrival lands on pick with options visible and the instruction line rendered; a stored `manobu.drillMode=draw` survives a reload; the full pick loop grades (朱 stamp, mastered count, auto-advance, wrong -> redo queue -> tap-to-continue). Pinned by `apps/desktop/test/drill-mode.test.ts` (calls the pure seam; no source-text assertions) and two mutation seams, both CAUGHT. `bun run test` 10/10 tasks green, `tsc --noEmit` clean, `check:dox` clean, `apps/desktop/AGENTS.md` drill-lab row updated.

Left as a finding, not fixed: making pick a recall task means hiding the card-top glyph, which is a drill-design change outside this task.
<!-- SECTION:FINAL_SUMMARY:END -->
