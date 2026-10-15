//! Pure engine functions · a faithful port of the TS engine
//! (`@manobu/japanese/src/{index,grammar,kanji,pitch-accent}.ts`). Search
//! semantics, case handling, and result ordering are identical so MCP tool
//! output is byte-compatible with the previous binary.

use std::collections::HashSet;

use crate::tokenize::{split_tokens, tokenize_with_tags};
use crate::types::{
    ConjugationEntry, Corpus, DrillCandidate, DrillCandidateSource, DrillCandidatesResult,
    GrammarPoint, JlptLevel, KanjiEntry, PitchAccentEntry, SentenceEntry, StrokeNumber,
    StrokeOrderEntry, StrokePath, VocabEntry,
};

/// True when a string contains any non-ASCII character (i.e. is not pure
/// English/romaji). Only non-ASCII queries switch to token-overlap ranking;
/// ASCII behavior stays byte-identical to the TS engine (parity golden).
fn has_non_ascii(text: &str) -> bool {
    text.chars().any(|character| !character.is_ascii())
}

/// Score one entry against the query tokens: count how many tokens appear in
/// any of the haystacks. Higher = more query tokens matched (the Rust
/// approximation of `vaporetto_or_query` + `bm25()` ranking).
fn overlap_score(haystacks: &[&str], tokens: &[String]) -> usize {
    if tokens.is_empty() {
        return 0;
    }
    let mut score = 0;
    for token in tokens {
        if haystacks
            .iter()
            .any(|haystack| haystack.contains(token.as_str()))
        {
            score += 1;
        }
    }
    score
}

/// Exact match on the surface form (kanji or kana reading).
/// `lookup_vocab` plus the deinflection reason when the result came from
/// the TASK-23.27 miss-retry (empty string on direct hits). Direct hits are
/// byte-identical to the pre-retry behavior (AC#3).
pub fn lookup_vocab_with_reason(corpus: &Corpus, word: &str) -> (Vec<VocabEntry>, String) {
    let q = word.trim();
    if q.is_empty() {
        return (Vec::new(), String::new());
    }
    let direct: Vec<VocabEntry> = corpus
        .all_vocab
        .iter()
        .filter(|e| e.word == q || e.reading == q)
        .cloned()
        .collect();
    if !direct.is_empty() {
        return (direct, String::new());
    }
    for candidate in crate::deinflect::deinflect(q) {
        let retried: Vec<VocabEntry> = corpus
            .all_vocab
            .iter()
            .filter(|e| {
                e.word.contains(candidate.form.as_str())
                    && e.part_of_speech
                        .as_deref()
                        .map_or(false, |pos| pos.contains(candidate.required_pos))
            })
            .cloned()
            .collect();
        if !retried.is_empty() {
            return (retried, candidate.reason.to_string());
        }
    }
    (Vec::new(), String::new())
}

