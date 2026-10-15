---
id: TASK-23.24
title: Doc6 Office — Morph/pptx/docx/xlsx as extension skill (low)
status: To Do
assignee: []
created_date: '2026-09-06 06:10'
labels:
  - skills
  - doc6
dependencies: []
parent_task_id: TASK-23
priority: low
type: feature
ordinal: 882000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Doc-6 §1.2 21 Assistants (Morph 3D, Academic Paper Writer, Financial Model etc. OfficeCLI pptx/docx/xlsx, UI/UX Pro Max 57 styles, 3D Game) tuned for office. Manobu closest analog is EJU comprehensive subject charts + Reader pre-N5 illustrated stories. Want skill-as-extension (Extension SDK contributes.skills pptx/docx/xlsx/mermaid) not tool itself. Keep Vercel Object.assign composition. See doc-6 §2 H + doc-1 21 Assistants.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Expose Office/Morph as optional builtin:Extension skills: pptx of eju chart vs mermaid radical graph as optional skills, not new server
- [ ] #2 Keep composition Vercel Object.assign(Root,{.Sub}) and per-skill tool_choice narrowing cheaper context
- [ ] #3 Verification: EJU chart generation optionally uses xlsx skill as shared lib, not new server
<!-- AC:END -->
