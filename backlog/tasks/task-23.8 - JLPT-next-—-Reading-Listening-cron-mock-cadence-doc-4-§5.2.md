---
id: TASK-23.8
title: JLPT next — Reading/Listening + cron mock cadence (doc-4 §5.2)
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-06 06:03'
updated_date: '2026-09-09 03:13'
labels:
  - jlpt
  - cron
  - doc4
dependencies:
  - TASK-23.7
parent_task_id: TASK-23
priority: medium
type: feature
ordinal: 596000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
jlpt-mock Choices with Text grammar before EJU copies shell. Add one information retrieval + one short passage per N5/N4 reusing Reader N5_DEFAULT コンビニで 12 sentences. Add Mock.Listening via TASK-21.1 speak({speed 0.8/1.0, sid ♀/♂}) [▶]; keep SubmitFail Retry WAL. Add bi-weekly JLPT mock → weak topology → 7-day Plan cron job ICronJob every 14d newConversation. See doc-4 §5.2.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Reading passage type in mock: one information retrieval + one short passage per N5/N4 reusing Reader collection
- [x] #2 Listening stub via TASK-21.1 TTS s peed wiring to Mock.Listening card; Verify listening choice same shape Choices
- [x] #3 Cron: bi-weekly JLPT mock → weak → Plan job ICronJob {cronExpr|interval|oneTime, tz} every 14d newConversation via doc-1 Tier B packages/cron + MCP catalog C1 fan-out
- [x] #4 Verification: JLPT mock now exercises reading/listening; Timer + Score still pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes: AC#1 — two section-tagged reading questions built from Reader N5_DEFAULT コンビニで reuse: information-retrieval notice (おしらせ, 24時間/110円) + short passage (どきょ, narrative) rendered by JlptMock.ReadingCard (stimulus keyed by question id); same Choices shape, section:'reading' feeds the TASK-23.7 sectional scoring. AC#2 — JlptMock.ListeningCard with [▶] mock-listening-play via dynamic @manobu/speech/tts speak() at useTtsPrefs speed/sid (Tauri-only; web-dev shows transcript fallback — hooks hoisted above the section guard to satisfy useHookAtTopLevel); one listening question (section:'listening'), choices same shape. Both cards mounted in the lazy route wizard between Progress and Choices; SEED grew q4-q6 (N3/N2/N1) + 3 section-tagged questions (9 total in all view). AC#3 — lib/cron.ts gains JLPT_PLAN_CRON_EXPR ('0 9 */14 * *' = every 14 days 09:00) + buildJlptPlanJob(tz) producing ICronJob {id: jlpt-plan-biweekly, executionMode: 'new' (= newConversation), queueProtection: true, level-agnostic Coach prompt (mock → weak → 7-day plan)}; CRON_PRESETS gains 'Bi-weekly Mon 9:00' so the settings ScheduledTasks creator offers the cadence. AC#4 — browser walkthrough on the all view: Q1-6 lang → Q7 reading (passage rendered, answered 24時間) → Q8 short passage (おにぎり) → Q9 listening ([▶] present) → submit → Score 56% with 'Language 40/120 ✓ · Reading 60/60 ✓ · Listening 60/60 ✓' (N5 caps, 'all' maps to N5) — Timer + Score verified working. bun test 234/0; tsc + ultracite clean. Lint fixes: hooks-order in ListeningCard, optional chains, dead builder fns removed, nested ternaries flattened.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped Reading/Listening sections + bi-weekly plan cron (doc-4 §5.2). Reading: two section-tagged questions reusing the Reader konbini content — an information-retrieval notice (営業時間) and a short narrative passage — rendered by a new JlptMock.ReadingCard above the shared Choices. Listening: JlptMock.ListeningCard with a [▶] TTS button (speak at the learner's TtsPrefs speed/sid, Tauri-only with a web-dev transcript fallback) and same-shape choices; section tags feed the TASK-23.7 sectional scoring directly. Cron: lib/cron.ts exports JLPT_PLAN_CRON_EXPR (0 9 */14 * *) + buildJlptPlanJob(tz) — ICronJob with executionMode 'new' (newConversation), queue-protected, level-agnostic Coach prompt for the bi-weekly mock → weak → 7-day plan cadence; 'Bi-weekly Mon 9:00' added to CRON_PRESETS for the settings creator. SubmitFail WAL retry untouched. Browser walkthrough (all view, 9 questions): lang → reading → listening → submit → Score 56% with 'Language 40/120 ✓ · Reading 60/60 ✓ · Listening 60/60 ✓'; Timer pause/resume and Score verified unchanged. bun test 234/0; tsc + ultracite clean on all touched files; AGENTS.md SCR-10/SCR-11 updated.
<!-- SECTION:FINAL_SUMMARY:END -->
