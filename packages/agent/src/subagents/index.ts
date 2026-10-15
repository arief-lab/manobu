/*
 * Sub-agents for the Teacher Agent (spec §TASK-1.16).
 *
 *   - ConversationCoach.grammar_check(message) — naive surface corrections
 *     (period at end, double space). v1 stub; production replaces with a
 *     real provider call.
 *   - GrammarExplainer.lookup_pattern(query) — substring match over the
 *     grammar corpus loaded from @manobu/japanese/data.
 *   - KanjiTutor.decompose(input) — extracts the first CJK ideograph and
 *     looks it up via lookupKanji from apps/desktop/src/lib/kanji.ts (we
 *     duplicate the minimal shape here to avoid a circular dep).
 *   - VocabSRS.due_cards(vocabIds) — computes next interval per vocab id
 *     using previewIntervals from @manobu/srs with a demo memory state.
 *
 * The Kanji lookup is inlined because @manobu/japanese is data-only in TS
 * (see packages/japanese/AGENTS.md); the heavy lifting is in the Rust
 * MCP server crates/jlpt-mcp. We don't talk to it from these stubs — the
 * teacher agent does, in the apps/teacher binary.
 */

import { previewIntervals } from "@manobu/srs";

import type {
  ConversationCorrection,
  GrammarPatternResult,
  KanjiDecomposition,
  VocabDueCard,
} from "../index";

interface RawGrammarEntry {
  id: string;
  level: "N5" | "N4" | "N3" | "N2" | "N1";
  meaning_en: string;
  pattern: string;
}

const CORPUS_BY_LEVEL = new Map<
  RawGrammarEntry["level"],
  Promise<readonly RawGrammarEntry[]>
>();

const loadGrammar = (
  level: RawGrammarEntry["level"]
): Promise<readonly RawGrammarEntry[]> => {
  const cached = CORPUS_BY_LEVEL.get(level);
  if (cached) {
    return cached;
  }
  const promise = (async () => {
    const mod = await import(`@manobu/japanese/data/grammar/${level}.json`);
    return mod.default as readonly RawGrammarEntry[];
  })();
  CORPUS_BY_LEVEL.set(level, promise);
  return promise;
};

const ENDING_RE = /[。.!?]$/;
const DOUBLE_SPACE_RE = /\s{2,}/;
const CJK_RE = /[㐀-鿿豈-﫿]/;

export const conversationCoachGrammarCheck = (
  message: string
): readonly ConversationCorrection[] => {
  const corrections: ConversationCorrection[] = [];
  if (message.length > 0 && !ENDING_RE.test(message)) {
    corrections.push({
      corrected: `${message}。`,
      original: message,
      reason: "Add sentence-ending punctuation (Japanese uses 。).",
    });
  }
  if (DOUBLE_SPACE_RE.test(message)) {
    corrections.push({
      corrected: message.replace(DOUBLE_SPACE_RE, " "),
      original: message,
      reason: "Collapse double spaces.",
    });
  }
  return corrections;
};

export const grammarExplainerLookupPattern = async (
  query: string
): Promise<GrammarPatternResult | null> => {
  const needle = query.toLowerCase().trim();
  const allRows = await Promise.all(
    (["N5", "N4", "N3", "N2", "N1"] as const).map(loadGrammar)
  );
  for (const rows of allRows) {
    const idMatch = rows.find((r) => r.id === needle);
    const patternMatch = rows.find((r) =>
      r.pattern.toLowerCase().includes(needle)
    );
    const meaningMatch = rows.find((r) =>
      r.meaning_en.toLowerCase().includes(needle)
    );
    const hit = idMatch ?? patternMatch ?? meaningMatch;
    if (hit) {
      return {
        id: hit.id,
        level: hit.level,
        meaning_en: hit.meaning_en,
        pattern: hit.pattern,
      };
    }
  }
  return null;
};

interface RawKanjiEntry {
  character: string;
  meanings: { en?: string[] };
  readings: { on?: string[]; kun?: string[] };
  stroke_count: number;
}

const kanjiPromise: Promise<ReadonlyMap<string, RawKanjiEntry>> = (async () => {
  const mod = await import("@manobu/japanese/data/kanji.json");
  const file = mod.default as { kanji: RawKanjiEntry[] };
  const m = new Map<string, RawKanjiEntry>();
  for (const k of file.kanji) {
    m.set(k.character, k);
  }
  return m;
})();

export const kanjiTutorDecompose = async (
  input: string
): Promise<KanjiDecomposition | null> => {
  const character = CJK_RE.exec(input)?.[0];
  if (character === undefined) {
    return null;
  }
  const map = await kanjiPromise;
  const k = map.get(character);
  if (!k) {
    return null;
  }
  return {
    character,
    kun: k.readings.kun ?? [],
    meanings_en: k.meanings.en ?? [],
    on: k.readings.on ?? [],
    strokes: k.stroke_count,
  };
};

export const vocabSrsDueCards = (
  vocabIds: readonly number[]
): readonly VocabDueCard[] => {
  if (vocabIds.length === 0) {
    return [];
  }
  const demoMemory = { difficulty: 5, stability: 10 };
  const { 3: goodInterval } = previewIntervals(demoMemory, 0.9, 0);
  return vocabIds.map((vocabId) => ({
    intervalDays: goodInterval,
    vocabId,
  }));
};

export const __test__ = { CJK_RE, CORPUS_BY_LEVEL };
