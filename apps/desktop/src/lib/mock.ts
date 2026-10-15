/*
 * JLPT Mock (spec §SCR-10).
 *
 * Pure-TS helpers for the SCR-10 wizard:
 *   - `scoreQuestion(question, choiceId)` — did the user pick the right one?
 *   - `deriveWeakPatterns(mistakes, topN=3)` — top-N grammar patterns
 *     the user failed on, tie-broken by mistake count desc then pattern id.
 *   - `formatTimer(seconds)` — `mm:ss` for the real+pausable timer.
 *
 * Grammar patterns come from the server API (GET /grammar?level=<N5-N1>); it
 * reads the JSON files from disk and returns only what's requested.
 */

import type { JlptLevel } from "@manobu/api-contract";
import { env } from "@manobu/env/web";
import { orpc } from "./orpc";

export interface Question {
  choiceIds: readonly string[];
  choices: Readonly<Record<string, string>>;
  correctId: string;
  grammarId: string;
  id: string;
  prompt: string;
  /** Mock section for sectional scoring (TASK-23.7): defaults to "lang". */
  section?: SectionName;
}

export interface Mistake {
  grammarId: string;
  questionId: string;
  wrongChoiceId: string;
}

export interface WeakPattern {
  grammarId: string;
  pattern: string;
  total: number;
  wrong: number;
}

export interface MockResult {
  mistakes: readonly Mistake[];
  pct: number;
  score: number;
  total: number;
  weak: readonly WeakPattern[];
}

export const scoreQuestion = (
  question: Question,
  choiceId: string | null
): boolean => choiceId !== null && choiceId === question.correctId;

const serverOrigin = env.VITE_SERVER_URL ?? "";
const hasServer = serverOrigin.length > 0;

// Local fallback grammar data for tests and offline use.
// In production this comes from GET /grammar?level=<N5-N1>.
const LOCAL_GRAMMAR: Record<
  string,
  readonly { id: string; pattern: string }[]
> = {
  // TASK-23.27 (doc-4 §5): N3..N1 seeds non-empty — representative points
  // from the jkindrix corpus (packages/japanese/data/grammar/n*.json, served
  // via GET /api/grammar). The ids MUST match the corpus ids so
  // deriveWeakPatterns resolves real pattern labels offline. Full tables
  // (N1 150 / N2 149 / N3 130) come from the server; these are the offline
  // fallback, matching the n4/n5 precedent.
  n1: [
    { id: "ni-kataku-nai", pattern: "Noun / V dict + に難くない" },
    { id: "wo-motte", pattern: "Noun + をもって (by means of / as of)" },
  ],
  n2: [
    {
      id: "ni-atatte-occasion",
      pattern: "V plain non-past / noun + にあたって / にあたり",
    },
    { id: "ue-de-upon", pattern: "Noun の + 上で (upon / after doing)" },
  ],
  n3: [
    { id: "you-da-appearance", pattern: "Plain form + ようだ" },
    { id: "causative-passive", pattern: "Causative passive + られる" },
    { id: "noni-although", pattern: "Plain form + のに (although)" },
  ],
  n4: [
    { id: "n4-conditional-ba", pattern: "Verb-ば (conditional)" },
    { id: "n4-passive-form", pattern: "Verb-られる (passive)" },
  ],
  n5: [
    { id: "n5-desu", pattern: "Verb-です (copula)" },
    { id: "n5-past-ta-form", pattern: "Verb-た (past tense)" },
    { id: "n5-dewa-arimasen", pattern: "ではありません (negative polite)" },
  ],
};

/**
 * Fetch one grammar level from the server, never throwing.
 *
 * Order: no configured server → local fallback; server configured →
 * fetch, falling back to local data on connection failure (server not
 * running, offline), non-ok status, or a malformed payload. Keeps
 * `deriveWeakPatterns`/`computeMockResult` usable in tests (bun
 * auto-loads `.env` so `VITE_SERVER_URL` may be set without a live
 * server) and during a mid-session server outage.
 */
async function fetchGrammarLevel(
  level: string
): Promise<readonly { id: string; pattern: string }[]> {
  const local = LOCAL_GRAMMAR[level] ?? [];
  if (!hasServer) {
    return local;
  }
  // TASK-71 phase 4: typed oRPC call replaces GET /api/grammar?level=.
  // Same never-throw semantics: any failure falls back to LOCAL_GRAMMAR.
  // grammarIdLevel returns the LOCAL_GRAMMAR key (lowercase "n5"); the
  // API schema wants the JlptLevel enum ("N5") — uppercase here, or every
  // call 400s and silently degrades to the local seed.
  try {
    const data = await orpc.jap.grammar.list({
      level: level.toUpperCase() as "N5" | "N4" | "N3" | "N2" | "N1",
    });
    return data.grammar.map((g) => ({ id: g.id, pattern: g.pattern }));
  } catch {
    return local;
  }
}

