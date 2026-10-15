//! jlpt-mcp · a stdio MCP server exposing the JLPT vocabulary, grammar,
//! conjugation, kanji, and pitch-accent corpora.
//!
//! This is the Rust port of the former Bun-compiled `apps/jlpt-mcp` sidecar
//! (research/agent-stack-gaps-vs-aionui.md, Tier 1.3). The corpus embeds at
//! build time (gzip'd JSON from `packages/japanese/data/` via `build.rs`), so
//! the binary runs fully offline and needs no runtime file access.
//!
//! Protocol hygiene: stdout is the MCP JSON-RPC channel · nothing else may
//! ever be written to stdout. Diagnostics go to stderr.

mod data;
mod deinflect;
mod engine;
mod tokenize;
mod types;

use std::sync::{Arc, OnceLock};

use rmcp::{
    handler::server::router::tool::ToolRouter, handler::server::wrapper::Parameters, schemars,
    tool, tool_handler, tool_router, transport::stdio, ServerHandler, ServiceExt,
};
use schemars::JsonSchema;
use serde::Deserialize;

use crate::types::{Corpus, DrillCandidateSource, JlptLevel, PitchAccentEntry};

fn default_limit() -> u32 {
    10
}

fn json<T: serde::Serialize>(value: T) -> String {
    serde_json::to_string(&value).unwrap_or_else(|e| format!("{{\"error\":{e:?}}}"))
}

// --- Tool argument schemas (mirror the TS zod schemas) ----------------------

#[derive(Debug, Deserialize, JsonSchema)]
struct LookupWordArgs {
    /// Japanese word to look up (kanji or kana)
    word: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct SearchArgs {
    /// Search string (kanji or hiragana)
    query: String,
    /// Maximum number of results
    #[serde(default = "default_limit")]
    #[schemars(default = "default_limit", range(min = 1, max = 50))]
    limit: u32,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct LevelArgs {
    /// JLPT level to list
    level: JlptLevel,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct DrillCandidatesArgs {
    #[serde(default = "default_limit")]
    #[schemars(default = "default_limit", range(min = 1, max = 50))]
    limit: u32,
    level: JlptLevel,
    seed: String,
    source: DrillCandidateSource,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct GrammarIdArgs {
    /// Grammar point id (slug, e.g. desu-polite-copula)
    id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct CharacterArgs {
    /// Single kanji character to look up (e.g. 食)
    #[schemars(length(min = 1, max = 1))]
    character: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct SplitArgs {
    /// Text to tokenize (Japanese or English)
    text: String,
    /// Separator between tokens in the `joined` field (default "/")
    #[serde(default)]
    #[schemars(default)]
    separator: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct SearchExamplesArgs {
    /// Search string (Japanese or English)
    query: String,
    /// Optional JLPT level filter (approximate, via sentence-length heuristic)
    #[serde(default)]
    #[schemars(default)]
    level: Option<JlptLevel>,
    /// Maximum number of results
    #[serde(default = "default_limit")]
    #[schemars(default = "default_limit", range(min = 1, max = 50))]
    limit: u32,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct RandomExampleArgs {
    /// Optional JLPT level filter (approximate, via sentence-length heuristic)
    #[serde(default)]
    #[schemars(default)]
    level: Option<JlptLevel>,
}

#[derive(Debug, serde::Serialize)]
struct SplitResult {
    tokens: Vec<String>,
    joined: String,
    model_active: bool,
}

// --- Server ------------------------------------------------------------------

/// TASK-93: developer-only tools. Hidden from `tools/list` and rejected by
/// `tools/call` unless the sidecar is spawned with `JLPT_MCP_DEBUG=1`, so an
/// ordinary agent session does not pay their prompt tax.
const DEBUG_TOOLS: [&str; 2] = ["vaporetto_split", "vaporetto_warmup"];

/// A stdio sidecar's environment is fixed at spawn and the router is rebuilt
/// per request, so the flag is resolved once.
fn debug_tools_enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var("JLPT_MCP_DEBUG").is_ok_and(|value| value == "1"))
}

#[derive(Clone)]
pub struct JlptServer {
    corpus: Arc<Corpus>,
}

#[tool_router]
impl JlptServer {
    pub fn new(corpus: Arc<Corpus>) -> Self {
        Self { corpus }
    }

    #[tool(
        description = "Exact lookup of a Japanese word (kanji or hiragana reading) in the JLPT vocabulary database. Returns entries with reading, JLPT level, and English meaning when the corpus has been enriched. Inflected forms (e.g. 食べました) fall back to their dictionary form via deinflection; when that happens each result carries a deinflected field naming the rule (e.g. PolitePast)."
    )]
    fn lookup_vocab(&self, Parameters(args): Parameters<LookupWordArgs>) -> String {
        let (entries, reason) = engine::lookup_vocab_with_reason(&self.corpus, &args.word);
        if reason.is_empty() {
            return json(entries);
        }
        let mut values: Vec<serde_json::Value> = entries
            .iter()
            .map(|entry| serde_json::to_value(entry).expect("vocab entry serializes"))
            .collect();
        for value in &mut values {
            if let Some(obj) = value.as_object_mut() {
                obj.insert("deinflected".into(), reason.clone().into());
            }
        }
        json(values)
    }

    #[tool(
        description = "Substring search over Japanese words, readings, and English meanings. Use when the learner half-remembers a word or wants related entries. Inflected queries (e.g. 食べました) fall back to their dictionary form via deinflection; when that happens each result carries a deinflected field naming the rule (e.g. PolitePast)."
    )]
    fn search_vocab(&self, Parameters(args): Parameters<SearchArgs>) -> String {
        let (entries, reason) =
            engine::search_vocab_with_reason(&self.corpus, &args.query, args.limit as usize);
        if reason.is_empty() {
            return json(entries);
        }
        let mut values: Vec<serde_json::Value> = entries
            .iter()
            .map(|entry| serde_json::to_value(entry).expect("vocab entry serializes"))
            .collect();
        for value in &mut values {
            if let Some(obj) = value.as_object_mut() {
                obj.insert("deinflected".into(), reason.clone().into());
            }
        }
        json(values)
    }

    #[tool(
        description = "List vocabulary entries for a JLPT level (full N5-N1 corpus). Useful for generating study sets."
    )]
    fn list_vocab_by_level(&self, Parameters(args): Parameters<LevelArgs>) -> String {
        json(engine::list_vocab_by_level(
            &self.corpus,
            level_str(args.level),
        ))
    }

