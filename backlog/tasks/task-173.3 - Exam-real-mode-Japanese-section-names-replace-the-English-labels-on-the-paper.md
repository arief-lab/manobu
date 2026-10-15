---
id: TASK-173.3
title: >-
  Exam (real mode): Japanese section names replace the English labels on the
  paper
status: Done
assignee:
  - '@arif'
created_date: '2026-09-29 10:45'
updated_date: '2026-09-29 18:26'
labels: []
dependencies:
  - TASK-173.1
documentation:
  - doc-26
parent_task_id: TASK-173
priority: medium
type: feature
ordinal: 941000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`EXAM_SECTION_LABELS` (`packages/api-contract/src/exam.ts:36-41`) and `EXAM_SCORING_SECTION_LABELS` render English column names ("Vocabulary", "Grammar·Reading", "Listening", "Language Knowledge·Reading", "Reading"). The real paper prints 科目 names like 言語知識（文字・語彙・文法）・読解 and 聴解. These labels reach the learner through `examSectionLabel` in the chat summary and result pane, so the real mode must show Japanese names.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A real-mode renderer prints the official Japanese 科目 names for every section and scoring column
- [x] #2 English labels remain available for internal non-learner contexts so existing consumers do not break
- [x] #3 The level/id parity test `apps/server/test/exam-section-labels.test.ts` still passes, extended for the Japanese names
- [x] #4 No English section name reaches the learner surface in real mode
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach

Add Japanese twins to the one label declaration, switch on `mode`, and leave the
English functions untouched so AC#2 holds by construction.

### 1. Where the language choice lives (material decision, needs approval)

Keep `examSectionLabel(id)` and `examScoringSectionLabel({id, level})` and both
English tables byte-for-byte as they are. Add:

- `EXAM_SECTION_LABELS_JA` / `EXAM_SCORING_SECTION_LABELS_JA`, each
  `satisfies Record<..., string>` so a new section id fails to compile rather
  than defaulting to English (the TASK-137 failure mode).
- ONE chooser per fact: `examSectionLabelForMode({id, mode})` and
  `examScoringSectionLabelForMode({id, level, mode})`. `real` selects the
  Japanese table, every other mode the English one. The `language-knowledge`
  switch reuses the existing `FOLDED_READING_LEVELS`.

Rejected alternative: thread `mode` into the two existing functions. That
renames the contract of every internal caller (audit rows, logs,
`paper-fallback.ts`) and turns "English for non-learner contexts" into a branch
every caller must remember, instead of the unchanged default.

### 2. The strings, each read off a page this session

| section id | Japanese | provenance |
|---|---|---|
| `vocabulary` | 言語知識（文字・語彙） | N5V/N4V/N3V.pdf running header |
| `grammar-reading` | 言語知識（文法）・読解 | N5G/N4G/N3G.pdf running header |
| `language-knowledge-reading` | 言語知識（文字・語彙・文法）・読解 | N2V/N1V/N2G/N1G.pdf |
| `listening` | 聴解 | N5L.pdf, 試験科目 column, all levels |
| `reading` | 読解 | jlpt.jp/guideline/results.html 得点区分 |
| `language-knowledge` | N1/N2 言語知識（文字・語彙・文法）; N4/N5 folded, so the `language-knowledge-reading` name | results.html |

Ruby-free forms only: the official pages print furigana inside the names and a
learner string must not.

### 3. Call sites

Learner surfaces move to the chooser:
- `apps/desktop/src/features/exam/exam-paper-pane.tsx:309` and `:388` (`exam.mode`
  is already in scope), `:897` and `:927` (thread mode as a prop from `Result()`,
  which holds `exam`).
- `apps/server/src/services/exam-service.ts:2058` (`paperFrameData` has `receipt.mode`).
- `packages/chat-session/src/chat-engine/folds/paper.ts:40` and `:66`
  (`projectResult` gains a `mode` argument; the frame data already carries it).
- `apps/desktop/src/lib/paper-notice.ts`: add `"mode"` to the `PaperBuildResult`
  Pick and use the chooser in `missingBlockList`.

Stays English, with a comment saying why:
- `apps/desktop/src/lib/paper-fallback.ts:28` - the offline card hardcodes
  `mode: "shortened"`, so it is never a real-mode surface.

### 4. Proofs

- `apps/server/test/exam-section-labels.test.ts` (AC#3): existing English
  expectations unchanged, plus `OFFICIAL_SECTIONS_JA` and
  `OFFICIAL_SCORING_SECTIONS_JA` asserted through the chooser for every level.
- `packages/api-contract` test: the ambiguous `language-knowledge` id in
  Japanese, and every non-real mode in `EXAM_MODES` returning English.
- `apps/desktop/test/exam-workspace.test.ts`: real-mode nav chip and section
  heading print Japanese; `shortened` and `exam-conditions` still English.
- New mutation-gate seams: chooser ignores `real`, frame label ignores mode,
  notice ignores mode. Then `bun scripts/mutation-gate.ts --check`.

### 5. Verification and docs

`bun x ultracite fix`, `bun run check-types`, package test suites,
`fallow dead-code --boundary-violations`, `bun run check:dox`. DOX pass over
api-contract / server / desktop / chat-session AGENTS.md and a doc-26 section
carrying the provenance table.

### Out of scope, report only

The N3 blueprint scores `vocabulary` / `grammar-reading` / `listening`, while the
official N3 得点区分 is 言語知識（文字・語彙・文法）/ 読解 / 聴解. The Japanese
names therefore follow the 試験科目 at N3, which is what the English table
already does. Changing the N3 scoring split is an id-composition decision, not
a labelling one, so it is recorded as a finding rather than folded into this task.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation: apps/server bun test exam-section-labels+exam-paper-frame-labels = 9 pass; apps/desktop exam-workspace+paper-notice+exam-result-copy = 28 pass; packages/chat-session paper.test = 5 pass. bun run check-types 14/14; ultracite clean on the 9 touched sources; mutation-gate --check = 82 anchors resolve (5 new seams added); check:dox complete; fallow boundary-violations 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Japanese 科目 names added beside the English tables in packages/api-contract/src/exam.ts (EXAM_SECTION_LABELS_JA :86, EXAM_SCORING_SECTION_LABELS_JA :96, both satisfies Record<...,string>) and one mode chooser per fact (examSectionLabelForMode :113, examScoringSectionLabelForMode :125): real selects Japanese, every other mode the unchanged English function, so AC#2 holds by construction. Every learner surface routes through the chooser with the paper's own mode: the server frame (paperFrameData, receipt.mode), the chat-session fold (projectResult gains mode), the desktop pane nav/heading (exam.mode) and both result views (result.mode), and the build notice (receipt.mode). English functions byte-for-byte unchanged; paper-fallback stays English (offline card is always shortened). Verified by the parity test extended for both languages plus the non-real-returns-English loop (AC#1/#3/#4), and 5 new mutation-gate seams that each fail if a surface ignores mode.
<!-- SECTION:FINAL_SUMMARY:END -->
