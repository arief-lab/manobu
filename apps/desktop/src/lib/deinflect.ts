/*
 * Query-time deinflection for typed drill answers (TASK-23.29, doc-8 §4).
 *
 * TypeScript port of crates/jlpt-mcp/src/deinflect.rs (TASK-23.27) — same
 * rule order, same reasons, same row tables. The drills are offline-first
 * surfaces (listen-type / conjugate), so the table lives in the bundle
 * instead of behind the sidecar; `deinflect-parity.test.ts` runs the same
 * cases against both implementations' documented outputs to catch drift.
 *
 * A port note (not a deviation): the Rust `godan_e_potential` engine-side
 * generator is NOT ported — it exists there to corpus-gate 買える-class
 * bare-る potentials against dictionary ichidan forms. On the desktop the
 * CALLER does that gate against the drill's known target word instead
 * (`matchTarget` below takes the answer as an argument), which is a
 * strictly stronger check.
 *
 * MIT-clean: implemented independently (10ten-style morphology); tentoku's
 * GPL port deliberately not consulted (doc-8 §6.3 license note).
 */

export interface Deinflection {
  /** Candidate dictionary form (kanji or kana, matching the query script). */
  form: string;
  /** Human-readable reason (PolitePast, …) — shown on deinflected matches. */
  reason: string;
  /** Corpus POS the dictionary form must carry: "verb" | "adjective". */
  requiredPos: "verb" | "adjective";
}

/** Godan i-row: renyōkei last kana → dictionary last kana (買いました → 買う). */
const GODAN_U_ROW: ReadonlyArray<readonly [string, string]> = [
  ["い", "う"],
  ["き", "く"],
  ["ぎ", "ぐ"],
  ["し", "す"],
  ["ち", "つ"],
  ["に", "ぬ"],
  ["び", "ぶ"],
  ["み", "む"],
  ["り", "る"],
];

/** Godan e-row: potential stem last kana → dictionary (買える → 買う). */
const GODAN_E_ROW: ReadonlyArray<readonly [string, string]> = [
  ["え", "う"],
  ["け", "く"],
  ["げ", "ぐ"],
  ["せ", "す"],
  ["て", "つ"],
  ["ね", "ぬ"],
  ["べ", "ぶ"],
  ["め", "む"],
  ["れ", "る"],
];

/** Onbin tail → possible renyōkei stem tails (飲んだ → 飲み, 行った → 行き). */
const ONBIN_TAILS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["ん", ["に", "び", "み"]],
  ["っ", ["き", "ち", "り", "い"]],
];

/** Irregular stems → dictionary forms (します → する, 来ました → くる). */
const IRREGULAR: ReadonlyArray<readonly [string, string]> = [
  ["し", "する"],
  ["さ", "する"],
  ["き", "くる"],
  ["こ", "くる"],
  // TASK-54: できる is する's potential — bare-form queries hit the
  // potential family (き is also くる's renyōkei, so the き→くる entry
  // must not shadow it; both candidates coexist and the caller
  // validates against the corpus/target).
  ["できる", "する"],
];

const VERB_POS = "verb" as const;
const ADJ_POS = "adjective" as const;

/** Godan a-row: negative stem last kana → dictionary last kana (行か → 行く). */
const GODAN_A_ROW: Record<string, string> = {
  か: "く",
  が: "ぐ",
  さ: "す",
  た: "つ",
  な: "ぬ",
  ば: "ぶ",
  ま: "む",
  ら: "る",
  わ: "う",
};

/** Godan o-row: volitional stem last kana → dictionary (行こ → 行く). */
const GODAN_O_ROW: Record<string, string> = {
  お: "う",
  こ: "く",
  ご: "ぐ",
  そ: "す",
  と: "つ",
  の: "ぬ",
  ぼ: "ぶ",
  も: "む",
  よ: "う",
  ろ: "る",
};

const applyGodanRow = (
  row: ReadonlyArray<readonly [string, string]>,
  stem: string
): string | null => {
  const last = [...stem].at(-1);
  if (last === undefined) {
    return null;
  }
  const match = row.find(([stemKana]) => stemKana === last);
  return match ? [...stem].slice(0, -1).join("") + match[1] : null;
};

const godanDictionary = (stem: string): string | null =>
  applyGodanRow(GODAN_U_ROW, stem);

/* Bare-godan potential, e-row dictionary restoration, and the u-row
 * rewrite from an e-row stem are the same GODAN_E_ROW mapping
 * (行け → 行く). */
const godanEDictionary = (stem: string): string | null =>
  applyGodanRow(GODAN_E_ROW, stem);

