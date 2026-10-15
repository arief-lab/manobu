/*
 * Kana checkpoint instrument (TASK-118) — pure paper generation + pass rule
 * per doc-13 §3-§4. Six kinds, 208 cells, 2 per (kind,row) group + 2 word-level.
 */

import kanaData from "@manobu/japanese/data/kana.json";
import n5Data from "@manobu/japanese/data/n5.json";
// `kana-checkpoint.ts` owns the script vocabulary (kana-admission.ts already
// imports it from there); a second declaration here drifted as an export name.
import type { KanaScript } from "./kana-checkpoint";

interface KanaCell {
  char: string;
  kind: string;
  romaji: string;
  row: string;
}

export interface KanaItem {
  char: string;
  groupKey: string;
  id: string;
  kind: string;
  reading: string;
  row: string;
  type: string;
}

export interface KanaAnswer {
  correct: boolean;
  itemId: string;
  picked?: string | null;
}

export interface KanaChoiceAnswer {
  correct: boolean;
  picked: string | null;
}

export type KanaAnswerValue = boolean | null | KanaAnswer | KanaChoiceAnswer;

export interface KanaGroupResult {
  correct: number;
  failedItemIds: readonly string[];
  key: string;
  kind: string;
  row: string;
  total: number;
}

export interface KanaReviewRow {
  correct: string;
  groupKey: string;
  isCorrect: boolean;
  item: KanaItem;
  picked: string | null;
}

export interface KanaEvaluation {
  groups: readonly KanaGroupResult[];
  groupsFailed: string[];
  passed: boolean;
  pct: number;
  review: readonly KanaReviewRow[];
  score: number;
  total: number;
}

const DATA = kanaData as readonly KanaCell[];
const N5 = n5Data as readonly { word: string; reading: string }[];

// --- seeded PRNG (mulberry32) ---

const hashString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    // biome-ignore lint/suspicious/noBitwiseOperators: hash
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: hash
  return h >>> 0;
};