export const grammarIdLevel = (id: string): string | null => {
  // Prefix-tagged ids (n5-desu…) resolve directly.
  for (const level of ["n5", "n4", "n3", "n2", "n1"]) {
    if (id.startsWith(`${level}-`)) {
      return level;
    }
  }
  // TASK-23.7: the jkindrix corpus ids carry NO level prefix
  // (you-da-appearance, wo-motte…) — resolve via the local seed membership.
  for (const [level, entries] of Object.entries(LOCAL_GRAMMAR)) {
    if (entries.some((entry) => entry.id === id)) {
      return level;
    }
  }
  return null;
};

export const deriveWeakPatterns = async (
  mistakes: readonly Mistake[],
  topN = 3
): Promise<readonly WeakPattern[]> => {
  if (mistakes.length === 0) {
    return [];
  }
  const counts = new Map<string, { total: number; wrong: number }>();
  for (const m of mistakes) {
    const prev = counts.get(m.grammarId) ?? { total: 0, wrong: 0 };
    prev.total += 1;
    prev.wrong += 1;
    counts.set(m.grammarId, prev);
  }
  const rows = [...counts.entries()].map(([id, c]) => ({ id, ...c }));
  rows.sort((a, b) => {
    if (b.wrong !== a.wrong) {
      return b.wrong - a.wrong;
    }
    return a.id.localeCompare(b.id);
  });
  const top = rows.slice(0, topN);
  const enriched = await Promise.all(
    top.map(async ({ id, total, wrong }) => {
      const level = grammarIdLevel(id);
      const patterns = level ? await fetchGrammarLevel(level) : [];
      const pattern = patterns.find((p) => p.id === id)?.pattern ?? id;
      return { grammarId: id, pattern, total, wrong };
    })
  );
  return enriched;
};

export const computeMockResult = async (
  questions: readonly Question[],
  userAnswers: ReadonlyMap<string, string | null>
): Promise<MockResult> => {
  const mistakes: Mistake[] = [];
  let score = 0;
  for (const q of questions) {
    const choice = userAnswers.get(q.id) ?? null;
    if (scoreQuestion(q, choice)) {
      score += 1;
    } else if (choice !== null) {
      mistakes.push({
        grammarId: q.grammarId,
        questionId: q.id,
        wrongChoiceId: choice,
      });
    }
  }
  const total = questions.length;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const weak = await deriveWeakPatterns(mistakes);
  return { mistakes, pct, score, total, weak };
};

