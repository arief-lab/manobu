---
id: TASK-55
title: >-
  P1 — search_vocab reading-bridge overmatches and displaces the deinflected
  target (みました → no 見る)
status: Done
assignee: []
created_date: '2026-09-09 20:45'
updated_date: '2026-09-25 18:29'
labels:
  - bug
  - p1
  - tokenizer
  - search
  - vaporetto
dependencies: []
priority: high
ordinal: 880000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found 2026-09-10 live-probing the 10ten-inspired reading-match feature (TASK-23.26, Done) against the fresh MCP binary. Working: たべました → 食べる (deinflected=PolitePast) — the headline case. BROKEN: みました → 10 rows of 〜む godan verbs (住む/頼む/飲む/休む/読む/包む/噛む/込む…), 見る ABSENT. Direct searches prove the data is fine: 見る → 2 hits, みる → 7 hits incl. 見る. Mechanism: deinflect(みました) → みる (ichidan PolitePast) produces the correct candidate, but the reading-tag union (TASK-23.26 AC#4's reading-stem bridge) matches 〜む-family readings and the results are capped/truncated at 10 — the exact/deinflected target is crowded out. Two sub-bugs: (a) ranking — bridge hits are not ranked below direct/deinflected matches before the cap; (b) match strictness — the bridge appears to be substring/contains on the reading (すむ contains み? or み-prefix rule catching geminate forms) rather than a prefix match on the reading stem, over-pulling unrelated verbs. Reproduce: MCP search_vocab みました with SQLITE_VAPORETTO_MODEL set; observe result set. Also note: する/来る irregulars and theTASK-54 past-negative gaps interact here — a learner querying みました today gets a result list with no 見る in it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ranking fix: direct/deinflected hits always outrank reading-tag bridge hits in search_vocab results — みました returns 見る (the deinflected candidate みる's direct match) at/near the top, not crowded out by 〜む-reading bridge rows; verified by an MCP test asserting the target appears in the result set for みました, たべました, and at least one godan-m inflection
- [x] #2 Bridge relevance filter tightened: a reading-tag candidate only bridges when the corpus reading genuinely matches the queried form's reading stem (prefix match on the kana reading, not substring/contains) — みました must not pull すむ/たのむ/よむ whose readings merely contain み mid-word; verified by asserting すむ-style rows are absent (or strictly below the target) in the みました result set
- [x] #3 Result cap does not drop the target: with the 10-result cap, the exact/deinflected match is guaranteed a slot (pinned first or ranked above bridge rows before truncation) — test with a query whose bridge hits exceed the cap
- [x] #4 No regression on the working cases: たべました → 食べる with deinflected=PolitePast stays first; direct 見る/みる searches unchanged (2 and 7 hits respectively)
- [x] #5 Both search paths share the fix if applicable: search_vocab and lookup_examples use the same candidate union (crates/jlpt-mcp/src/engine.rs) — verify lookup_examples is not left with the old ranking
- [x] #6 cargo test green in crates/jlpt-mcp (both with and without --features vaporetto per the parity-golden contract)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed 2026-09-26 as already-shipped, not as new work. The fix landed in 32b9d7f (2026-09-10, 'fix(jlpt-mcp): search_vocab reading-bridge ranking - deinflected target no longer displaced (TASK-55)') together with both regression tests; the task was never moved off To Do, so this pass verified the shipped behavior and checked the criteria rather than re-implementing anything. Verification, in order of strength: (1) live probe of the actual release binary (crates/jlpt-mcp/target/release/jlpt-mcp) over real MCP JSON-RPC with the bundled vaporetto model, which is the code path the sidecar hands the agent: みました -> 見る 観る / 見る / 診る / 顧みる / 省みる / 試みる / 染みる (見る first, zero 〜む-family rows), たべました -> 食べる, 飲みました -> 飲む, 住みます -> 住む, 読みました -> 読む. (2) cargo test --features vaporetto: search_vocab_deinflected_target_ranks_above_bridge (unit) and search_vocab_reading_bridge_ranks_target_first (parity, spawns the real binary) both pass. (3) cargo test with no feature: 7 pass / 0 fail, including parity_with_ts_engine, so the TS-golden contract is intact.

Per-AC evidence. AC#1+AC#2: engine.rs:119 matches the reading tag as a PREFIX on the stored reading (e.reading.starts_with(reading)) instead of contains() - that was the mid-word み overmatch - and engine.rs:156 makes direct_substring the PRIMARY sort key ahead of token overlap, so a direct or deinflected hit outranks a bridge-only row before the cap truncates. Single-kana deinflected forms are skipped so a junk dictionary form (み -> む) cannot match a verb class. The parity test asserts 見る is present for みました AND that every row above it carries a み-prefixed reading, which is AC#2's 'すむ-style rows absent or strictly below the target'. AC#3: the test queries at limit 10, the exact cap from the report, and the target still holds a slot. AC#4: the test pins たべました -> 食べる FIRST; the task's own direct-search counts reproduce exactly on the live binary (見る -> 2 hits, みる -> 7 hits), and 見る leads the みる result set rather than being buried. AC#5 holds for a different reason than the task assumed: lookup_examples never used the reading bridge at all (engine.rs:699) - it returns direct sentence hits first and only then retries with deinflected dictionary forms, so there was no shared candidate union to go stale on either side. AC#6: green in both feature modes (above).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Verified TASK-55 as already fixed in the shipped binary and closed it against evidence rather than re-implementing. The reading bridge in engine.rs is a prefix match on the stored reading (not contains) and direct/deinflected substring hits sort above bridge-only rows before the 10-row cap, so みました returns 見る first with no 〜む-family rows, while たべました -> 食べる and the direct 見る (2) / みる (7) searches are unchanged. Confirmed by a live JSON-RPC probe of target/release/jlpt-mcp with the bundled model plus both cargo gates (unit + binary-spawning parity, with and without --features vaporetto). lookup_examples needed no fix: it has no bridge path. The fix itself is 32b9d7f from 2026-09-10; the task sat open at 0/6 until now.
<!-- SECTION:FINAL_SUMMARY:END -->
