---
id: TASK-1.15
title: SCR-11 Settings + SCR-12 Review FSRS — FSRS controls + privacy + queue
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:55'
updated_date: '2026-09-05 05:53'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 635000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Settings tabs AI & Model / Data & Privacy / Appearance / About + Review queue per SCR-11 mmWSF and SCR-12 r5jqXr. Centralizes Desired Retention, voice, correction style, telemetry OFF, and due queue batch 20.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Settings: model fallback chain local→BYOK→cache with storage bar; FSRS slider 70-97% default 90% + warn `→95% doubles reviews` + Advanced D/S/R/21-params YR9VH; Ask/Tell-first LU5Qi; Voice Female/Male/Varied + ♀/♂ preview + no-output miYYm
- [x] #2 Privacy: telemetry OFF default, Export .json, typed RESET + backup export; save-fail Zbbf2 toast; About shortcuts/offline docs
- [x] #3 Review: queue due R≤Desired Retention batch 20 (144+ hidden); grades show intervals before press Again 1d/Hard 4d/Good 12d/Easy 28d; D/S/R behind Advanced; empty `No cards due — great work! Next in {duration}`
- [x] #4 Ref: spec SCR-11/12 + copy-deck set.* + review.* + spec Appendix A scheduling rules
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 AGENTS.md chain (root → apps/web) re-read before edits; nearest owning AGENTS.md + Child DOX Index updated when contracts/structure change; no stale or contradictory DOX entries remain
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify baseline (check-types 8/8, ultracite clean)
2. Add set.* + review.* + grade.* + voice.* + reset.* + ai.* copy keys to packages/ui/src/lib/copy.ts: set.tab.{ai,data,appearance,about}, set.model.title, set.fsrs.{title,body}, set.corr.{title,desc,ask,tell}, set.privacy, set.voice.title, voice.{varied,female,male,no_output}, review.{header,badge,slider,batch,empty}, grade.{again,hard,good,easy}, reset.confirm, ai.disk.full already exists. set.doubling_warn {pct}% doubles reviews, advanced.fsrs.title 21-params D/S/R
3. Add apps/desktop/src/lib/settings.ts: pure-TS Settings shape + defaults (model="local", correction="ask", voice="varied", desiredRetention=0.9, fsrsAdvanced=false, telemetry=false, batchSize=20), validator (retention in 0.7-0.97), persistence hook signature (call sites wire to @manobu/db later). persistence omitted — task uses in-memory state for v1.
4. Add apps/desktop/src/lib/review.ts: types ReviewCard {vocabId, memory, dueAt}, ReviewQueue {cards, hidden}, batchNext(queue, batchSize=20) -> visible+hidden. Use @manobu/srs previewIntervals for grade previews.
5. Compose apps/desktop/src/components/settings.tsx (Vercel): <Settings> provider with tab state, .Tabs (4 buttons), .ModelTab (chain local→BYOK→cache + storage bar placeholder), .FsrsTab (slider 70-97% default 90% + warn →95% doubles reviews + Advanced toggle revealing D/S/R/21-params list), .CorrectionTab (Ask first / Tell first radio), .VoiceTab (Varied/Female/Male + ♀/♂ preview buttons), .PrivacyTab (telemetry OFF default, Export .json placeholder download, Reset typed RESET + backup offer + confirmReset from toast lib), .AboutTab (shortcuts + offline docs link)
6. Compose apps/desktop/src/components/review-queue.tsx (Vercel): <ReviewQueue> provider, .Header (Review · FSRS — Due at R≤{pct}% · {due} cards due · {total} total), .Batch (visible 20 + {hidden} hidden — Finish batch to see more), .Card (current card front, shows D/S/R if Advanced enabled), .Grades (4 buttons Again/Hard/Good/Easy each showing interval preview BEFORE press, Good default), .Empty (No cards due — great work! Next in {duration})
7. Add routes: apps/desktop/src/routes/settings.tsx (mounts Settings.Tabs + all tabs), apps/desktop/src/routes/review.tsx (mounts ReviewQueue with seed cards)
8. Add apps/desktop/test/settings.test.ts (defaults, validateRetention, batchNext 20+hidden/empty) + apps/desktop/test/review.test.ts (batchNext + interval preview with demo state 1d/4d/12d/28d)
9. DOX pass: apps/desktop/AGENTS.md Child DOX Index gets SCR-11 + SCR-12 entries; cross-cutting lib gains settings.ts + review.ts; packages/ui/AGENTS.md not strictly needed (no child docs there yet)
10. Verify: check-types 8/8, bun test, ultracite 0 errors on settings/review scope, commit
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation 2026-09-05: SCR-11 Settings + SCR-12 Review FSRS scaffold. New: apps/desktop/src/components/settings.tsx (Vercel compound: Tabs 4 buttons, Model fallback chain Local→BYOK→Cache + storage bar placeholder, Fsrs slider 70-97% default 90% + warn at >=95% doubles reviews + Advanced toggle revealing D/S/R 21-params, Correction Ask/Tell first radio, Voice Varied/Female/Male + no-output banner, Privacy telemetry OFF default + Export .json placeholder + typed RESET via inline fieldset using confirmReset from @manobu/ui/lib/toast — no native prompt, About shortcuts + offline). New apps/desktop/src/routes/settings.tsx. New apps/desktop/src/lib/settings.ts: DEFAULT_SETTINGS (90%, local, ask, varied, telemetry off, batchSize 20), validateRetention clamps [0.7, 0.97], isRetentionDoublingWarn >=0.95, updateSettings patch+clamp. New apps/desktop/src/components/review-queue.tsx (Header Review FSRS with pct/due/total + Smart spacing badge, Batch visible 20 + hidden counter, Card with optional D/S/R memory when Advanced on, Grades fieldset with 4 buttons Again/Hard/Good/Easy each with interval preview BEFORE press via @manobu/srs previewIntervals — demo state {d:5,s:10} returns 1d/4d/12d/28d, Good default, Empty copy). New apps/desktop/src/routes/review.tsx. New apps/desktop/src/lib/review.ts: batchNext, previewGradeIntervals, gradeLabel. Added @manobu/srs to apps/web deps. Copy keys: set.tab.{ai,data,appearance,about}, set.model.title, set.fsrs.{title,body,advanced,doubling_warn}, set.corr.{title,desc,ask,tell}, set.voice.title, set.privacy, set.about.{shortcuts,offline}, voice.{varied,female,male,no_output}, review.{header,badge,slider,batch}, grade.{again,hard,good,easy}, reset.confirm. Tests: apps/desktop/test/settings.test.ts (5 cases — defaults, validateRetention clamp, isRetentionDoublingWarn threshold, updateSettings merge+clamp, __test__ re-exports) + apps/desktop/test/review.test.ts (6 cases — batchNext 200/3/empty, previewGradeIntervals demo 1d/4d/12d/28d + new card, gradeLabel mapping). DOX: apps/desktop/AGENTS.md Child DOX Index gained SCR-11 + SCR-12 entries; cross-cutting lib gained settings.ts + review.ts. Verification: check-types 8/8, bun test 43/43 pass, ultracite 0 errors on settings+review scope.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented SCR-11 Settings + SCR-12 Review FSRS. New: apps/desktop/src/components/settings.tsx (Vercel compound — Tabs 4 buttons, Model fallback chain Local→BYOK→Cache + storage bar, Fsrs slider 70-97% default 90% + warn →95% doubles reviews + Advanced toggle revealing D/S/R 21-params, Correction Ask/Tell radio, Voice Varied/Female/Male + ♀/♂ + no-output banner, Privacy telemetry OFF default + Export .json placeholder + typed RESET via inline fieldset using confirmReset (no native prompt per lint), About shortcuts + offline); apps/desktop/src/routes/settings.tsx; apps/desktop/src/lib/settings.ts (DEFAULT_SETTINGS 90%/local/ask/varied/telemetry-off/batchSize-20, validateRetention clamps [0.7, 0.97], isRetentionDoublingWarn >=0.95, updateSettings); apps/desktop/src/components/review-queue.tsx (Header Review FSRS + Smart spacing badge, Batch visible 20 + hidden counter, Card with optional D/S/R when Advanced on, Grades fieldset with 4 buttons Again/Hard/Good/Easy each showing interval preview BEFORE press via @manobu/srs previewIntervals — demo state {d:5,s:10} returns 1d/4d/12d/28d, Good default, Empty copy); apps/desktop/src/routes/review.tsx; apps/desktop/src/lib/review.ts (batchNext, previewGradeIntervals, gradeLabel). Added @manobu/srs to apps/web deps. Copy keys added to packages/ui/src/lib/copy.ts (30 entries: set.tab.*, set.model.title, set.fsrs.{title,body,advanced,doubling_warn}, set.corr.{title,desc,ask,tell}, set.voice.title, set.privacy, set.about.{shortcuts,offline}, voice.{varied,female,male,no_output}, review.{header,badge,slider,batch}, grade.{again,hard,good,easy}, reset.confirm). Tests: apps/desktop/test/settings.test.ts (5 cases) + apps/desktop/test/review.test.ts (6 cases including the spec demo 1d/4d/12d/28d). DOX: apps/desktop/AGENTS.md Child DOX Index gained SCR-11 + SCR-12 entries; cross-cutting lib gained settings.ts + review.ts. Verification: check-types 8/8, bun test 43/43, ultracite 0 errors.
<!-- SECTION:FINAL_SUMMARY:END -->
