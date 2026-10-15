---
id: doc-2
title: Japanese datasets + sqlite-vaporetto - complementing JMdict for Teacher AI
type: specification
created_date: '2026-09-06 04:17'
---

# Japanese Datasets + sqlite-vaporetto — Complementing JMdict for a Stronger Teacher AI

> **Status:** research / specification  
> **Date:** 2026-09-06  
> **Prompt:** "JMdict is already the gold standard. No single source replaces it. But you should complement it with other datasets to make your teacher AI much more powerful" + `https://github.com/hotchpotch/sqlite-vaporetto`  
> **Manobu context:** `manobu-gg` Tauri v2 desktop — `packages/japanese` data home (`data/n1..n5.json` 8,505 vocab, `data/grammar/*` 595 points + `conjugations.json` 3,511, `data/kanji.json` 13,108, `data/pitch-accent.json` 124,011) consumed **only** by `crates/jlpt-mcp` Rust stdio MCP (`build.rs` gzip embed, 12 tools `lookup_vocab/search_vocab/list_vocab_by_level` etc. — `src/main.rs:92`), `packages/db` Drizzle+libSQL (`vocab_fts` FTS5 `test/fts5-perf.test.ts` <100 ms @ 30k rows)  
> **Sources:** EDRDG `edrdg.org` (JMdict, KANJIDIC2, JMnedict/ENAMDICT docs + DTD), `tatoeba.org/downloads`, `edrdg.org/wiki/Tanaka_Corpus.html`, `github.com/KanjiVG/kanjivg`, `github.com/mifunetoshiro/kanjium`, `github.com/jkindrix/japanese-language-data`, `github.com/daac-tools/vaporetto` + `vaporetto-models`, `github.com/hotchpotch/sqlite-vaporetto` `main` @ `26` commits, `arxiv:2406.17185` (Vaporetto PLC)

---

## 0. TL;DR — What to keep, what to add, and what sqlite-vaporetto fixes

**JMdict stays the vocabulary backbone.** At `~214,000` entries (EDRDG, CC BY-SA 4.0) it is the only maintained multilingual JM resource with sense-level `kana[]/kanji[]/sense[].gloss/partOfSpeech` and the only one already joined to manobu's JLPT corpus (`packages/japanese/scripts/fetch-vocab.ts:185` `buildSurfaceIndex` + `coarsePos` + `joinCorpus` `99.7 %` coverage). Do not replace it.

**Four complements are high-leverage because manobu already pays the license/tooling cost for them:**

| Add next | Dataset | What it adds for Teacher AI | Size | Manobu cost |
|---|---|---|---|---|
| **A. Keep** | **Tatoeba** (of which **Tanaka** is the curated `~150k` subset) | Real `JP↔EN` sentence pairs with `jpn_indices` word→sentence links → grounded example retrieval, drill generation, Reader (`SCR-05`) grading, `describe_pitch` with context | `13M+` sentences all langs; `JP` `~250k`, JP-EN links `~200k` | New `data/sentences/` + FTS5 table + MCP tools `lookup_examples/search_examples` |
| **B. Keep** | **KanjiVG** | Per-kanji `109×109` SVG `M/C/S` cubic beziers in `StrokePaths` order + `StrokeNumbers` group → true stroke animation for `SCR-03` Drill Lab `280×140` `gradeShape` + `SCR-09` `KanjiDetail.Hero` stepper (today just `stroke_count`) | `6,355` JIS X 0208 + `5,801` X 0212 `→ ~13k` files | New `data/kanjivg/` (or gzipped blob) + MCP `lookup_stroke_order` + frontend `KanjiVG.tsx` |
| **C. Already have (deepen)** | **Kanjium `accents.txt` `124,137` → `pitch-accent.json` 124k** | Mora-level accent (`0=heiban`, `1=atamadaka`, `n=nakadaka`) with `accent.css` rendering; already powers `engine.rs:describe_pitch` for `lookup_pitch_accent` | `~60k` distinct surfaces reported in prompt, `124k` in repo | Add `Kanjium+Wiktionary` `12,788` gap-fill from `jkindrix` `pitch-accent-wiktionary.json` |
| **D. Defer** | **JMnedict** `~400k` proper nouns | `surname/place/given/female/male/org/product/station/work` tags → name-aware search, Reader entity handling, avoid "word not found" on `田中/東京駅` | `s 138k, p 99k, u 139k, g 64k, f 106k, m 14k, h 30k, pr 55…` | Low priority until Reader does NER; share JMdict parser. |

**KANJIDIC2** (`~13k` entries, JIS X 0208/0212/0213) is not an addition — **manobu already ships it** (`packages/japanese/data/kanji.json` 13,108 entries, KANJIDIC2-derived via `jkindrix/japanese-language-data`, CC BY-SA 4.0). The work is to use its richer fields (`grade G1-G10`, `freq`, `radical classical/nelson_c`, `dic_number nelson_c/nelson_n/halpern_njecd/heisig…`, `query_code skip/sh_desc/four_corner/deroo`) that are currently flattened.

**`sqlite-vaporetto`** (`github.com/hotchpotch/sqlite-vaporetto`, MIT OR Apache-2.0, model BSD-3) is orthogonal to all datasets: it is the **tokenizer for the FTS5 that indexes them**. Replacing `unicode61`/`trigram` with `tokenize='vaporetto'` gives word-aware Japanese segmentation, `vaporetto_and_query / vaporetto_or_query / vaporetto_split`, `bm25()` ranking, `highlight()`, POS-tag filtering (`tags 名詞,動詞…`), and ASCII case-insensitive matching — with `Vaporetto` PLC speed `5.7× KyTea, 6.8× MeCab, 7.1× sudachi.rs` (`arxiv:2406.17185 Table 1`). This directly fixes `packages/db/test/fts5-perf.test.ts` recall and `crates/jlpt-mcp/src/engine.rs:search_*` substring scans.

---

## 1. Current manobu data — what we already have and where it derives

