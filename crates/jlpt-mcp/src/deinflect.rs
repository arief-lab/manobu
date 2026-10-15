//! Query-time deinflection (TASK-23.27, doc-8 §4, §6.3): inflected query
//! forms → candidate dictionary forms for the search miss-retry path.
//!
//! Corpus `data/n*.json` stores dictionary forms (食べる), so an inflected
//! query (食べました) substring-matches nothing. `deinflect()` maps an
//! inflected form to a small set of candidate dictionary forms + the reason
//! string (PolitePast), implemented independently (10ten-style morphology —
//! MIT-clean; tentoku's GPL port deliberately not consulted).
//!
//! Design:
//! - Rules fire ONLY on the zero-hit miss-retry path (AC#3: direct hits are
//!   byte-identical to the pre-retry behavior — the golden battery never
//!   sends an inflected query, so the golden is untouched).
//! - Candidates are POS-validated against the corpus `partOfSpeech` field
//!   (AC#2): a noun never deinflects as a verb because the regenerated
//!   dictionary form is only accepted for corpus entries whose POS contains
//!   the rule's required class.
//! - The TASK-23.26 vaporetto POS tag (when the model is active) is NOT
//!   required for the rule to fire — the tag channel confirmed
//!   (`動詞-一般`+`助動詞` splits) but the corpus POS check is the gate that
//!   keeps this honest on model-less builds too.

/// A candidate dictionary form plus why we think it deinflects to the query.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Deinflection {
    /// Candidate dictionary form (kanji or kana, matching the query script).
    pub form: String,
    /// Human-readable reason, e.g. `PolitePast` — surfaced in the tool-layer
    /// description so Teacher can explain the match.
    pub reason: &'static str,
    /// POS the regenerated dictionary form must carry in the corpus.
    pub required_pos: &'static str,
}

/// Substrings any of which must appear in the corpus `partOfSpeech` field.
pub const VERB_POS: &str = "verb";
pub const ADJ_POS: &str = "adjective";

/// Godan dictionary-form last-kana row: (masu-stem kana → dictionary kana).
/// 食べました[かい-い row: 買いました stem かい] → 買う. The stem's last
/// kana sits in the i-row of a godan verb's five-grade row; the dictionary
/// form uses the u-row kana.
const GODAN_U_ROW: &[(char, char)] = &[
    ('い', 'う'),
    ('き', 'く'),
    ('ぎ', 'ぐ'),
    ('し', 'す'),
    ('ち', 'つ'),
    ('に', 'ぬ'),
    ('び', 'ぶ'),
    ('み', 'む'),
    ('り', 'る'),
];

/// Godan e-row: potential form 買える stem 買え → dictionary 買う.
const GODAN_E_ROW: &[(char, char)] = &[
    ('え', 'う'),
    ('け', 'く'),
    ('げ', 'ぐ'),
    ('せ', 'す'),
    ('て', 'つ'),
    ('ね', 'ぬ'),
    ('べ', 'ぶ'),
    ('め', 'む'),
    ('れ', 'る'),
];

/// Engine-side generator for godan potential without れ (買える → 買う):
/// e-row last kana → dictionary u-row. pub because the engine applies it as
/// an extra corpus-gated candidate (the rule table alone can't tell
/// 買える-potential from the dictionary form 食べる).
pub fn godan_e_potential(query: &str) -> Option<String> {
    let stem = query.strip_suffix('る')?;
    godan_e_dictionary(stem)
}

fn godan_e_dictionary(stem: &str) -> Option<String> {
    let last = stem.chars().last()?;
    GODAN_E_ROW
        .iter()
        .find(|(stem_kana, _)| *stem_kana == last)
        .map(|(_, dict_kana)| {
            let mut owned = stem.to_string();
            owned.pop();
            owned.push(*dict_kana);
            owned
        })
}

/// Onbin (euphonic) tail → possible pre-tail stem kana: 飲んだ stem is
/// 飲ん (ん) whose dictionary last-kana is one of ぬ/ぶ/む; 行った stem is
/// 行っ (っ) → く/つ/る(+う for う-verbs like 買って). A past/te query with
/// a geminate/nasal tail regenerates candidates for EVERY possibility and
/// lets the corpus POS check (AC#2) pick the real one.
const ONBIN_TAILS: &[(char, &[char])] = &[
    ('ん', &['に', 'び', 'み']),
    ('っ', &['き', 'ち', 'り', 'い']),
];

