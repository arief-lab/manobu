//! Typed views of the Japanese corpus, mirroring the TS engine's public
//! shapes exactly (field names + declaration order = the JSON key order the
//! old `JSON.stringify` produced, so MCP tool output stays byte-compatible).
//!
//! `Corpus` is defined here (single owner, TASK-23.1); `data.rs` constructs
//! it from the embedded gzip files and re-exports nothing.

use std::collections::{BTreeMap, HashMap};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// The in-memory Japanese corpus, built once at startup from embedded
/// compressed JSON.
#[derive(Debug, Clone)]
pub struct Corpus {
    pub vocab_by_level: HashMap<JlptLevel, Vec<VocabEntry>>,
    pub all_vocab: Vec<VocabEntry>,
    pub grammar_by_level: HashMap<JlptLevel, Vec<GrammarPoint>>,
    pub all_grammar: Vec<GrammarPoint>,
    pub grammar_by_id: HashMap<String, GrammarPoint>,
    pub conjugation_by_form: BTreeMap<String, ConjugationEntry>,
    pub all_kanji: Vec<KanjiEntry>,
    pub kanji_by_character: HashMap<String, KanjiEntry>,
    pub kanji_by_level: HashMap<JlptLevel, Vec<KanjiEntry>>,
    pub all_pitch: Vec<PitchAccentEntry>,
    /// `(word, reading)` -> position in `all_vocab`. The pitch corpus carries no
    /// glosses, and the TS engine answered a pitch query by joining each row
    /// back to the vocabulary corpus; this index is that join. First entry wins
    /// on a duplicate surface, which preserves the N5→N1 scan order the golden
    /// was captured under.
    pub vocab_by_surface: HashMap<(String, String), usize>,
    /// TASK-23.5.1: KanjiVG SVG document per covered character
    /// (`data/kanjivg/kanjivg.jsonl`). Structured stroke fields are
    /// extracted at lookup time (engine.rs), not at load.
    pub kanjivg_by_character: HashMap<String, String>,
    /// TASK-23.4: Tatoeba/Tanaka sentence pairs (all levels — level is
    /// derived per query from jpLen heuristics, not stored per row).
    pub all_sentences: Vec<SentenceEntry>,
}

/// JLPT levels, from most advanced to most basic. N5 first to match the
/// zod enum order the TS server exposed (`["N5","N4","N3","N2","N1"]`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub enum JlptLevel {
    N5,
    N4,
    N3,
    N2,
    N1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum DrillCandidateSource {
    Vocab,
    Grammar,
    Kanji,
    Sentence,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrillCandidate {
    pub anchors: Vec<String>,
    pub entry: serde_json::Value,
    pub level: String,
    pub source: DrillCandidateSource,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrillCandidatesResult {
    pub candidates: Vec<DrillCandidate>,
    pub level: String,
    pub seed: String,
}

impl JlptLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            JlptLevel::N1 => "N1",
            JlptLevel::N2 => "N2",
            JlptLevel::N3 => "N3",
            JlptLevel::N4 => "N4",
            JlptLevel::N5 => "N5",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "N1" => JlptLevel::N1,
            "N2" => JlptLevel::N2,
            "N3" => JlptLevel::N3,
            "N4" => JlptLevel::N4,
            "N5" => JlptLevel::N5,
            _ => panic!("unknown JLPT level: {s}"),
        }
    }
}

/// One vocabulary entry. `meaning` / `partOfSpeech` are filled by the
/// JMdict enrichment step; entries JMdict doesn't cover omit them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VocabEntry {
    /// JLPT level.
    pub level: JlptLevel,
    /// English meaning(s), when the corpus has been enriched.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meaning: Option<String>,
    /// Coarse part of speech, when known.
    #[serde(skip_serializing_if = "Option::is_none", rename = "partOfSpeech")]
    pub part_of_speech: Option<String>,
    /// Reading in hiragana.
    pub reading: String,
    /// Surface form — kanji where the word has it, otherwise kana.
    pub word: String,
    /// Sense groups from JMdict. `senses[0][0]` is the headline gloss — the one
    /// a learner should be taught. `meaning` is a ";"-joined summary and JMdict
    /// glosses contain ";" inside parentheses, so splitting it mangles the
    /// primary gloss: アウト is "out (of a ball; in tennis, etc.)" and the split
    /// yields "out (of a ball".
    #[serde(default, skip_serializing)]
    pub senses: Option<Vec<Vec<String>>>,
    /// First rendering of the first sense group. Populated by `load_corpus`
    /// from `senses[0][0]`, never derived from `meaning.split(";")`.
    #[serde(default)]
    pub gloss: String,
}

/// One example sentence attached to a grammar point.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrammarExample {
    pub english: String,
    pub japanese: String,
    pub source: String,
}