/// Substring search over word, reading, and (when present) meaning.
/// TS lowercases word + meaning but compares reading as-is.
///
/// TASK-23.1: non-ASCII queries use word-aware token-overlap ranking (the
/// in-process analogue of `vaporetto_or_query` + `bm25()`): keep the
/// substring-scan hit-set, then rerank by matched-token-count so the result
/// membership is identical to the TS engine while multi-token Japanese
/// queries surface the most relevant matches first.
/// `search_vocab` plus the deinflection reason when the result came from
/// the TASK-23.27 miss-retry (empty string on direct hits · the tool layer
/// appends it to the response description).
pub fn search_vocab_with_reason(
    corpus: &Corpus,
    query: &str,
    limit: usize,
) -> (Vec<VocabEntry>, String) {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return (Vec::new(), String::new());
    }
    let direct: Vec<VocabEntry> = if has_non_ascii(&q) {
        // Tag-channel match (TASK-23.26): the model's katakana reading
        // (converted to hiragana) widens the candidate + ranking fields so an
        // inflected query like たべました can hit the 食べる entry: the model
        // reads the renyōkei stem (たべ), a prefix of the stored reading
        // たべる, while the raw query substring-matches nothing. Drop only
        // readings that ARE the whole query (pure redundancy · the query
        // already substring-matches); short particle readings survive the
        // stem case because the stem itself is what bridges. Boundaries and
        // the ASCII/parity path are unchanged.
        let tokens = split_tokens(&q);
        let readings: Vec<String> = tokenize_with_tags(&q)
            .into_iter()
            .filter_map(|token| token.reading)
            .filter(|reading| !reading.is_empty() && *reading != q)
            .collect();
        // TASK-55: prefix match, not contains · the reading tag is the
        // renyōkei STEM of the query (たべ for たべました), so stored
        // readings START with it. contains() overmatched mid-word: み
        // (from みました) pulled すむ/よむ/読む-family rows whose readings
        // merely CONTAIN み, crowding the real target out of the cap.
        let reading_hit = |e: &VocabEntry| {
            readings
                .iter()
                .any(|reading| e.reading.starts_with(reading.as_str()))
        };
        let candidates: Vec<(&VocabEntry, usize)> = corpus
            .all_vocab
            .iter()
            .enumerate()
            .filter(|(_, e)| {
                e.word.to_lowercase().contains(&q)
                    || e.reading.to_lowercase().contains(&q)
                    || e.meaning
                        .as_deref()
                        .map_or(false, |m| m.to_lowercase().contains(&q))
                    || reading_hit(e)
            })
            .map(|(index, e)| (e, index))
            .collect();
        let mut ranked: Vec<(usize, usize, usize, &VocabEntry)> = candidates
            .iter()
            .map(|&(e, index)| {
                let fields = {
                    let mut f = vec![e.word.to_lowercase(), e.reading.clone()];
                    if let Some(m) = e.meaning.as_deref() {
                        f.push(m.to_lowercase());
                    }
                    f
                };
                let matched = overlap_score(
                    &fields.iter().map(String::as_str).collect::<Vec<_>>(),
                    &tokens,
                );
                // TASK-55: direct substring hits (word/reading contains the
                // raw query) rank above reading-bridge-only entries before
                // the cap truncates · the bridge widens recall, it must not
                // displace the target.
                let direct_substring = (e.word.to_lowercase().contains(&q)
                    || e.reading.to_lowercase().contains(&q))
                    as usize;
                (index, direct_substring, matched, e)
            })
            .collect();
        ranked.sort_by(|left, right| {
            right
                .1
                .cmp(&left.1)
                .then_with(|| right.2.cmp(&left.2))
                .then_with(|| left.0.cmp(&right.0))
        });
        ranked.truncate(limit);
        ranked.into_iter().map(|(_, _, _, e)| e.clone()).collect()
    } else {
        corpus
            .all_vocab
            .iter()
            .filter(|e| {
                e.word.to_lowercase().contains(&q)
                    || e.reading.to_lowercase().contains(&q)
                    || e.meaning
                        .as_deref()
                        .map_or(false, |m| m.to_lowercase().contains(&q))
            })
            .take(limit)
            .cloned()
            .collect()
    };
    // TASK-23.27 miss-retry + TASK-55: deinflected candidates rank ABOVE
    // bridged substring hits (みました → みる → 見る must beat the 〜む
    // reading bridge), and the retry runs even when the direct set is
    // non-empty · the bridge can fill the result set with unrelated rows
    // that would otherwise displace the target. Merge order:
    // deinflected hits (reason attached) → remaining direct hits, capped.
    let mut candidates = crate::deinflect::deinflect(&q);
    if let Some(form) = crate::deinflect::godan_e_potential(&q) {
        candidates.push(crate::deinflect::Deinflection {
            form,
            reason: "Potential",
            required_pos: crate::deinflect::VERB_POS,
        });
    }
    let mut merged_final: Vec<VocabEntry> = Vec::new();
    let mut merged_reason = String::new();
    for candidate in candidates {
        // TASK-55: single-kana stems produce junk dictionary forms (み →
        // む) whose contains() matches an entire verb class · skip them.
        if candidate.form.chars().count() < 2 {
            continue;
        }
        let retried: Vec<VocabEntry> = corpus
            .all_vocab
            .iter()
            .filter(|e| {
                (e.word.contains(candidate.form.as_str())
                    || e.reading.contains(candidate.form.as_str()))
                    && e.part_of_speech
                        .as_deref()
                        .map_or(false, |pos| pos.contains(candidate.required_pos))
            })
            .take(limit)
            .cloned()
            .collect();
        for entry in retried {
            if merged_final.len() >= limit {
                break;
            }
            if !merged_final
                .iter()
                .any(|m| m.word == entry.word && m.reading == entry.reading)
            {
                if merged_reason.is_empty() {
                    merged_reason = candidate.reason.to_string();
                }
                merged_final.push(entry);
            }
        }
    }
    for entry in &direct {
        if merged_final.len() >= limit {
            break;
        }
        if !merged_final
            .iter()
            .any(|m| m.word == entry.word && m.reading == entry.reading)
        {
            merged_final.push(entry.clone());
        }
    }
    (merged_final, merged_reason)
}

/// All entries for a JLPT level (N1–N5).
pub fn list_vocab_by_level(corpus: &Corpus, level: &str) -> Vec<VocabEntry> {
    let normalized = level.trim().to_uppercase();
    match parse_level(&normalized) {
        Some(l) => corpus.vocab_by_level.get(&l).cloned().unwrap_or_default(),
        None => Vec::new(),
    }
}

