//! Word-aware Japanese tokenization for the search ranking path
//! (TASK-23.1, doc-2 §5.1). With the `vaporetto` cargo feature,
//! `SQLITE_VAPORETTO_MODEL` resolves to a zstd-compressed (`.model.zst`)
//! BCCWJ+UniDic model; without the feature (or a missing model) the fallback
//! splits on ASCII whitespace only so non-feature builds reproduce the legacy
//! substring-search semantics (and the parity golden).

use std::path::PathBuf;

#[cfg(feature = "vaporetto")]
use std::sync::OnceLock;

/// Default model location relative to this crate (matches the layout produced
/// by `packages/db/scripts/fetch-vaporetto.ts`; `+` characters are literal).
const DEFAULT_MODEL: &str =
    "../../apps/desktop/src-tauri/resources/vaporetto/model/bccwj-suw+unidic_pos+kana.model.zst";

fn model_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("SQLITE_VAPORETTO_MODEL") {
        let path = PathBuf::from(path);
        return path.exists().then_some(path);
    }
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(DEFAULT_MODEL);
    path.exists().then_some(path)
}

#[cfg(feature = "vaporetto")]
static PREDICTOR: OnceLock<Option<vaporetto::Predictor>> = OnceLock::new();

#[cfg(feature = "vaporetto")]
fn predictor() -> Option<&'static vaporetto::Predictor> {
    PREDICTOR.get_or_init(|| load_predictor()).as_ref()
}

/// Load path (TASK-24.2). Two artifacts, fastest first:
///
/// 1. `<model>.predictor.bin.zst` — a PRE-BUILT predictor (zstd-compressed)
///    cached next to the
///    model by `packages/db/scripts/fetch-vaporetto.ts`. `Model::read` +
///    `Predictor::new` costs ~7 s because `Predictor::new` rebuilds the
///    daachorse Aho-Corasick automaton over ~1.3 M ngrams (profiled:
///    zstd 0.1 s + bincode 0.5 s + PMA build 6.5 s). The serialized
///    predictor carries the built automaton, so
///    `deserialize_from_slice_unchecked` skips construction (~0.9 s).
///    Regenerated in the same commit as any model bump — the unsafe
///    deserialization must never meet a stale cache.
/// 2. `<model>.zst` — the upstream model, decoded + built as before
///    (first boot on a box that never fetched the cache). ~8 s one-time.
#[cfg(feature = "vaporetto")]
fn load_predictor() -> Option<vaporetto::Predictor> {
    let path = model_path()?;
    let mut cache = path.as_os_str().to_os_string();
    cache.push(".predictor.bin.zst");
    let cache = PathBuf::from(cache);
    if let Ok(compressed) = std::fs::read(&cache) {
        // 89 MB raw → 26 MB at zstd-3; decode ~0.12 s, deserialize ~0.9 s.
        let decoded = zstd::stream::decode_all(&compressed[..]).map_err(|e| e.to_string());
        let result = decoded.and_then(|blob| {
            // borrows `blob` — keep both alive in this scope, move the
            // predictor out after.
            unsafe { vaporetto::Predictor::deserialize_from_slice_unchecked(&blob) }
                .map(|(predictor, _)| predictor)
                .map_err(|e| e.to_string())
        });
        match result {
            Ok(predictor) => {
                eprintln!(
                    "[jlpt-mcp] vaporetto predictor from cache: {}",
                    cache.display()
                );
                return Some(predictor);
            }
            Err(error) => {
                eprintln!("[jlpt-mcp] predictor cache unreadable: {error} — rebuilding from model");
            }
        }
    }
    let file = std::fs::File::open(&path).ok()?;
    // The distribution model ships zstd-compressed (.model.zst);
    // decompress fully, then parse the bincode model.
    let reader = zstd::Decoder::new(file).ok()?;
    match vaporetto::Model::read(reader) {
        Ok(model) => vaporetto::Predictor::new(model, true).ok(),
        Err(error) => {
            eprintln!("[jlpt-mcp] vaporetto model unreadable: {error}");
            None
        }
    }
}

/// Force-load the predictor now and return how long the load took (ms).
/// `None` on non-vaporetto builds or when no model is present. Used by the
/// `vaporetto_warmup` tool (TASK-24.1): boot warms the predictor on a
/// background thread so the first Japanese search never pays the decode.
#[cfg(feature = "vaporetto")]
pub fn warm() -> Option<u128> {
    let start = std::time::Instant::now();
    predictor()?;
    Some(start.elapsed().as_millis())
}

/// True when the model-backed tokenizer is active (feature + model present).
pub fn vaporetto_active() -> bool {
    #[cfg(feature = "vaporetto")]
    {
        predictor().is_some()
    }
    #[cfg(not(feature = "vaporetto"))]
    {
        false
    }
}

fn has_non_ascii(text: &str) -> bool {
    text.chars().any(|character| !character.is_ascii())
}

/// Split `text` into tokens. Japanese input goes through the vaporetto model
/// when available; ASCII-only (or model-less) input splits on whitespace.
pub fn split_tokens(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    #[cfg(feature = "vaporetto")]
    if has_non_ascii(text) {
        if let Some(predictor) = predictor() {
            let mut sentence = vaporetto::Sentence::default();
            if sentence.update_raw(text).is_ok() {
                predictor.predict(&mut sentence);
                sentence.fill_tags();
                return sentence
                    .iter_tokens()
                    .map(|token| token.surface().to_string())
                    .collect();
            }
        }
    }
    whitespace_tokens(text)
}

/// Whitespace fallback used for ASCII-only input and when the model is
/// absent (vaporetto-less builds keep the legacy substring semantics).
fn whitespace_tokens(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_string).collect()
}