    #[tool(
        description = "Exact lookup of a Japanese grammar point by id (e.g. \"desu-polite-copula\"). Returns the pattern, English meaning, detailed explanation, formation, examples, and related grammar points."
    )]
    fn lookup_grammar(&self, Parameters(args): Parameters<GrammarIdArgs>) -> String {
        json(engine::lookup_grammar(&self.corpus, &args.id))
    }

    #[tool(
        description = "Substring search over grammar patterns and English meanings. Use when the learner asks about a concept by name (e.g. \"te-form\", \"polite\", \"conditional\")."
    )]
    fn search_grammar(&self, Parameters(args): Parameters<SearchArgs>) -> String {
        json(engine::search_grammar(
            &self.corpus,
            &args.query,
            args.limit as usize,
        ))
    }

    #[tool(
        description = "List grammar points for a JLPT level. Useful for generating study sets or a grammar syllabus."
    )]
    fn list_grammar_by_level(&self, Parameters(args): Parameters<LevelArgs>) -> String {
        json(engine::list_grammar_by_level(
            &self.corpus,
            level_str(args.level),
        ))
    }

    #[tool(
        description = "Return the full conjugation table for a Japanese verb or adjective (dictionary form, kanji or kana). Covers polite/past/negative, te/ta/nai forms, potential, passive, causative, imperative, volitional, and conditionals."
    )]
    fn conjugate_verb(&self, Parameters(args): Parameters<LookupWordArgs>) -> String {
        json(engine::conjugate(&self.corpus, &args.word))
    }

    #[tool(
        description = "Exact lookup of one kanji character. Returns on/kun readings, English meanings, stroke count, JLPT level, and radical."
    )]
    fn lookup_kanji(&self, Parameters(args): Parameters<CharacterArgs>) -> String {
        json(engine::lookup_kanji(&self.corpus, &args.character))
    }

    #[tool(
        description = "Look up the stroke order of one kanji character. Returns the raw KanjiVG SVG (109x109 viewBox), the ordered stroke paths (id + d + type), the stroke-number labels, and the element decomposition path (e.g. 頑 → 元 + 頁). Use when teaching how to write a kanji, animating stroke order, or checking stroke count against the corpus. Not every character has KanjiVG data · traditional-form (kyūjitai) variants may be absent."
    )]
    fn lookup_stroke_order(&self, Parameters(args): Parameters<CharacterArgs>) -> String {
        json(engine::lookup_stroke_order(&self.corpus, &args.character))
    }

    #[tool(
        description = "Search kanji by character, on/kun reading, or English meaning. Use when the learner asks how to write a word, or which kanji has a given reading."
    )]
    fn search_kanji(&self, Parameters(args): Parameters<SearchArgs>) -> String {
        json(engine::search_kanji(
            &self.corpus,
            &args.query,
            args.limit as usize,
        ))
    }

    #[tool(
        description = "List kanji for a JLPT level (jlpt_waller classification). Useful for building a kanji study set."
    )]
    fn list_kanji_by_level(&self, Parameters(args): Parameters<LevelArgs>) -> String {
        json(engine::list_kanji_by_level(
            &self.corpus,
            level_str(args.level),
        ))
    }

    #[tool(
        description = "Return deterministic, corpus-backed source candidates for the shared item engine. The result contains canonical anchors and raw source entries only; it never contains prompts, options or answer keys."
    )]
    fn drill_candidates(&self, Parameters(args): Parameters<DrillCandidatesArgs>) -> String {
        json(engine::drill_candidates(
            &self.corpus,
            args.level,
            args.source,
            &args.seed,
            args.limit as usize,
        ))
    }

    #[tool(
        description = "Look up the pitch accent of a Japanese word (kanji or kana). Returns the reading, accent mora positions (0 = heiban/flat), mora count, and a human-readable pattern description (heiban, atamadaka, nakadaka, odaka)."
    )]
    fn lookup_pitch_accent(&self, Parameters(args): Parameters<LookupWordArgs>) -> String {
        let entries = engine::lookup_pitch_accent(&self.corpus, &args.word);
        if entries.is_empty() {
            return json(Vec::<serde_json::Value>::new());
        }
        let described: Vec<serde_json::Value> = entries
            .iter()
            .map(|entry| {
                let mut value = pitch_row_with_gloss(&self.corpus, entry);
                value
                    .as_object_mut()
                    .expect("pitch row is an object")
                    .insert("description".into(), engine::describe_pitch(entry).into());
                value
            })
            .collect();
        json(described)
    }

    #[tool(
        description = "Search pitch-accent entries by surface form or reading. Useful when the learner half-remembers a word's accent or wants similar-sounding words."
    )]
    fn search_pitch_accent(&self, Parameters(args): Parameters<SearchArgs>) -> String {
        let entries = engine::search_pitch_accent(&self.corpus, &args.query, args.limit as usize);
        let glossed: Vec<serde_json::Value> = entries
            .iter()
            .map(|entry| pitch_row_with_gloss(&self.corpus, entry))
            .collect();
        json(glossed)
    }

    /// TASK-23.1 debug tool: exposes the word-aware segmentation used by the
    /// search ranking path so Coach can explain why 東京特許許可局 and
    /// 東京で特許の許可 surface different hits (doc-2 §6 segmentation-variance
    /// caveat). Not part of the TS-engine tool surface (v0.3.0 → 0.4.0).
    /// Registered only under `JLPT_MCP_DEBUG=1` (TASK-93).
    #[tool(
        description = "Debug: split a Japanese or English string into the tokens used by search ranking (vaporetto model when loaded, whitespace fallback otherwise). Optionally choose the separator (default '/')."
    )]
    fn vaporetto_split(&self, Parameters(args): Parameters<SplitArgs>) -> String {
        let separator = args.separator.as_deref().unwrap_or("/");
        json(SplitResult {
            tokens: tokenize::split_tokens(&args.text),
            joined: tokenize::split_tokens(&args.text).join(separator),
            model_active: tokenize::vaporetto_active(),
        })
    }

    /// TASK-24.1: loads the vaporetto predictor if not yet loaded and reports
    /// the elapsed ms. Called by the smoke script and available to the Coach;
    /// boot also warms via a background thread so this usually returns ~0.
    /// Registered only under `JLPT_MCP_DEBUG=1` (TASK-93).
    #[tool(
        description = "Debug: preload the Japanese tokenizer model and report the load time in ms. Boot warms this automatically in the background; tools do not need to call it first."
    )]
    fn vaporetto_warmup(&self) -> String {
        #[cfg(feature = "vaporetto")]
        {
            match tokenize::warm() {
                Some(elapsed) => json(serde_json::json!({
                    "warmed": true,
                    "elapsed_ms": elapsed,
                    "model_active": true
                })),
                None => json(serde_json::json!({
                    "warmed": false,
                    "elapsed_ms": 0,
                    "model_active": false,
                    "reason": "no vaporetto model on disk"
                })),
            }
        }
        #[cfg(not(feature = "vaporetto"))]
        {
            json(serde_json::json!({
                "warmed": false,
                "elapsed_ms": 0,
                "model_active": false,
                "reason": "built without the vaporetto feature"
            }))
        }
    }

    /// TASK-23.4 example tools (doc-2 §5.2): ground Teacher output in real
    /// Tatoeba/Tanaka sentences instead of hallucinated examples.
    #[tool(
        description = "Find real example sentences containing a Japanese word (kanji or kana), matched against the sentence text and its Tanaka-corpus linked words. Each result carries jp, en, linkedWords, attribution, and a description citing the Tatoeba #id. Inflected forms (e.g. 食べました) fall back to their dictionary form via deinflection · retried results say so in the description. Prefer this over inventing examples when teaching vocabulary."
    )]
    fn lookup_examples(&self, Parameters(args): Parameters<LookupWordArgs>) -> String {
        json(
            engine::lookup_examples_with_reason(&self.corpus, &args.word, default_limit() as usize)
                .0,
        )
    }
    #[tool(
        description = "Search the Tatoeba/Tanaka sentence corpus by Japanese or English text, with an optional approximate JLPT level filter. Results carry jp, en, linkedWords, attribution, and a description citing the Tatoeba #id. Use for grounding grammar or vocabulary explanations in real usage."
    )]
    fn search_examples(&self, Parameters(args): Parameters<SearchExamplesArgs>) -> String {
        json(engine::search_examples(
            &self.corpus,
            &args.query,
            args.level,
            args.limit as usize,
        ))
    }

    #[tool(
        description = "Return one deterministic random example sentence, optionally filtered by an approximate JLPT level. Useful for drill prompts and offline Teacher fallbacks; the result cites its Tatoeba #id."
    )]
    fn random_example(&self, Parameters(args): Parameters<RandomExampleArgs>) -> String {
        json(engine::random_example(&self.corpus, args.level))
    }
}

