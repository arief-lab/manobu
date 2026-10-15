/*
 * Corpus-anchored next-card generation — the logic behind GET
 * /learn/nextCards and the includeNextCards branch of POST /learn/chat
 * (TASK-18.1). Extracted from routes/learn-chat.ts in TASK-71 phase 3 and
 * split per fallow health feedback (CC 14 → 4): path resolution, corpus
 * reading, and card mapping are separate concerns.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDir } from "../data-dir";

export interface GeneratedNextCard {
  jp: string;
  level: string;
  reading: string;
  vocabId: number;
}

const VALID_LEVELS = new Set(["n5", "n4", "n3", "n2", "n1"]);

/** Resolve the corpus file path; falls back to N5 for unknown levels. */
function levelFilePath(learnerLevel: string): string | null {
  const level = learnerLevel.toLowerCase();
  const fileLevel = VALID_LEVELS.has(level) ? level : "n5";
  // TASK-43: resolveDataDir() — import.meta.dir is /$bunfs in the compiled
  // sidecar; env/resource/dev candidates live in data-dir.ts.
  const dataDir = resolveDataDir();
  return dataDir === null ? null : join(dataDir, `${fileLevel}.json`);
}

interface RawVocabEntry {
  id?: number;
  jp?: string;
  kana?: string;
  level?: string;
  reading?: string;
  vocabId?: number;
  word?: string;
}

/** Map one raw corpus row to a card; null for rows missing a headword. */
function toCard(
  entry: RawVocabEntry,
  index: number,
  learnerLevel: string
): GeneratedNextCard | null {
  const jp = entry.jp ?? entry.word ?? "";
  if (!jp) {
    return null;
  }
  const vocabId = entry.id ?? entry.vocabId ?? index + 1;
  const reading = entry.reading ?? entry.kana ?? "";
  return { jp, level: learnerLevel, reading, vocabId: Number(vocabId) };
}

/** Take the first `count` mappable rows from the corpus. */
function takeCards(
  data: RawVocabEntry[],
  count: number,
  learnerLevel: string
): GeneratedNextCard[] {
  const cards: GeneratedNextCard[] = [];
  for (const [index, entry] of data.entries()) {
    if (cards.length >= count) {
      break;
    }
    const card = toCard(entry, index, learnerLevel);
    if (card) {
      cards.push(card);
    }
  }
  return cards;
}

export async function generateNextCards(
  learnerLevel: string,
  count = 3
): Promise<GeneratedNextCard[]> {
  try {
    const dataPath = levelFilePath(learnerLevel);
    if (dataPath === null) {
      return [];
    }
    const raw = await readFile(dataPath, "utf-8");
    const data = JSON.parse(raw) as RawVocabEntry[];
    return takeCards(data, count, learnerLevel);
  } catch {
    // TASK-67 lineage: missing/corrupt corpus degrades to an empty queue —
    // callers render "no cards today", the sidecar never 500s.
    return [];
  }
}
