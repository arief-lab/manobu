---
id: TASK-23.26
title: >-
  Harvest vaporetto tag channel — expose POS + katakana reading from shipped
  model (doc-8 §3, §6.2)
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-08 17:08'
updated_date: '2026-09-08 22:16'
labels:
  - vaporetto
  - doc2
  - tokenizer
dependencies: []
references:
  - >-
    backlog/docs/doc-8 -
    Japanese-Tokenizer-Research-—-sudachi.rs-vs-lindera-vs-tentoku.md
parent_task_id: TASK-23
priority: medium
type: feature
ordinal: 564000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
crates/jlpt-mcp/src/tokenize.rs already calls predict() + fill_tags() on the shipped bccwj-suw+unidic_pos+kana model but discards the tags. Live probe (doc-8 §3) confirmed the model carries two tag channels per token: UniDic POS1-POS2 (動詞-一般, 名詞-一般, …) and katakana reading (タベ, マシ, …). Reading forms are currently unavailable to search/matching even though the data is already in memory — zero new bytes, no model swap, no new dependency. This unblocks reading-hint surfaces (Teacher, Reader OOV) and gives TASK-23.27 a POS source to validate deinflection against.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 tokenize.rs exposes tokenize_with_tags() (or equivalent) returning surface + POS1-POS2 + katakana reading per token when the vaporetto feature and model are active
- [x] #2 katakana reading is converted to hiragana for matching against vocab readings (lookup_vocab/search_vocab reading column)
- [x] #3 ASCII-only input and vaporetto-less builds keep the legacy whitespace path byte-identical to tests/golden.json (cargo test both with and without --features vaporetto)
- [x] #4 search_vocab non-ASCII queries match an inflected-kana reading query (e.g. タベる → 食べる entry) via the new tag channel
- [x] #5 No binary size regression beyond noise (~50 lines, no new deps) and no model file change
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. tokenize.rs: add pub struct TokenTag { pos: Option<String>, reading_hiragana: Option<String> } + pub struct TaggedToken { surface: String, tags: TokenTag } + pub fn tokenize_with_tags(text) -> Vec<TaggedToken>. Feature-gated: vaporetto path reads token.tags() (2 channels: POS1-POS2, katakana reading); converts katakana→hiragana via a small katakana_to_hiragana() (0x30A1..0x30F6 range −0x60, w­-vu special cases); ASCII/model-less returns per-char whitespace surfaces with None tags (legacy path preserved — parity golden untouched because split_tokens itself is unchanged). 2. search_vocab: on the non-ASCII path, ALSO try per-token reading forms — build extra query candidate readings (katakana→hiragana per token) and match against e.reading so タベる hits 食べる (AC#4) without touching ASCII/parity paths. 3. Wire tags into search_vocab ranking fields only (no tool output shape change — parity golden is serialized tool output; VocabEntry shape untouched). 4. Tests: tokenize_with_tags unit tests (model-gated, mirroring existing model_loads_when_present pattern) + search_vocab reading-match test. 5. cargo test default + --features vaporetto; binary size check vs baseline.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation + probe findings: tokenize_with_tags() returns surface + POS1-2 + katakana→hiragana reading per token (TaggedToken struct). search_vocab non-ASCII path now unions reading-tag hits into candidates (reading != whole-query filter; stems like たべ bridge たべました→食べる). Verification quirks worth recording: (1) Live probes (doc-8 §3 confirmed on =0.6.5) show the model emits ONE UNTAGGED token for mixed-script katakana queries — タベる tokenizes as a single token with no POS/reading, so AC#4's literal タベる example is unreachable via tags; the achievable contract is pure-kana inflected queries: たべました → stem たべ (reading タベ) prefix-matches corpus たべる ✓. The u-verb class does NOT bridge (かいました stem かい is not a prefix of かう) — that gap belongs to TASK-23.27's rule-table deinflection, not the tag channel. (2) My first readings filter (!q.contains(reading)) discarded exactly the useful stems (たべました contains たべ) — fixed to drop only readings EQUAL to the whole query. (3) A shell-piped MCP client stalls after the first response (rmcp serve_inner reads via tokio select; single-shot pipes lose the pacing race) — behavioral MCP tests must use the McpClient harness with the initialize handshake (my first test version skipped it and the server exited before responding). Tests: 9 unit + 2 parity on BOTH feature paths green; new tests search_vocab_reaches_entry_via_reading_tag (engine, model-gated skip) + search_vocab_matches_inflected_kana_reading_via_tags (parity harness). Binary size: default +848 B, vaporetto +2704 B on ~19 MB (noise). Golden parity untouched (byte-identical on both paths).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Harvested the shipped vaporetto model's unused tag channel (doc-8 §3). tokenize.rs: TaggedToken {surface, pos (UniDic POS1-2), reading (katakana→hiragana via katakana_to_hiragana, ヴ→ゔ in-range, ー passthrough)} + tokenize_with_tags() mirroring split_tokens boundaries (None tags on the whitespace path). engine.rs search_vocab: non-ASCII candidates now union reading-tag hits (readings equal to the whole query dropped; stems kept) so たべました reaches 食べる via stem reading たべ ⊂ たべる. AC#4's literal タベる example is unreachable BY THE MODEL (probe: mixed-script katakana → one untagged token) — contract implemented and tested against the achievable superset class (pure-kana/kanji-stem queries); u-verb stems (かいました→かい vs かう) remain for TASK-23.27 rule-table deinflection. Verified: cargo test green on default AND --features vaporetto (9 unit + 2 parity each, golden byte-identical both paths — AC#3), binary size +0.8/2.7 KB on 19 MB (AC#5), no model or dep change. New tests: engine reading_tag_tests + parity search_vocab_matches_inflected_kana_reading_via_tags (initialize-handshake-gated McpClient; skip when model absent).
<!-- SECTION:FINAL_SUMMARY:END -->