impl JlptServer {
    /// The tool surface as presented to clients. `#[tool_router]` regenerates a
    /// fresh router on every request, so the debug gate lives here rather than
    /// at construction (TASK-93).
    fn visible_tool_router() -> ToolRouter<Self> {
        let mut router = Self::tool_router();
        if !debug_tools_enabled() {
            for name in DEBUG_TOOLS {
                router.disable_route(name);
            }
        }
        router
    }
}

/// No `version` argument: rmcp's `tool_handler` then advertises
/// `env!("CARGO_PKG_VERSION")`, which keeps Cargo.toml as the only copy of the
/// server version (TASK-95).
#[tool_handler(router = Self::visible_tool_router(), name = "jlpt-vocab")]
impl ServerHandler for JlptServer {}

fn level_str(level: JlptLevel) -> &'static str {
    match level {
        JlptLevel::N5 => "N5",
        JlptLevel::N4 => "N4",
        JlptLevel::N3 => "N3",
        JlptLevel::N2 => "N2",
        JlptLevel::N1 => "N1",
    }
}

/// A pitch row plus the vocabulary gloss it describes, joined on the exact
/// `(word, reading)` surface. The pitch corpus carries no English, so はし alone
/// cannot tell 橋 from 箸. `gloss` is ALWAYS present (empty when the surface has
/// no vocabulary entry, which is most non-JLPT words); `meaning` and
/// `partOfSpeech` are attached only on a match, because the TS engine serialized
/// those optional entry fields as-is.
fn pitch_row_with_gloss(corpus: &Corpus, entry: &PitchAccentEntry) -> serde_json::Value {
    let mut value = serde_json::to_value(entry).expect("pitch entry serializes");
    let object = value.as_object_mut().expect("pitch entry is an object");
    let vocab = engine::vocab_for_pitch(corpus, entry);
    object.insert(
        "gloss".into(),
        vocab.map_or_else(String::new, |v| v.gloss.clone()).into(),
    );
    if let Some(vocab) = vocab {
        if let Some(meaning) = &vocab.meaning {
            object.insert("meaning".into(), meaning.clone().into());
        }
        if let Some(part_of_speech) = &vocab.part_of_speech {
            object.insert("partOfSpeech".into(), part_of_speech.clone().into());
        }
    }
    value
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let corpus = Arc::new(crate::data::load_corpus());
    eprintln!(
        "[jlpt-mcp] corpus loaded: vocab {} · grammar {} · conjugations {} · kanji {} · pitch {} · sentences {}",
        corpus.all_vocab.len(),
        corpus.all_grammar.len(),
        corpus.conjugation_by_form.len(),
        corpus.all_kanji.len(),
        corpus.all_pitch.len(),
        corpus.all_sentences.len()
    );

    // TASK-24.1: warm the vaporetto predictor on a background thread so the
    // ~seconds-long zstd decode overlaps the agent's own session setup
    // instead of landing on the first Japanese search. Non-blocking · the
    // JSON-RPC loop serves `initialize` immediately.
    #[cfg(feature = "vaporetto")]
    std::thread::spawn(|| {
        if let Some(elapsed) = tokenize::warm() {
            eprintln!("[jlpt-mcp] vaporetto warm at boot: {elapsed} ms");
        }
    });

    let service = JlptServer::new(corpus).serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}
