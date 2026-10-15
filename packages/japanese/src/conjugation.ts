/*
 * Verb conjugation engine - the shared form table.
 *
 * MOVED HERE from apps/desktop/src/lib/conjugate.ts (TASK-145), which was the
 * only place it lived and the reason the sidecar could not reach it. The split
 * is clean because the table is pure: the desktop module's ONE dependency,
 * `deinflect`, is used by `verifyDetailed` alone (the TASK-23.29 grading path),
 * which stayed behind. So this file is the engine and the desktop file is now
 * the grading wrapper.
 *
 * Six forms, one classifier, table-driven:
 *   te/ta: onbin per row (食べて / 飲んで / 書いて / 行って)
 *   masen: i-row + ません (飲みません)
 *   nai/tai: a-row / i-row (飲まない, 飲みたい; う→わ: 会わない)
 *   potential: e-row + る (飲める); ichidan + られる (食べられる)
 *   irregulars: する (して/べんきょうできる), 来る (きて/こない),
 *               行く (行って · te/ta only, the rest is regular く-godan)
 *
 * WHY IT IS HERE AND NOT ONLY IN THE UI (TASK-145 AC#3): doc-21 §9.1 calls
 * distractor family 3 - "same rule, wrong application" - the family a POS or
 * tag filter cannot produce, because its members share a lemma and differ only
 * in application. `wrongRuleVariant` and `choiceOptions` below already compute
 * exactly that (飲ません for a godan, 食べって for an ichidan, はいて for
 * はいって), and they compute it correctly and for free. Asking a model to
 * produce inflections a table already has would buy variance and latency in
 * exchange for nothing, so the table serves the exam path and the model is
 * left the work the table cannot do - see doc-21 §9.1.
 *
 * `choiceOptions` shuffles with Math.random() unless `deterministic: true`.
 * The exam path passes deterministic and lets the paper's own seeded shuffle
 * own the presentation order, so a paper replays identically.
 */

/*
 * Verb conjugation engine (N5/N4 spec, SCR-06 redesign 2026-09-13).
 *
 * Six forms, one classifier, table-driven:
 *   te/ta: onbin per row (食べて / 飲んで / 書いて / 行って)
 *   masen: i-row + ません (飲みません)
 *   nai/tai: a-row / i-row (飲まない, 飲みたい; う→わ: 会わない)
 *   potential: e-row + る (飲める); ichidan + られる (食べられる)
 *   irregulars: する (して/べんきょうできる), 来る (きて/こない),
 *               行く (行って · te/ta only, the rest is regular く-godan)
 *
 * The UI validates free input against `conjugate(verb, form)`; a
 * right-verb-wrong-form answer deinflects to a hint (TASK-23.29), never a
 * silent pass. classify() keeps its TASK-23.29 contract.
 */

export type ConjugationKind =
  | "ichidan"
  | "godan-mu"
  | "godan-u"
  | "godan-tsu"
  | "godan-ru"
  | "godan-ku"
  | "godan-sasu"
  | "godan-hugu"
  | "godan-bumapu"
  | "irregular-iku"
  | "irregular-kuru"
  | "irregular-suru";

export type FormId = "te" | "ta" | "masen" | "nai" | "tai" | "potential";

export const FORM_IDS: readonly FormId[] = [
  "te",
  "ta",
  "masen",
  "nai",
  "tai",
  "potential",
];

/** What each form is called on the UI chips. */
export const FORM_LABELS: Record<FormId, string> = {
  masen: "ません",
  nai: "ない",
  potential: "れる",
  ta: "た",
  tai: "たい",
  te: "て",
};

interface StrokeMap {
  reason: string;
  /** The te-form ending: replaces the dictionary tail (ichidan/irregular)
   * or follows the godan stem's changed last kana. */
  te: string;
}

const GODAN_MAP: Record<ConjugationKind, StrokeMap> = {
  "godan-bumapu": { reason: "ぬ/む/ぶ/ぷ → んで", te: "んで" },
  "godan-hugu": { reason: "ふ/ぐ → いで", te: "いで" },
  "godan-ku": { reason: "く → いて", te: "いて" },
  "godan-mu": { reason: "む → んで", te: "んで" },
  "godan-ru": { reason: "る → って", te: "って" },
  "godan-sasu": { reason: "す → して", te: "して" },
  "godan-tsu": { reason: "つ → って", te: "って" },
  "godan-u": { reason: "う → って", te: "って" },
  ichidan: { reason: "る-verb: drop る, add て", te: "て" },
  "irregular-iku": {
    reason: "行く is the exception: 行って (not 行いて)",
    te: "って",
  },
  "irregular-kuru": { reason: "来る → 来て (ki-te)", te: "て" },
  "irregular-suru": { reason: "する → して", te: "て" },
};