/// Exact grammar-point lookup by id (e.g. "desu-polite-copula").
pub fn lookup_grammar(corpus: &Corpus, id: &str) -> Option<GrammarPoint> {
    let q = id.trim();
    if q.is_empty() {
        return None;
    }
    corpus.grammar_by_id.get(q).cloned()
}

/// Substring search over pattern, English meaning, and detailed explanation.
/// Non-ASCII queries use token-overlap ranking (TASK-23.1): keep the
/// substring-scan hit-set, then rerank by matched-token-count.
pub fn search_grammar(corpus: &Corpus, query: &str, limit: usize) -> Vec<GrammarPoint> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    if has_non_ascii(&q) {
        let tokens = split_tokens(&q);
        let candidates: Vec<(&GrammarPoint, usize)> = corpus
            .all_grammar
            .iter()
            .enumerate()
            .filter(|(_, p)| {
                p.pattern.to_lowercase().contains(&q)
                    || p.meaning_en.to_lowercase().contains(&q)
                    || p.meaning_detailed.to_lowercase().contains(&q)
            })
            .map(|(index, p)| (p, index))
            .collect();
        let mut ranked: Vec<(usize, usize, &GrammarPoint)> = candidates
            .iter()
            .map(|&(p, index)| {
                let fields = [
                    p.pattern.to_lowercase(),
                    p.meaning_en.to_lowercase(),
                    p.meaning_detailed.to_lowercase(),
                ];
                let matched = overlap_score(
                    &fields.iter().map(String::as_str).collect::<Vec<_>>(),
                    &tokens,
                );
                (index, matched, p)
            })
            .collect();
        ranked.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
        ranked.truncate(limit);
        ranked.into_iter().map(|(_, _, p)| p.clone()).collect()
    } else {
        corpus
            .all_grammar
            .iter()
            .filter(|p| {
                p.pattern.to_lowercase().contains(&q)
                    || p.meaning_en.to_lowercase().contains(&q)
                    || p.meaning_detailed.to_lowercase().contains(&q)
            })
            .take(limit)
            .cloned()
            .collect()
    }
}

/// All grammar points for a JLPT level (N1–N5).
pub fn list_grammar_by_level(corpus: &Corpus, level: &str) -> Vec<GrammarPoint> {
    let normalized = level.trim().to_uppercase();
    match parse_level(&normalized) {
        Some(l) => corpus.grammar_by_level.get(&l).cloned().unwrap_or_default(),
        None => Vec::new(),
    }
}

/// Exact conjugation lookup by kana reading (e.g. "たべる").
pub fn conjugate(corpus: &Corpus, reading: &str) -> Option<ConjugationEntry> {
    let q = reading.trim();
    if q.is_empty() {
        return None;
    }
    corpus.conjugation_by_form.get(q).cloned()
}

/// Exact lookup by kanji character (e.g. "食").
pub fn lookup_kanji(corpus: &Corpus, character: &str) -> Option<KanjiEntry> {
    let q = character.trim();
    if q.is_empty() {
        return None;
    }
    corpus.kanji_by_character.get(q).cloned()
}

/// Substring search over the character, on/kun readings, and English meanings.
/// TS compares the character as-is (kanji has no case) but lowercases
/// readings and meanings. Non-ASCII queries use token-overlap ranking
/// (TASK-23.1): keep the substring-scan hit-set, then rerank.
pub fn search_kanji(corpus: &Corpus, query: &str, limit: usize) -> Vec<KanjiEntry> {
    let q = query.trim().to_lowercase();

    if q.is_empty() {
        return Vec::new();
    }
    if has_non_ascii(&q) {
        let tokens = split_tokens(&q);
        let candidates: Vec<(&KanjiEntry, usize)> = corpus
            .all_kanji
            .iter()
            .enumerate()
            .filter(|(_, e)| {
                e.character.contains(&q)
                    || e.on_readings.iter().any(|r| r.to_lowercase().contains(&q))
                    || e.kun_readings.iter().any(|r| r.to_lowercase().contains(&q))
                    || e.meanings.iter().any(|m| m.to_lowercase().contains(&q))
            })
            .map(|(index, e)| (e, index))
            .collect();
        let mut ranked: Vec<(usize, usize, &KanjiEntry)> = candidates
            .iter()
            .map(|&(e, index)| {
                let mut fields = vec![e.character.clone()];
                fields.extend(e.on_readings.iter().map(|r| r.to_lowercase()));
                fields.extend(e.kun_readings.iter().map(|r| r.to_lowercase()));
                fields.extend(e.meanings.iter().map(|m| m.to_lowercase()));
                let matched = overlap_score(
                    &fields.iter().map(String::as_str).collect::<Vec<_>>(),
                    &tokens,
                );
                (index, matched, e)
            })
            .collect();
        ranked.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
        ranked.truncate(limit);
        ranked.into_iter().map(|(_, _, e)| e.clone()).collect()
    } else {
        corpus
            .all_kanji
            .iter()
            .filter(|e| {
                e.character.contains(&q)
                    || e.on_readings.iter().any(|r| r.to_lowercase().contains(&q))
                    || e.kun_readings.iter().any(|r| r.to_lowercase().contains(&q))
                    || e.meanings.iter().any(|m| m.to_lowercase().contains(&q))
            })
            .take(limit)
            .cloned()
            .collect()
    }
}

