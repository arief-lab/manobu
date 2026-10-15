---
id: TASK-81.5
title: >-
  C5 misc: frameContent block-walk table, ChatRoute guards, transcript
  CardSwitch component
status: Done
assignee: []
created_date: '2026-09-20 13:12'
updated_date: '2026-09-21 02:30'
labels: []
dependencies: []
parent_task_id: TASK-81
ordinal: 701000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three singleton sites: chat-persistence frameContent (structural walk over the content-block union -> per-kind table), apps/desktop ai.tsx ChatRoute (extract loading/error guard sections into route-part components), message-transcript map arrow (extract a <ChatCardSwitch card> component so the dispatch leaves JSX). Each keeps behavior; cover with existing suite + one new test per site.
<!-- SECTION:DESCRIPTION:END -->
