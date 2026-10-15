---
id: TASK-1.11
title: SCR-07 Roleplay — structured scene + politeness/particle scoring (WF5)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:55'
updated_date: '2026-09-04 19:22'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 631000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Production under constraint, not endless chat. Clerk (Sensei) scene with goal + scoring + FSRS save. N5 convenience store + N2 job interview variants. Must end saving 3 phrases, not thread.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 N5: Goal Buy coffee politely; Clerk `いらっしゃいませ！何になさいますか？` + gloss + [▶] audio; input コーヒーをください scored politeness + を
- [x] #2 Scores: progress 2/5 lines, politeness 2/3, Particles 3/3; keigo boost コーヒーをいただけますか？; [Save phrase to FSRS] [Next line: pay]; 3 phrases saved then end
- [x] #3 N2 variant: Job interview / meeting scoring 謙譲語 strictly (いただく/申し上げる), contrast わけではない vs はずがない
- [x] #4 Ref: spec SCR-07 + copy-deck rp.* + wireframe WF5 + spec §Sensei i+1 constraint (known_ids +1 new, D>7 excluded)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read spec SCR-07 + copy-deck rp.* (Goal Buy coffee politely, Clerk いらっしゃいませ 何になさいますか + gloss + audio, progress 2/5 lines, politeness 2/3, particles 3/3, keigo boost いただけますか, Save phrase to FSRS, Next line: pay, 3 phrases saved end; N2 謙譲語 contrast わけではない vs はずがない)
2. Implement SCR-07 compound <Roleplay> in apps/desktop/src/routes/roleplay.tsx: <Roleplay.Goal> Buy coffee politely, <Roleplay.Clerk> いらっしゃいませ + gloss + audio, <Roleplay.Input> コーヒーをください scored politeness + particles, <Roleplay.Scores> progress 2/5 lines politeness 2/3 particles 3/3, <Roleplay.Keigo> いただけますか boost, <Roleplay.Save> Save phrase to FSRS, <Roleplay.NextLine> pay, <Roleplay.End> after 3 phrases saved, <Roleplay.N2> job interview 謙譲語 strict scoring, <Roleplay.Contrast> わけではない vs はずがない
3. Scoring lib in @manobu/lib: politenessScore (keigo boost), particleScore (を/は/に/で/が), i+1 constraint (known_ids +1 new, D>7 excluded) from spec §Sensei
4. State machine: scene -> line -> save -> next -> end, after 3 saves trigger End (no endless thread per spec); gsm.lesson_start/complete + grade distribution
5. a11y: focus 2px, role=progressbar, aria-live=polite on scores, error pattern red only
6. Verify bun test (politenessScore keigo boost, particleScore, i+1 constraint, 3 saves end), check-types, ultracite, commit
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification 2026-09-04: apps/desktop/src/lib/roleplay.ts politenessScore (POLITE_RE_1/2/3 top-level), particleScore capped 3, i1Constraint rejects >1 new + D>7, endAfter3Saves. Verified politeness 0/1/2/3, particles 1/3, i+1 OK/fail/D>7. apps/desktop/src/components/roleplay.tsx <Roleplay> = Object.assign with Goal/Clerk/Input/Scores/Keigo/Save/NextLine/End/N2/Contrast (Vercel pattern). State machine: onSave increments saved, endAfter3Saves triggers End + gsm.lesson_complete. N5 3 lines + N2 3 lines. a11y: role=progressbar, aria-live=polite on scores, focus 2px, error red only. check-types 4/4 OK biome fixed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented SCR-07 Roleplay compound: scoring lib (politeness 0-3, particles capped 3, i+1 constraint, endAfter3Saves) verified; N5 3 lines Buy coffee + N2 3 lines 謙譲語 job interview; <Roleplay> = Object.assign with 10 subcomponents; state machine ends after 3 saves + gsm.lesson_complete; check-types 4/4 OK.
<!-- SECTION:FINAL_SUMMARY:END -->