const ichidanDictionary = (stem: string): string => `${stem}る`;

/** Past/te stem expansion: the stem as-is plus onbin restorations. */
const pastStemCandidates = (stem: string): string[] => {
  const out = [stem];
  for (const [tail, restores] of ONBIN_TAILS) {
    if (stem.endsWith(tail)) {
      const prefix = [...stem].slice(0, -1).join("");
      for (const restore of restores) {
        out.push(prefix + restore);
      }
    }
  }
  return out;
};

/** Dedup-append closure over a family's candidate list. */
const makePush =
  (out: Deinflection[]) =>
  (form: string, reason: string, requiredPos: "verb" | "adjective"): void => {
    if (form !== "" && !out.some((c) => c.form === form)) {
      out.push({ form, reason, requiredPos });
    }
  };

/** Godan a-row restoration for a negative stem (行か → 行く). */
const pushGodanARow = (
  stem: string,
  reason: string,
  push: (
    form: string,
    reason: string,
    requiredPos: "verb" | "adjective"
  ) => void
): void => {
  const last = [...stem].at(-1);
  if (last !== undefined && last in GODAN_A_ROW) {
    push([...stem].slice(0, -1).join("") + GODAN_A_ROW[last], reason, VERB_POS);
  }
};

/** Dictionary candidates for a 〜ない verb stem (行か → 行く, 食べ → 食べる). */
const pushNegativeStemCandidates = (
  stem: string,
  push: (
    form: string,
    reason: string,
    requiredPos: "verb" | "adjective"
  ) => void
): void => {
  pushGodanARow(stem, "Negative", push);
  push(ichidanDictionary(stem), "Negative", VERB_POS);
  for (const [irrStem, dict] of IRREGULAR) {
    if (stem.endsWith(irrStem)) {
      push(dict, "Negative", VERB_POS);
    }
  }
};

/** Polite/negative stem → candidates (godan i-row, ichidan, irregular). */
const pushDeinflectStem = (
  stem: string,
  reason: string,
  out: Deinflection[]
): void => {
  const push = (form: string): void => {
    if (form !== "" && !out.some((c) => c.form === form)) {
      out.push({ form, reason, requiredPos: VERB_POS });
    }
  };
  const godan = godanDictionary(stem);
  if (godan !== null) {
    push(godan);
  }
  push(ichidanDictionary(stem));
  for (const [irrStem, dict] of IRREGULAR) {
    if (stem.endsWith(irrStem)) {
      push(dict);
    }
  }
};

/**
 * All deinflection candidates for `query`, most-likely first. Empty when
 * the query does not end in a known inflection — callers treat that as "no
 * retry available" and fall back to exact comparison.
 */
/** TASK-54: verb past-negative candidates — 行かなかった = negative stem
 * 行か + なかった (godan a-row か→く → 行く); 食べなかった = ichidan stem
 * 食べ; しなかった → する (irregular). The old code early-returned after
 * the adjective check, leaving verb forms with zero candidates (correct
 * input graded Again(1)). Same candidate shapes as the 〜ない verb branch. */
const pushPastNegativeVerbCandidates = (
  stem: string,
  push: (
    form: string,
    reason: string,
    requiredPos: "verb" | "adjective"
  ) => void
): void => {
  pushGodanARow(stem, "PastNegative", push);
  for (const [irrStem, dict] of IRREGULAR) {
    if (stem === irrStem) {
      push(dict, "PastNegative", VERB_POS);
    }
  }
  push(ichidanDictionary(stem), "PastNegative", VERB_POS);
};

