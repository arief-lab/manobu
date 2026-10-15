---
id: TASK-23.20
title: Doc5 polish — romaji gate + goal-specific queue + keep 46+46 together (low)
status: To Do
assignee: []
created_date: '2026-09-06 06:07'
labels:
  - beginner
  - doc5
dependencies: []
parent_task_id: TASK-23
priority: low
type: feature
ordinal: 891000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Doc-5 §3.2 G4 + §3.3 M4 + §4.1/§5 guardrails: romaji trap (Lesson Kanji+pitch+Furigana shows 食べる/たべ˥る without taberu — keep gate; only Input shows a→あ hint listen-type 160 correct), goal-specific bypass GoalId travel vs jlpt vs anime queue filtering (minor queue.ts branch travel: tatoeba survival+numbers vs jlpt: JLPT N5 500), and All four paths share same first two steps hiragana then katakana — A1/A2 must ship together not hiragana only. Keep Western Skip placement always available bigger tap Zp5FA (both cultures) vs LINE-like mandatory quiz. See doc-5 §§3-5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Romaji gate: primary cards show no romaji; RomajiChip OFF default for beginners, show Type a→あ only on ListenType Input; avoid permanent caps reading speed
- [ ] #2 Goal-specific queue filter: GoalId already in onboarding context filters pickCardsWithFallback travel vs jlpt vs anime; minor queue.ts branch, big perceived personalization
- [ ] #3 Kanji withheld correct until Month 2 in context of words you already know (一二三…); Numbers 0-100 already correct; document no accelerate KanjiDetail to pre-N5
- [ ] #4 Ship A1/A2 together week-on/week-on not 92 at once; A0 Already enough milestone mark Onboarding→Kana→Numbers Done in AGENTS.md
<!-- AC:END -->
