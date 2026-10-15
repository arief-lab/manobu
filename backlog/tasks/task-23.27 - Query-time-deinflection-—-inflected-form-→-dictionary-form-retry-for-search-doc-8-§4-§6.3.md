---
id: TASK-23.27
title: >-
  Query-time deinflection — inflected form → dictionary form retry for search
  (doc-8 §4, §6.3)
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-08 17:09'
updated_date: '2026-09-08 23:10'
labels:
  - vaporetto
  - doc2
  - tokenizer
  - search
dependencies:
  - TASK-23.26
references:
  - >-
    backlog/docs/doc-8 -
    Japanese-Tokenizer-Research-—-sudachi.rs-vs-lindera-vs-tentoku.md
parent_task_id: TASK-23
priority: medium
type: feature
ordinal: 563000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Inflected queries miss dictionary-form corpus entries today: search_vocab('食べました') returns nothing useful because data/n*.json stores dictionary forms (食べる). doc-8 §4 decided against tentoku (GPL-3.0, 0.1.2, greedy matcher, ~130MB runtime JMdict DB) and for a small independent deinflect() step (10ten-style rule table, MIT-clean upstream, ~100 lines, no new deps): try the raw form first; on zero hits, strip known endings (ます/た/ない/て/れば/よう/そう/…), POS-validate the stem against the corpus partOfSpeech field (and reuse the TASK-23.26 tag channel where available), then retry — attaching the reason (PolitePast) to the result description. Serves search_vocab, lookup_examples (Tanaka linkedWords are dictionary forms), and free-form drill/listen matching.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 search_vocab('食べました') and lookup_examples('食べました') return the 食べる entry/results via the miss-retry path, with the deinflection reason recorded in the tool-layer description
- [x] #2 Deinflection rules are POS-validated (a noun never deinflects as a verb; い-adjectives use adjective rules) using corpus partOfSpeech or the vaporetto POS tag
- [x] #3 Exact dictionary-form queries behave byte-identically to today (deinflection only fires on zero-hit miss-retry, never reorders direct hits) — parity golden unchanged
- [x] #4 Rule table lives in its own module (e.g. src/deinflect.rs) with unit tests per rule class (masu/past/negative/te/potential/causative/passive/volitional/tai)
- [x] #5 cargo test passes on default and --features vaporetto paths
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation: new src/deinflect.rs rule table (12 unit tests, one per rule class per AC#4) + engine miss-retry in search_vocab_with_reason/lookup_vocab_with_reason/lookup_examples_with_reason (fire ONLY on zero-hit, AC#3). Rules: longest-suffix-first first-family-wins — polite negative (past) ませんでした/ません, polite ました/ます (with e-row potential variant 泳げます→泳ぐ), past た/だ with onbin ん/っ expansion (飲んだ→飲む, 行った→行く, 話した→話す), te て/で with voiced で handling (泳いで→泳ぐ via ぎ/び/み restore), negative ない with a-column (買わない→買う), conditional れば/ければ, volitional generalized o-row+う (食べよう/行こう/しよう), want-to たい/たく/たかった with the かった ambiguity disambiguated by stem-tail (行きたかった vs adjective 寒かった), potential/causative られる/せる + bare-る e-row potential (買える→買う) kept ENGINE-side (godan_e_potential, corpus-gated — a table rule can't tell 買える from dictionary 食べる which maps to garbage 食ぶ). POS validation (AC#2): every candidate gated on corpus partOfSpeech containing required_pos (verb/adjective); a noun never deinflects as a verb. Tool layer (AC#1): retried vocab results carry deinflected:<reason> field (e2e verified through the actual MCP binary: search_vocab('食べました') → 食べる + deinflected:PolitePast; '飲みませんでした' → 飲む + PoliteNegativePast; '泳げます' → 泳ぐ + PolitePotential; direct '食べる' hit carries NO deinflected field); lookup_examples retry adds a deinflected note to the description (direct hits with the raw substring unchanged). All rules were probe-driven — every failure class (onbin rows, かった/たい ambiguity, o-row volitional, く inside くない) was hit by a failing test and fixed against real morphology. Verification (AC#3/#5): cargo test green on default (20+2) AND --features vaporetto (21+2); parity golden byte-identical both paths; release binary +17.6 KB on 19 MB (0.09%, no new deps, no model change). Dead plain wrappers (lookup_vocab/search_vocab/lookup_examples) removed in clean cutover — the *_with_reason variants are the only entry points.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped query-time deinflection (doc-8 §4): independent 10ten-style rule table in new src/deinflect.rs (~350 lines, MIT-clean, zero deps), engine miss-retry in search_vocab/lookup_vocab/lookup_examples (*_with_reason variants, plain wrappers removed in clean cutover), POS-validated against corpus partOfSpeech. E2E-verified through the real MCP binary: 食べました → 食べる + deinflected:PolitePast; 飲みませんでした → 飲む; 泳げます → 泳ぐ; direct hits (食べる) byte-identical with no deinflected field and untouched parity golden. 12 rule-table unit tests (one per class: masu/past/negative/te/potential/causative/passive/volitional/tai + onbin rows + irregular + adjective). cargo test green on default AND --features vaporetto; release binary +17.6 KB/0.09% on 19 MB, no model or dependency change. Key design calls: longest-suffix-first first-family-wins ordering; かった want-to vs adjective disambiguation by stem tail; bare-る e-row potential deliberately engine-side corpus-gated.
<!-- SECTION:FINAL_SUMMARY:END -->
