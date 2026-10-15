---
id: TASK-32.4
title: Remove any types from conjugate.tsx form integration
status: Done
assignee:
  - '@arif'
created_date: '2026-09-08 01:36'
updated_date: '2026-09-08 09:01'
labels:
  - frontend
  - types
dependencies: []
references:
  - apps/desktop/src/components/conjugate.tsx
  - apps/desktop/src/lib/form-options.ts
parent_task_id: TASK-32
priority: low
type: task
ordinal: 572000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/components/conjugate.tsx annotates the TanStack Form integration as form any plus field any and state any selectors. This escapes the Zod-backed formOptions safety used by SCR-06 Conjugate Lab and hides validator and submit-state regressions from check-types. Typing the form with its formOptions inference restores the Ultracite type-safety contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No any remains in conjugate.tsx for form, field, or Subscribe selectors
- [x] #2 Form types derive from conjugateFormOptions and Zod schemas in lib/form-options.ts
- [x] #3 bun run check-types and bun x ultracite check pass with no new suppressions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Extend 32.4 pattern to settings/ compounds + conversation; remove blanket biome ignores; derive types from formOptions; extract inline handlers.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Removed any from form/state/Subscribe; types derived from conjugateFormOptions; DOX read + updated. Check passes.

Partial: conjugate (full) + settings-privacy (rep); remaining scheduled-tasks, speech-models, conversation still have blanket ignores. Pattern: derive types from formOptions, extract useCallback handlers, remove suppressions file-by-file.

Full sweep: conjugate + settings-privacy (typed) + scheduled-tasks, speech-models, conversation (ignored removed). DOX noted. 32.4 complete.
<!-- SECTION:NOTES:END -->
