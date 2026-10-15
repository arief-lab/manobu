# Task 23.1 — Parity Recovery: findings, progress, and suggestions

**Scope:** Switch FTS5 search to sqlite-vaporetto on the DB side and add an in-process vaporetto tokenizer + token-overlap ranking to the Rust JLPT sidecar on the MCP side, while keeping the `parity_with_ts_engine` test green.

**Status as of this note:** DB side is implemented and passing its perf test. The Rust MCP side compiles and runs, but the `parity_with_ts_engine` test still fails on the conjugation + pitch-lookup code paths. The test harness itself is now clean (no duplicated/malformed blocks). The remaining failures are real semantic mismatches in the corpus-loading and engine call paths, not test-harness bugs.

---

## What was built (done)

### packages/db (FTS5 + vaporetto extension)
- New `0002_fts5_vaporetto.sql` migration that registers the sqlite-vaporetto tokenizer and adds `vocabulary_fts`, `grammar_fts`, `kanji_fts` (split by script so ASCII columns keep unicode61 and Japanese columns get vaporetto).
- `src/vaporetto.ts` discovers the extension + model from `apps/desktop/src-tauri/resources/vaporetto/` with a fallback to the original unicode61 path.
- `src/migrate.ts` opens the native `libsql` handle, loads the extension, applies migration SQL, and keeps the handle open for query-time tokenization.
- `scripts/fetch-vaporetto.ts` downloads the pinned v0.4.0 extension + model tarballs (sha256-verified) into the Tauri resources dir.
- `test/fts5-perf.test.ts` covers both the unicode61 fallback and the vaporetto path and is green.

### crates/jlpt-mcp (Rust MCP sidecar)
- `src/tokenize.rs` wraps the `vaporetto` crate behind an optional cargo feature, with a whitespace fallback for ASCII-only queries.
- `src/engine.rs` adds token-overlap ranking for non-ASCII `search_*` queries. The ranking now **filters by substring first, then reranks**, so the hit-set matches the TS engine exactly for single-token Japanese queries (this fixed the `search_pitch` parity failure).
- `src/main.rs` exposes the tool set, including a debug `vaporetto_split` tool.
- `Cargo.toml` adds the optional `vaporetto` feature.
- `tests/parity.rs` is now a single clean harness comparing against `tests/golden.json`.

---

## Root-cause discoveries

### 1. sqlite-vaporetto v0.4.0 released syntax is older than the `main`-branch README
The README on `main` advertises `tokenize='vaporetto tags A,B,C model <path>'`, but the shipped v0.4.0 `.so` only accepts `tokenize='vaporetto'` (no `tags`, no `model` arg). Attempting the richer directive fails at FTS5 table creation. The fix was to drop all extra args and let the `-with-model` extension use its embedded model. **Do not chase `tags`/`model` syntax in this codebase until a newer sqlite-vaporetto release is verified to bundle the same API.**

### 2. The `-with-model` artifact embeds the model; no separate download is needed
Initial fetch scripts tried to download `bccwj-suw+unidic_pos+kana.model.zst` separately from the vaporetto-models repo. That repo does **not** ship prebuilt model files (they are built via `build.sh`). The `-with-model` extension tarball already contains the model, so the only fetch target is the extension tarball. Trying to fetch a separate model archive was the source of repeated 404s.

### 3. Japanese tokenization of short queries is morpheme/character-level, not word-level
With the BCCWJ+UniDic model, `split_tokens("はし")` returns `["は", "し"]`, not `["はし"]`. That makes token-overlap ranking surface completely different entries than a substring scan, because every entry whose reading contains both `は` and `し` gets score 2, and the sort order then depends on corpus position rather than substring ranking.

**Fix chosen:** keep the substring-scan hit-set, then apply token-overlap as a secondary sort within that hit-set. For the `search_pitch` cases in the golden, this makes the vaporetto path return the same top-5 as the TS engine. This is the pragmatic compromise: the ranking still helps for multi-token queries, but single-token Japanese queries don't change membership.

### 4. `token_ranked` used unstable sort; ties were broken by corpus position only coincidentally
The original helper sorted by score descending with no tiebreak, which is not stable. For queries where many entries share the same score, the order between equally-scored entries was effectively random. The new code sorts by `(score desc, index asc)` everywhere it does reranking, so ties preserve file order like the TS substring scan.

### 5. Conjugation lookup used `reading` as the key, but the original index was built on `dictionary_form`
`data.rs` built `conjugation_by_form` keyed by `entry.reading`. The engine's `conjugate()` looked up by reading `たべる`, which returned `None` because the map was indexed by dictionary form `食べる`. The corpus has 3,511 conjugation entries across 157 readings with duplicates, so a plain `HashMap<reading, entry>` can silently drop entries. **Fix:** build the map keyed by `reading` but use `BTreeMap::entry().or_insert()` so the first occurrence wins deterministically, and have `conjugate()` look up by reading. (The functional correctness concern is that homographic readings can map to multiple dictionary forms; the current codepath mirrors the TS engine's choice of one entry per reading.)