const tryAdjectiveFamilies = (query: string, out: Deinflection[]): boolean => {
  const push = makePush(out);
  // Negative adjective (longest first so 〜なかった never leaks into the
  // 〜た/〜だ verb rules and 〜くない never into 〜ない).
  if (query.endsWith("なかった")) {
    const pastNegStem = query.slice(0, -"なかった".length);
    // ku-form stem 寒く → dictionary 寒い (the 〜ない/〜かった family
    // attaches to the ku-form, not the dictionary form).
    if (pastNegStem.endsWith("く")) {
      push(`${pastNegStem.slice(0, -1)}い`, "AdjectivePastNegative", ADJ_POS);
    }
    // TASK-54: verb past-negative — 行かなかった = negative stem 行か +
    // なかった (godan a-row か→く → 行く); 食べなかった = ichidan stem 食べ
    // + なかった; しなかった → する (irregular). The old code early-returned
    // after the adjective check, leaving verb forms with zero candidates
    // (correct input graded Again(1)). Same candidate shapes as the 〜ない
    // verb branch below.
    pushPastNegativeVerbCandidates(pastNegStem, push);
    return true;
  }
  if (query.endsWith("くない")) {
    // くない already contains the ku-form's く (高くない → stem 高):
    // dictionary = stem + い.
    push(`${query.slice(0, -"くない".length)}い`, "Negative", ADJ_POS);
    return true;
  }
  // Adjective conditional/past before the verb 〜れば/〜た families.
  if (query.endsWith("ければ")) {
    push(`${query.slice(0, -"ければ".length)}い`, "Conditional", ADJ_POS);
    return true;
  }
  if (query.endsWith("かった")) {
    const kattaStem = query.slice(0, -"かった".length);
    if (kattaStem.endsWith("た")) {
      // 〜たかった = want-to past (行きたかった): the pre-かった stem ends
      // in the want-to た (行きた) — strip it → the want-to stem 行き.
      const wantStem = kattaStem.slice(0, -1);
      const godan = godanDictionary(wantStem);
      if (godan !== null) {
        push(godan, "WantToPast", VERB_POS);
      }
      push(ichidanDictionary(wantStem), "WantToPast", VERB_POS);
      return true;
    }
    // かった already contains the ku-form's く (高かった → stem 高):
    // dictionary = stem + い.
    push(`${kattaStem}い`, "AdjectivePast", ADJ_POS);
    return true;
  }
  if (query.endsWith("です")) {
    push(query.slice(0, -"です".length), "Polite", ADJ_POS);
    return true;
  }
  return false;
};

const tryPoliteVerbFamilies = (query: string, out: Deinflection[]): boolean => {
  // Polite negative (past) before polite past: ませんでした/ません end in
  // the negative stem (飲みませんでした → 飲み → 飲む). Polite past before
  // plain past (ました ends in した and 〜た).
  const polNegPastStem = query.endsWith("ませんでした")
    ? query.slice(0, -"ませんでした".length)
    : null;
  if (polNegPastStem !== null) {
    pushDeinflectStem(polNegPastStem, "PoliteNegativePast", out);
    return true;
  }
  const polNegStem = query.endsWith("ません")
    ? query.slice(0, -"ません".length)
    : null;
  if (polNegStem !== null) {
    pushDeinflectStem(polNegStem, "PoliteNegative", out);
    return true;
  }
  const polPastStem = query.endsWith("ました")
    ? query.slice(0, -"ました".length)
    : null;
  if (polPastStem !== null) {
    pushDeinflectStem(polPastStem, "PolitePast", out);
    return true;
  }
  const masuStem = query.endsWith("ます")
    ? query.slice(0, -"ます".length)
    : null;
  if (masuStem !== null) {
    // The stem may itself be an e-row potential form (泳げます → 泳げ →
    // 泳ぐ), so try the e-row map in addition to the i-row.
    const godan = godanDictionary(masuStem);
    if (godan !== null) {
      pushDeinflectStem(masuStem, "Polite", out);
      out.unshift({
        form: godan,
        reason: "Polite",
        requiredPos: VERB_POS,
      });
    }
    const godanE = godanEDictionary(masuStem);
    if (godanE !== null && !out.some((c) => c.form === godanE)) {
      out.push({
        form: godanE,
        reason: "PolitePotential",
        requiredPos: VERB_POS,
      });
    }
    pushDeinflectStem(masuStem, "Polite", out);
    return true;
  }
  return false;
};

const tryAuxiliaryVerbFamilies = (
  query: string,
  out: Deinflection[]
): boolean => {
  const push = makePush(out);

  // Causative/passive before potential before plain past (せる/られる end
  // in る but not た; ordering still matters vs the bare-る forms below).
  const rareruStem = query.endsWith("られる")
    ? query.slice(0, -"られる".length)
    : null;
  if (rareruStem !== null) {
    push(ichidanDictionary(rareruStem), "PassivePotential", VERB_POS);
    const godanE = godanEDictionary(rareruStem);
    if (godanE !== null) {
      push(godanE, "PassivePotential", VERB_POS);
    }
    return true;
  }
  const saseruStem = query.endsWith("させる")
    ? query.slice(0, -"させる".length)
    : null;
  if (saseruStem !== null) {
    push(ichidanDictionary(saseruStem), "Causative", VERB_POS);
    pushGodanARow(saseruStem, "Causative", push);
    return true;
  }
  return false;
};

