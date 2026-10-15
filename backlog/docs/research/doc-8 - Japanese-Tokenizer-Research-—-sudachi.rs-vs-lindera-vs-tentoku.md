---
id: doc-8
title: Japanese Tokenizer Research — sudachi.rs vs lindera vs tentoku
type: specification
created_date: '2026-09-08 16:09'
updated_date: '2026-09-08 16:58'
tags:
  - tokenizer
  - research
  - doc2
---
# Japanese Tokenizer Research — sudachi.rs vs lindera vs tentoku (doc-8)

> **Status:** research / decision-support
> **Date:** 2026-09-08
> **Question:** Research sudachi.rs, lindera, tentoku as Japanese tokenizers for manobu; is tentoku-style deinflection needed in this app? Document findings here.
> **Sources:** crates.io API (2026-09-08), GitHub API (WorksApplications/sudachi.rs, lindera/lindera, eridgd/tentoku-rs, daac-tools/vaporetto, daac-tools/vaporetto-models, WorksApplications/SudachiDict, hotchpotch/sqlite-vaporetto), PyPI (sudachidict_*), live probe of the shipped BCCWJ model (/tmp/vapo-probe, vaporetto =0.6.5)

---

## 0. Verdict up front

**manobu already has its tokenizer, and the research confirms the choice was right.** The repo runs **vaporetto** in two places: `sqlite-vaporetto` v0.4.0 FTS5 extension (pinned, `packages/db`) and the `vaporetto =0.6.5` Rust crate inside `crates/jlpt-mcp` (optional `vaporetto` feature). None of the three candidates justifies a migration:

| Candidate | Verdict | One-line reason |
|---|---|---|
| **sudachi.rs** | Keep as *reference*, not dependency | Best linguistics (A/B/C splits, normalization, readings), but no crates.io release, 41–72 MB dictionary, slower than vaporetto (7.1× per arXiv:2406.17185) |
| **lindera** | No | Same lemma/reading/POS data as what we already get, 190 MB build-time download for embedded SudachiDict, active-breaking-change cadence |
| **tentoku** | No as tokenizer; **the deinflection idea is worth stealing** | GPL-3.0 (incompatible with our MIT/Apache deps story), 1-star toy maturity — but its 241-rule conjugation→dictionary-form approach maps 1:1 onto data manobu **already ships** |

**The deinflection answer:** tentoku-style deinflection is *not needed as a tokenizer feature* — manobu already has richer machinery: (a) `conjugations.json` 3,511 full conjugation tables + `conjugate_verb` MCP tool (engine.rs), (b) vaporetto token boundaries + UniDic POS in the shipped model's tag channel, (c) JMdict surface-index join in the corpus. What IS missing and IS worth adding is a **small deinflection pre-step for search queries** (~50–100 rules, no new dependency) so `食べました` queries hit the 食べる entry. Details in §4.

---

## 1. The three candidates, verified from primary sources

### 1.1 sudachi.rs (WorksApplications) — the best analyzer we cannot easily ship