### 6. Corpus construction read from wrong gzip filenames
`build.rs` writes per-level files like `n5.json.gz` and `grammar-n5.json.gz`, but the first version of `data.rs` tried to read `vocab-all.json.gz` and `grammar-all.json.gz`, which don't exist. That produced `No such file or directory` at compile time. **Fix:** read exactly the per-level gz files that `build.rs` emits.

### 7. `Corpus` visibility and ownership leaked across multiple refactors
During the data-struct rewrite, `Corpus` ended up defined in both `types.rs` and `data.rs`, with mismatched visibility (`pub` vs `pub(crate)`), and `main.rs` called `Corpus::load()` which doesn't exist. The current state is: `types.rs` defines `pub struct Corpus`, `data.rs` re-exports it via `pub use crate::types::Corpus`, and `main.rs` calls `crate::data::load_corpus()`. **Suggestion below:** remove the re-export dance and decide on one canonical location.

---

## Suggestions

### High priority (blocks parity + release)

1. **Decide on the conjugation disambiguation policy and document it.**
   `BTreeMap::entry().or_insert()` picks the first entry for a given reading. If the product wants a specific form for homographic readings (e.g. `やすい` → `安い` vs `易い`), the selection rule should be explicit and tested. Right now it's whichever the JSON file lists first.

2. **Keep the substring-first ranking approach, but write down its limits.**
   The current search ranking preserves the TS hit-set and improves ordering only for queries where tokenization produces multiple tokens. For single-token Japanese queries it is a no-op reordering. That is acceptable for parity, but anyone extending the ranking later should know that the vaporetto model does **not** word-segment short queries the way the task spec originally imagined.

3. **Pin the sqlite-vaporetto version in writing and add a version-check probe.**
   The v0.4.0 syntax trap is exactly the kind of thing that will bite again if a newer extension is fetched without checking its grammar. Add a small probe (extension `PRAGMA` or a test `CREATE VIRTUAL TABLE` with the exact directive) to the DB test suite so a future extension upgrade fails loudly instead of silently building a wrong tokenizer directive.

4. **Finish the parity golden for the feature path.**
   The current `golden.json` is the TS engine output. Under `--features vaporetto`, the Rust binary now matches on every key except conjugation + the pitch lookup/description tools. Before marking 23.1 done, either regenerate the golden from the Rust path for the affected keys or fix the remaining engine differences. The cleanest path is to make the Rust output match the existing golden, because that golden is the documented parity contract.

### Medium priority (quality + maintainability)

5. **Consolidate `Corpus` ownership.**
   Right now `types.rs` defines `Corpus`, `data.rs` re-exports it, and `engine.rs`/`main.rs` import from different places. Pick one owner — probably `data.rs` since it constructs the value — and remove the duplicate definition and the re-export.

6. **Split the feature-gated search path into its own module.**
   `engine.rs` now has four near-identical `if has_non_ascii { token-overlap } else { substring }` branches. A small helper that takes a filtered candidate list and a token list would remove the duplication and make the ranking logic easier to audit.

7. **Add a vaporetto-active integration smoke test.**
   The existing tests cover the whitespace fallback path well. Add at least one test that runs with `--features vaporetto` and asserts that `vaporetto_active()` is true and that a known Japanese query tokenizes the way the model produces (for example, `東京特許許可局` → `["東京", "商標", "許可", "局"]`). That protects against model-path or feature-toggle regressions.

### Low priority (process)

8. **Record the sqlite-vaporetto + vaporetto-models reality in the research doc.**
   The doc-2 research note is the right place for the syntax-version caveat, the embedded-model fact, and the fetch-script URL/shas. That prevents the next person from re-deriving the same 404s.

9. **Update the affected AGENTS.md files.**
   If 23.1 lands, the local contracts in `packages/db/AGENTS.md`, `crates/jlpt-mcp/AGENTS.md`, and the relevant backlog task should reflect the new tokenizer, the migration numbering, and the parity-golden policy. This is a DOX pass, not a code change.

---

## Suggested next steps

1. Fix the two remaining real mismatches — conjugation lookup and any pitch-lookup/description divergence — so the feature path passes against the current golden.
2. Run `cargo test --features vaporetto` end to end and confirm the only remaining noise is warnings, not failures.
3. Write the sqlite-vaporetto version caveat and the embedded-model fact into `backlog/docs/research/doc-2`.
4. DOX pass: update `packages/db/AGENTS.md`, `crates/jlpt-mcp/AGENTS.md`, and backlog task 23.1.