/* Godan vowel rows keyed by the dictionary-form last kana. */
const I_ROW: Record<string, string> = {
  う: "い",
  く: "き",
  ぐ: "ぎ",
  す: "し",
  つ: "ち",
  ぬ: "に",
  ぶ: "び",
  ぷ: "ぴ",
  む: "み",
  る: "り",
};
const A_ROW: Record<string, string> = {
  う: "わ",
  く: "か",
  ぐ: "が",
  す: "さ",
  つ: "た",
  ぬ: "な",
  ぶ: "ば",
  ぷ: "ぱ",
  む: "ま",
  る: "ら",
};
const E_ROW: Record<string, string> = {
  う: "え",
  く: "け",
  ぐ: "げ",
  す: "せ",
  つ: "て",
  ぬ: "ね",
  ぶ: "べ",
  ぷ: "ぺ",
  む: "め",
  る: "れ",
};

const shift = (row: Record<string, string>, kana: string): string =>
  row[kana] ?? kana;

/** る-verbs: every form is stem + a fixed ending. */
const ICHIDAN_ENDINGS: Record<FormId, string> = {
  masen: "ません",
  nai: "ない",
  potential: "られる",
  ta: "た",
  tai: "たい",
  te: "て",
};

/** 来る: the whole paradigm is irregular; kana output (the card shows 来る). */
const KURU_FORMS: Record<FormId, string> = {
  masen: "きません",
  nai: "こない",
  potential: "こられる",
  ta: "きた",
  tai: "きたい",
  te: "きて",
};

export interface VerbEntry {
  /** Surface form, e.g. 食べる */
  kanji: string;
  /** Conjugation kind */
  kind: ConjugationKind;
  /** Hiragana reading, e.g. たべる */
  reading: string;
  /** Stem in kana · what comes before the te-form ending */
  stem: string;
}

const ICHIDAN_RE = /[えけげねへべぺめれ][る]$/;
const SURU_RE = /する$/;
const GODAN_TSU_RE = /(つ)$/;
const GODAN_RU_RE = /(る)$/;
const GODAN_KU_RE = /(く)$/;
const GODAN_MU_RE = /(む)$/;
const GODAN_BUMAPU_RE = /(ぬ|む|ぶ|ぷ)$/;
const GODAN_HUGU_RE = /(ふ|ぐ)$/;
const GODAN_SASU_RE = /(す)$/;
const GODAN_U_RE = /(う)$/;

export const classify = (reading: string): VerbEntry | null => {
  const r = reading.trim();
  if (r === "いく" || r === "行く") {
    return {
      kanji: "行く",
      kind: "irregular-iku",
      reading: r,
      stem: "い",
    };
  }
  if (r === "くる" || r === "来る") {
    return {
      kanji: "来る",
      kind: "irregular-kuru",
      reading: r,
      stem: "き",
    };
  }
  if (SURU_RE.test(r)) {
    // 勉強する: stem べんきょうし (drop する, add し); kanji keeps the
    // full surface so the card shows a real word.
    return {
      kanji: r,
      kind: "irregular-suru",
      reading: r,
      stem: `${r.slice(0, -2)}し`,
    };
  }
  if (ICHIDAN_RE.test(r)) {
    return {
      kanji: r,
      kind: "ichidan",
      reading: r,
      stem: r.slice(0, -1),
    };
  }
  const godan = (kind: ConjugationKind): VerbEntry => ({
    kanji: r,
    kind,
    reading: r,
    stem: r.slice(0, -1),
  });
  if (GODAN_TSU_RE.test(r)) {
    return godan("godan-tsu");
  }
  if (GODAN_RU_RE.test(r)) {
    return godan("godan-ru");
  }
  if (GODAN_KU_RE.test(r)) {
    return godan("godan-ku");
  }
  if (GODAN_MU_RE.test(r)) {
    return godan("godan-mu");
  }
  if (GODAN_BUMAPU_RE.test(r)) {
    return godan("godan-bumapu");
  }
  if (GODAN_HUGU_RE.test(r)) {
    return godan("godan-hugu");
  }
  if (GODAN_SASU_RE.test(r)) {
    return godan("godan-sasu");
  }
  if (GODAN_U_RE.test(r)) {
    return godan("godan-u");
  }
  return null;
};

/** The te-form (kept as the SCR-06 primary path). */
export const toTeForm = (verb: VerbEntry): string =>
  verb.stem + GODAN_MAP[verb.kind].te;

const taFromTe = (te: string): string =>
  te.endsWith("で") ? `${te.slice(0, -1)}だ` : `${te.slice(0, -1)}た`;

/** う-verbs: te/ta from the onbin table, the rest from vowel rows. 行く
 * rides this path too (its GODAN_MAP te is って, the exception baked in). */
const godanForm = (verb: VerbEntry, form: FormId): string => {
  const last = verb.reading.slice(-1);
  switch (form) {
    case "te":
      return toTeForm(verb);
    case "ta":
      return taFromTe(toTeForm(verb));
    case "masen":
      return `${verb.stem}${shift(I_ROW, last)}ません`;
    case "nai":
      return `${verb.stem}${shift(A_ROW, last)}ない`;
    case "tai":
      return `${verb.stem}${shift(I_ROW, last)}たい`;
    case "potential":
      return `${verb.stem}${shift(E_ROW, last)}る`;
    default:
      return toTeForm(verb);
  }
};

