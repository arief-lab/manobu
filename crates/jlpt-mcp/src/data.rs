//! Corpus loading. The build script (`build.rs`) gzips every corpus JSON file
//! from `packages/japanese/data/` into `OUT_DIR` (shrinking ~21 MB raw JSON
//! to a few MB) so the binary embeds compressed data and decompresses once at
//! startup.
//!
//! Corpus data lives in `packages/japanese/data/` (the `@manobu/japanese`
//! package is now a data generator — its fetch scripts write these files; the
//! Rust crate is the only consumer of the lookup engine). Every file gets a
//! `cargo:rerun-if-changed` directive so a corpus regen triggers a rebuild.
//!
//! Source-file shapes (TASK-23.1 note — these differ per file, do not
//! assume a common envelope):
//! - `n1..n5.json`, `grammar/n1..n5.json`: top-level JSON arrays.
//! - `grammar/conjugations.json`: `{ metadata, entries }`.
//! - `kanji.json`: `{ metadata, kanji }` in raw KANJIDIC2 shape; entries are
//!   transformed here into the flat TS-engine output shape (`KanjiEntry`).
//! - `pitch-accent.json`: `{ metadata, entries }`.
//!
//! `all_vocab` / `all_grammar` / `all_kanji` are built N5→N1 (the TS engine
//! iterated levels from the zod enum order `["N5","N4","N3","N2","N1"]`), so
//! substring-scan hit order matches the parity golden.

use std::collections::BTreeMap;
use std::collections::HashMap;

use flate2::read::GzDecoder;
use serde_json::Value;

use crate::types::{
    ConjugationEntry, Corpus, GrammarPoint, JlptLevel, KanjiEntry, PitchAccentEntry, SentenceEntry,
    VocabEntry,
};

// --- embedded compressed corpus (produced by build.rs) -------------------

const N1_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/n1.json.gz"));
const N2_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/n2.json.gz"));
const N3_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/n3.json.gz"));
const N4_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/n4.json.gz"));
const N5_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/n5.json.gz"));

const GRAMMAR_N1_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/grammar-n1.json.gz"));
const GRAMMAR_N2_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/grammar-n2.json.gz"));
const GRAMMAR_N3_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/grammar-n3.json.gz"));
const GRAMMAR_N4_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/grammar-n4.json.gz"));
const GRAMMAR_N5_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/grammar-n5.json.gz"));
const GRAMMAR_CONJ_GZ: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/grammar-conjugations.json.gz"));

const KANJI_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/kanji.json.gz"));
const PITCH_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/pitch-accent.json.gz"));
const SENTENCES_GZ: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/sentences-sentences.jsonl.gz"));
const KANJIVG_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/kanjivg-kanjivg.jsonl.gz"));

fn gunzip(bytes: &[u8]) -> Vec<u8> {
    let decoder = GzDecoder::new(bytes);
    std::io::Read::bytes(decoder)
        .collect::<Result<Vec<_>, _>>()
        .expect("gz decode failed")
}

fn parse(gz_bytes: &[u8], label: &str) -> Value {
    let raw = gunzip(gz_bytes);
    serde_json::from_slice(&raw).unwrap_or_else(|e| panic!("corrupt {label}: not valid json: {e}"))
}

/// Deserialize a `Value` into `Vec<T>`, accepting both a top-level array and
/// an `{ entries: [...] }` envelope.
fn parse_list<T: serde::de::DeserializeOwned>(value: Value, label: &str) -> Vec<T> {
    let raw = match value {
        Value::Array(_) => value,
        Value::Object(map) => map
            .get("entries")
            .cloned()
            .unwrap_or_else(|| panic!("corrupt {label}: no entries key")),
        _ => panic!("corrupt {label}: not a list or entries envelope"),
    };
    serde_json::from_value(raw).unwrap_or_else(|e| panic!("corrupt {label}: bad entries: {e}"))
}

/// Transform one raw KANJIDIC2-shaped entry into the flat TS-engine output
/// shape. Field order matches `KanjiEntry`'s declaration order (the order the
/// old TS engine serialized). `jlpt` is dropped when the Waller classification
/// is absent — the TS engine only emitted the key when a level existed.
fn kanji_entry(raw: &Value) -> KanjiEntry {
    let get = |key: &str| raw.get(key).cloned().unwrap_or(Value::Null);
    let jlpt = get("jlpt_waller");
    let jlpt = if jlpt.is_null() {
        None
    } else {
        Some(JlptLevel::from_str(
            jlpt.as_str().expect("jlpt_waller is a string"),
        ))
    };
    let radical = get("radical");
    let radical = radical
        .get("classical")
        .and_then(Value::as_u64)
        .map(|v| v as u32);
    let readings = get("readings");
    let empty = Vec::new();
    let on = readings
        .get("on")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or(empty.clone())
        .into_iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();
    let kun = readings
        .get("kun")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or(empty.clone())
        .into_iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();
    let meanings = get("meanings");
    let meanings = meanings
        .get("en")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or(empty.clone())
        .into_iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();
    let nanori = get("nanori");
    let readings_nanori = if nanori.is_null() {
        None
    } else {
        Some(
            nanori
                .as_array()
                .cloned()
                .unwrap_or(empty)
                .into_iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
        )
    };
    let stroke_count = get("stroke_count").as_u64().map(|v| v as u32);
    KanjiEntry {
        character: get("character")
            .as_str()
            .expect("kanji character")
            .to_string(),
        jlpt,
        kun_readings: kun,
        meanings,
        on_readings: on,
        radical,
        readings_nanori,
        stroke_count,
    }
}