export const formatTimer = (totalSeconds: number): string => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(mm)}:${pad(ss)}`;
};

export type SectionName = "lang" | "reading" | "listening";

// ---------------------------------------------------------------------------
// Sectional scoring (TASK-23.7 AC#2, doc-4 §5; jlpt.jp results.html +
// comprendreport 2025) — corrected by TASK-113 D11.
//
// Official JLPT scoring sections: N1-N3 = Language Knowledge (Vocab+Grammar)
// 60 + Reading 60 + Listening 60 = 180 (3 sections). N4-N5 = Language
// Knowledge·Reading 120 + Listening 60 = 180 (2 scoring sections). The code
// still buckets raw questions into three test sections (lang/reading/listening)
// for counting, but BANDS are scored as 2 at N4/N5: reading cap 0, lang 120.
// Raw overall N1 100 N2 90 N3 95 / N4 90 N5 80 (of 180); sectional pass:
// 19/60 for N1-N3, 38/120 + 19/60 for N4-N5 (reading has no mark at N4/N5).
//
// Viability floor (TASK-113 D5): band points / 6 per item → 60-cap ≥10,
// 120-cap ≥20. Below floor show raw counts only, no scaled badges.
// ---------------------------------------------------------------------------

export interface SectionalScore {
  lang: number;
  listening: number;
  reading: number;
}

export interface SectionalCaps {
  lang: number;
  listening: number;
  reading: number;
}

/** Viability floor divisor: cap / 6 per item. 60 → 10, 120 → 20. */
const VIABILITY_DIVISOR = 6;

/** Per-level scoring caps: N1-N3 60/60/60, N4-N5 120/60/0 (reading folded). */
export const sectionCaps = (level: JlptLevel): SectionalCaps =>
  level === "N1" || level === "N2" || level === "N3"
    ? { lang: 60, listening: 60, reading: 60 }
    : { lang: 120, listening: 60, reading: 0 };

/** Overall pass marks (of 180): N1 100 N2 90 N3 95 N4 90 N5 80. */
export const overallPassMark = (level: JlptLevel): number => {
  switch (level) {
    case "N1":
      return 100;
    case "N3":
      return 95;
    case "N5":
      return 80;
    // N2 and N4 share the 90 mark.
    default:
      return 90;
  }
};

/** Sectional pass marks: N1-N3 19 per section; N4-N5 38 (lang) + 19 (listening), reading has no mark. */
export const sectionalPassMark = (
  level: JlptLevel,
  section: keyof SectionalScore
): number => {
  if (level === "N1" || level === "N2" || level === "N3") {
    return 19;
  }
  if (section === "reading") {
    return 0;
  }
  return section === "lang" ? 38 : 19;
};

/** Viability floor: min items for a scoring section to show bands. 0-cap → 0 (never viable as a band). */
export const viabilityFloor = (
  level: JlptLevel,
  section: keyof SectionalCaps
): number => {
  const cap = sectionCaps(level)[section];
  return cap > 0 ? Math.ceil(cap / VIABILITY_DIVISOR) : 0;
};

/** True when a section has enough items to render scaled bands. */
export const isSectionViable = (
  level: JlptLevel,
  section: keyof SectionalCaps,
  total: number
): boolean => {
  const floor = viabilityFloor(level, section);
  return floor > 0 && total >= floor;
};

/** CEFR mapping (comprendreport §3): N5 80→A1, N4 90→A2, N3 95→B1, N2 115→B2, N1 100→C1. */
export const cefrForScore = (
  level: JlptLevel,
  score: number
): string | null => {
  const thresholds: Record<JlptLevel, [number, string][]> = {
    N1: [
      [100, "C1"],
      [145, "C2"],
    ],
    N2: [
      [90, "B1"],
      [115, "B2"],
      [145, "C1"],
    ],
    N3: [
      [95, "B1"],
      [115, "B2"],
    ],
    N4: [
      [90, "A2"],
      [115, "B1"],
    ],
    N5: [
      [80, "A1"],
      [100, "A2"],
    ],
  };
  let matched: string | null = null;
  for (const [min, cefr] of thresholds[level]) {
    if (score >= min) {
      matched = cefr;
    }
  }
  return matched;
};

/**
 * Sectional mirror of `deriveWeakPatterns`: group mistakes into the three
 * sections via the question's `section` tag (Language Knowledge vocab+grammar
 * folds into `lang`; standalone reading/listening questions tag themselves),
 * returning wrong counts per section. Sections with no mistakes get 0 — the
 * caller renders pass/fail against `sectionalPassMark`.
 */
export const deriveSectionalWeak = (
  mistakes: readonly (Mistake & { section?: SectionName })[]
): { lang: number; listening: number; reading: number } => ({
  lang: mistakes.filter((m) => (m.section ?? "lang") === "lang").length,
  listening: mistakes.filter((m) => m.section === "listening").length,
  reading: mistakes.filter((m) => m.section === "reading").length,
});

/**
 * Scale a raw sectional score {correct counts} to the official 60/60/60
 * (N1-N3) or 120/60/0 (N4-N5, reading folded) point bands. `raw.correct`
 * is the count of correct answers in the section and `raw.total` the
 * section's question count; the result is round(correct / total * cap).
 * N4/N5 reading raw is folded into lang by the caller before calling
 * (see jlpt-mock computeSectional); scoreBySection itself just scales caps,
 * so calling it with reading at N4/N5 yields 0.
 */
export const scoreBySection = (
  level: JlptLevel,
  raw: Record<SectionName, { correct: number; total: number }>
): SectionalScore => {
  const caps = sectionCaps(level);
  const scale = (section: SectionName, cap: number): number => {
    const { correct, total } = raw[section];
    return total > 0 && cap > 0 ? Math.round((correct / total) * cap) : 0;
  };
  return {
    lang: scale("lang", caps.lang),
    listening: scale("listening", caps.listening),
    reading: scale("reading", caps.reading),
  };
};

/** Sum of scoring caps for a level — always 180. */
export const totalCaps = (level: JlptLevel): number => {
  const c = sectionCaps(level);
  return c.lang + c.listening + c.reading;
};

/** Sum of scaled sectional points. */
export const totalScaled = (sectional: SectionalScore): number =>
  sectional.lang + sectional.listening + sectional.reading;

export const __test__ = {
  grammarIdLevel,
};
