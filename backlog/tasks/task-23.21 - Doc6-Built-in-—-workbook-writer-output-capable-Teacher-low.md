---
id: TASK-23.21
title: Doc6 Built-in — workbook writer output-capable Teacher (low)
status: To Do
assignee: []
created_date: '2026-09-06 06:09'
labels:
  - agent
  - doc6
dependencies: []
parent_task_id: TASK-23
priority: low
type: feature
ordinal: 884000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Doc-6 §1.1 Built-in Agent zero setup: AionUi aionrs ships file read/write + MCP + image with zero CLI; manobu Teacher Agent packages/agent 4 stubs (conversationCoachGrammarCheck end punctuation only, grammarExplainer substring n*.json, kanjiTutor CJK+kanji.json, vocabSrs previewIntervals d5/s10 demo) not an autonomous file writer for JLPT reading/EJU charts. Want: Teacher becomes output-capable writing Markdown/PDF workbook app_data_dir/workbooks/ instead of chat text-only; shares same tool plumbing CoreToolScheduler. See doc-6 §2 P0 A + §1.1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add packages/agent/workbookWriter sub-agent that writes Markdown workbook (printable) via tool write_file; shares tool set with other 4 sub-agents
- [ ] #2 Teacher Agent routes workbook requests via markdown skill body (assistant/*.md) not inline TS sensei-prompt.ts; no PPT factory — one Markdown writer suffices
- [ ] #3 Verification: JLPT/EJU workbook generation shows in Preview Panel tracking without leaving Tauri
<!-- AC:END -->