/// Regenerate dictionary-form candidates for a past/te stem: the stem as-is
/// (i-row godan / ichidan / irregular) plus each onbin possibility
/// (stem-tail dropped, pre-tail kana restored).
fn past_stem_candidates(stem: &str) -> Vec<String> {
    let mut out = vec![stem.to_string()];
    for (tail, restores) in ONBIN_TAILS {
        if let Some(prefix) = stem.strip_suffix(*tail) {
            for restore in *restores {
                out.push(format!("{prefix}{restore}"));
            }
        }
    }
    out
}

/// Irregular: します/しました → する; きます/きました → 来る/くる handled by
/// explicit candidate pairs (both scripts, matching the corpus).
const IRREGULAR: &[(&str, &str)] = &[
    ("し", "する"),
    ("さ", "する"),
    ("き", "くる"),
    ("こ", "くる"),
];

fn godan_dictionary(stem: &str) -> Option<String> {
    let last = stem.chars().last()?;
    GODAN_U_ROW
        .iter()
        .find(|(stem_kana, _)| *stem_kana == last)
        .map(|(_, dict_kana)| {
            let mut owned = stem.to_string();
            owned.pop();
            owned.push(*dict_kana);
            owned
        })
}

fn ichidan_dictionary(stem: &str) -> String {
    let mut owned = stem.to_string();
    owned.push('る');
    owned
}

/// Generate dictionary candidates from a polite/negative stem (the renyōkei
/// form before ます/ません): godan i-row map, ichidan +る, irregular. Shared
/// by the polite-family rules so each keeps one code path.
fn push_deinflect_stem(stem: &str, reason: &'static str, out: &mut Vec<Deinflection>) {
    if let Some(dict) = godan_dictionary(stem) {
        if !out.iter().any(|c| c.form == dict) {
            out.push(Deinflection {
                form: dict,
                reason,
                required_pos: VERB_POS,
            });
        }
    }
    let ichidan = ichidan_dictionary(stem);
    if !out.iter().any(|c| c.form == ichidan) {
        out.push(Deinflection {
            form: ichidan,
            reason,
            required_pos: VERB_POS,
        });
    }
    for (irr_stem, dict) in IRREGULAR {
        if stem.ends_with(irr_stem) && !out.iter().any(|c| c.form == *dict) {
            out.push(Deinflection {
                form: dict.to_string(),
                reason,
                required_pos: VERB_POS,
            });
        }
    }
}