/// All kanji for a JLPT level (N1–N5).
pub fn list_kanji_by_level(corpus: &Corpus, level: &str) -> Vec<KanjiEntry> {
    let normalized = level.trim().to_uppercase();
    match parse_level(&normalized) {
        Some(l) => corpus.kanji_by_level.get(&l).cloned().unwrap_or_default(),
        None => Vec::new(),
    }
}

pub fn drill_candidates(
    corpus: &Corpus,
    level: JlptLevel,
    source: DrillCandidateSource,
    seed: &str,
    limit: usize,
) -> DrillCandidatesResult {
    let level = level.as_str();
    let vocab_entries = match source {
        DrillCandidateSource::Vocab => Some(list_vocab_by_level(corpus, level)),
        _ => None,
    };
    let grammar_entries = match source {
        DrillCandidateSource::Grammar => Some(list_grammar_by_level(corpus, level)),
        _ => None,
    };
    let kanji_entries = match source {
        DrillCandidateSource::Kanji => Some(list_kanji_by_level(corpus, level)),
        _ => None,
    };
    let mut ranked = Vec::new();
    let mut seen = HashSet::new();

    if let Some(entries) = vocab_entries.as_ref() {
        for (index, entry) in entries.iter().enumerate() {
            let anchor = format!("vocab:{}:{}:{}", level, entry.word, entry.reading);
            if seen.insert(anchor.clone()) {
                ranked.push((stable_hash(&format!("{seed}\0{anchor}")), anchor, index));
            }
        }
    }
    if let Some(entries) = grammar_entries.as_ref() {
        for (index, entry) in entries.iter().enumerate() {
            let anchor = format!("grammar:{}", entry.id);
            if seen.insert(anchor.clone()) {
                ranked.push((stable_hash(&format!("{seed}\0{anchor}")), anchor, index));
            }
        }
    }
    if let Some(entries) = kanji_entries.as_ref() {
        for (index, entry) in entries.iter().enumerate() {
            let anchor = format!("kanji:{}", entry.character);
            if seen.insert(anchor.clone()) {
                ranked.push((stable_hash(&format!("{seed}\0{anchor}")), anchor, index));
            }
        }
    }
    if matches!(source, DrillCandidateSource::Sentence) {
        for (index, entry) in corpus.all_sentences.iter().enumerate() {
            if sentence_level(entry).as_str() != level {
                continue;
            }
            let anchor = format!("sentence:{}", entry.id);
            if seen.insert(anchor.clone()) {
                ranked.push((stable_hash(&format!("{seed}\0{anchor}")), anchor, index));
            }
        }
    }

    ranked.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| left.1.cmp(&right.1))
            .then_with(|| left.2.cmp(&right.2))
    });
    ranked.truncate(limit.min(50));

    let candidates = ranked
        .into_iter()
        .map(|(_, anchor, index)| {
            let entry = match source {
                DrillCandidateSource::Vocab => vocab_entries
                    .as_ref()
                    .and_then(|entries| entries.get(index))
                    .map(|entry| serde_json::to_value(entry).expect("vocab candidate serializes"))
                    .expect("vocab candidate index exists"),
                DrillCandidateSource::Grammar => grammar_entries
                    .as_ref()
                    .and_then(|entries| entries.get(index))
                    .map(|entry| serde_json::to_value(entry).expect("grammar candidate serializes"))
                    .expect("grammar candidate index exists"),
                DrillCandidateSource::Kanji => kanji_entries
                    .as_ref()
                    .and_then(|entries| entries.get(index))
                    .map(|entry| serde_json::to_value(entry).expect("kanji candidate serializes"))
                    .expect("kanji candidate index exists"),
                DrillCandidateSource::Sentence => corpus
                    .all_sentences
                    .get(index)
                    .map(|entry| {
                        serde_json::to_value(entry).expect("sentence candidate serializes")
                    })
                    .expect("sentence candidate index exists"),
            };
            DrillCandidate {
                anchors: vec![anchor],
                entry,
                level: level.to_string(),
                source,
            }
        })
        .collect();

    DrillCandidatesResult {
        candidates,
        level: level.to_string(),
        seed: seed.to_string(),
    }
}

