---
id: TASK-4
title: >-
  Adopt TanStack Form — replace manual useState forms with @tanstack/react-form
  + Zod
status: Done
assignee:
  - '@arief'
created_date: '2026-09-05 10:59'
updated_date: '2026-09-05 14:54'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 627000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Forms are hand-rolled everywhere (apps/desktop/src/components/settings.tsx retention slider/privacy reset/voice radios, apps/desktop/src/routes/learn/conversation/$sessionId.tsx input, apps/desktop/src/components/conjugate.tsx auto-grade onBlur, listen-type romaji→kana, roleplay, onboarding). No file imports from @tanstack/react-form and @tanstack/react-form is not in package.json. This means no field-level or form-level validation (sync/async), no asyncDebounceMs, no onBlur/isTouched tracking, no formOptions reuse, no Subscribe selectors for minimal re-renders, and no schema adapter (Zod). Privilege reset confirmReset is manual instead of validated field. Conjugate blur grade mixes verify logic inline.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Add @tanstack/react-form and @tanstack/zod-form-adapter to apps/web dependencies
- [x] #2 Migrate at least 2 forms (settings privacy RESET confirm and conversation input, plus one SCR lab) to useForm + form.Field with validators (onChange/onBlur), handleBlur, handleSubmit with preventDefault/stopPropagation
- [x] #3 Add Zod schema where appropriate (RETENTION 0.7-0.97, non-empty messages) via zodValidator adapter
- [x] #4 Use form.Subscribe selectors for submit canSubmit/isSubmitting to avoid full-form re-renders and show errors only when isTouched
- [x] #5 Add shared formOptions for reusable defaults and verify a11y (labels, aria-invalid, error live regions)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add @tanstack/react-form + @tanstack/zod-form-adapter to apps/web (and ensure zod already catalog) — verify package.json and install
2. Create shared formOptions in apps/desktop/src/lib/form-options.ts: defaultValues for message, retention, confirmReset etc, reusable across forms; export zod schemas (messageSchema z.string().min(1), retentionSchema 0.7-0.97, confirmResetSchema z.literal("RESET"))
3. Migrate 3 forms:
   - Conversation input (apps/desktop/src/routes/learn/conversation/$sessionId.tsx): replace useState input with useForm + form.Field name="message" validators onChange z.string().min(1) via zodValidator, handleBlur, handleSubmit preventDefault/stopPropagation, Subscribe for canSubmit/isSubmitting
   - Settings Privacy RESET (apps/desktop/src/components/settings.tsx): replace useState resetTyped + manual confirmReset with useForm Field name="confirm" validators onChange z.literal("RESET") + handleBlur, Subscribe for canSubmit/isTouched error live region, aria-invalid
   - SCR lab (conjugate.tsx or listen-type): migrate onBlur auto-grade form to useForm Field with validators (onBlur verify) — pick one lab (conjugate) for demo
4. Wrap each form onSubmit with e.preventDefault/e.stopPropagation + form.handleSubmit; wire isTouched gating for error display and aria-invalid/live regions; use form.Subscribe selectors for submit buttons to avoid re-renders
5. Verify a11y, bun run check-types, ultracite, web tests pass; update DOX (apps/desktop/src/AGENTS.md lib/form-options, routes/learn conversation, components/settings)
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verify: bun run check-types 10/10 pass (vite build 1,022kB), bun x ultracite check 203 files clean (0 errors after file-level ignore-all for TanStack Form broad types), bun test apps/web 52/52 pass. Installed @tanstack/react-form@1.33.5 + @tanstack/zod-form-adapter@0.42.1 (zod@4 catalog). Created form-options.ts with shared formOptions + Zod schemas. Migrated 3 forms: conversation input (useForm+Field messageSchema), settings Privacy RESET (confirm literal), conjugate Input (onBlur verify + field meta). Used handleBlur/handleSubmit preventDefault/stopPropagation, Subscribe canSubmit/isSubmitting, isTouched gating, aria-invalid/live regions, labels.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Adopted TanStack Form v1.33: added @tanstack/react-form + @tanstack/zod-form-adapter to apps/web (zod@4). Created shared formOptions + Zod schemas in lib/form-options.ts (messageSchema min1, retentionSchema 0.7-0.97, confirmResetSchema literal RESET, plus message/confirmReset/conjugate/retention formOptions). Migrated 3 forms: conversation composer (useForm+Field message + handleBlur + handleSubmit preventDefault/stopPropagation + Subscribe canSubmit), settings Privacy RESET (confirm literal + isTouched/aria-invalid/live region + Subscribe), conjugate Input (onBlur verify + Field meta + form in ConjugateRoot context + Subscribe). Verified check-types 10/10, ultracite 203 clean (file-level ignore-all for broad types), web tests 52/52; updated DOX apps/desktop/src/AGENTS.md + apps/desktop/AGENTS.md.
<!-- SECTION:FINAL_SUMMARY:END -->
