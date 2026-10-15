---
id: TASK-1.10
title: SCR-06 Conjugate Lab — transform + Socratic ask-first (WF4)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:55'
updated_date: '2026-09-04 19:07'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 630000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Grammar as transform: 食べる→て/ます/た free input. Socratic 1st fail asks Q, 2nd tells + source citation. Must handle ichidan + irregular exception 飲む→飲んで.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Prompt Base: 食べる (たべる) → Transform to て-form; free input with inline validation; hint `いちだん → る → て` on demand (no FSRS effect)
- [x] #2 Socratic: 1st wrong asks guiding Q `What does {word} describe?`; 2nd wrong tells `が not {wrong} — reason · Source: Grammar DB {ref} [Save to FSRS]`
- [x] #3 Correct shows pattern `ichidan: drop る, add て`; irregular YailE contrast 飲む→飲んで (む→んで exception); Next: 飲む → ?
- [x] #4 Ref: spec SCR-06 + copy-deck conj.* + socratic.* + wireframe WF4
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read spec SCR-06 + copy-deck conj.* socratic.* (Prompt Base verb 食べる, free input, hint いちだん→る→て on demand no FSRS, 1st fail Socratic Q, 2nd tell が not {wrong} + source, ichidan pattern, irregular 飲む→飲んで む→んで YailE)
2. Implement SCR-06 compound <Conjugate> in apps/desktop/src/routes/conjugate.tsx: <Conjugate.Prompt> 食べる (たべる) → Transform to て-form, <Conjugate.Input> free input with inline validation, <Conjugate.Hint> いちだん→る→て on demand (no FSRS), <Conjugate.Socratic> 1st wrong Q guiding 2nd wrong tell + source, <Conjugate.Pattern> ichidan explanation, <Conjugate.Irregular> 飲む→飲んで む→んで YailE contrast, <Conjugate.Next> 飲む → ?
3. Conjugation lib in @manobu/japanese: ichidan (drop る + て) godan/exception (飲む→飲んで), machine-checkable so we can validate free input + emit pattern explanation
4. Socratic state: per-card attempts counter, on 1st wrong show guiding Q, on 2nd wrong show 答案 + Grammar DB ref source citation, gsm.socratic_fail_count increment
5. a11y: focus 2px on input, error pattern red only, hint no FSRS effect (no grade log), [Save to FSRS] only after 2nd fail reveal
6. Verify bun test (ichidan 食べる→食べて OK, godan 飲む→飲んで OK, Socratic 1st Q 2nd tell), check-types, ultracite, commit
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification 2026-09-04: conjugation lib apps/desktop/src/lib/conjugate.ts classify/toTeForm/verify/patternExplanation with ichidan drop ru + te, godan mu->んで YailE, godan ku->いて, godan gu->いで, godan su->して, godan ru->って, irregular いく/くる. Verified たべる→たべて OK, のむ→のんで OK, はなす→はなして OK, かく→かいて OK, まつ→まって OK, よぶ→よんで OK, およぐ→およいで OK. Component apps/desktop/src/components/conjugate.tsx Conjugate = Object.assign with .Prompt/.Input/.Hint/.Socratic/.Pattern/.Irregular/.Next. Socratic recordAttempt ask/tell/correct increments attempts and logs gsm.socratic_fail. Hint [いちだん→る→て] shown, no FSRS. Pattern explains ichidan, Irregular contrast のむ→のんで. Next のむ→? routes/conjugate.tsx mounts with たべる default. check-types 4/4 OK biome fixed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented SCR-06 Conjugate Lab compound: conjugation lib ichidan/godan/irregular verified たべる→たべて, のむ→のんで YailE; Conjugate = Object.assign with Prompt/Input/Hint/Socratic/Pattern/Irregular/Next; Socratic 1st ask / 2nd tell + source; hint no FSRS; check-types 4/4 OK.
<!-- SECTION:FINAL_SUMMARY:END -->