/** する + compounds: only the する part moves; potential detaches it. */
const suruForm = (verb: VerbEntry, form: FormId): string => {
  switch (form) {
    case "te":
      return `${verb.stem}て`;
    case "ta":
      return `${verb.stem}た`;
    case "masen":
      return `${verb.stem}ません`;
    case "nai":
      return `${verb.stem}ない`;
    case "tai":
      return `${verb.stem}たい`;
    case "potential":
      // する → できる; 勉強する → 勉強できる (drop the し, keep the noun).
      return `${verb.stem.slice(0, -1)}できる`;
    default:
      return `${verb.stem}て`;
  }
};

/** Full form table for a verb. */
export const conjugate = (verb: VerbEntry, form: FormId): string => {
  switch (verb.kind) {
    case "ichidan":
      return verb.stem + ICHIDAN_ENDINGS[form];
    case "irregular-kuru":
      return KURU_FORMS[form];
    case "irregular-suru":
      return suruForm(verb, form);
    default:
      return godanForm(verb, form);
  }
};

export const verifyForm = (
  verb: VerbEntry | null,
  form: FormId,
  input: string
): boolean => verb !== null && input.trim() === conjugate(verb, form);

/* ── multiple choice (Bunpro convention) ──────────────────────── */

/** English gloss of a form, for the choice hover ("doesn't enter"). */
const FORM_GLOSS: Record<FormId, string> = {
  masen: "doesn't",
  nai: "don't",
  potential: "can",
  ta: "did",
  tai: "want to",
  te: "(–ing / then)",
};

const TO_PREFIX = /^to\s+/i;

/** "doesn't enter" · FORM_GLOSS + the deck gloss with its "to" stripped. */
export const formGloss = (form: FormId, gloss: string): string => {
  const bare = gloss.replace(TO_PREFIX, "");
  return `${FORM_GLOSS[form]} ${bare}`;
};

const shuffle = <T>(arr: readonly T[]): T[] => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) {
      continue;
    }
    out[i] = b;
    out[j] = a;
  }
  return out;
};

/** A te-ending from the same table that is NOT this verb's own. */
const wrongTeEnding = (verb: VerbEntry): string | null => {
  const own = GODAN_MAP[verb.kind].te;
  const candidates = ["って", "いて", "んで", "して", "いで", "て"];
  return candidates.find((te) => te !== own) ?? null;
};

/**
 * The classic wrong rule for this verb+form · the error a learner
 * actually makes, not a random string: ichidan conjugated like godan
 * (食べって, 食べれる), godan conjugated like ichidan (飲ません), the
 * wrong onbin row (はいて for はいって), the a-row instead of the i-row
 * for たい (飲またい). Null when no pedagogical variant applies.
 */
export const wrongRuleVariant = (
  verb: VerbEntry,
  form: FormId
): string | null => {
  const { stem, kind, reading } = verb;
  const last = reading.slice(-1);
  const ichidan = kind === "ichidan";
  switch (form) {
    case "te": {
      if (ichidan) {
        return `${stem}って`;
      }
      const wrong = wrongTeEnding(verb);
      return wrong === null ? null : stem + wrong;
    }
    case "ta": {
      const te = wrongRuleVariant(verb, "te");
      return te === null ? null : taFromTe(te);
    }
    case "masen":
      return ichidan ? `${stem}りません` : `${stem}ません`;
    case "nai":
      return ichidan ? `${stem}りない` : `${stem}ない`;
    case "tai":
      return ichidan ? `${stem}りたい` : `${stem}${shift(A_ROW, last)}たい`;
    case "potential":
      // 食べれる is the famous error; godan has no wrong variant worth
      // offering (飲られる is valid Japanese), so other forms fill in.
      return ichidan ? `${stem}れる` : null;
    default:
      return null;
  }
};

/**
 * 4 choices: the correct form, then the wrong-rule variant (the teaching
 * distractor), then other forms of the SAME verb for form discrimination.
 * Never duplicates, never a distractor equal to the answer.
 */
export const choiceOptions = (
  verb: VerbEntry,
  form: FormId,
  options: { deterministic?: boolean } = {}
): string[] => {
  const correct = conjugate(verb, form);
  const pool: string[] = [];
  const near = wrongRuleVariant(verb, form);
  if (near !== null && near !== correct) {
    pool.push(near);
  }
  for (const f of FORM_IDS) {
    if (pool.length >= 3) {
      break;
    }
    const alt = conjugate(verb, f);
    if (alt !== correct && !pool.includes(alt)) {
      pool.push(alt);
    }
  }
  const four = [correct, ...pool.slice(0, 3)];
  return options.deterministic ? four : shuffle(four);
};

export const patternExplanation = (verb: VerbEntry): string =>
  GODAN_MAP[verb.kind].reason;
