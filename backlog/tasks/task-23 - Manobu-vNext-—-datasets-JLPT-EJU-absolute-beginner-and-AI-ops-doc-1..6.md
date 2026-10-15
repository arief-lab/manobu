---
id: TASK-23
title: 'Manobu vNext — datasets, JLPT/EJU, absolute-beginner and AI ops (doc-1..6)'
status: To Do
assignee: []
created_date: '2026-09-06 06:02'
labels:
  - roadmap
  - doc1
  - doc2
  - doc3
  - doc4
  - doc5
  - doc6
dependencies: []
priority: high
type: feature
ordinal: 898000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Umbrella epic tying backlog/docs/research/doc-1 (AionUi cron/ACP/MCP 354l + §5.2.5 doc-2 amendment) through doc-6 (AionUi re-research AI gaps 183l) together with doc-2 (JMdict complements + sqlite-vaporetto 294l), doc-3 (EJU v1→Finale 448l), doc-4 (JLPT mock all/N5/N4 → N3..N1 sectional 216l) and doc-5 (absolute beginner ≈70% → 46+46 kana 169l). Existing standalone epics TASK-21 (Sherpa-ONNX TTS/STT/VAD) and TASK-22 (AionUi cron/ACP pool/MCP catalog) remain; this epic owns the *content+curriculum* layers that those ops layers unblock. Order respects doc-1 §5.2.5 (doc-2 P0 sqlite-vaporetto before EJU/JLPT term search), doc-5 (2-week kana before EJU), and doc-4 vs doc-3 interleaving.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Epic tracks delivery of v1 Foundations (syllabus + 46+46 kana + sqlite-vaporetto + EJU/JLPT v1) through v3 + Finale with byte-identical parity and FTS5 <100ms intact
- [ ] #2 No JASSO/JLPT booklet redistribution; all questions authored with JASSO topic source citation; CC BY-SA aggregation in packages/*/data/LICENSE.md
- [ ] #3 Docs cross-linked: doc-1 §5.2.5 ↔ doc-2, doc-3 v1→Finale ↔ doc-4/5, doc-6 Team before EJU charts
<!-- AC:END -->
