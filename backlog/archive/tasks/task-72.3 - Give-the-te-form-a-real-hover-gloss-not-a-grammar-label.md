---
id: TASK-72.3
title: 'Give the te-form a real hover gloss, not a grammar label'
status: To Do
assignee: []
created_date: '2026-09-14 03:47'
labels:
  - desktop
  - conjugate
dependencies: []
parent_task_id: TASK-72
priority: low
ordinal: 508000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FORM_GLOSS.te in apps/desktop/src/lib/conjugate.ts is the string "(–ing / then)", so the te-form choice hover renders "(–ing / then) flip" next to siblings that read "doesn't flip" / "did flip". It is a grammar label pasted into a translation slot and reads cryptic to the English-first learner the card is built for. Needs a decision on what the te-form gloss should say (e.g. a connective phrasing like "flip(ing) / then flip") plus a look at whether the en-dash in the current string collides with the repo's no-em-dash UI-copy rule (R-02 in root AGENTS.md).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 te hover reads as translated English of the shape, consistent in voice with the other five forms
- [ ] #2 No choice hover string exceeds the width that breaks the popover/title on the narrowest supported card
- [ ] #3 formGloss contract test updated for the te case
<!-- AC:END -->