```
packages/japanese/
  data/
    n1.json .. n5.json          ← 8,505 entries  (JLPT list tanos.co.uk CC-BY Jonathan Waller
                                   via Bluskyo/JLPT_Vocabulary MIT  +  JMdict glosses/POS via
                                   scriptin/jmdict-simplified  CC BY-SA 4.0, 99.7 % enriched)
    grammar/n1..n5.json          ← 595 points (jkindrix/japanese-language-data  CC BY-SA 4.0)
    grammar/conjugations.json    ← 3,511 tables (same upstream, auto-generated from JMdict)
    kanji.json                   ← 13,108 kanji (KANJIDIC2 via jkindrix  CC BY-SA 4.0)
    pitch-accent.json            ← 124,011 pitch entries (Kanjium accents.txt via jkindrix  CC BY-SA 4.0)
    LICENSE.md                   ← share-alike provenance (JMdict + jkindrix → CC BY-SA 4.0 for derived files)

crates/jlpt-mcp/
  build.rs                       ← include_bytes! + flate2 gzip  → embedded at compile time
  src/types.rs                   ← serde structs, preserve_order
  src/engine.rs                  ← lookup/search/conjugate/describe_pitch (ported from TS)
  src/main.rs:81                 ← 12 tools (vocab×3, grammar×3, conjugate_verb, kanji×3, pitch×2)  jlpt-vocab v0.3.0
  tests/golden.json + parity.rs  ← byte-identical to deleted TS engine

packages/db/
  src/schema/content.ts          ← vocab, grammar, kanji, sentences, themes, vocabKanji, vocabThemes + vocab_fts FTS5
  src/index.ts:59                ← createContentDb / createUserDb, PRAGMA journal_mode=WAL
  test/fts5-perf.test.ts         ← 30k-row seed, <100 ms query budget
```

**Types contract:** `packages/japanese/AGENTS.md:30` + `crates/jlpt-mcp/AGENTS.md:27` — `data/*.json` shape changes must update `build.rs` + `src/types.rs` + `tests/golden.json` in the same commit; the former TS engine is deleted (`lookup/search` lives only in Rust now).

**What `fetch-vocab.ts:77` already models:** `coarsePos` buckets `vi/vt` (`transitive` kept separate for `開く/開ける` teaching), `adj-* → adjective`, `v* → verb`, `n* → noun`, plus glosses deduped `≤8`. This is the correct layer to extend when adding JMnedict (`s/p/u…`) or Tatoeba links.

---

## 2. Dataset deep dives

### 2.1 JMdict — the gold standard (already in use, keep as is)

