---
id: TASK-119
title: >-
  Kana: admission model and gate offer (named sources, skip that never passes,
  cooldown, settings reset)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:06'
updated_date: '2026-09-24 14:43'
labels: []
dependencies:
  - TASK-117
  - TASK-118
references:
  - 'apps/desktop/src/routes/drill.tsx:23'
documentation:
  - >-
    backlog/docs/feature/doc-13 -
    Kana-readiness-checkpoint-paper-scoring-and-retake-policy.md
  - >-
    backlog/docs/feature/doc-12 -
    Chat-generated-JLPT-exams-N5..N1-a-kana-readiness-gate.md
  - backlog/docs/feature/doc-19 - UI-wireframes-the-chat-learning-surface.md
priority: high
type: feature
ordinal: 862000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The gate is default-on and never a hard lock (D1): skipping opens the paper and a skip never records a pass. `doc-12` §3.2 and `doc-13` §6 make admission an OR of three **named** sources (`checkpoint | drill-coverage | skip`), each with its own stored reason, so the UI can always say why it is offering the paper and a learner is never shown a blended readiness score. Two constraints shape this task. First, `drill-coverage` is unreachable until the decks cover six kinds (`doc-13` §6.2; `apps/desktop/src/routes/drill.tsx:23` types `kind` as `gojuon | katakana | kanji` and the deck builders filter to `gojuon` and `katakana` only), so per decision D12 the resolver must refuse it explicitly and say "not available" rather than "not yet met". Second, the honest v1 statement is **drill shortens the checkpoint; it does not replace it**. Retakes are unlimited and regenerated per attempt (D4), with a 24-hour cooldown from the third failed attempt, per script, reading client time so a backwards clock cannot clear it. `doc-19` §4.1/§4.3/§4.5 draw the offer, the result and the cooldown.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Admission is an OR of three named sources and the resolved source is stored, so the UI can name which source is in play (`checkpoint`, `drill-coverage`, `skip`).
- [x] #2 `skip` never writes `passedAt`, is reversible in Settings, and reads as an override rather than a pass.
- [x] #3 `drill-coverage` is refused while the six-kind deck extension is unshipped, and the refusal reads as "not available" rather than "not yet met".
- [x] #4 Cooldown: attempts 1 and 2 are immediately available; a third attempt within 24h is refused with a date; the cooldown is per script and never blocks `/drill` or an N4 to N1 paper.
- [x] #5 A backwards clock does not clear a cooldown.
- [x] #6 The mastery state machine behaves as specified: three correct outcomes in one session stays `shaky`, three correct spread over two sessions becomes `solid`, and a later wrong outcome drops it back to `shaky`.
- [x] #7 `kana.settings.reset` clears admission for the selected script only and restores the offer.
- [x] #8 Every `doc-12` §9 row that names the checkpoint is exercised, and a corrupt or absent store yields "no attempt yet" rather than a fake pass.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Admission OR of checkpoint/drill-coverage/skip per doc-13 §6 with D12 refusal for drill-coverage, skip override never passedAt, per-script 24h cooldown from 3rd fail (monotonic, backwards clock safe), mastery state 3/2/last2 solid else shaky, settings reset per script, doc-12 §9 rows.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Admission OR checkpoint|drill-coverage|skip per doc-13 §6, D12 drill-coverage refused as not available (getDrillCoverageAdmission), skip never passedAt and reversible via clearKanaCheckpointScript, per-script 24h cooldown from 3rd fail with backwards clock safety (canAttemptCheckpoint), mastery 3/2/last2 solid (kana-mastery), settings reset per script. Verified: kana-admission.test.ts 7 AC (405 pass), desktop 405 pass, check 445 clean, check-types 13/13.
<!-- SECTION:FINAL_SUMMARY:END -->