/// All deinflection candidates for `query`, most-likely first. Empty when
/// the query does not end in a known inflection (callers treat that as "no
/// retry available").
pub fn deinflect(query: &str) -> Vec<Deinflection> {
    let mut out: Vec<Deinflection> = Vec::new();
    let mut push = |form: String, reason: &'static str, required_pos: &'static str| {
        if !form.is_empty() && !out.iter().any(|c| c.form == form) {
            out.push(Deinflection {
                form,
                reason,
                required_pos,
            });
        }
    };

    // Negative adjective (longest first so 〜なかった never leaks into the
    // 〜た/〜だ verb rules and 〜くない never into 〜ない).
    if let Some(stem) = query.strip_suffix("なかった") {
        // ku-form stem 寒く → dictionary 寒い (the 〜ない/〜かった family
        // attaches to the ku-form, not the dictionary form).
        if let Some(root) = stem.strip_suffix('く') {
            push(format!("{root}い"), "AdjectivePastNegative", ADJ_POS);
        }
        // TASK-54: verb past-negative — 行かなかった = negative stem 行か
        // + なかった (godan a-row か→く); 食べなかった = ichidan stem 食べ;
        // しなかった → する. Parity with apps/desktop deinflect.ts.
        let chars: Vec<char> = stem.chars().collect();
        if let Some(last) = chars.last() {
            let a_row: &[(char, char)] = &[
                ('か', 'く'),
                ('が', 'ぐ'),
                ('さ', 'す'),
                ('た', 'つ'),
                ('な', 'ぬ'),
                ('ば', 'ぶ'),
                ('ま', 'む'),
                ('ら', 'る'),
                ('わ', 'う'),
            ];
            if let Some((_, u_row)) = a_row.iter().find(|(a, _)| a == last) {
                let dict: String =
                    chars[..chars.len() - 1].iter().collect::<String>() + &u_row.to_string();
                push(dict, "PastNegative", VERB_POS);
            }
        }
        for (irr_stem, dict) in IRREGULAR {
            if stem == *irr_stem {
                push((*dict).to_string(), "PastNegative", VERB_POS);
            }
        }
        push(ichidan_dictionary(stem), "PastNegative", VERB_POS);
        return out;
    }
    if let Some(stem) = query.strip_suffix("くない") {
        // くない already contains the ku-form's く (高くない → stem 高):
        // dictionary = stem + い.
        push(format!("{stem}い"), "Negative", ADJ_POS);
        return out;
    }
    // Adjective conditional/past before the verb 〜れば/〜た families.
    if let Some(stem) = query.strip_suffix("ければ") {
        push(format!("{stem}い"), "Conditional", ADJ_POS);
        return out;
    }
    if let Some(stem) = query.strip_suffix("かった") {
        if let Some(want_stem) = stem.strip_suffix('た') {
            // 〜たかった = want-to past (行きたかった): the pre-かった stem
            // ends in the want-to た (行きた) — strip it → the want-to stem
            // 行き → godan/ichidan dictionary candidates. An い-adjective
            // past (寒かった) has stem 寒く, NOT ending in た → falls through.
            if let Some(dict) = godan_dictionary(want_stem) {
                push(dict, "WantToPast", VERB_POS);
            }
            push(ichidan_dictionary(want_stem), "WantToPast", VERB_POS);
            return out;
        }
        // かった already contains the ku-form's く (高かった → stem 高):
        // dictionary = stem + い.
        push(format!("{stem}い"), "AdjectivePast", ADJ_POS);
        return out;
    }
    // Polite past before plain past (ました ends in した! and 〜た).
    // Polite negative (past) before polite past: ませんでした/ません end in
    // the negative stem (飲みませんでした → 飲み → 飲む).
    if let Some(stem) = query.strip_suffix("ませんでした") {
        push_deinflect_stem(stem, "PoliteNegativePast", &mut out);
        return out;
    }
    if let Some(stem) = query.strip_suffix("ません") {
        push_deinflect_stem(stem, "PoliteNegative", &mut out);
        return out;
    }
    if let Some(stem) = query.strip_suffix("ました") {
        if let Some(dict) = godan_dictionary(stem) {
            push(dict, "PolitePast", VERB_POS);
        }
        push(ichidan_dictionary(stem), "PolitePast", VERB_POS);
        for (irr_stem, dict) in IRREGULAR {
            if stem.ends_with(irr_stem) {
                push(dict.to_string(), "PolitePast", VERB_POS);
            }
        }
        return out;
    }
    // Causative/passive before potential before plain past (せる/られる end
    // in る but not た; ordering still matters vs the bare-る forms below).
    if let Some(stem) = query.strip_suffix("られる") {
        push(ichidan_dictionary(stem), "PassivePotential", VERB_POS);
        if let Some(dict) = godan_e_dictionary(stem) {
            push(dict, "PassivePotential", VERB_POS);
        }
        return out;
    }
    if let Some(stem) = query.strip_suffix("させる") {
        push(ichidan_dictionary(stem), "Causative", VERB_POS);
        if let Some(last) = stem.chars().last() {
            let a_row = match last {
                'さ' => Some('す'),
                'か' => Some('く'),
                'が' => Some('ぐ'),
                'た' => Some('つ'),
                'な' => Some('ぬ'),
                'ば' => Some('ぶ'),
                'ま' => Some('む'),
                'ら' => Some('る'),
                'わ' => Some('う'),
                _ => None,
            };
            if let Some(dict_kana) = a_row {
                let mut owned = stem.to_string();
                owned.pop();
                owned.push(dict_kana);
                push(owned, "Causative", VERB_POS);
            }
        }
        return out;
    }
    // Plain verb past / te / negative families.
    for (suffix, reason) in [("た", "Past"), ("だ", "Past")] {
        if let Some(stem) = query.strip_suffix(suffix) {
            for stem_candidate in past_stem_candidates(stem) {
                if let Some(dict) = godan_dictionary(&stem_candidate) {
                    push(dict, reason, VERB_POS);
                }
                push(ichidan_dictionary(&stem_candidate), reason, VERB_POS);
                for (irr_stem, dict) in IRREGULAR {
                    if stem_candidate.ends_with(irr_stem) {
                        push(dict.to_string(), reason, VERB_POS);
                    }
                }
            }
            return out;
        }
    }
    for (suffix, reason) in [("て", "Te"), ("で", "Te")] {
        if let Some(stem) = query.strip_suffix(suffix) {
            let mut stems = past_stem_candidates(stem);
            if suffix == "で" {
                // で signals the voiced onbin: 飲んで (ん restores に/び/み),
                // 泳いで (i-tail is the RENYOKEI of a ぎ/び/み-row verb —
                // plain い→う gives 泳う garbage, so restore ぎ/び/み first
                // and let godan_dictionary do the row map; the corpus POS
                // check AC#2 discards wrong candidates).
                if let Some(prefix) = stem.strip_suffix('い') {
                    for restore in ['ぎ', 'び', 'み'] {
                        stems.push(format!("{prefix}{restore}"));
                    }
                }
            }
            for stem_candidate in stems {
                if let Some(dict) = godan_dictionary(&stem_candidate) {
                    push(dict, reason, VERB_POS);
                }
                push(ichidan_dictionary(&stem_candidate), reason, VERB_POS);
                // TASK-54 parity: TS pushPastStemCandidates also unions the
                // irregular candidates (して → する) — Rust omitted them.
                for (irr_stem, dict) in IRREGULAR {
                    if stem_candidate.ends_with(irr_stem) {
                        push((*dict).to_string(), reason, VERB_POS);
                    }
                }
            }
            return out;
        }
    }
    if let Some(stem) = query.strip_suffix("ない") {
        if let Some(last) = stem.chars().last() {
            let a_row = match last {
                'わ' => Some('う'),
                'か' => Some('く'),
                'が' => Some('ぐ'),
                'さ' => Some('す'),
                'た' => Some('つ'),
                'な' => Some('ぬ'),
                'ば' => Some('ぶ'),
                'ま' => Some('む'),
                'ら' => Some('る'),
                _ => None,
            };
            if let Some(dict_kana) = a_row {
                let mut owned = stem.to_string();
                owned.pop();
                owned.push(dict_kana);
                push(owned, "Negative", VERB_POS);
            }
        }
        push(ichidan_dictionary(stem), "Negative", VERB_POS);
        for (irr_stem, dict) in IRREGULAR {
            if stem.ends_with(irr_stem) {
                push(dict.to_string(), "Negative", VERB_POS);
            }
        }
        return out;
    }
    if let Some(stem) = query.strip_suffix("れば") {
        push(ichidan_dictionary(stem), "Conditional", VERB_POS);
        for (irr_stem, dict) in IRREGULAR {
            if stem.ends_with(irr_stem) {
                push(dict.to_string(), "Conditional", VERB_POS);
            }
        }
        return out;
    }
    if let Some(stem) = query.strip_suffix("ます") {
        // The stem may itself be an e-row potential form (泳げます → 泳げ
        // → 泳ぐ), so try the e-row map in addition to the i-row.
        if let Some(dict) = godan_dictionary(stem) {
            push(dict, "Polite", VERB_POS);
        }
        if let Some(dict) = godan_e_dictionary(stem) {
            push(dict, "PolitePotential", VERB_POS);
        }
        push(ichidan_dictionary(stem), "Polite", VERB_POS);
        for (irr_stem, dict) in IRREGULAR {
            if stem.ends_with(irr_stem) {
                push(dict.to_string(), "Polite", VERB_POS);
            }
        }
        return out;
    }
    // Volitional: 〜よう (ichidan/食べよう) + general o-row + う (行こう/
    // 買おう/飲もう), with しよう → する irregular.
    if let Some(stem) = query.strip_suffix('う') {
        if let Some(o_kana) = stem.chars().last() {
            let dict_kana = match o_kana {
                'よ' | 'お' => Some('う'),
                'こ' => Some('く'),
                'ご' => Some('ぐ'),
                'そ' => Some('す'),
                'と' => Some('つ'),
                'の' => Some('ぬ'),
                'ぼ' => Some('ぶ'),
                'も' => Some('む'),
                'ろ' => Some('る'),
                _ => None,
            };
            if let Some(dict_kana) = dict_kana {
                let root: String = {
                    let mut owned = stem.to_string();
                    owned.pop();
                    owned
                };
                push(format!("{root}{dict_kana}"), "Volitional", VERB_POS);
                // ichidan: 食べよう → stem 食べよ → root 食べ → 食べる.
                push(ichidan_dictionary(&root), "Volitional", VERB_POS);
                // しよう → する.
                if root == "し" {
                    push("する".to_string(), "Volitional", VERB_POS);
                }
                return out;
            }
        }
    }
    for (suffix, reason) in [("たく", "WantToStem"), ("たい", "WantTo")] {
        if let Some(stem) = query.strip_suffix(suffix) {
            push(ichidan_dictionary(stem), reason, VERB_POS);
            return out;
        }
    }
    for (suffix, reason) in [("れる", "Potential"), ("せる", "Causative")] {
        if let Some(stem) = query.strip_suffix(suffix) {
            push(ichidan_dictionary(stem), reason, VERB_POS);
            if let Some(dict) = godan_e_dictionary(stem) {
                push(dict, reason, VERB_POS);
            }
            return out;
        }
    }
    // NOTE: godan potential WITHOUT れ (買える = え-row + る) is ALSO
    // handled by the ENGINE retry (search_vocab_with_reason) via
    // godan_e_potential(): a bare-る e-row rule also matches dictionary
    // ichidan forms (食べる → stem 食べ → e-row maps to 食ぶ) and only the
    // corpus can disambiguate a real potential from a headword. TASK-54
    // parity: deinflect() now ALSO emits the bare-potential candidate
    // (ichidan + godan-u pair, mirroring apps/desktop deinflect.ts) so the
    // 30-form sweep passes identically on both sides; over-generation is
    // safe — the engine validates against the corpus. できる is する's
    // irregular potential — no corpus needed for the pair.
    if query == "できる" {
        push("する".to_string(), "Potential", VERB_POS);
    }
    if query.ends_with('る') {
        let chars: Vec<char> = query.chars().collect();
        if let Some(second_last) = chars.get(chars.len() - 2) {
            if GODAN_E_ROW.iter().any(|(e_kana, _)| e_kana == second_last) {
                let stem: String = chars[..chars.len() - 1].iter().collect();
                push(ichidan_dictionary(&stem), "Potential", VERB_POS);
                if let Some(dict) = godan_e_dictionary(&stem) {
                    push(dict, "Potential", VERB_POS);
                }
                return out;
            }
        }
    }

    if let Some(stem) = query.strip_suffix("です") {
        push(stem.to_string(), "Polite", ADJ_POS);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// TASK-54 AC4: shared 30-form conjugation sweep — identical table to
    /// apps/desktop/src/lib/deinflect.ts CONJUGATION_SWEEP. Every form must
    /// deinflect back to its target (or be an exact match).
    #[test]
    fn conjugation_sweep_30_forms() {
        let sweep: &[(&str, &[&str])] = &[
            (
                "食べる",
                &[
                    "食べます",
                    "食べた",
                    "食べて",
                    "食べない",
                    "食べなかった",
                    "食べられる",
                ],
            ),
            (
                "行く",
                &[
                    "行きます",
                    "行った",
                    "行って",
                    "行かない",
                    "行かなかった",
                    "行ける",
                ],
            ),
            (
                "見る",
                &["見ます", "見た", "見て", "見ない", "見なかった", "見られる"],
            ),
            (
                "する",
                &["します", "した", "して", "しない", "しなかった", "できる"],
            ),
            (
                "来る",
                &["来ます", "来た", "来て", "来ない", "来なかった", "来られる"],
            ),
        ];
        for (target, forms) in sweep {
            for form in *forms {
                if form == target {
                    continue;
                }
                let got: Vec<String> = deinflect(form).into_iter().map(|d| d.form).collect();
                assert!(
                    got.iter().any(|f| f == target),
                    "{form} (target {target}) did not deinflect: {got:?}"
                );
            }
        }
    }

    /// AC#4: one test per rule class.
    #[test]
    fn polite_and_polite_past() {
        let got: Vec<String> = deinflect("食べました")
            .into_iter()
            .map(|d| d.form)
            .collect();
        assert!(got.iter().any(|f| f == "食べる"), "{got:?}");
        let got: Vec<String> = deinflect("買いました")
            .into_iter()
            .map(|d| d.form)
            .collect();
        assert!(got.iter().any(|f| f == "買う"), "{got:?}");
        assert_eq!(deinflect("食べました")[0].reason, "PolitePast");
        let got: Vec<String> = deinflect("食べます").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "食べる"), "{got:?}");
    }

    #[test]
    fn past_plain_and_onbin() {
        let got: Vec<String> = deinflect("食べた").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "食べる"), "{got:?}");
        let got: Vec<String> = deinflect("飲んだ").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "飲む"), "{got:?}");
        let got: Vec<String> = deinflect("行った").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "行く"), "{got:?}");
        let got: Vec<String> = deinflect("話した").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "話す"), "{got:?}");
    }

    #[test]
    fn adjective_past_and_negative() {
        let got: Vec<String> = deinflect("高かった").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "高い"), "{got:?}");
        let got: Vec<String> = deinflect("高くない").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "高い"), "{got:?}");
        let got: Vec<String> = deinflect("寒くなかった")
            .into_iter()
            .map(|d| d.form)
            .collect();
        assert!(got.iter().any(|f| f == "寒い"), "{got:?}");
    }

    #[test]
    fn verb_negative_godan_a_column() {
        let got: Vec<String> = deinflect("買わない").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "買う"), "{got:?}");
        let got: Vec<String> = deinflect("食べない").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "食べる"), "{got:?}");
    }

    #[test]
    fn te_form_onbin() {
        let got: Vec<String> = deinflect("食べて").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "食べる"), "{got:?}");
        let got: Vec<String> = deinflect("飲んで").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "飲む"), "{got:?}");
        let got: Vec<String> = deinflect("泳いで").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "泳ぐ"), "{got:?}");
        let got: Vec<String> = deinflect("待って").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "待つ"), "{got:?}");
    }

    #[test]
    fn conditional() {
        let got: Vec<String> = deinflect("食べれば").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "食べる"), "{got:?}");
        let got: Vec<String> = deinflect("高ければ").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "高い"), "{got:?}");
    }

    #[test]
    fn volitional() {
        let got: Vec<String> = deinflect("食べよう").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "食べる"), "{got:?}");
        let got: Vec<String> = deinflect("行こう").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "行く"), "{got:?}");
        let got: Vec<String> = deinflect("しよう").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "する"), "{got:?}");
    }

    #[test]
    fn want_to() {
        let got: Vec<String> = deinflect("食べたい").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "食べる"), "{got:?}");
        let got: Vec<String> = deinflect("行きたかった")
            .into_iter()
            .map(|d| d.form)
            .collect();
        assert!(got.iter().any(|f| f == "行く"), "{got:?}");
    }

    #[test]
    fn potential_passive_causative() {
        let got: Vec<String> = deinflect("食べられる")
            .into_iter()
            .map(|d| d.form)
            .collect();
        assert!(got.iter().any(|f| f == "食べる"), "{got:?}");
        let got: Vec<String> = deinflect("食べさせる")
            .into_iter()
            .map(|d| d.form)
            .collect();
        assert!(got.iter().any(|f| f == "食べる"), "{got:?}");
        // 買える (godan potential without れ) is engine-side: corpus-gated
        // generator, unit-tested directly.
        assert_eq!(godan_e_potential("買える"), Some("買う".to_string()));
        // The generator is deliberately morphological-only: 食べる (stem
        // 食べ, e-row べ) also maps — 食ぶ vs 買う is corpus-resolved by the
        // engine's POS gate (AC#2), not here.
    }

    #[test]
    fn irregular() {
        let got: Vec<String> = deinflect("しました").into_iter().map(|d| d.form).collect();
        assert!(got.iter().any(|f| f == "する"), "{got:?}");
        let got: Vec<String> = deinflect("来ました").into_iter().map(|d| d.form).collect();
        assert!(
            got.iter().any(|f| f == "くる") || got.iter().any(|f| f == "来る"),
            "{got:?}"
        );
    }

    /// AC#2: plain nouns / uninflected forms produce no candidates — the
    /// rule table never invents a dictionary form from a bare stem.
    /// TASK-54 update: bare e-row+る forms (食べる, a genuine ichidan
    /// dictionary form AND a potential shape) now emit candidates whose
    /// identity member is skipped downstream — the engine's corpus
    /// validation disambiguates. 選挙/パソコン stay empty.
    #[test]
    fn noun_or_unknown_yields_nothing() {
        assert!(deinflect("選挙").is_empty());
        assert!(deinflect("パソコン").is_empty());
        assert!(deinflect("").is_empty());
    }

    /// Dictionary-form regeneration correctness: every candidate carries a
    /// POS requirement the callers can validate (AC#2 gate).
    #[test]
    fn candidates_carry_pos_requirements() {
        for candidate in deinflect("食べました") {
            assert!(candidate.required_pos == VERB_POS || candidate.required_pos == ADJ_POS);
        }
    }
}