/// A token plus the two tag channels the shipped model carries
/// (TASK-23.26, doc-8 §3): UniDic POS1-POS2 (e.g. `動詞-一般`) and the
/// katakana reading (e.g. `タベ`), the latter converted to hiragana for
/// matching against corpus `reading` columns. `None` tags on the
/// whitespace path (ASCII input / model-less builds) so legacy behavior
/// stays observable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaggedToken {
    pub pos: Option<String>,
    pub reading: Option<String>,
    pub surface: String,
}

/// Katakana codepoint → hiragana (ー U+30FC passes through; ヴ lands on
/// ひらがな ゔ U+3094 in the same offset scheme). Non-katakana unchanged.
#[cfg(feature = "vaporetto")]
fn katakana_to_hiragana(text: &str) -> String {
    text.chars()
        .map(|c| {
            if ('\u{30A1}'..='\u{30F6}').contains(&c) {
                char::from_u32(c as u32 - 0x60).unwrap_or(c)
            } else {
                c
            }
        })
        .collect()
}

/// `split_tokens` with the model's tag channels attached. Same token
/// boundaries as `split_tokens`; tags are `None` wherever the model did
/// not run (ASCII-only input, no model, or a token the model left
/// untagged — e.g. embedded ASCII words).
pub fn tokenize_with_tags(text: &str) -> Vec<TaggedToken> {
    if text.is_empty() {
        return Vec::new();
    }
    #[cfg(feature = "vaporetto")]
    if has_non_ascii(text) {
        if let Some(predictor) = predictor() {
            let mut sentence = vaporetto::Sentence::default();
            if sentence.update_raw(text).is_ok() {
                predictor.predict(&mut sentence);
                sentence.fill_tags();
                return sentence
                    .iter_tokens()
                    .map(|token| {
                        let tags = token.tags();
                        TaggedToken {
                            surface: token.surface().to_string(),
                            pos: tags.first().and_then(|t| t.as_deref().map(str::to_string)),
                            // Model channel is katakana (UniDic kana field);
                            // convert here so consumers match corpus readings
                            // (hiragana) directly (TASK-23.26 AC#2).
                            reading: tags
                                .get(1)
                                .and_then(|t| t.as_deref())
                                .map(|kana| katakana_to_hiragana(kana)),
                        }
                    })
                    .collect();
            }
        }
    }
    whitespace_tokens(text)
        .into_iter()
        .map(|surface| TaggedToken {
            pos: None,
            reading: None,
            surface,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_input_splits_on_whitespace() {
        assert_eq!(split_tokens("eat drink go"), vec!["eat", "drink", "go"]);
    }

    #[test]
    fn empty_input_yields_no_tokens() {
        assert!(split_tokens("").is_empty());
    }

    #[test]
    fn whitespace_only_yields_no_tokens() {
        assert!(split_tokens("   \t ").is_empty());
    }

    #[test]
    fn japanese_tokenization_matches_model_or_fallback() {
        let tokens = split_tokens("東京特許許可局");
        if vaporetto_active() {
            assert_eq!(tokens, vec!["東京", "特許", "許可", "局"]);
        } else {
            assert_eq!(tokens, vec!["東京特許許可局"]);
        }
    }

    /// Version probe (TASK-23.1): when the pinned model artifact is present
    /// the predictor must load it — but only the `vaporetto` feature builds
    /// the predictor at all. Catches corrupted fetches and incompatible model
    /// formats loudly instead of silently degrading to whitespace tokens.
    /// Passes on machines that have not fetched the model yet, and on
    /// non-feature builds (which keep the legacy substring semantics).
    #[test]
    fn model_loads_when_present() {
        #[cfg(feature = "vaporetto")]
        if model_path().is_some() {
            assert!(
                vaporetto_active(),
                "model file exists but the vaporetto predictor failed to load it"
            );
        }
    }

    #[test]
    #[cfg(feature = "vaporetto")]
    fn katakana_to_hiragana_basic() {
        assert_eq!(katakana_to_hiragana("タベ"), "たべ");
        assert_eq!(katakana_to_hiragana("トウキョウ"), "とうきょう");
        assert_eq!(katakana_to_hiragana("ー"), "ー");
        assert_eq!(katakana_to_hiragana("abc"), "abc");
        assert_eq!(katakana_to_hiragana("漢字"), "漢字");
    }

    /// Tag-channel probe (TASK-23.26): when the pinned model is loaded the
    /// POS + katakana-reading channels must surface through
    /// `tokenize_with_tags` (model-gated like `model_loads_when_present`).
    #[test]
    fn tagged_tokens_carry_pos_and_reading() {
        if !vaporetto_active() {
            return;
        }
        let tokens = tokenize_with_tags("食べました");
        assert_eq!(tokens.len(), 3);
        assert_eq!(tokens[0].surface, "食べ");
        assert_eq!(tokens[0].pos.as_deref(), Some("動詞-一般"));
        assert_eq!(tokens[0].reading.as_deref(), Some("たべ"));
        assert_eq!(tokens[1].pos.as_deref(), Some("助動詞"));
        assert_eq!(tokens[1].reading.as_deref(), Some("まし"));
    }

    #[test]
    fn ascii_input_keeps_none_tags() {
        for token in tokenize_with_tags("eat drink go") {
            assert_eq!(token.pos, None);
            assert_eq!(token.reading, None);
        }
        assert_eq!(
            tokenize_with_tags("eat drink go")
                .iter()
                .map(|t| t.surface.as_str())
                .collect::<Vec<_>>(),
            vec!["eat", "drink", "go"]
        );
    }
}
