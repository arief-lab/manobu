/*
 * Kana checkpoint store (TASK-117) — auditable gate record per script.
 *
 * Pattern: kanji-progress.ts — one localStorage key, JSON blob, corrupt
 * reads degrade to empty. Two scripts independent: hiragana + katakana.
 *
 * Shape: manobu.kanaCheckpoint → { hiragana?: CheckpointRecord, katakana?: CheckpointRecord }
 * where CheckpointRecord = { script, source, passedAt, attempts }
 * attempts: [{ at, score, groupsFailed, itemIds }]
 * source: "checkpoint" | "drill-coverage" | "skip" | null (no pass)
 */

const STORAGE_KEY = "manobu.kanaCheckpoint";

export type KanaScript = "hiragana" | "katakana";
export type CheckpointSource = "checkpoint" | "drill-coverage" | "skip";

export interface CheckpointAttempt {
  at: number;
  groupsFailed: readonly string[];
  itemIds: readonly string[];
  score: number;
}

export interface CheckpointRecord {
  attempts: readonly CheckpointAttempt[];
  passedAt: number | null;
  script: KanaScript;
  source: CheckpointSource | null;
}

export interface KanaCheckpoint {
  hiragana?: CheckpointRecord;
  katakana?: CheckpointRecord;
}

const SCRIPTS: readonly KanaScript[] = ["hiragana", "katakana"];

const SOURCES: readonly CheckpointSource[] = [
  "checkpoint",
  "drill-coverage",
  "skip",
];

const EMPTY: KanaCheckpoint = {};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const isKanaScript = (v: unknown): v is KanaScript =>
  v === "hiragana" || v === "katakana";

const isCheckpointSource = (v: unknown): v is CheckpointSource =>
  SOURCES.includes(v as CheckpointSource);

const parseJsonRecord = (
  raw: string | null
): Record<string, unknown> | null => {
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isRecord(parsed) ? parsed : null;
};

const stringList = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === "string")
    : [];

const parseAttempt = (raw: unknown): CheckpointAttempt | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const at = typeof raw.at === "number" ? raw.at : null;
  const score = typeof raw.score === "number" ? raw.score : null;
  if (at === null || score === null) {
    return null;
  }
  return {
    at,
    groupsFailed: stringList(raw.groupsFailed),
    itemIds: stringList(raw.itemIds),
    score,
  };
};

const parseAttempts = (raw: unknown): CheckpointAttempt[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  const attempts: CheckpointAttempt[] = [];
  for (const entry of raw) {
    const attempt = parseAttempt(entry);
    if (attempt) {
      attempts.push(attempt);
    }
  }
  return attempts;
};

const parseScriptRecord = (raw: unknown): CheckpointRecord | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const script = isKanaScript(raw.script) ? raw.script : null;
  if (script === null) {
    return null;
  }
  return {
    attempts: parseAttempts(raw.attempts),
    // allow null source/passedAt for no-pass state
    passedAt: typeof raw.passedAt === "number" ? raw.passedAt : null,
    script,
    source: isCheckpointSource(raw.source) ? raw.source : null,
  };
};

const parseCheckpoint = (raw: string | null): KanaCheckpoint => {
  const parsed = parseJsonRecord(raw);
  if (parsed === null) {
    return EMPTY;
  }
  const out: KanaCheckpoint = {};
  for (const script of SCRIPTS) {
    const record = parseScriptRecord(parsed[script]);
    if (record) {
      out[script] = record;
    }
  }
  return out;
};

export const readKanaCheckpoint = (): KanaCheckpoint => {
  try {
    return parseCheckpoint(localStorage.getItem(STORAGE_KEY));
  } catch {
    return EMPTY;
  }
};

const persist = (c: KanaCheckpoint): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    // private mode
  }
};

export const recordCheckpointAttempt = (
  script: KanaScript,
  attempt: CheckpointAttempt
): void => {
  const cur = readKanaCheckpoint();
  const rec = cur[script] ?? {
    attempts: [],
    passedAt: null,
    script,
    source: null,
  };
  persist({
    ...cur,
    [script]: { ...rec, attempts: [...rec.attempts, attempt] },
  });
};

export const setCheckpointPass = (
  script: KanaScript,
  source: CheckpointSource,
  at = Date.now()
): void => {
  const cur = readKanaCheckpoint();
  const rec = cur[script] ?? {
    attempts: [],
    passedAt: null,
    script,
    source: null,
  };
  persist({ ...cur, [script]: { ...rec, passedAt: at, source } });
};

export const setCheckpointSkip = (
  script: KanaScript,
  _at = Date.now()
): void => {
  // skip is an override, never a pass — passedAt stays null, source is skip
  const cur = readKanaCheckpoint();
  const rec = cur[script] ?? {
    attempts: [],
    passedAt: null,
    script,
    source: null,
  };
  persist({ ...cur, [script]: { ...rec, passedAt: null, source: "skip" } });
};

export const clearKanaCheckpoint = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
};

export const clearKanaCheckpointScript = (script: KanaScript): void => {
  const cur = readKanaCheckpoint();
  const next = { ...cur };
  delete next[script];
  persist(next);
};

export const __test__ = { EMPTY, parseCheckpoint, STORAGE_KEY };