/// The vocabulary entry a pitch row describes, joined on its exact
/// `(word, reading)` surface. The pitch corpus carries no English at all, so a
/// bare はし row cannot tell 橋 from 箸; the TS engine resolved the gloss through
/// the vocabulary corpus and the parity golden records that join.
pub fn vocab_for_pitch<'a>(corpus: &'a Corpus, entry: &PitchAccentEntry) -> Option<&'a VocabEntry> {
    let index = corpus
        .vocab_by_surface
        .get(&(entry.word.clone(), entry.reading.clone()))?;
    corpus.all_vocab.get(*index)
}

/// Exact lookup of pitch-accent entries for a word or reading (kanji or kana).
/// Returns the matching entries in corpus order (same as the TS engine).
pub fn lookup_pitch_accent(corpus: &Corpus, word_or_reading: &str) -> Vec<PitchAccentEntry> {
    let q = word_or_reading.trim();
    if q.is_empty() {
        return Vec::new();
    }
    corpus
        .all_pitch
        .iter()
        .filter(|e| e.word == q || e.reading == q)
        .cloned()
        .collect()
}

/// Substring search over surface forms and readings. TS does NOT lowercase
/// here · queries are matched as-is. Non-ASCII queries use token-overlap
/// ranking (TASK-23.1): keep the substring-scan hit-set, then rerank.
pub fn search_pitch_accent(corpus: &Corpus, query: &str, limit: usize) -> Vec<PitchAccentEntry> {
    let q = query.trim();
    if q.is_empty() {
        return Vec::new();
    }
    if has_non_ascii(q) {
        let tokens = split_tokens(q);
        let candidates: Vec<(&PitchAccentEntry, usize)> = corpus
            .all_pitch
            .iter()
            .enumerate()
            .filter(|(_, e)| e.word.contains(q) || e.reading.contains(q))
            .map(|(index, e)| (e, index))
            .collect();
        let mut ranked: Vec<(usize, usize, &PitchAccentEntry)> = candidates
            .iter()
            .map(|&(e, index)| {
                let fields = vec![e.word.clone(), e.reading.clone()];
                let matched = overlap_score(
                    &fields.iter().map(String::as_str).collect::<Vec<_>>(),
                    &tokens,
                );
                (index, matched, e)
            })
            .collect();
        ranked.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
        ranked.truncate(limit);
        ranked.into_iter().map(|(_, _, e)| e.clone()).collect()
    } else {
        corpus
            .all_pitch
            .iter()
            .filter(|e| e.word.contains(q) || e.reading.contains(q))
            .take(limit)
            .cloned()
            .collect()
    }
}

/// Classify one accent position (mora index where the pitch drops):
/// 0 → heiban, 1 → atamadaka, >= moraCount → odaka, else nakadaka.
fn classify_accent(accent: u32, mora_count: usize) -> &'static str {
    if accent == 0 {
        "heiban"
    } else if accent == 1 {
        "atamadaka"
    } else if accent as usize >= mora_count {
        "odaka"
    } else {
        "nakadaka"
    }
}

/// Render a pitch pattern as a compact textual diagram over the kana
/// (`は↓し` marks the downstep after the accent-position mora). Byte-compatible
/// with the TS `describePitch`.
pub fn describe_pitch(entry: &PitchAccentEntry) -> String {
    let mora_count = entry
        .mora_count
        .map_or_else(|| entry.reading.chars().count(), |m| m as usize);
    if entry.pitch_positions.is_empty() {
        return format!("{} · no accent data", entry.reading);
    }
    let described: Vec<String> = entry
        .pitch_positions
        .iter()
        .map(|&accent| {
            let label = classify_accent(accent, mora_count);
            if accent == 0 || accent as usize >= mora_count {
                label.to_string()
            } else {
                // Downstep after the accent-th mora: `は↓し` (drop after mora 1).
                let marked: String = entry
                    .reading
                    .chars()
                    .enumerate()
                    .map(|(index, ch)| {
                        if index == accent as usize - 1 {
                            format!("{ch}↓")
                        } else {
                            ch.to_string()
                        }
                    })
                    .collect();
                format!("{label} (drop after mora {accent}): {marked}")
            }
        })
        .collect();
    format!("{} · {}", entry.reading, described.join(", "))
}

fn parse_level(value: &str) -> Option<JlptLevel> {
    match value {
        "N5" => Some(JlptLevel::N5),
        "N4" => Some(JlptLevel::N4),
        "N3" => Some(JlptLevel::N3),
        "N2" => Some(JlptLevel::N2),
        "N1" => Some(JlptLevel::N1),
        _ => None,
    }
}

// --- sentences (TASK-23.4, doc-2 §5.2) --------------------------------------