// --- corpus construction --------------------------------------------------

/// Build the in-memory corpus from the compressed JSON files embedded at
/// compile time. This runs once per process start; the corpus is small enough
/// (~1–2 MB decompressed) to keep in RAM.
pub fn load_corpus() -> Corpus {
    // vocabulary per level — build.rs writes n1.json.gz … n5.json.gz
    let n1: Value = parse(N1_GZ, "n1");
    let n2: Value = parse(N2_GZ, "n2");
    let n3: Value = parse(N3_GZ, "n3");
    let n4: Value = parse(N4_GZ, "n4");
    let n5: Value = parse(N5_GZ, "n5");

    let mut vocab_n1: Vec<VocabEntry> = parse_list(n1, "n1");
    let mut vocab_n2: Vec<VocabEntry> = parse_list(n2, "n2");
    let mut vocab_n3: Vec<VocabEntry> = parse_list(n3, "n3");
    let mut vocab_n4: Vec<VocabEntry> = parse_list(n4, "n4");
    let mut vocab_n5: Vec<VocabEntry> = parse_list(n5, "n5");

    // Populate `gloss` from `senses[0][0]` for every entry. This is the only
    // place the corpus is constructed, so doing it here means no consumer can
    // forget it. Derived from the sense groups, never from `meaning.split(";")`,
    // which mangles glosses containing ";" inside parentheses.
    fn populate_gloss(entries: &mut [VocabEntry]) {
        for entry in entries.iter_mut() {
            entry.gloss = entry
                .senses
                .as_ref()
                .and_then(|s| s.first())
                .and_then(|g| g.first())
                .cloned()
                .unwrap_or_default();
        }
    }
    populate_gloss(&mut vocab_n1);
    populate_gloss(&mut vocab_n2);
    populate_gloss(&mut vocab_n3);
    populate_gloss(&mut vocab_n4);
    populate_gloss(&mut vocab_n5);

    let mut vocab_by_level: HashMap<JlptLevel, Vec<VocabEntry>> = HashMap::new();
    vocab_by_level.insert(JlptLevel::N1, vocab_n1);
    vocab_by_level.insert(JlptLevel::N2, vocab_n2);
    vocab_by_level.insert(JlptLevel::N3, vocab_n3);
    vocab_by_level.insert(JlptLevel::N4, vocab_n4);
    vocab_by_level.insert(JlptLevel::N5, vocab_n5);
    // TS engine iterated levels N5→N1 (zod enum order); keep that scan order.
    let all_vocab: Vec<VocabEntry> = [
        JlptLevel::N5,
        JlptLevel::N4,
        JlptLevel::N3,
        JlptLevel::N2,
        JlptLevel::N1,
    ]
    .iter()
    .flat_map(|level| vocab_by_level[level].clone())
    .collect();

    // grammar per level — build.rs writes grammar-n1.json.gz … grammar-n5.json.gz
    let gn1: Value = parse(GRAMMAR_N1_GZ, "grammar-n1");
    let gn2: Value = parse(GRAMMAR_N2_GZ, "grammar-n2");
    let gn3: Value = parse(GRAMMAR_N3_GZ, "grammar-n3");
    let gn4: Value = parse(GRAMMAR_N4_GZ, "grammar-n4");
    let gn5: Value = parse(GRAMMAR_N5_GZ, "grammar-n5");

    let grammar_n1: Vec<GrammarPoint> = parse_list(gn1, "grammar n1");
    let grammar_n2: Vec<GrammarPoint> = parse_list(gn2, "grammar n2");
    let grammar_n3: Vec<GrammarPoint> = parse_list(gn3, "grammar n3");
    let grammar_n4: Vec<GrammarPoint> = parse_list(gn4, "grammar n4");
    let grammar_n5: Vec<GrammarPoint> = parse_list(gn5, "grammar n5");

    let mut grammar_by_level: HashMap<JlptLevel, Vec<GrammarPoint>> = HashMap::new();
    grammar_by_level.insert(JlptLevel::N1, grammar_n1);
    grammar_by_level.insert(JlptLevel::N2, grammar_n2);
    grammar_by_level.insert(JlptLevel::N3, grammar_n3);
    grammar_by_level.insert(JlptLevel::N4, grammar_n4);
    grammar_by_level.insert(JlptLevel::N5, grammar_n5);
    let all_grammar: Vec<GrammarPoint> = [
        JlptLevel::N5,
        JlptLevel::N4,
        JlptLevel::N3,
        JlptLevel::N2,
        JlptLevel::N1,
    ]
    .iter()
    .flat_map(|level| grammar_by_level[level].clone())
    .collect();
    let grammar_by_id: HashMap<String, GrammarPoint> = all_grammar
        .iter()
        .map(|p| (p.id.clone(), p.clone()))
        .collect();

    // conjugations — keyed by reading AND dictionary_form (the tool accepts
    // both; homographic readings keep their first file occurrence, matching
    // the TS engine's single-entry-per-key behavior).
    let conj: Value = parse(GRAMMAR_CONJ_GZ, "conjugations");
    let entries: Vec<ConjugationEntry> = parse_list(conj, "conjugations");
    let mut conjugation_by_form: BTreeMap<String, ConjugationEntry> = BTreeMap::new();
    for entry in entries {
        conjugation_by_form
            .entry(entry.reading.clone())
            .or_insert_with(|| entry.clone());
        conjugation_by_form
            .entry(entry.dictionary_form.clone())
            .or_insert(entry);
    }

    // kanji — raw KANJIDIC2 shape; transform into the TS output shape.
    let kanji: Value = parse(KANJI_GZ, "kanji");
    let raw_kanji = kanji
        .get("kanji")
        .and_then(Value::as_array)
        .cloned()
        .expect("corrupt kanji data: no kanji array");
    let all_kanji: Vec<KanjiEntry> = raw_kanji.iter().map(kanji_entry).collect();
    let kanji_by_character: HashMap<String, KanjiEntry> = all_kanji
        .iter()
        .map(|k| (k.character.clone(), k.clone()))
        .collect();
    let mut kanji_by_level: HashMap<JlptLevel, Vec<KanjiEntry>> = HashMap::new();
    for level in [
        JlptLevel::N5,
        JlptLevel::N4,
        JlptLevel::N3,
        JlptLevel::N2,
        JlptLevel::N1,
    ] {
        let entries: Vec<KanjiEntry> = all_kanji
            .iter()
            .filter(|k| k.jlpt.as_ref() == Some(&level))
            .cloned()
            .collect();
        kanji_by_level.insert(level, entries);
    }

    // pitch-accent
    let pitch: Value = parse(PITCH_GZ, "pitch-accent");
    let all_pitch: Vec<PitchAccentEntry> = parse_list(pitch, "pitch-accent");
    // The pitch join the TS engine performed per query. Built once at load
    // because a pitch search can return `limit` rows and each needs its gloss.
    let mut vocab_by_surface: HashMap<(String, String), usize> = HashMap::new();
    for (index, entry) in all_vocab.iter().enumerate() {
        vocab_by_surface
            .entry((entry.word.clone(), entry.reading.clone()))
            .or_insert(index);
    }
    // TASK-23.5.1: KanjiVG stroke-order SVGs — JSONL (one {c, s} object per
    // line), keyed by character for O(1) lookup. The structured fields
    // (strokes/numbers/element_path) are extracted from the SVG lazily at
    // lookup time (engine.rs), not at load — startup cost stays flat.
    let raw = gunzip(KANJIVG_GZ);
    let text = String::from_utf8(raw).expect("kanjivg.jsonl is utf8");
    let mut kanjivg_by_character: HashMap<String, String> = HashMap::new();
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let entry: Value = serde_json::from_str(line)
            .unwrap_or_else(|e| panic!("corrupt kanjivg.jsonl line: {e}"));
        let char = entry
            .get("c")
            .and_then(Value::as_str)
            .expect("kanjivg line has c")
            .to_string();
        let svg = entry
            .get("s")
            .and_then(Value::as_str)
            .expect("kanjivg line has s")
            .to_string();
        kanjivg_by_character.insert(char, svg);
    }

    // TASK-23.4: sentences — JSONL (one object per line), not a JSON array.
    let raw = gunzip(SENTENCES_GZ);
    let text = String::from_utf8(raw).expect("sentences.jsonl is utf8");
    let all_sentences: Vec<SentenceEntry> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str(line)
                .unwrap_or_else(|e| panic!("corrupt sentences.jsonl line: {e}"))
        })
        .collect();

    Corpus {
        vocab_by_level,
        all_vocab,
        grammar_by_level,
        all_grammar,
        grammar_by_id,
        conjugation_by_form,
        all_kanji,
        kanji_by_character,
        kanji_by_level,
        all_pitch,
        vocab_by_surface,
        all_sentences,
        kanjivg_by_character,
    }
}
