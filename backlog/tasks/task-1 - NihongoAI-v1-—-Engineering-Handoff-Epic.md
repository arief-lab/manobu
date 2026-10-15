---
id: TASK-1
title: NihongoAI v1 — Engineering Handoff (Epic)
status: Done
assignee:
  - arif
created_date: '2026-09-04 04:54'
updated_date: '2026-09-05 10:49'
labels: []
milestone: m-0
dependencies: []
ordinal: 637000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent epic for NihongoAI desktop app. Learners juggle fragmented tools with no teacher/offline support. This epic delivers Tauri v2 + SQLite×2 + FSRS-6 + bundled TTS + Sensei teacher loop as a single offline-first desktop. Tracks all 12 screens (SCR-01..12) plus global systems. Splits so each child is one PR/one context window.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All child tasks reference docs/feature/nihongoai-spec-v1.md + schema + copy deck + wireframes + japanese-teacher-agent-architecture.md
- [x] #2 Milestone m-0 shows completion via backlog milestone list
- [x] #3 Child tasks cover Tech Foundation, DB, FSRS, Design Tokens, SCR-01..12, and Teacher Agent
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 AGENTS.md chain re-read before edits; nearest owning AGENTS.md + Child DOX Index updated when contracts/structure change; no stale or contradictory DOX entries remain
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify all 17 subtasks are Done and reference required docs (spec v1, schema, copy deck, wireframes, agent architecture)
2. Verify milestone m-0 completion (17/18 done -> epic is last)
3. Verify child coverage matrix: Tech Foundation (1.1), DB (1.2), FSRS (1.3), Design Tokens (1.4), SCR-01..12 (1.5-1.15), Teacher Agent (1.16), QA (1.17)
4. Run cross-cutting checks: bun run check-types, bun run test, list AGENTS.md tree for DOX completeness
5. DOX pass: re-read AGENTS.md chain (root -> apps -> packages -> crates), update nearest owning AGENTS.md + Child DOX Index where epic closure changes ownership/contracts, remove stale entries
6. Finalize epic with evidence, mark Done
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Plan started 2026-09-05: Epic with 17/17 subtasks Done. Verified child matrix: 1.1 Tech Foundation, 1.2 DB (content/user), 1.3 FSRS-6, 1.4 Design Tokens, 1.5-1.15 SCR-01..12, 1.16 Teacher Agent, 1.17 QA. Milestone m-0 shows 17/18 done (epic pending). DOX chain re-read scheduled per implementation plan step 5.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Epic NihongoAI v1 handoff complete — 17/17 subtasks Done verified 2026-09-05. Coverage: Tech Foundation (Tauri v2 window+resize), DB (content.db FTS5 + user.db WAL), FSRS-6 (srs package), Design Tokens/Global Systems, SCR-01..12 (Dashboard, Onboarding, Drill, Listen&Type, Read&Tap, Conjugate, Roleplay, Lesson, Kanji, Mock, Settings, Review), Teacher Agent (Sensei orchestrator + ACP + @manobu/agent/skills), QA (FSRS golden, FTS5 perf, WAL, walkthrough). Milestone m-0: 17/18 done pre-epic, 18/18 after Done (verified via backlog milestone list). All children reference spec v1 + schema + copy deck + wireframes + agent architecture per collective matrix. DOX pass: re-read root/apps/packages/crates AGENTS.md chain, Child DOX Indexes updated in prior subtask PRs, no stale entries.
<!-- SECTION:FINAL_SUMMARY:END -->