/** Emit dictionary candidates for one past/te stem (godan + ichidan + irregular). */
const pushPastStemCandidates = (
  stem: string,
  reason: string,
  push: (
    form: string,
    reason: string,
    requiredPos: "verb" | "adjective"
  ) => void
): void => {
  const godan = godanDictionary(stem);
  if (godan !== null) {
    push(godan, reason, VERB_POS);
  }
  push(ichidanDictionary(stem), reason, VERB_POS);
  for (const [irrStem, dict] of IRREGULAR) {
    if (stem.endsWith(irrStem)) {
      push(dict, reason, VERB_POS);
    }
  }
};

/** で-restoration: voiced onbin i-tail → ぎ/び/み renyōkei candidates. */
const voicedRestores = (stem: string): string[] => {
  if (!stem.endsWith("い")) {
    return [];
  }
  const prefix = [...stem].slice(0, -1).join("");
  return ["ぎ", "び", "み"].map((restore) => prefix + restore);
};

const tryPastTeFamilies = (query: string, out: Deinflection[]): boolean => {
  const push = makePush(out);

  // Plain verb past / te / negative families.
  for (const [suffix, reason] of [
    ["た", "Past"],
    ["だ", "Past"],
  ] as const) {
    if (query.endsWith(suffix)) {
      const stem = query.slice(0, -1);
      for (const stemCandidate of pastStemCandidates(stem)) {
        pushPastStemCandidates(stemCandidate, reason, push);
      }
      return true;
    }
  }
  for (const [suffix, reason] of [
    ["て", "Te"],
    ["で", "Te"],
  ] as const) {
    if (query.endsWith(suffix)) {
      const stem = query.slice(0, -1);
      const stems =
        suffix === "で"
          ? [...pastStemCandidates(stem), ...voicedRestores(stem)]
          : pastStemCandidates(stem);
      for (const stemCandidate of stems) {
        pushPastStemCandidates(stemCandidate, reason, push);
      }
      return true;
    }
  }
  return false;
};

const tryNegativeConditionalFamilies = (
  query: string,
  out: Deinflection[]
): boolean => {
  const push = makePush(out);

  if (query.endsWith("ない")) {
    pushNegativeStemCandidates(query.slice(0, -"ない".length), push);
    return true;
  }
  if (query.endsWith("れば")) {
    const rebaStem = query.slice(0, -"れば".length);
    push(ichidanDictionary(rebaStem), "Conditional", VERB_POS);
    for (const [irrStem, dict] of IRREGULAR) {
      if (rebaStem.endsWith(irrStem)) {
        push(dict, "Conditional", VERB_POS);
      }
    }
    return true;
  }
  return false;
};

/** TASK-54: potential/causative candidates — れる (passive/potential),
 * せる (causative), the bare godan potential 行ける/買える (e-row kana +
 * る, no れ — ambiguous with ichidan dictionary forms, so push BOTH the
 * ichidan dictionary and the godan u-row restoration; over-generation is
 * safe — matchTarget compares against the known target with identity
 * candidates skipped, and the search engine validates against the
 * corpus), and できる → する. Returns true when this family claimed the
 * query. */
const pushPotentialCausativeCandidates = (
  query: string,
  push: (
    form: string,
    reason: string,
    requiredPos: "verb" | "adjective"
  ) => void
): boolean => {
  if (query === "できる") {
    push("する", "Potential", VERB_POS);
    return true;
  }
  for (const [suffix, reason] of [
    ["れる", "Potential"],
    ["せる", "Causative"],
  ] as const) {
    if (query.endsWith(suffix)) {
      const stem = query.slice(0, -suffix.length);
      push(ichidanDictionary(stem), reason, VERB_POS);
      const godanE = godanEDictionary(stem);
      if (godanE !== null) {
        push(godanE, reason, VERB_POS);
      }
      return true;
    }
  }
  if (query.endsWith("る")) {
    const prev = [...query].at(-2);
    if (prev !== undefined && GODAN_E_ROW.some(([eKana]) => eKana === prev)) {
      const stem = query.slice(0, -"る".length);
      push(ichidanDictionary(stem), "Potential", VERB_POS);
      const godanU = godanEDictionary(stem);
      if (godanU !== null) {
        push(godanU, "Potential", VERB_POS);
      }
      return true;
    }
  }
  return false;
};