| Field | Detail |
|---|---|
| **Upstream** | EDRDG `https://www.edrdg.org/jmdict/jmdict.html` (Breen 2004a), companion `Papillon` project (Sérasset 1994, MTT Mel'čuk) |
| **Size** | `~214,000` entries (prompt's number; `scriptin/jmdict-simplified` `jmdict-eng-3.6.2+…` same ballpark). Manobu's view: `scripts/fetch-vocab.ts:180` `~113 MB` JSON (`jmdict-eng-*.json` after `tgz` extract) → cached `.cache/jmdict-eng-3.6.2.json` |
| **Shape** | `JMdictEntry { id, kanji: [{text}], kana: [{text}], sense: [{ partOfSpeech: string[], gloss: [{lang,text}], misc, dialect, field… }] }` — `scripts/fetch-vocab.ts:60`. XML DTD is source; `jmdict-simplified` JSON is what `fetch-vocab.ts` consumes (`JMDICT_URL` `3.6.2+20260803141815`). |
| **Manobu use** | `buildSurfaceIndex` `183` indexes every `kanji.text + kana.text` → `enrichFrom` `201` merges glosses (`lang eng|null`) dedup `≤8` + coarse POS `≤3` onto each JLPT entry. Coverage `99.7 %`. |
| **License** | **CC BY-SA 4.0** (EDRDG). Share-alike → any redistribution of derived `data/n*.json` carrying `meaning/partOfSpeech` is CC BY-SA 4.0 (`data/LICENSE.md:41`). `jmdict-simplified` preserves the same license. |
| **Strengths** | Multilingual senses, per-reading sense restrictions (`(P)` common), `misc/dialect/field` for teaching, actively maintained weekly via EDRDG; Tanako/JMnedict share the same DTD family so parser reuse is high. |
| **Limits** | Proper nouns are **not** here — moved to `JMnedict` `1995` split (`enamdict_doc.html`); grammatical words (`です/ます`) are thin — grammar corpora (jkindrix) complement, not JMdict. |
| **Action for Teacher AI** | Do nothing to the source — deepen the **join**: surface `sense[].field/misc/dialect` in MCP `search_vocab` for "is this 敬語/口語?" queries; add a `senses[]` array (not just flattened string) when `engine.rs` grows a richer `VocabEntry`. |

### 2.2 KANJIDIC2 — kanji readings/meanings/JLPT/stroke (already shipped, under-used)

| Field | Detail |
|---|---|
| **Upstream** | EDRDG `http://www.edrdg.org/kanjidic/kanjidic2_dtdh.html` DTD `v1.6 April 2008`, docs `jmdictart.html` + `wiki/KANJIDIC_Project.html` (Breen 2004c), `pub/Nihongo/kanjidic2_ov.html`. 13,108 kanji: JIS X 0208 `6,355` + X 0212 `5,801` + X 0213 `3,693` (2,741 overlap, `952` new). |
| **Size** | `~13,000` entries; manobu `data/kanji.json` 13,108 (same universe). |
| **Shape** | DTD `kanjidic2.dtd`: `literal` (character), `codepoint { jis208/jis212/jis213/ucs }`, `radical { classical/nelson_c }`, `misc { grade G1-G10, stroke_count, variant {jis208/jis212/jis213/deroo/njecd/s_h/nelson_c…}, freq, jlpt 1-4 (pre-2010), unicode }`, `dic_number { nelson_c/nelson_n/halpern_njecd/halpern_kkld/heisig/gakken/oneill… }`, `query_code { skip/sh_desc/four_corner/deroo }`, `reading_meaning { rmg { reading r_type=ja_on/ja_kun }, meaning {m_lang} }`. Manobu currently flattens to `{ character, on, kun, meaningsEn, strokeCount, jlpt, grade, freq, radical }` via `jkindrix`. |
| **License** | **CC BY-SA 4.0** (EDRDG `General Dictionary Licence`). Codes (Nelson index, Heisig, Henshall) are provider IP but inclusion licensed: De Roo written permission; Spahn descriptor kindly supplied — commercial `SKIP` has separate restrictions (`[P]`). |
| **Strengths** | Single file covers grade `G1 G1-G6 kyōiku 1,026, G8 jōyō 1,110, G9/G10 jinmeiyō 649/212`, stroke counts with miscount alternates, frequency, JLPT legacy mapping, and **every** major dictionary index (Nelson Classic/New, Halpern NJECD/KKLD, Heisig RTK, Henshall, Spahn) — one lookup answers "where is 食 in RTK/Nelson?". |
| **Limits** | `jlpt` field is pre-2010 `1-4` (N2/N3 split not official); manobu already uses `jlpt_waller` from `jkindrix` to fix this. No SVG — that is KanjiVG's job. |
| **Action for Teacher AI** | Expose the rich indices already in `kanji.json` through MCP: `lookup_kanji('食')` should already surface `grade, freq, radical, stroke_count`; adding `skip/four_corner/deroo` lets Coach answer "how to look up unknown kanji" didactically. No new dataset — just widen `src/types.rs KanjiEntry` + `engine.rs:lookup_kanji`. |

### 2.3 Tatoeba + Tanaka — real sentences (missing, highest value-add)

| Field | Tatoeba | Tanaka Corpus (its curated subset) |
|---|---|---|
| **Source** | `https://tatoeba.org/en/downloads`, `https://dev.tatoeba.org/en/downloads` — community-curated multilingual sentences | Prof. Yasuhito Tanaka (Hyogo, Pacling2001 "Past Compilation Method"), `≈212k` raw pairs (students, `300` each, textbooks/songs/Bible), released public domain 2001; edited by Jim Breen for `WWWJDIC` (duplicates/orthography/minor-grammar filtered `210k→180k`, kana-only shorts removed, spelling/kana-kanji errors fixed, `EN↔JA` mismatch fixed, gender `[M]/[F]` tagged) → `≈150k` edited pairs; adopted by Tatoeba Project 2006 as home |
| **Today** | `13M+` sentences all languages (`sentences.tar.bz2: id \t lang \t text`), `~250k` Japanese, `links.tar.bz2` translation pairs, `jpn_indices.tar.bz2` = B-line equivalent (`sentence_id \t meaning_id \t text`) | `examples.utf.gz` (`A: JA \t EN#ID=…` pairs, 2-line chunks) — the "B lines" Tatoeba preserves; HF mirrors `hpprc/tanaka-corpus`, `nntsuzu/Tanaka-corpus` (`A: (.*?)\t(.*?)#ID=(.*)`) |
| **JMdict link** | Word-level link via `Chasen` morphological analysis (`tanaka corpus wiki:Incorporation into WWWJDIC`): `~30k` unique JP words/phrases extracted per sentence (compound words recombined if dictionary entry exists). `JMdict` `≈31,400` sentences (`≈28,700` entries) already embed a Tanaka subset since `2021-06` (`JMdict Incorporation`) | Same indices now maintained inside Tatoeba's `jpn_indices`; browsing/search by JP/EN/regex in WWWJDIC |
| **Licenses** | Tatoeba **CC BY 2.0 FR** (sentences), links **CC0**; Tanaka originally **public domain** (2001), Tatoeba re-licensed **CC BY 2.0 FR** `2009` (FR has no PD), edited `WWWJDIC` snapshot `2008-10` remains PD snapshot downloadable `EUC-JP/UTF-8` | Either PD snapshot (pre-2009) or CC BY with attribution — both permissive for manobu's share-alike derived corpus. Attribute source in `data/LICENSE.md`. |
| **Quality** | Community-corrected, natural but mixed provenance (textbook-derived) — **not** statistically representative, but **adequate for word usage examples** (`edrdg wiki:Caveats 1` still contains errors/repetition; validate before statistical use) | Same caveat; Tanaka's `Chasen` indices are `~2006` vintage — Vaporetto today is faster/more accurate. |
| **Manobu value** | **Grounds Teacher AI**: every vocab/grammar answer can cite a corpus sentence (`私はコンビニで…` already in `lesson.tsx:371`, but today handwritten). Enables `SCR-05` Reader graded sentences beyond the single `N5_DEFAULT` `コンビニで` `3`-word story, `SCR-04` Listen & Type dictation sources, and `SCR-07` Roleplay clerk prompts. | Smaller, already indexed to dictionary headwords — less infra to ship `v1`. Embed the `~31k` JMdict-embedded subset directly if full Tatoeba `250k` is heavy for a `5 MB` sidecar. |

**Concrete shape for manobu:**

* Add `data/sentences/jpn_indices.json` (or `sentences.db` SQLite) with fields `{ sentenceId, jp, en, linkedWords: string[] }` (from `jpn_indices.tar.bz2`).
* New MCP tools: `lookup_examples(word) → {jp,en,attribution}[]` and `search_examples(query,level?,limit)` (FTS5 `sentences_fts` with `vaporetto` tokenizer).
* Drizzle: `packages/db/src/schema/content.ts` add `sentences { id, jp, en, linkedWord, levelGuess }` + `themes` join already exists.
* Keep `data/grammar/n*.json` examples (`jkindrix` 595 points already have examples) as curated overlay — Tatoeba/Tanaka is the **bulk fallback**, not the authority.

### 2.4 Tanaka in isolation — why it still matters even inside Tatoeba

The `150k` edited Tanaka set is **the only Tanaka snapshot with dictionary linkage** (B-lines → `jpn_indices`). Pure Tatoeba dump has no `linkedWords`; WWWJDIC/Tatoeba maintain that index today. So shipping Tatoeba raw without `jpn_indices` loses the word→sentence join that Teacher AI needs. Practical rule: if you ship Tatoeba, also ship `jpn_indices.tar.bz2` (or the JMdict `31k` embedded subset) — they are a pair.

### 2.5 JMnedict — proper nouns (defer, but parser is free)

| Field | Detail |
|---|---|
| **Source** | `https://www.edrdg.org/enamdict/enamdict_doc.html` — split from EDICT `late 1995` when name entries outnumbered other entries; reformatted to XML `UTF-8` (`JMnedict.xml.gz`, `enamdict.gz`), plus `JIS X 0212` kanji. DTD mirrors JMdict; maintained via EDRDG online DB since `2016` (submit `jmnedict` corpus dropdown); downloadable via `ftp.edrdg.org`. |
| **Size** | `~400,000` entries (prompt) — breakdown in doc: `s surname 138,500, p place 99,500, u unclassified person 139,000, g given unclassified 64,600, f female 106,300, m male 14,500, h full person 30,500, pr product 55, c company 34, o organization, st station 8,254, wk work…` |
| **Shape** | Same as JMdict but `trans` with `name_type` bitmask: `surname/place/person/company/organization/product/stationboolean/work`. Example codes: `s`, `p`, `f`, `m`, `st`, `wk`; English descriptors for geo (`cape, island…`) extended per language. |
| **License** | **CC BY-SA 4.0** (EDRDG), same as JMdict. Share-alike propagates if `data/names.json` carries JMnedict fields. |
| **Strengths** | Covers `田中太郎, 東京, 富士山, 京急線, 任天堂` — the "word not found" hits that break Reader/Roleplay immersion; stations `st 8,254` map directly to `Roleplay` travel scenes. |
| **Limits** | `JMdict + JMnedict` double the EDRDG surface (parse twice); names have no JLPT level, no pitch accent — they are a separate MCP domain (`lookup_name/search_name`). |
| **Action for Teacher AI** | **Defer to after sentences+KanjiVG.** Parser cost is zero (reuse `fetch-vocab.ts` `JmdictFile` shape, change `trans.name_type`), so the decision is about **search UX**: add `JMnedict` only when `search_vocab` misses on names should succeed rather than fall through. When added, new tools `lookup_name/search_name/list_names_by_type` (or a `polytagged` `search_all`) — do not pollute vocab ranking with name hits. |

### 2.6 KanjiVG — stroke order SVGs (missing, visual win)

| Field | Detail |
|---|---|
| **Source** | `https://kanjivg.tagaini.net/` (Ulrich Apel, Tagaini Jisho), `https://github.com/KanjiVG/kanjivg` (`master/kanji/*.svg`), `svg-format.html`, `files.html` (JIS X 0208/0212). Reference fonts: Japanese schoolbook; shapes/order are Japanese, not Chinese. |
| **Size** | `~13,000` SVG files (covers JIS level-1 + level-2). Distributed as `kanjivg-YYYYMMDD-main.zip` (non-variant, recommended), `-all.zip` (with variants), `-stripped.zip` (no attrs), legacy single-file `kanjivg-YYYYMMDD.xml.gz` (via `kvg.py`, obsolete). |
| **Shape** | SVG extension: `109×109` px, two root groups `StrokePaths` + optional `StrokeNumbers`. `StrokePaths` contains nested `<g element="…" radical="…">` grouping strokes into elements (e.g. `頑 → 元 + 頁`), each stroke `<path kvg:id="kvg:053ec-s3" d="M…C…S…">` only `M/m C/c S/s` cubics, **ordered by stroke order**. `StrokeNumbers` `<text transform="…">1</text>` near stroke start. Attributes expose element, radical, stroke type. |
| **License** | **CC BY-SA 3.0** (`kanjivg/README` + `tagaini.net`). Attribute `KanjiVG (© Ulrich Apel)` + share-alike on derived SVGs. |
| **Strengths** | Gives manobu what `kanji.json stroke_count=9` cannot: animated `▶ 1→N` stepping, per-stroke direction, component decomposition (`kanji_parts`), radical highlighting — the substrate for `engine.rs:stroke_count` → visual verification instead of counting. `stripped.zip` lets the app run on strict XML parsers. |
| **Limits** | Art lineage matters — schoolbook glyph vs handwriting; variant forms matter for `旧字体/新字体` — use `main.zip` (not `all.zip`) unless variant toggle is a feature. |
| **Action for Teacher AI** | Store as `data/kanjivg/<unicode>.svg` (or `kanjivg.db` with SVG blobs gzipped like `jlpt-mcp/build.rs` does JSON) — `5-10 MB` gzipped for `13k` files. New MCP tool `lookup_stroke_order(character) → { strokes: {id,d,order}[], numbers:{n,x,y}[], elementTree }` and a React `KanjiVG` component `109×109 → viewBox 0 0 109 109` with `CSS stroke-dasharray` animation + `[♀]/[♂]` audio overlay already in `KanjiDetail.Audio`. Drill Lab reuse: `Canvas 280×140 + ghost 1→2→3` overlays the same SVG for guidance, graded by `gradeShape` `GHOST_TOLERANCE_PX=40`. |

### 2.7 Kanjium — pitch accent (already shipped, extend)

| Field | Detail |
|---|---|
| **Source** | `https://github.com/mifunetoshiro/kanjium` (`data/source_files/raw/accents.txt` `124,137` mora positions), supplements `wikipedia_freq.txt`, `novels_freq.txt` (`~5k novels`, ambiguous `*` frequencies), `particles.txt` (Tatoeba particle+verb), `word_segmentation.txt` (Ryuujouji GPL, remnant `連声` not handled). Aggregator `https://github.com/jkindrix/japanese-language-data` compiles it into `data/enrichment/pitch-accent.json` `124,011` + `pitch-accent-wiktionary.json` `12,788` (Kaikki.org, `CC BY-SA 4.0`, post-2022 gap-fill). |
| **Size** | Prompt says `~60,000` entries (distinct word surfaces); raw `accents.txt` `124,137`; manobu `pitch-accent.json` `124,011`; Wiktionary supplement `12,788`. Loss comes from dedup + reading disambiguation (e.g. `七 シチ/なな` ambiguous frequency marker `*`). |
| **Shape** | Kanjium `homonyms.txt: id kanji reading homonyms accent`; `kanjidb.sqlite: edict/jukugo/compverbs { word, reading, frequency*, particles, accentPos }`, `conjugations { search: ";reading;" FTS trick }`, `elements { grade 1=jouyou/2=jinmeiyou/3=hyougai, idc, elements (3-byte lookup), extra_elements, kanji_parts, part_of }`, `segments { location J=jukugo/C=compverbs/Y=yojijukugo }`, `sentences { obi2 readability }`. Manobu flattens to `{ word, reading, accent: number[], moraCount, description }` where `accent 0=heiban, 1=atamadaka, n=nakadaka 2..moraCount-1, moraCount=odaka` (see `jkindrix` `accent.css` rendering). |
| **License** | Upstream Kanjium `kanjidb.sqlite` is courtesy data (IGG crowdfunding, `CC BY`/`public` mixes); the derived `accents.txt` via `jkindrix` is shipped **CC BY-SA 4.0** (same as kanji/grammar). Attribute chain: Kanjium + Kaikki.org Wiktionary. |
| **Strengths** | Only free mora-level pitch DB with this coverage; `accent.css` gives the visual `たべ˥る` diagram that `listen-type.tsx:72 Pitch` already falls back to on `pcvtp/J-7/UUIuC`. |
| **Limits** | Homonym disambiguation is reading-gated (`七` problem `*`), Wiktionary gap-fill (`12,788`) lags community edits — refresh on rebuild (jkindrix does). |
| **Action for Teacher AI** | Already powers `lookup_pitch_accent/search_pitch_accent` (+ `describe_pitch` human description) — keep it, but **merge the Wiktionary `12,788` supplement** (`packages/japanese/scripts/fetch-kanji-pitch.ts` already fetches `jkindrix/main`; add the second JSON and overlay by `word+reading` key). No new MCP — just richer `pitch-accent.json`. |

### 2.8 jkindrix/japanese-language-data — the glue upstream

| Field | Detail |
|---|---|
| **Upstream** | `https://github.com/jkindrix/japanese-language-data` — "every piece already exists openly, but nothing unifies them." `CC BY-SA 4.0`. `data/enrichment/pitch-accent.json` `124,011 ✓`, `pitch-accent-wiktionary.json` `12,788 ✓`, kanji `KanjIDIC2` `13k` aggregation, grammar `595` + conjugations `3,511` generation from JMdict `3.6.2+…` tags. Quoted in `packages/japanese/data/LICENSE.md:44-68`. |
| **Role** | Manobu already depends on it — it is the reason `kanji.json`/`pitch-accent.json`/`grammar/*` are single `CC BY-SA 4.0` files instead of 5 upstreams. Future refresh = `bun run fetch:kanji-pitch` + curl for grammar (no script yet). |

---

## 3. sqlite-vaporetto — fast word-aware FTS5 for Japanese

### 3.1 What it is

`github.com/hotchpotch/sqlite-vaporetto` (`26` commits, MIT OR Apache-2.0) — a **loadable FTS5 extension** that registers `tokenize='vaporetto'` powered by `daac-tools/vaporetto` (`https://github.com/daac-tools/vaporetto`, Rust, MIT OR Apache-2.0, `256`★, paper `arxiv:2406.17185` + `NLP2022 D2-5`). Vaporetto = pointwise linear classification (PLC) Japanese tokenizer — learns `BCCWJ 1.1 SUW 60k` boundaries + `UniDic 3.1.0 667k` dict features, runtime is **array ops + automata feature lookup + 3 orthogonal preprocs** (`§3.1 pattern matching, §3.2 merging char n-gram scores, §3.3 integrating dict scores, §3.4 caching type n-gram`) — `5.7× KyTea, 6.8× MeCab, 7.1× sudachi.rs` on same model (`Table 1: KyTea 136.6ms → Vaporetto-e 23.8ms`), `8.7×` on `daac-tools` wiki.

Note the README warning (important for search): **"Vaporetto's pointwise prediction can produce different segmentations depending on surrounding context — same phrase is not guaranteed to split the same way."** Context-aware is good for NLP, slightly bad for `MATCH` consistency — mitigation is `vaporetto_and_query/or_query` (token-OR with `bm25`) rather than strict phrase `MATCH`.

### 3.2 How it plugs into FTS5

```sql
.load ./libsqlite_vaporetto.so sqlite3_vaporetto_init   -- .so/.dylib/.dll

CREATE VIRTUAL TABLE docs USING fts5(
  body,
  tokenize='vaporetto'                                   -- or 'vaporetto model /path/to/bccwj-suw+unidic_pos+kana.model.zst tags 名詞,動詞,形容詞 keep_untagged'
);
INSERT INTO docs VALUES ('東京特許許可局で検索エンジンの実験をした。'); -- indexed as 東京/特許/許可/局/検索/エンジン/実験

-- same tokenizer runs on the query → word-AND vs phrase
SELECT rowid FROM docs WHERE docs MATCH '東京 検索エンジン';            -- phrase over tokens → requires adjacency as indexed
SELECT rowid FROM docs WHERE docs MATCH vaporetto_and_query('東京特許許可局'); -- "東京" AND "特許" AND "許可" AND "局" → finds split docs
SELECT rowid, bm25(docs) AS rank FROM docs
  WHERE docs MATCH vaporetto_or_query('東京特許許可局') ORDER BY rank LIMIT 10;  -- recall → ranking
SELECT highlight(docs, 0, '[', ']') FROM docs WHERE docs MATCH '東京 検索エンジン'; -- [東京]特許許可局で[検索エンジン]…
SELECT vaporetto_split('東京特許許可局', '/'); -- 東京/特許/許可/局  (inspect)
```

Options: `model <path>` (or `SQLITE_VAPORETTO_MODEL`, or embedded `bccwj-suw+unidic_pos+kana.model.zst` via `-with-model` build `MODEL_LICENSES.md BSD-3`), `wsconst DGR` (chars not to segment), `tags 名詞,動詞…` (prefix filter `名詞-普通名詞-一般` → kept), `keep_untagged` (ASCII/unknown tokens), `case sensitive/insensitive` (default **case insensitive** ASCII — `Hello` ↔ `hello`, `highlight` preserves original case).

Helpers: `vaporetto_split(text[, sep[, opts]])`, `vaporetto_and_query(text[, opts])` (every token `AND`), `vaporetto_or_query(text[, opts])` (any token `OR`) — quote tokens for FTS5, omit whitespace-only tokens.

### 3.3 Vaporetto models

Upstream `https://github.com/daac-tools/vaporetto-models/releases`:

* **`bccwj-suw+unidic_pos+kana.model.zst`** — recommended for `tags` filtering (has POS + kana predictions) — ships in `-with-model` release artifacts (adds **BSD-3** to the bundle, see `MODEL_LICENSES.md`). Enables `tokenize='vaporetto tags 名詞,動詞,形容詞,副詞,接頭辞,接尾辞 keep_untagged'` (practical default for search indexes — keeps content-bearing POS + ASCII).
* Small `bccwj-suw_c0.003` smoke-test model — CI only, not for `tags`.

Builds: `make build` (no embed, needs `model` arg or `SQLITE_VAPORETTO_MODEL`), `make embedded-build` / `make embedded-release` (embed default). Tests: `make test` (temp SQLite + model in `.tmp/`), `make test-release-light`, `make test-embedded`.

### 3.4 Performance in context

`faster 5.7× KyTea / 6.8× MeCab (same dict) / 7.1× sudachi.rs` is **boundary classification only** — FTS5's `fts5: tokenization + merge + bm25` dominates end-to-end. For manobu's `F T S5 perf guard 30k rows <100 ms` (`packages/db/test/fts5-perf.test.ts`), the win is not raw ns/token but **correct tokens**: `東京特許許可局` staying unsplit vs split as `東京/特許/許可/局` changes whether `MATCH '東京特許許可'` hits at all — the `AND/OR` helpers make search usable rather than micro-faster.

### 3.5 Trade-offs and caveats

* **Segmentation variance:** `東京特許許可局` may segment differently in query vs document depending on surrounding context — strict `MATCH '東京特許許可局'` may miss a doc indexed as `東京 特許 許可局`. **Mitigation:** always use `vaporetto_and_query/vaporetto_or_query` for user input; reserve raw `MATCH` for exact token-phrase probes.
* **Bundle size:** `bccwj-suw+unidic_pos+kana.model.zst` is `~few MB` compressed; `-with-model` `.so + .model` is larger than bare `-without-model`. For Tauri sidecar `crates/jlpt-mcp` (goal `~5 MB`), keep model **path-based** (`SQLITE_VAPORETTO_MODEL`) rather than embedded, loaded from `app_data_dir/speech/models/…` sibling dir — same pattern as `sherpa-onnx` models (`models.rs:34 models_dir`).
* **License additive:** bare extension MIT/Apache-2.0; `-with-model` adds BSD-3 for the model file — attribute in `MODEL_LICENSES.md` style.

---

## 4. Comparative table — what to add when

| # | Dataset | Size | License | Manobu has it? | Teacher AI win | FTS5 tokenizer win | Ship priority |
|---|---|---|---|---|---|---|---|
| 1 | **JMdict** | `~214k` entries | CC BY-SA 4.0 | ✅ `fetch-vocab.ts:40 JMDICT_TAG 3.6.2+…` `~113 MB JSON` `99.7%` | Vocabulary core — glosses + POS for sense-correct answers | Enables `search_vocab` on `meaning` + `reading` with `vaporetto tags 名詞,動詞` so `たべる → 食べる` recall via `reading` survives | **Already shipped** |
| 2 | **Tatoeba + Tanaka (`jpn_indices`)** | `13M+` total / `JP ~250k` / `JP-EN links ~200k` / Tanaka `~150k` edited | CC BY 2.0 FR / PD snapshot / Tatoeba CC0 links | ❌ | Real sentences for every drill/reader/roleplay; Teacher AI can cite sources, not hallucinate examples; bulk fallback for 595 grammar points | Sentences table `sentences_fts` with `vaporetto` so `検索エンジン 実験` `AND/OR` finds relevant corpus hits; `highlight()` for reader overlay | **P1** (after tokenizer) |
| 3 | **KanjiVG** | `~13k` SVG (`main.zip` non-variant) | CC BY-SA 3.0 | ❌ | True stroke animation + component tree (`StrokePaths` groups) for Drill Lab ghost `1→2→3` + KanjiVG hero stepper; fixes `TODO KanjiVG ingestion` in `KanjiDetail.Hero` | Not FTS — blob storage; but `q_code skip/sh_desc` from KANJIDIC2 can index against SVG `element` attrs | **P1** (visual, narrow scope) |
| 4 | **Kanjium + Wiktionary** | `124k` + `12.8k` gap-fill | Kanjium crowd / Wiktionary CC BY-SA 4.0 (via `jkindrix`) | ✅ `124k` `pitch-accent.json` | Already powers `lookup_pitch_accent` `describe_pitch`; `12.8k` Wiktionary overlay closes post-2022 gaps | Same FTS; `accent mora 0=heiban` query by `surface OR reading` benefits from `keep_untagged` for mixed kana/ASCII | **P0** tiny — add `fetch-kanji-pitch.ts` second source |
| 5 | **KANJIDIC2** | `13,108` kanji | CC BY-SA 4.0 | ✅ `13,108` `kanji.json` | Grade `G1-G10`, `freq`, `radical classical/nelson_c`, all `dic_number` + `query_code` — already there, just under-surfaced | `search_kanji` on `on/kun/meaning` gains from `vaporetto tags 名詞` filtering | **Already shipped** — widen `engine.rs` fields |
| 6 | **JMnedict** | `~400k` names | CC BY-SA 4.0 | ❌ | `surname/place/station/product/work` aware: `search_vocab` stops missing `渋谷/佐藤` | Separate `names_fts` with `vaporetto` — do not merge with vocab ranking | **P2** (after sentence infra) |
| 7 | **sqlite-vaporetto** | ext `~200 KB` + model `~few MB zst` | MIT OR Apache-2.0 (+ BSD-3 with model) | ❌ (`unicode61` today) | Makes every `search_*` useful by segmenting `東京特許許可局` → `東京/特許/許可/局` | `tokenize='vaporetto tags 名詞,動詞,形容詞,副詞,接頭辞,接尾辞 keep_untagged'`, `vaporetto_and_query/or_query` + `bm25()`; helpers for query building | **P0** (before adding more rows) |

---

## 5. How to integrate in manobu — concrete file plan

### 5.1 sqlite-vaporetto first (unblocks quality of everything else)

* **DB layer** `packages/db/src/schema/content.ts`: for every FTS5 table (`vocab_fts`, `grammar_fts`, `kanji_fts`, new `sentences_fts`, future `names_fts`), change `tokenize='unicode61 "remove_diacritics 1"'` → `tokenize='vaporetto tags 名詞,動詞,形容詞,副詞,接頭辞,接尾辞 keep_untagged'` (POS-filter to content words; `keep_untagged` preserves ASCII/flat kana). Provide `tokenizeWithModel` helper that injects `model /app_data/vaporetto/bccwj-suw+unidic_pos+kana.model.zst` when `SQLITE_VAPORETTO_MODEL` is unset (dev) vs embedded (prod `-with-model` variant).
* **Extension loading** `packages/db/src/index.ts:33 applyPragmas`: after `journal_mode=WAL`, `SELECT load_extension('libsqlite_vaporetto')` (libSQL `load_extension` gate) with fallback to no-op when extension missing — tests (`fts5-perf.test.ts`) assert both paths.
* **Query builders** `crates/jlpt-mcp/src/engine.rs` `search_vocab/search_grammar/search_kanji/search_pitch_accent`: for `limit 1..50` paths, replace `str::contains` substring scan (or raw `MATCH`) with `vaporetto_or_query(query) ORDER BY bm25(fts) LIMIT ?` then `highlight(fts,0,'[',']')` for display; expose `vaporetto_split(query)` debug tool for `__test__`.
* **Tauri bundling** `apps/desktop/src-tauri/build.rs` + `Cargo.toml`: add `sqlite-vaporetto` crate as `cdylib` dependency or sidecar `libsqlite_vaporetto.so/.dylib/.dll` to `bundle.externalBin` (same shape as `crates/jlpt-mcp`), resolved via `bundle.resources` → `app_data_dir/vaporetto/` (sibling to `speech/models`).
* **Verification:** `packages/db/test/fts5-perf.test.ts` `30k` seed still `<100 ms` but with `vaporetto` `MATCH` semantics (`東京特許許可` → `東京 AND 特許 AND 許可`); new `crates/jlpt-mcp/tests/parity.rs` golden updated from `vaporetto_and_query` output.

### 5.2 Sentences (Tatoeba + Tanaka) second

* **Fetch** `packages/japanese/scripts/fetch-sentences.ts` (new, sibling to `fetch-vocab.ts:24` pattern) — downloads `sentences.tar.bz2`, `jpn_indices.tar.bz2` (or `examples.utf.gz` PD snapshot) into `.cache/`, emits `data/sentences/sentences.jsonl` (`{id, jp, en, linkedWords}` from `jpn_indices` `sentence_id \t meaning_id \t Text` lines). Deduplicate `jp+en` pair, tag `attribution: "Tatoeba CC BY 2.0"` or `"Tanaka PD"`; optionally emit the `JMdict 31k` embedded subset as `data/sentences/jmdict-examples.json` for the sidecar-embedded variant.
* **DB** `packages/db/src/schema/content.ts`: add `sentences { id PK, jp TEXT NOT NULL, en TEXT NOT NULL, linkedWord TEXT, jpLen INT }` + `sentences_fts USING fts5(jp, en, tokenize='vaporetto …')` + `content='sentences'` triggers.
* **MCP** `crates/jlpt-mcp/src/main.rs:81` `#[tool_router]`: add `lookup_examples(word)`, `search_examples(query, limit, level?)`, `random_example(level?)` (`level` via `jpn_indices` `levelGuess` heuristic or Tanaka's `jlpt` guess). Results carry `description` enriched by `describe_pitch` analog (`jp [reading] (EN)` + `highlight` span + attribution).
* **Teacher AI** `packages/agent` / `apps/server/src/sensei-prompt.ts`: instruct Coach to **prefer** `search_examples` over hallucinated `Example: 私は…` — cite `source: Tatoeba #id`. `Reader` (`SCR-05`) and `Lesson` (`lesson.tsx:371`) switch from handwritten `コンビニで` to corpus random `N5` picks when offline fallback (`offline-fallback.test.ts`) kicks in.

### 5.3 KanjiVG third

* **Fetch** `packages/japanese/scripts/fetch-kanjivg.ts` (new): curl `kanjivg-YYYYMMDD-main.zip` → expand `kanji/*.svg` → emit `data/kanjivg/<unicode>.svg` (or gzipped `data/kanjivg.jsonl { unicode, svg }`). Record `SOURCE_SHA` in `data/LICENSE.md` + `CC BY-SA 3.0` note.
* **Engine** `crates/jlpt-mcp/src/engine.rs`: add `lookup_stroke_order(character) → { svg, strokeCount, strokes:[{id, d}], numbers:[{n,x,y}], elementPath:[radical, element…] }` parsing the SVG `kvg:id kvg:053ec-sN` + `StrokeNumbers` `<text>`.
* **UI** `apps/desktop/src/components/kanji-detail.tsx` (hero stepper) + `drill-lab.tsx` (`Canvas 280×140`): new `<KanjiVG svg strokeIndex numbers viewBox="0 0 109 109" />` with `CSS stroke-dasharray` animated progression; `ghost 1→2→3` draws the next stroke's `d` faintly. `pointerType mouse|pen|touch` `gradeShape` stays.

### 5.4 Kanjium gap-fill (tiny, do with P1)

* In `packages/japanese/scripts/fetch-kanji-pitch.ts`: also fetch `pitch-accent-wiktionary.json` from `jkindrix` and merge into `data/pitch-accent.json` keyed by `word+reading` (`12,788` overlay, prefer Kanjium on conflict, provenance `source: "kanjium"|"wiktionary"`). Same `CC BY-SA 4.0`.

### 5.5 JMnedict last

* When Reader NER is needed, reuse `fetch-vocab.ts` parser: new `scripts/fetch-names.ts` downloading `JMnedict.xml.gz` (`ftp.edrdg.org`), emitting `data/names.json` with `name_type` bitmask. Add MCP `lookup_name/search_name/list_names_by_type` — keep `names_fts` separate from `vocab_fts` with same `vaporetto` tokenizer.

---

## 6. Risks, licenses, and commit contracts

* **Share-alike aggregation:** `data/n*.json` (`meaning/partOfSpeech` from JMdict), `data/kanji.json` (KANJIDIC2), `data/grammar/*` + `data/pitch-accent.json` (jkindrix), Tatoeba sentences (`CC BY 2.0`), Tanaka snapshot (PD or CC BY), KanjiVG (`CC BY-SA 3.0`), Kanjium/Wiktionary (`CC BY-SA 4.0`), `vaporetto model BSD-3` — the **derived corpus as a whole is CC BY-SA 4.0 or more restrictive thereafter**. Keep `packages/japanese/data/LICENSE.md` updated with every new upstream `SOURCE_URL` + commit SHA + SPDX, as `fetch-vocab.ts:37` pins (`JMDICT_TAG 3.6.2+…`). Tauri bundle `bundle.resources` must ship license texts.
* **Byte identity:** each new `data/` file added to `crates/jlpt-mcp/build.rs` gzip list must bump `crates/jlpt-mcp/src/types.rs` struct (if shape changes) + regenerate `tests/golden.json` + `parity.rs` in the same PR (`crates/jlpt-mcp/AGENTS.md:27`).
* **Binary size:** sidecar is `~5 MB` today (`crates/AGENTS.md: opt-level="z", lto, strip`). Adding sentences `250k JP × ~100B avg → ~25 MB` raw → gzipped `~2-3 MB`, KanjiVG `13k × ~2 KB SVG → ~26 MB → gz ~6 MB`. Keep embedded vs path-based tradeoff: small augment (Kanjium gap-fill) embed; large augment (sentences, SVG blobs) as sibling files under `app_data_dir/content/` loaded lazily, not `include_bytes!`.
* **Segmentation variance caveat** (`sqlite-vaporetto README`): never do `WHERE fts MATCH 'user typed exactly'` as a strict phrase — always go through `vaporetto_and_query/or_query` + `bm25()`; expose `vaporetto_split()` as debug so Coach can explain why `東京特許許可局` and `東京で特許の許可` surface different hits.

---

## 7. Recommended order (mirrors the earlier sherpa epic pattern)

1. **P0 — sqlite-vaporetto FTS5 switch** (`packages/db` + `crates/jlpt-mcp` engine) — 1 PR, gates all search quality.
2. **P1 — Tatoeba+Tanaka sentences** (`fetch-sentences.ts` + `sentences_fts` + MCP `search_examples`) — grounds Teacher AI examples.
3. **P1 — KanjiVG SVG** (`fetch-kanjivg.ts` + `lookup_stroke_order` + `KanjiVG.tsx`) — completes Drill/KanjiDetail TODO.
4. **P0/tiny — Kanjium Wiktionary `12k` overlay** (one extra fetch line).
5. **P2 — JMnedict names** (only when "name not found" becomes a top miss).

Each step is a self-contained `fetch:` script + `data/` diff + `build.rs/types.rs/golden.json` sync + MCP tool addition + `cargo test` + `bun run db:push`/`fts5-perf.test.ts` check.

### 7.1 — TASK-23.1 implementation notes: what differs from this spec (2026-09-07)

Recorded so nobody re-derives these findings (full analysis: `backlog/docs/analysis/task-23.1-parity-recovery.md`):

* **Pinned release syntax is older than this doc.** §3.2's `tokenize='vaporetto tags 名詞,動詞… keep_untagged'`, `model <path>`, and `wsconst` args are `main`-branch README syntax. The shipped **v0.4.0** extension accepts only the bare `tokenize='vaporetto'` directive (the `-with-model` artifact embeds the model, so no `model` arg is needed or supported). Do not use the richer directive until a newer release is verified to bundle it.
* **The model is embedded in the extension, not separately downloadable.** `daac-tools/vaporetto-models` does not ship prebuilt `.model.zst` files (they are built from source via `build.sh`). The only fetch target is the extension tarball: `packages/db/scripts/fetch-vaporetto.ts` pins the **v0.4.0** `-with-model` artifact (sha256-verified) into `apps/desktop/src-tauri/resources/vaporetto/`. §3.3's separate-model-download plan is moot.
* **Rust sidecar uses the `vaporetto` crate in-process, not the SQLite extension.** Approved architecture decision: the `crates/jlpt-mcp` sidecar loads the same `.model.zst` via the optional `vaporetto` cargo feature (`src/tokenize.rs`, `SQLITE_VAPORETTO_MODEL` env override), with token-overlap reranking on top of the substring-scan hit-set in `search_*`. Pure token-overlap ranking of short Japanese queries changes result membership versus the TS golden (the model segments はし → [は, し]), so ranking is substring-filter-first; the DB-side FTS5 tables remain the place where `vaporetto_or_query`/`bm25()` semantics will pay off.
* **Short-query segmentation caveat is real.** With BCCWJ+UniDic, `split_tokens("はし")` → `["は", "し"]` (char/morpheme-level), so token-count ranking over an unfiltered corpus surfaces unrelated entries. §3.5's mitigation (`vaporetto_and_query/or_query` + `bm25()`) stands for the DB path; the sidecar keeps substring-first ordering for parity.

---

## 8. References — primary sources used

* **EDRDG:** `edrdg.org/jmdict/jmdict.html` (Breen 2004a), `enamdict/enamdict_doc.html`, `kanjidic/kanjidic2_dtdh.html` (DTD v1.6), `wiki/KANJIDIC_Project.html`, `pub/Nihongo/kanjidic2_ov.html` (X 0208/0212/0213 counts), JMdict art paper (Papillon/MTT).
* **Tatoeba / Tanaka:** `tatoeba.org/en/downloads` (`sentences.tar.bz2`, `jpn_indices.tar.bz2`, `sentencesCC0`), `dev.tatoeba.org/downloads` (B-lines doc), `edrdg.org/wiki/Tanaka_Corpus.html` (212k → 180k → 150k, Chasen `30k` word extraction, `31,400` JMdict-embedded subset since `2021-06`, `2008-10` PD snapshot), `huggingface.co/datasets/hpprc/tanaka-corpus` + `nntsuzu/Tanaka-corpus`.
* **KanjiVG:** `kanjivg.tagaini.net` (`svg-format.html` `109×109 M/C/S`, `files.html` JIS lv1/lv2, `main.zip` vs `all.zip` vs `stripped.zip`), `github.com/KanjiVG/kanjivg/tree/master/kanji`.
* **Kanjium:** `github.com/mifunetoshiro/kanjium` (`data/source_files/raw/accents.txt` `124,137`, `kanjidb.sqlite` `edict/jukugo/compverbs/elements…`, `accents.txt` mora positions, `accents.css`), `data/source_files/0_README.txt`, `jkindrix/japanese-language-data` (`data/enrichment/pitch-accent.json` `124,011 ✓`, `pitch-accent-wiktionary.json` `12,788 ✓`).
* **jkindrix:** `github.com/jkindrix/japanese-language-data` (glue, CC BY-SA 4.0, "every piece exists but nothing unifies them").
* **sqlite-vaporetto / Vaporetto:** `github.com/hotchpotch/sqlite-vaporetto` (`Quick Start` `.load`, `tokenize='vaporetto model … tags … keep_untagged case …'`, helpers `and_query/or_query/split`, `MODEL_LICENSES.md` BSD-3, `make build/embedded-release/test`), `github.com/daac-tools/vaporetto` (`5.7× KyTea 6.8× MeCab 7.1× sudachi.rs`, PLC array+automata+3 preprocs, model `bccwj-suw+unidic_pos+kana`), `arxiv:2406.17185` Table 1, `daac-tools/vaporetto-models/releases`.
* **Manobu:** `packages/japanese/{AGENTS.md,package.json,src/types.ts,data/LICENSE.md,scripts/fetch-vocab.ts:24 JMDICT_TAG 3.6.2+… JLPT_SOURCE_URL, fetch-kanji-pitch.ts}`, `crates/jlpt-mcp/{AGENTS.md,src/main.rs:81 12 tools, build.rs, tests/parity.rs}`, `packages/db/{AGENTS.md,src/schema/content.ts,src/index.ts:59, test/fts5-perf.test.ts}`, `apps/desktop/src/components/{drill-lab.tsx,kanji-detail.tsx}`.