| Fact | Value (checked 2026-09-08) |
|---|---|
| Repo | `WorksApplications/sudachi.rs`, Apache-2.0, ★478, 34 open issues, pushed 2026-08-28 |
| Release cadence | v0.6.11 (2026-04-13), previous v0.6.10 (2025-01-10) — slow but alive |
| **crates.io** | **Not published.** README "ToDo: Registration to crates.io" still unchecked. Only unofficial `suiko-sudachi 0.6.11` (492 dl) redistribution exists |
| Rust API | README: "There is no public API for the initial release" (issue #28) — but `StatelessTokenizer`/`Morpheme` API exists in-tree and is used by SudachiPy |
| Dictionary | **Not bundled.** SudachiDict small 41.8 MB / **core 72.3 MB** / full (even larger) — vs our current 6.05 MB `.model.zst` |
| `bake_dictionary` feature | **Broken** — README admits "This was un-implemented and does not work currently" (issue #35); requires `SUDACHI_DICT_PATH` at build time |
| Features | Surface, POS (UniDic short), **normalized form** (打込む→打ち込む, かつ丼→カツ丼, 附属→付属, vintage→ビンテージ), dictionary form, **reading form (katakana)**, OOV flag, synonym group IDs, **A/B/C multi-granular splits** (選挙管理委員会 C=whole / A=選挙+管理+委員+会), sentence splitting |
| Performance | arXiv:2406.17185 Table 1: Vaporetto is **7.1× faster** than sudachi.rs |

Assessment: the linguistics are the best of the three — normalization alone is teacher-grade (kanji variants, katakana spell-out). But: no crates.io (vendored source or the unofficial crate), 12× dictionary size vs vaporetto's model, broken bake-in feature (we need embedded assets for the Tauri sidecar), and slower. Migrating would regress the binary-size first-class goal (`crates/AGENTS.md`) for no capability manobu lacks.

**Where sudachi.rs is genuinely valuable:** its A/B/C split + normalized_form + reading_form triple is the *target output schema* if manobu ever builds a Reader glossing panel. Keep as design reference.

### 1.2 lindera — mature, but wrong shape for manobu

| Fact | Value (checked 2026-09-08) |
|---|---|
| Repo | `lindera/lindera` (forked from kuromoji-rs), MIT, ★667, 13 open issues, pushed 2026-09-08 |
| crates.io | `lindera 6.0.0` (2026-08-25), **2.1M total downloads**; `lindera-tantivy 5.0.1` 220k dl; Node/Python/Ruby/PHP/WASM bindings |
| Dictionaries | IPADIC, IPADIC-NEologd, **UniDic**, **SudachiDict**, CC-CEDICT, ko-dic, jieba — each an optional crate (`lindera-unidic` 20.3 KB, `lindera-sudachidict` 14.8 KB wrapper) |
| Embedded dictionaries | `embed-*` features: crate is small but `build.rs` **downloads the dictionary at build time** — `lindera.dev/sudachidict-20260723.tar.gz` is **199,672,394 bytes (~190 MB)** (verified via Content-Length) |
| Token details | MeCab-style `details: Vec<Cow<str>>` + schema-ordered fields. UniDic schema: surface, POS×4, conjugation type/form, **reading, lexeme (=lemma), orthographic/phonological surface+base forms**, word_type, cType/cForm. SudachiDict schema adds **normalized_form, dictionary_form_id, split_a/split_b, word_structure, synonym_group_ids** |
| Performance | README: 10–20 MB/s single-threaded (IPADIC), bench suite + issue #875 methodology |
| Churn | v5→v6 (2026): workspace restructure, system-dict format v2, user-dict rebuild, npm/PyPI renames. v5.0→6.0 within months |

Assessment: the "embedded dictionary feature for easy install" the comparison table touts is real for *ergonomics* but not for *bundle size* — the dictionary arrives as a 190 MB build-time download and lands in the binary (our sidecar is ~5 MB by contract, 13.9 MB with the sentence corpus; doc-2 §6 records that tradeoff). Capabilities (lemma, reading, POS, even normalized form via lindera-sudachidict) overlap ~100% with what the vaporetto model + our JMdict join already give. Verdict: no migration. Its value would be the Tantivy integration — manobu has no full-text search engine dependency (FTS5 is built into SQLite we already ship).

### 1.3 tentoku (eridgd/tentoku-rs) — wrong license/maturity, right idea

| Fact | Value (checked 2026-09-08) |
|---|---|
| Repos | `eridgd/tentoku-rs` (Rust) + `eridgd/tentoku` (Python reference), **GPL-3.0-or-later**, ★1, pushed 2026-03-02 |
| crates.io | `tentoku 0.1.2` (2026-03-02), **80 downloads** total |
| Algorithm | Port of **10ten Japanese Reader** (birchill/10ten-ja-reader) tokenization: greedy longest-match + rule-based **deinflection** — NOT statistical (their own README contrasts with MeCab/Sudachi) |
| Deinflection | **241 conjugation rules** resolving verbs/adjectives to dictionary forms, with `Reason` variants (PolitePast, Negative, Potential, Causative, Passive, Tai, Volitional, Te, Zu, Imperative, MasuStem, …) and POS-validated deinflection chains |
| Dictionary | **Requires a JMdict SQLite DB** (~130 MB) built on first run — a hard runtime dependency, not embedded |
| Also does | Chōonpu expansion (ー→オ段), kyuujitai→shinjitai conversion, tense/form detection labels |
| Deps | rusqlite, quick-xml, ureq, clap — heavy for a library crate |

Assessment: as a tokenizer it is a non-starter for manobu — GPL-3.0 is share-alike viral for the sidecar (our other Rust deps are MIT/Apache), 0.1.2/★1 maturity, greedy longest-match segmenting is *worse* than the statistical model we already run (10ten's algorithm exists to support interactive lookup with a huge dictionary, not corpus segmentation), and it forces a JMdict SQLite DB at runtime that our architecture deliberately avoids (everything embedded/offline, no runtime data resolution — doc-2 §6).

**But the deinflection *concept* is exactly right for a teacher app** — see §4.

---

## 2. What manobu already has (the baseline this research validated)

- **FTS5 search** (`packages/db`): `vocabulary_fts`/`grammar_fts`/`kanji_fts`/`sentences_fts` with `tokenize='vaporetto'` (pinned sqlite-vaporetto v0.4.0 `-with-model`, sha256-verified fetch, unicode61 fallback when the extension can't load). ASCII columns deliberately split to `unicode61` because the full model chunks ASCII into space-containing tokens (migration 0002 header rationale).
- **In-process tokenizer** (`crates/jlpt-mcp/src/tokenize.rs`): optional `vaporetto` feature, `vaporetto =0.6.5` exact-pinned, 6.05 MB `bccwj-suw+unidic_pos+kana.model.zst` under `apps/desktop/src-tauri/resources/vaporetto/model/`, `SQLITE_VAPORETTO_MODEL` override; non-ASCII queries → model tokens; ASCII/missing-model → whitespace (parity-golden-preserving).
- **Conjugation data**: `packages/japanese/data/grammar/conjugations.json` — 3,511 tables (CC BY-SA 4.0, jkindrix, auto-generated from JMdict) + MCP tool `conjugate_verb` (engine.rs).
- **Open follow-up**: TASK-24 (vaporetto cold-start — warm at boot + mmap model load), TASK-24.1/24.2 subtasks, all To Do. Cold start is the real performance issue in this repo, and it is about *our* tokenizer, not a missing alternative.

## 3. New finding from this research — the shipped model's tag channel is unused

**Live probe result** (/tmp/vapo-probe against the exact shipped `.model.zst`, vaporetto `=0.6.5` with `predict_tags=true` + `fill_tags()`):

```
食べ | tags=[Some("動詞-一般"), Some("タベ")]
まし | tags=[Some("助動詞"), Some("マシ")]
た  | tags=[Some("助動詞"), Some("タ")]
選挙/管理/委員/会 → 名詞-普通名詞-サ変可能 etc.
```

The model carries **two tag channels per token**: (1) UniDic POS string (`動詞-一般`, `名詞-一般`…), (2) **katakana reading** (`タベ`). The model's build script (`vaporetto-models/models/bccwj-suw+unidic_pos+kana/build.sh`) confirms the spec: `--tag "{4}-{5}-{6}-{7}|{24}"` (POS levels 4–7) + `--tag "{24}|"` (kana field) from UniDic 3.1.1.

`crates/jlpt-mcp/src/tokenize.rs` calls `predict()` + `fill_tags()` but **discards the tags** — it maps `iter_tokens()` to surfaces only. Reading forms are then re-derived at query time by expensive means, or missed. Also note the POS granularity is POS1-POS2 (`動詞-一般`), not the full 4-level UniDic chain the sqlite-vaporetto `tags` argument would filter on (pinned v0.4.0 parses one tag only — `packages/db/src/vaporetto.ts:VAPORETTO_TAGS` comment).

**Actionable:** expose `reading_form` (katakana → hiragana for matching vs `lookup_vocab`) and `pos` from the same model, zero new bytes, one small API change in tokenize.rs. This directly serves the Reader/Teacher surfaces that currently lack reading hints for OOV words.

## 4. Deinflection: is tentoku's feature needed here?

**Needed: yes (as capability). As tentoku's dependency: no.**

Where inflected forms currently hurt manobu:

1. **`search_vocab("食べました")` misses 食べる** — `lookup_vocab` matches surface/reading exactly; the search path substring-scans then token-overlap reranks. An inflected verb form is a different token surface than the dictionary headword stored in `data/n*.json` (entries are dictionary forms).
2. **Drill/listen flows** ask learners to type inflected answers; matching them against dictionary-form expectations needs the same normalize-to-dictionary-form step.
3. **Teacher AI grounding**: `lookup_examples(word)` (Tanaka linkedWords) works only with dictionary-form inputs.

What manobu ALREADY has covering most of this:

- `conjugations.json` 3,511 tables: full paradigm per reading — can *generate* any inflected form (reverse lookup: inflected form → which lemma generates it = deinflection by table inversion). No new data, no new code path, pure index work.
- vaporetto POS tags (§3): `食べ/まし/た` tokenization alone tells you a 動詞 stem followed by 助動詞 `まし`(masu) + `た`(past) — enough to reconstruct 食べ+ます+た with ~30 rules for the *common* assistant case (ます/た/ない/て/れば/よう/そう…).
- JMdict-derived `meaning`/`partOfSpeech` on corpus entries for POS-validated deinflection (tentoku's `Reason` validation trick, without their code).

**Recommendation (concrete):** a ~100-line `deinflect()` in `crates/jlpt-mcp/src/engine.rs` (or a new `src/deinflect.rs`), rule table derived from — but not copied from — 10ten's public algorithm (MIT), applied ONLY in the query path: before `search_vocab`/`lookup_examples`, try the raw form; if zero hits, deinflect (strip known endings, POS-validate against the corpus `partOfSpeech` field) and retry, attaching the reason string (`PolitePast`) to the result description. This is the 80/20 of tentoku with zero license exposure and zero runtime deps. NOT a priority above TASK-24 (cold-start) — but a natural TASK-24-adjacent follow-up when the Reader gains free-form input.

## 5. Decision matrix (manobu-specific weights: binary size > offline > correctness > features)

| Criterion (weight) | vaporetto (status quo) | sudachi.rs | lindera 6.0 | tentoku |
|---|---|---|---|---|
| Binary/model size (high) | **6 MB model** ✅ | 72 MB core dict ❌ | ~190 MB build download ❌ | JMdict SQLite ~130 MB runtime ❌ |
| Fully offline embedded (high) | ✅ baked | ⚠ bake feature broken | ⚠ embed = build-time download | ❌ external DB required |
| Word segmentation quality (high) | ✅ PLC-linear, SOTA speed | ✅ (gold standard) | ✅ MeCab-grade | ⚠ greedy longest-match |
| Lemma/reading/POS (medium) | ✅ POS + katakana reading via fill_tags (§3, currently unused) | ✅ best (normalized+dict+reading forms) | ✅ full UniDic fields | ⚠ JMdict-gloss only |
| Normalized form (medium) | ❌ not in model | ✅ | ⚠ only via lindera-sudachidict | ⚠ kyuujitai/chōon only |
| A/B/C granular splits (low for now) | ❌ single model | ✅ native | ⚠ SudachiDict schema has split_a/b but via MeCab lattice | ❌ |
| License (medium) | MIT/Apache ✅ | Apache-2.0 ✅ | MIT ✅ | **GPL-3.0** ❌ |
| Maintenance risk (medium) | slow-stable, exact-pinned ✅ | slow, crates.io absent ⚠ | **high churn** (v5→v6 breaking, 2 in 6 months) ⚠ | abandoned-ish (1★, 6mo) ❌ |
| Speed (low — query path is small) | ✅ fastest | 7.1× slower | 6.8× slower (MeCab) | n/a |

## 6. Recommended actions (in priority order)

1. **Do nothing about tokenizers.** No migration. Revisit only if (a) a Reader glossing panel needs normalized_form + A/B/C splits — then sudachi.rs CLI as a *separate* sidecar, or (b) FTS recall regressions appear that tokenization (not ranking) causes.
2. **Harvest the unused tag channel** in `crates/jlpt-mcp/src/tokenize.rs` (`fill_tags()` already called): add `tokenize_with_tags()` returning (surface, POS1-2, katakana reading); convert katakana→hiragana for `search_vocab` reading matching. Zero new deps, ~50 lines. Candidate follow-up task.
3. **Add query-time deinflection** (~100 lines, 10ten-style rules, MIT-clean) for `search_vocab`/`lookup_examples` miss-retry (§4). Candidate follow-up task; gate on Reader free-form input work.
4. **Unchanged priorities:** finish TASK-24 (vaporetto warm-boot + mmap) — that is where tokenizer time is actually lost today.
5. **License note for the record:** tentoku/10ten *rules data* is factual (conjugation morphology), but tentoku's *code* is GPL-3.0 — implement rules independently (10ten is MIT; its deinflection table is the cleaner upstream reference than tentoku's GPL port of it).

## 7. Provenance appendix

- crates.io API pulls (2026-09-08): lindera 6.0.0 (2,101,936 dl, MIT, rust_version 1.88, features incl. embed-ipadic/embed-unidic/embed-sudachidict/mmap/train), tentoku 0.1.2 (80 dl, GPL-3.0-or-later, deps: rusqlite/quick-xml/ureq/clap), no official sudachi crate; suiko-sudachi 0.6.11 unofficial.
- GitHub (gh API, 2026-09-08): sudachi.rs ★478 Apache-2.0 pushed 2026-08-28, releases v0.6.11 2026-04-13; lindera ★667 MIT pushed 2026-09-08, releases v6.0.0 2026-08-25; tentoku-rs ★1 GPL-3.0 pushed 2026-03-02; vaporetto ★298 pushed 2026-07-20 v0.6.5; sqlite-vaporetto ★20 pushed 2026-04-30 v0.4.0.
- Dictionary sizes: SudachiDict core wheel 72,275,897 B (PyPI sudachidict_core-20260723), small 41,770,618 B; lindera.dev sudachidict-20260723.tar.gz Content-Length 199,672,394 B; shipped vaporetto model 6,050,826 B (local file).
- Model tag spec: vaporetto-models `models/bccwj-suw+unidic_pos+kana/build.sh` — `--tag "{4}-{5}-{6}-{7}|{24}"`, `--tag "{24}|"` over UniDic 3.1.1 lex_3_1.csv.
- Performance ranking: arXiv:2406.17185 (Vaporetto PLC) Table 1 — 5.7× KyTea, 6.8× MeCab, 7.1× sudachi.rs; vaporetto wiki claims 8.7× KyTea.
- Live probe: /tmp/vapo-probe (vaporetto =0.6.5, zstd 0.13) against `apps/desktop/src-tauri/resources/vaporetto/model/bccwj-suw+unidic_pos+kana.model.zst` — tag channels [POS1-POS2, katakana reading] confirmed; `fill_tags()` required after `predict()` (lazy tag path).
- Prior context: doc-2 (§3/§5.1 tokenizer decision, §6 corpus-size tradeoff), TASK-23.1 (implemented), TASK-24 (open, cold-start).