const tryVolitionalWantToFamilies = (
  query: string,
  out: Deinflection[]
): boolean => {
  const push = makePush(out);

  // Volitional: 〜よう (ichidan/食べよう) + general o-row + う (行こう/
  // 買おう/飲もう), with しよう → する irregular.
  if (query.endsWith("う")) {
    const stem = query.slice(0, -1);
    const oKana = [...stem].at(-1);
    if (oKana !== undefined && oKana in GODAN_O_ROW) {
      const root = [...stem].slice(0, -1).join("");
      push(root + GODAN_O_ROW[oKana], "Volitional", VERB_POS);
      // ichidan: 食べよう → stem 食べよ → root 食べ → 食べる.
      push(ichidanDictionary(root), "Volitional", VERB_POS);
      // しよう → する.
      if (root === "し") {
        push("する", "Volitional", VERB_POS);
      }
      return true;
    }
  }
  for (const [suffix, reason] of [
    ["たく", "WantToStem"],
    ["たい", "WantTo"],
  ] as const) {
    if (query.endsWith(suffix)) {
      push(ichidanDictionary(query.slice(0, -suffix.length)), reason, VERB_POS);
      return true;
    }
  }
  // (れる/せる forms are handled by pushPotentialCausativeCandidates
  // below — the old duplicate loop here produced identical candidates.)
  pushPotentialCausativeCandidates(query, push);
  return false;
};

/**
 * All deinflection candidates for `query`, most-likely first. Empty when the
 * query does not end in a known inflection — callers treat that as "no retry
 * available" and fall back to exact comparison. Rule order (longest suffix
 * first, first family wins) mirrors crates/jlpt-mcp/src/deinflect.rs.
 */
export const deinflect = (query: string): Deinflection[] => {
  const out: Deinflection[] = [];
  if (tryAdjectiveFamilies(query, out)) {
    return out;
  }
  if (tryPoliteVerbFamilies(query, out)) {
    return out;
  }
  if (tryAuxiliaryVerbFamilies(query, out)) {
    return out;
  }
  if (tryPastTeFamilies(query, out)) {
    return out;
  }
  if (tryNegativeConditionalFamilies(query, out)) {
    return out;
  }
  tryVolitionalWantToFamilies(query, out);
  return out;
};

/**
 * TASK-36 AC2: character-level similarity % for the "yours matched N%"
 * reveal on wrong Listen & Type answers. Small-edit-distance based so a
 * one-kana slip (ください vs ください) reads as "close", while a wrong
 * word reads as near-0. Exported for the reveal UI, not used in grading.
 */
export const similarityPercent = (target: string, input: string): number => {
  const a = target.trim();
  const b = input.trim();
  if (a.length === 0 && b.length === 0) {
    return 100;
  }
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  // Levenshtein distance, two-row rolling buffer (kana strings are short).
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost
      );
    }
    prev = curr;
  }
  const distance = prev[b.length] ?? Math.max(a.length, b.length);
  return Math.round((1 - distance / Math.max(a.length, b.length)) * 100);
};

export type MatchResult =
  | { kind: "exact" }
  | { kind: "deinflected"; reason: string; dictionaryForm: string }
  | { kind: "wrong" };

/**
 * Grade a typed answer against the known target using the rule table.
 * - exact: the input IS the target (trim-equal).
 * - deinflected: input deinflects to a candidate that equals the target —
 *   correct answer in an inflected form; the UI shows the reason and the
 *   dictionary form.
 * - wrong: no rule fires or no candidate matches the target.
 */
export const matchTarget = (target: string, input: string): MatchResult => {
  const trimmed = input.trim();
  if (trimmed === target.trim()) {
    return { kind: "exact" };
  }
  for (const candidate of deinflect(trimmed)) {
    // TASK-54: identity candidates (bare-potential pushes the input's own
    // dictionary form — 食べる → 食べる) must not grade as "deinflected";
    // an answer identical to its own deinflection is not an inflection.
    if (candidate.form === trimmed) {
      continue;
    }
    if (candidate.form === target.trim()) {
      return {
        dictionaryForm: candidate.form,
        kind: "deinflected",
        reason: candidate.reason,
      };
    }
  }
  return { kind: "wrong" };
};

/**
 * TASK-54 shared sweep: 5 verbs × 6 inflections — the parity contract with
 * crates/jlpt-mcp/src/deinflect.rs. Every row must deinflect back to its
 * target (or exact-match); a row returning "wrong" is a coverage gap in
 * either implementation. Kept as exported data so both TS tests and the
 * Rust test can assert against the same table.
 */
export const CONJUGATION_SWEEP: ReadonlyArray<
  readonly [target: string, forms: readonly string[]]
> = [
  [
    "食べる",
    ["食べます", "食べた", "食べて", "食べない", "食べなかった", "食べられる"],
  ],
  [
    "行く",
    ["行きます", "行った", "行って", "行かない", "行かなかった", "行ける"],
  ],
  ["見る", ["見ます", "見た", "見て", "見ない", "見なかった", "見られる"]],
  ["する", ["します", "した", "して", "しない", "しなかった", "できる"]],
  ["来る", ["来ます", "来た", "来て", "来ない", "来なかった", "来られる"]],
];