/// One grammar point, as curated by jkindrix/japanese-language-data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrammarPoint {
    pub examples: Vec<GrammarExample>,
    pub formality: String,
    /// How to form it, e.g. "Noun or na-adjective + です".
    pub formation: String,
    pub formation_notes: Vec<String>,
    /// Stable slug, e.g. "desu-polite-copula".
    pub id: String,
    pub level: JlptLevel,
    /// Longer explanation in English.
    pub meaning_detailed: String,
    /// Short English meaning.
    pub meaning_en: String,
    /// The pattern as taught, e.g. "Noun + です".
    pub pattern: String,
    /// Ids of related grammar points (cross-links).
    pub related: Vec<String>,
    pub review_status: String,
    pub sources: Vec<String>,
}

/// A verb/adjective conjugation table. Serialized in raw file key order so
/// output matches what the TS server passed through unchanged.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConjugationEntry {
    pub id: String,
    pub dictionary_form: String,
    pub reading: String,
    /// JMdict POS class, e.g. "v1", "v5r", "adj-i", "adj-na".
    pub class: String,
    /// Reading-only forms (kana), keyed by form name, in file order.
    pub forms: serde_json::Map<String, serde_json::Value>,
    /// Kanji-surface forms.
    pub display_forms: serde_json::Map<String, serde_json::Value>,
}

/// One kanji entry (KANJIDIC2-derived, flattened by `data.rs::kanji_entry`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanjiEntry {
    /// The kanji character itself.
    pub character: String,
    /// JLPT level from the Waller classification, when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jlpt: Option<JlptLevel>,
    /// Kun readings (hiragana, with okurigana dots).
    pub kun_readings: Vec<String>,
    /// English meanings (primary senses).
    pub meanings: Vec<String>,
    /// On readings (katakana).
    pub on_readings: Vec<String>,
    /// Radical(s) the kanji is filed under (classical number).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub radical: Option<u32>,
    /// Readings usable in names (nanori).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readings_nanori: Option<Vec<String>>,
    /// Stroke count.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_count: Option<u32>,
}

/// One pitch-accent entry for a word.
/// Output is camelCase (TS-engine byte compatibility) but the corpus file
/// uses snake_case keys, so every field carries a snake_case `alias` for
/// deserialization (TASK-23.1). `source` is TASK-23.5.3 (Kanjium + Wiktionary
/// merge) — absent from the pre-merge corpus, so it is optional on
/// deserialization and skipped on serialization when missing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PitchAccentEntry {
    /// Number of mora in the reading.
    #[serde(default, alias = "mora_count", skip_serializing_if = "Option::is_none")]
    pub mora_count: Option<u32>,
    /// Mora positions where the pitch drops. `0` = heiban (flat).
    #[serde(alias = "pitch_positions")]
    pub pitch_positions: Vec<u32>,
    /// Reading in hiragana (the mora that the accent positions index).
    pub reading: String,
    /// Surface form — kanji where the word has it, otherwise kana.
    pub word: String,
    /// Provenance: `"kanjium"` (authority, ~2022 coverage) or `"wiktionary"`
    /// (post-2022 gap-fill). TASK-23.5.3.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// One Tatoeba/Tanaka sentence pair (TASK-23.4, `data/sentences/sentences.jsonl`).
/// The file is JSONL (one object per line), parsed in `data.rs`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceEntry {
    /// Tatoeba sentence id — cite as `Tatoeba #id` in Teacher output.
    pub id: u64,
    /// Japanese sentence text.
    pub jp: String,
    /// English translation.
    pub en: String,
    /// Tanaka B-line word surfaces (kana/kanji tokens from the linkage string).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub linked_words: Vec<String>,
    /// Attribution string (Tatoeba CC BY 2.0 / Tanaka Corpus PD).
    pub attribution: String,
}

/// One stroke of a KanjiVG SVG path (TASK-23.5.1). `d` carries the raw path
/// data (`M/m C/c S/s` cubics only, ordered by stroke order upstream).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrokePath {
    /// KanjiVG stroke id, e.g. `kvg:098df-s1`.
    pub id: String,
    /// SVG path data (`d` attribute).
    pub d: String,
    /// Stroke type glyph (kvg:type), e.g. `㇒` — optional upstream.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

/// One StrokeNumbers `<text>` label: the number plus its transform.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrokeNumber {
    /// 1-based stroke number as printed in the SVG.
    pub n: u32,
    /// SVG transform attribute positioning the label.
    pub transform: String,
}

/// One kanji's stroke-order data, parsed from
/// `data/kanjivg/kanjivg.jsonl` (`{c, s}` per line — the raw SVG plus the
/// character it draws). Structured fields (`strokes`, `numbers`,
/// `element_path`) are extracted from the SVG at lookup time; `svg` keeps
/// the full document for direct frontend rendering.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrokeOrderEntry {
    /// The kanji character this SVG draws.
    pub character: String,
    /// Full SVG document (109×109 viewBox), DOCTYPE/comment header stripped.
    pub svg: String,
    /// Strokes in stroke order (the SVG's document order).
    pub strokes: Vec<StrokePath>,
    /// Stroke-number labels, keyed to `strokes` positions.
    pub numbers: Vec<StrokeNumber>,
    /// Element decomposition path (kvg:element attrs, outermost first).
    pub element_path: Vec<String>,
}