/// jpLen ceiling per level for the levelGuess heuristic (doc-2 §5.2):
/// Tanaka pedagogy examples grow with the level. Bands are generous · they
/// filter obviously-off-level sentences, not police exact grammar.
const LEVEL_MAX_JP_LEN: [(JlptLevel, usize); 5] = [
    (JlptLevel::N5, 30),
    (JlptLevel::N4, 45),
    (JlptLevel::N3, 65),
    (JlptLevel::N2, 90),
    (JlptLevel::N1, usize::MAX),
];

fn sentence_level(entry: &SentenceEntry) -> JlptLevel {
    let len = entry.jp.chars().count();
    for (level, max) in LEVEL_MAX_JP_LEN {
        if len <= max {
            return level;
        }
    }
    JlptLevel::N1
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    hash
}

/// Deterministic pseudo-random pick from a slice (FNV-1a over the seed) ·
/// avoids `rand` dependency in the ~5 MB sidecar.
fn pseudo_random_index(len: usize, seed: &str) -> usize {
    let hash = stable_hash(seed);
    if len == 0 {
        0
    } else {
        (hash % len as u64) as usize
    }
}

/// One sentence-pair result with a Teacher-oriented description:
/// `jp (EN) · Tatoeba #id`, mirroring the describe_pitch enrichment pattern.
fn describe_sentence(entry: &SentenceEntry) -> String {
    format!("{} ({}) · Tatoeba #{}", entry.jp, entry.en, entry.id)
}

/// Exact lookup of sentences containing `word` in the Japanese text or its
/// Tanaka linked words. Word-aware when the vaporetto model is active:
/// every query token must appear (AND semantics over tokens).
/// `lookup_examples` plus the deinflection reason when the results came
/// from the TASK-23.27 miss-retry (empty string on direct hits).
pub fn lookup_examples_with_reason(
    corpus: &Corpus,
    word: &str,
    limit: usize,
) -> (Vec<serde_json::Value>, String) {
    let q = word.trim();
    if q.is_empty() {
        return (Vec::new(), String::new());
    }
    let direct = lookup_examples_direct(corpus, q, limit);
    if !direct.is_empty() {
        return (direct, String::new());
    }
    // TASK-23.27 miss-retry: Tanaka linkedWords are dictionary forms, so an
    // inflected query (食べました) misses · retry with dictionary-form
    // candidates, POS-validated like search_vocab.
    for candidate in crate::deinflect::deinflect(q) {
        let mut retried: Vec<serde_json::Value> = Vec::new();
        for entry in &corpus.all_sentences {
            let hit = entry.jp.contains(candidate.form.as_str())
                || entry
                    .linked_words
                    .iter()
                    .any(|w| w.contains(candidate.form.as_str()));
            if !hit {
                continue;
            }
            // POS validation via the corpus: the candidate must be an actual
            // corpus entry's form (vocab POS is the gate, mirroring
            // search_vocab's retry semantics).
            let pos_ok = corpus.all_vocab.iter().any(|v| {
                (v.word.contains(candidate.form.as_str())
                    || v.reading.contains(candidate.form.as_str()))
                    && v.part_of_speech
                        .as_deref()
                        .map_or(false, |pos| pos.contains(candidate.required_pos))
            });
            if !pos_ok {
                continue;
            }
            let mut value = serde_json::to_value(entry).expect("sentence serializes");
            value
                .as_object_mut()
                .expect("sentence is an object")
                .insert(
                    "description".into(),
                    serde_json::Value::String(format!(
                        "{} · deinflected {}: {}",
                        describe_sentence(entry),
                        candidate.reason,
                        candidate.form
                    )),
                );
            retried.push(value);
            if retried.len() >= limit {
                break;
            }
        }
        if !retried.is_empty() {
            return (retried, candidate.reason.to_string());
        }
    }
    (Vec::new(), String::new())
}

/// The pre-retry lookup_examples body (unchanged semantics · golden parity).
fn lookup_examples_direct(corpus: &Corpus, q: &str, limit: usize) -> Vec<serde_json::Value> {
    let tokens = split_tokens(q);
    let needle = q.to_lowercase();
    let mut results: Vec<serde_json::Value> = Vec::new();
    for entry in &corpus.all_sentences {
        let jp_hit = entry.jp.to_lowercase().contains(&needle)
            || entry
                .linked_words
                .iter()
                .any(|w| w.to_lowercase().contains(&needle));
        if !jp_hit {
            continue;
        }
        // Token-AND refinement on the vaporetto path (doc-2 §6 caveat:
        // substring hits can span unrelated tokens of a long sentence).
        if !tokens.is_empty()
            && tokens
                .iter()
                .any(|token| !entry.jp.contains(token.as_str()))
        {
            continue;
        }
        let mut value = serde_json::to_value(entry).expect("sentence serializes");
        value
            .as_object_mut()
            .expect("sentence is an object")
            .insert("description".into(), describe_sentence(entry).into());
        results.push(value);
        if results.len() >= limit {
            break;
        }
    }
    results
}