const mulberry32 = (seed: number): (() => number) => {
  let t = seed;
  return () => {
    t += 0x6d_2b_79_f5;
    // biome-ignore lint/suspicious/noBitwiseOperators: PRNG
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    // biome-ignore lint/suspicious/noBitwiseOperators: PRNG
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    // biome-ignore lint/suspicious/noBitwiseOperators: PRNG
    return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const seededShuffle = <T>(arr: readonly T[], seed: string): T[] => {
  const rnd = mulberry32(hashString(seed));
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
};

// --- grouping ---

const groupsForScript = (script: KanaScript): Map<string, KanaCell[]> => {
  const kinds =
    script === "hiragana"
      ? ["gojuon", "dakuten", "yoon"]
      : ["katakana", "katakana-dakuten", "katakana-yoon"];
  const map = new Map<string, KanaCell[]>();
  for (const cell of DATA) {
    if (!kinds.includes(cell.kind)) {
      continue;
    }
    const key = `${cell.kind}:${cell.row}`;
    const list = map.get(key) ?? [];
    list.push(cell);
    map.set(key, list);
  }
  return map;
};

const wordLevelItems = (
  script: KanaScript,
  seed: string,
  count = 2
): KanaItem[] => {
  const pool =
    script === "hiragana"
      ? N5.filter((w) => w.word.includes("っ"))
      : N5.filter((w) => w.word.includes("ー"));
  const shuffled = seededShuffle(pool, `${seed}:word:${script}`);
  return shuffled.slice(0, count).map((w, i) => ({
    char: w.word,
    groupKey: `word:${script}`,
    id: `kana:${script}:word:${w.word}:${seed}:${i}`,
    kind: "word",
    reading: w.reading,
    row: "word",
    type: script === "hiragana" ? "word-kana" : "katakana-word",
  }));
};

export const generateKanaPaper = (
  script: KanaScript,
  seed: string
): KanaItem[] => {
  const groups = groupsForScript(script);
  const items: KanaItem[] = [];
  const sortedKeys = [...groups.keys()].sort();
  for (const key of sortedKeys) {
    const cells = groups.get(key) as KanaCell[];
    const shuffled = seededShuffle(cells, `${seed}:${key}`);
    const take = cells.length === 1 ? 1 : 2;
    for (let i = 0; i < take; i += 1) {
      const cell = shuffled[i] as KanaCell;
      items.push({
        char: cell.char,
        groupKey: key,
        id: `kana:${script}:${key}:${cell.char}:${seed}:${i}`,
        kind: cell.kind,
        reading: cell.romaji,
        row: cell.row,
        type: cell.kind.includes("yoon") ? "yoon" : "kana-to-romaji",
      });
    }
  }
  items.push(...wordLevelItems(script, seed, 2));
  return seededShuffle(items, `${seed}:order:${script}`);
};

interface GroupTally {
  correct: number;
  total: number;
}

const answerIsCorrect = (answer: KanaAnswerValue | undefined): boolean =>
  answer === true ||
  (answer !== null && typeof answer === "object" && answer.correct);

const answerPicked = (answer: KanaAnswerValue | undefined): string | null => {
  if (answer !== null && typeof answer === "object") {
    if ("picked" in answer) {
      return answer.picked ?? null;
    }
    return answer.correct ? "correct" : null;
  }
  return answer === true ? "correct" : null;
};

const hasUnanswered = (
  paper: readonly KanaItem[],
  answers: ReadonlyMap<string, KanaAnswerValue>
): boolean =>
  paper.some((item) => {
    const answer = answers.get(item.id);
    return (
      !answers.has(item.id) ||
      answer === null ||
      (typeof answer === "object" && answer.picked === null)
    );
  });

const tallyByGroup = (
  paper: readonly KanaItem[],
  answers: ReadonlyMap<string, KanaAnswerValue>
): { correct: number; groupStats: Map<string, GroupTally> } => {
  let correct = 0;
  const groupStats = new Map<string, GroupTally>();
  for (const item of paper) {
    const ok = answerIsCorrect(answers.get(item.id));
    if (ok) {
      correct += 1;
    }
    const s = groupStats.get(item.groupKey) ?? { correct: 0, total: 0 };
    s.total += 1;
    if (ok) {
      s.correct += 1;
    }
    groupStats.set(item.groupKey, s);
  }
  return { correct, groupStats };
};

const groupsScoredZero = (
  groupStats: ReadonlyMap<string, GroupTally>
): string[] => {
  const groupsFailed: string[] = [];
  for (const [key, s] of groupStats) {
    if (s.total >= 2 && s.correct === 0) {
      groupsFailed.push(key);
    }
  }
  return groupsFailed;
};

const projectGroups = (
  paper: readonly KanaItem[],
  answers: ReadonlyMap<string, KanaAnswerValue>,
  groupStats: ReadonlyMap<string, GroupTally>
): KanaGroupResult[] => {
  const groups: KanaGroupResult[] = [];
  for (const [key, stats] of groupStats) {
    const first = paper.find((item) => item.groupKey === key);
    if (!first) {
      continue;
    }
    groups.push({
      correct: stats.correct,
      failedItemIds: paper
        .filter(
          (item) =>
            item.groupKey === key && !answerIsCorrect(answers.get(item.id))
        )
        .map((item) => item.id),
      key,
      kind: first.kind,
      row: first.row,
      total: stats.total,
    });
  }
  return groups.sort((a, b) => a.key.localeCompare(b.key));
};

const projectReview = (
  paper: readonly KanaItem[],
  answers: ReadonlyMap<string, KanaAnswerValue>
): KanaReviewRow[] =>
  paper.map((item) => ({
    correct: item.reading,
    groupKey: item.groupKey,
    isCorrect: answerIsCorrect(answers.get(item.id)),
    item,
    picked: answerPicked(answers.get(item.id)),
  }));

export const evaluateKanaPaper = (
  paper: readonly KanaItem[],
  answers: ReadonlyMap<string, KanaAnswerValue>
): KanaEvaluation => {
  if (hasUnanswered(paper, answers)) {
    return {
      groups: [],
      groupsFailed: [],
      passed: false,
      pct: 0,
      review: [],
      score: 0,
      total: paper.length,
    };
  }
  const { correct, groupStats } = tallyByGroup(paper, answers);
  const groupsFailed = groupsScoredZero(groupStats);
  const pct = paper.length > 0 ? correct / paper.length : 0;
  return {
    groups: projectGroups(paper, answers, groupStats),
    groupsFailed,
    passed: pct >= 0.9 && groupsFailed.length === 0,
    pct,
    review: projectReview(paper, answers),
    score: correct,
    total: paper.length,
  };
};

export const __test__ = { groupsForScript, hashString, wordLevelItems };
