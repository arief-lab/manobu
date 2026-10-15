/*
 * Romaji → hiragana conversion (N5 base set + digraphs).
 * Used by SCR-04 Listen & Type. The input is ASCII; we translate
 * one-or-two-letter chunks into the matching kana. Anything that
 * doesn't match stays ASCII so the caller can flag "still romaji"
 * (spec §SCR-04 MJKZg).
 */

const BASIC: Record<string, string> = {
  a: "あ",
  ba: "ば",
  be: "べ",
  bi: "び",
  bo: "ぼ",
  bu: "ぶ",
  bya: "びゃ",
  byo: "びょ",
  byu: "びゅ",
  cha: "ちゃ",
  chi: "ち",
  cho: "ちょ",
  chu: "ちゅ",
  da: "だ",
  de: "で",
  di: "ぢ",
  do: "ど",
  du: "づ",
  e: "え",
  fu: "ふ",
  ga: "が",
  ge: "げ",
  gi: "ぎ",
  go: "ご",
  gu: "ぐ",
  gya: "ぎゃ",
  gyo: "ぎょ",
  gyu: "ぎゅ",
  ha: "は",
  he: "へ",
  hi: "ひ",
  ho: "ほ",
  hya: "ひゃ",
  hyo: "ひょ",
  hyu: "ひゅ",
  i: "い",
  ja: "じゃ",
  ji: "じ",
  jo: "じょ",
  ju: "じゅ",
  ka: "か",
  ke: "け",
  ki: "き",
  ko: "こ",
  ku: "く",
  kya: "きゃ",
  kyo: "きょ",
  kyu: "きゅ",
  ma: "ま",
  me: "め",
  mi: "み",
  mo: "も",
  mu: "む",
  mya: "みゃ",
  myo: "みょ",
  myu: "みゅ",
  n: "ん",
  na: "な",
  ne: "ね",
  ni: "に",
  no: "の",
  nu: "ぬ",
  nya: "にゃ",
  nyo: "にょ",
  nyu: "にゅ",
  o: "お",
  pa: "ぱ",
  pe: "ぺ",
  pi: "ぴ",
  po: "ぽ",
  pu: "ぷ",
  pya: "ぴゃ",
  pyo: "ぴょ",
  pyu: "ぴゅ",
  ra: "ら",
  re: "れ",
  ri: "り",
  ro: "ろ",
  ru: "る",
  rya: "りゃ",
  ryo: "りょ",
  ryu: "りゅ",
  sa: "さ",
  se: "せ",
  sha: "しゃ",
  shi: "し",
  sho: "しょ",
  shu: "しゅ",
  so: "そ",
  su: "す",
  ta: "た",
  te: "て",
  to: "と",
  tsu: "つ",
  u: "う",
  wa: "わ",
  wo: "を",
  ya: "や",
  yo: "よ",
  yu: "ゆ",
  za: "ざ",
  ze: "ぜ",
  zo: "ぞ",
  zu: "ず",
};

// 2-letter digraphs (ka/ki/ku/...) plus the 3-letter exceptions. Order:
// longest-first so `chi` beats `chi`'s single-letter prefix attempts, and
// every 2-letter digraph is present.
// TASK-41: derived from BASIC keys (length ≥2, longest first) instead of a
// hand-written list — the list was missing the entire b/d/g/p columns
// (ba,be,bo, de,do, ga,go, pa,pi…), so romajiToKana('be') returned 'be'
// raw and words like たべる could never be typed as romaji (Next stayed
// disabled: isStillRomaji). BASIC remains the single source of truth.
const DIGRAPHS = Object.keys(BASIC)
  .filter((k) => k.length >= 2)
  .sort((a, b) => b.length - a.length);

const VOWEL_RE = /[aeiou]/;

/**
 * Convert ASCII romaji to hiragana. Doubled consonants become っ (いった
 * = "itta", あって = "atte"); "nn" → ん. Anything that doesn't match is
 * passed through so callers can prompt the user to keep typing.
 */
export const romajiToKana = (input: string): string => {
  const lower = input.toLowerCase();
  let out = "";
  let i = 0;
  while (i < lower.length) {
    const pair = pairRule(lower.slice(i, i + 2));
    if (pair !== null) {
      out += pair[0];
      i += pair[1];
      continue;
    }
    const hit = matchAt(lower, i);
    if (hit !== null) {
      out += hit[0];
      i += hit[1];
      continue;
    }
    // TASK-41: pass non-romaji characters through (kana, spaces, punctuation)
    // instead of bailing — the old early-return made every keystroke after
    // the first converted kana unconvertible ('た' + 'beru' stayed mixed).
    out += lower.slice(i, i + 1);
    i += 1;
  }
  return out;
};

/** The two pair-level rules: nn → ん (consumes 2), sokuon → っ (consumes 1). */
const pairRule = (pair: string): readonly [string, number] | null => {
  if (pair === "nn") {
    return ["ん", 2];
  }
  const doubled =
    pair.length === 2 && pair[0] === pair[1] && !VOWEL_RE.test(pair[0]);
  return doubled ? ["っ", 1] : null;
};

/** Longest-first digraph match, then the single-char basic map. */
const matchAt = (
  lower: string,
  i: number
): readonly [string, number] | null => {
  for (const d of DIGRAPHS) {
    const slice = lower.slice(i, i + d.length);
    if (slice === d && BASIC[slice]) {
      return [BASIC[slice], d.length];
    }
  }
  const one = lower.slice(i, i + 1);
  return BASIC[one] ? [BASIC[one], 1] : null;
};

const ASCII_LETTER = /[a-z]/i;
const HIRAGANA_RANGE = /[\u3040-\u309f]/;
const KATAKANA_RANGE = /[\u30a0-\u30ff]/;

export const isStillRomaji = (input: string): boolean =>
  ASCII_LETTER.test(input);

export const isValidKana = (input: string): boolean => {
  // TASK-23.2.1: both scripts are valid — kana.json carries both.
  return (
    (HIRAGANA_RANGE.test(input) || KATAKANA_RANGE.test(input)) &&
    !isStillRomaji(input)
  );
};

/* ── kana → romaji (display direction) ─────────────────────────── */

/** Inverse of BASIC, longest key first (きゃ before き + ゃ). */
const KANA_TO_ROMAJI: [string, string][] = Object.entries(BASIC)
  .map(([romaji, kana]) => [kana, romaji] as [string, string])
  .sort((a, b) => b[0].length - a[0].length);

const SOKUON_ROMAJI_FIRST = /^[^aeiouyn]/;

/**
 * Convert hiragana to romaji for DISPLAY (choices, glosses) — never for
 * grading. Geminate っ doubles the next consonant (いって → itte); ん is
 * always "n" (no m-before-b/p refinement; display only). Unmapped
 * characters pass through.
 */
export const kanaToRomaji = (input: string): string => {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i] as string;
    if (ch === "っ") {
      const next = kanaToRomaji(input.slice(i + 1));
      out += SOKUON_ROMAJI_FIRST.test(next) ? next.charAt(0) : "t";
      i += 1;
      continue;
    }
    const hit = KANA_TO_ROMAJI.find(([kana]) => input.startsWith(kana, i));
    if (hit) {
      out += hit[1];
      i += hit[0].length;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
};