/// Substring search over Japanese + English text with optional level filter
/// (levelGuess via jpLen bands). Non-ASCII queries rerank by token overlap.
pub fn search_examples(
    corpus: &Corpus,
    query: &str,
    level: Option<JlptLevel>,
    limit: usize,
) -> Vec<serde_json::Value> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let tokens = split_tokens(&q);
    let non_ascii = has_non_ascii(&q);
    let mut candidates: Vec<(usize, &SentenceEntry)> = corpus
        .all_sentences
        .iter()
        .enumerate()
        .filter(|(_, entry)| {
            let level_ok = level.map_or(true, |wanted| sentence_level(entry) == wanted);
            let text_ok = entry.jp.to_lowercase().contains(&q)
                || entry.en.to_lowercase().contains(&q)
                || entry
                    .linked_words
                    .iter()
                    .any(|w| w.to_lowercase().contains(&q));
            level_ok && text_ok
        })
        .collect();
    if non_ascii && !tokens.is_empty() {
        candidates.sort_by(|(left_index, left), (right_index, right)| {
            let left_score = overlap_score(&[left.jp.to_lowercase().as_str()], &tokens);
            let right_score = overlap_score(&[right.jp.to_lowercase().as_str()], &tokens);
            right_score
                .cmp(&left_score)
                .then_with(|| left_index.cmp(right_index))
        });
    }
    candidates
        .into_iter()
        .take(limit)
        .map(|(_, entry)| {
            let mut value = serde_json::to_value(entry).expect("sentence serializes");
            value
                .as_object_mut()
                .expect("sentence is an object")
                .insert("description".into(), describe_sentence(entry).into());
            value
        })
        .collect()
}

/// Deterministic random example for a level (seeded by the sentence id of a
/// rotating anchor) · stable across calls within a process so Teacher output
/// stays reproducible in tests.
pub fn random_example(corpus: &Corpus, level: Option<JlptLevel>) -> Option<serde_json::Value> {
    let pool: Vec<&SentenceEntry> = corpus
        .all_sentences
        .iter()
        .filter(|entry| level.map_or(true, |wanted| sentence_level(entry) == wanted))
        .collect();
    let anchor = pool.first()?.id.to_string();
    let index = pseudo_random_index(pool.len(), &anchor);
    let entry = pool[index];
    let mut value = serde_json::to_value(entry).expect("sentence serializes");
    value
        .as_object_mut()
        .expect("sentence is an object")
        .insert("description".into(), describe_sentence(entry).into());
    Some(value)
}

// --- stroke order (TASK-23.5.1, doc-2 §5.3) ---------------------------------
//
// KanjiVG SVG parsing. The corpus stores the raw SVG document per character
// (data.rs); this section extracts the structured fields a Teacher/front-end
// consumer needs: ordered strokes, stroke-number labels, and the element
// decomposition path. Parsing is regex-free and allocation-light · the SVGs
// are machine-generated with a fixed shape (see data/kanjivg/kanjivg.jsonl).

/// Extract all `d="…"` path data in document order from the StrokePaths
/// group. KanjiVG orders `<path>` elements by stroke order, so document
/// order IS stroke order. Each `id`/`kvg:type` attribute rides along.
fn parse_stroke_paths(svg: &str) -> Vec<StrokePath> {
    let mut strokes = Vec::new();
    let mut rest = svg;
    while let Some(pos) = rest.find("<path ") {
        rest = &rest[pos..];
        let end = match rest.find("/>") {
            Some(end) => end,
            None => break,
        };
        let tag = &rest[..end];
        let id = attribute(tag, "id");
        let d = attribute(tag, "d");
        if let Some(d) = d {
            strokes.push(StrokePath {
                id: id.unwrap_or_default(),
                d,
                kind: attribute(tag, "kvg:type"),
            });
        }
        rest = &rest[end..];
    }
    strokes
}

/// Extract the StrokeNumbers `<text transform="…">N</text>` labels.
fn parse_stroke_numbers(svg: &str) -> Vec<StrokeNumber> {
    let mut numbers = Vec::new();
    let Some(numbers_start) = svg.find("kvg:StrokeNumbers") else {
        return numbers;
    };
    let mut rest = &svg[numbers_start..];
    while let Some(pos) = rest.find("<text ") {
        rest = &rest[pos..];
        let Some(close) = rest.find("</text>") else {
            break;
        };
        let tag_end = rest.find('>').map(|p| p + 1).unwrap_or(0);
        if tag_end == 0 || tag_end >= close {
            break;
        }
        let transform = attribute(&rest[..close], "transform").unwrap_or_default();
        let n = rest[tag_end..close].trim().parse::<u32>().ok();
        if let Some(n) = n {
            numbers.push(StrokeNumber { n, transform });
        }
        rest = &rest[close..];
    }
    numbers
}

/// Extract one XML attribute value from a tag string.
fn attribute(tag: &str, name: &str) -> Option<String> {
    // Anchor on the character before the attribute name: `id="` also occurs
    // inside `kvg:id="` and `d="` inside `id="`, so a bare substring find
    // returns the wrong attribute (caught by the 食 smoke test · d came back
    // as the stroke id). Require a non-name character (start/space) before.
    let pattern = format!("{name}=\"");
    let mut search_from = 0;
    while let Some(rel) = tag[search_from..].find(&pattern) {
        let at = search_from + rel;
        let boundary_ok = at == 0
            || tag[..at]
                .chars()
                .next_back()
                .is_none_or(|previous| !previous.is_alphanumeric() && previous != ':');
        if boundary_ok {
            let rest = &tag[at + pattern.len()..];
            let end = rest.find('"')?;
            return Some(rest[..end].to_string());
        }
        search_from = at + 1;
    }
    None
}

/// Element decomposition path from `kvg:element="…"` attributes,
/// outermost group first. KanjiVG groups strokes into elements
/// (e.g. 頑 → 元 + 頁); the outermost `<g kvg:element>` is the kanji itself.
fn parse_element_path(svg: &str) -> Vec<String> {
    let mut elements = Vec::new();
    let mut rest = svg;
    while let Some(pos) = rest.find("kvg:element=\"") {
        rest = &rest[pos..];
        let start = "kvg:element=\"".len();
        let Some(end) = rest[start..].find('"') else {
            break;
        };
        elements.push(rest[start..start + end].to_string());
        rest = &rest[start + end..];
    }
    elements
}

/// Structured stroke-order lookup for one kanji character (TASK-23.5.1).
/// Returns `None` when the character has no KanjiVG SVG in the embedded
/// corpus (kyūjitai variants and non-JIS glyphs).
pub fn lookup_stroke_order(corpus: &Corpus, character: &str) -> Option<StrokeOrderEntry> {
    let svg = corpus.kanjivg_by_character.get(character)?;
    let strokes = parse_stroke_paths(svg);
    if strokes.is_empty() {
        return None;
    }
    Some(StrokeOrderEntry {
        character: character.to_string(),
        svg: svg.clone(),
        strokes,
        numbers: parse_stroke_numbers(svg),
        element_path: parse_element_path(svg),
    })
}

#[cfg(test)]
mod reading_tag_tests {
    use super::*;

    /// TASK-23.26 AC#4: an inflected-kana query must reach the dictionary
    /// entry through the model's reading tag channel. The model reads the
    /// renyōkei stem (たべました → stem たべ, reading タベ→たべ), which is a
    /// prefix of the corpus reading たべる · the raw query never
    /// substring-matches. (Model fact: mixed-script katakana queries like
    /// タベる come back as ONE untagged token · the tag bridge fires on
    /// pure-kana/kanji-stem queries, so the test uses たべました.) Skips
    /// silently when the model is absent: the whitespace fallback cannot
    /// honor this contract by design (AC#3 keeps that path byte-identical).
    #[test]
    fn search_vocab_reaches_entry_via_reading_tag() {
        if !crate::tokenize::vaporetto_active() {
            return;
        }
        let corpus = crate::data::load_corpus();
        let (results, reason) = search_vocab_with_reason(&corpus, "たべました", 10);
        assert!(
            results.iter().any(|e| e.word == "食べる"),
            "たべました must reach 食べる via the reading tag; got {} results",
            results.len()
        );
    }

    /// TASK-55: the deinflected target must not be crowded out by the
    /// reading bridge, and mid-word み substring rows must not overmatch.
    #[test]
    fn search_vocab_deinflected_target_ranks_above_bridge() {
        if !crate::tokenize::vaporetto_active() {
            return;
        }
        let corpus = crate::data::load_corpus();
        let (results, reason) = search_vocab_with_reason(&corpus, "みました", 10);
        assert!(
            results.iter().any(|e| e.word == "見る"),
            "みました must return 見る (deinflected candidate); got: {:?}",
            results.iter().map(|e| e.word.clone()).collect::<Vec<_>>()
        );
        assert_eq!(reason, "PolitePast");
        // Bridge strictness: rows whose reading merely CONTAINS み mid-word
        // (すむ/よむ/たのむ…) must not ride the bridge.
        assert!(
            results
                .iter()
                .take_while(|e| e.word != "見る")
                .all(|e| e.reading.starts_with('み')),
            "rows above the target must have み-prefixed readings; got {:?}",
            results
                .iter()
                .map(|e| (e.word.clone(), e.reading.clone()))
                .collect::<Vec<_>>()
        );
    }
}
