/*
 * Kana mastery store (TASK-117) — per-cell drill evidence for the kana
 * checkpoint's adaptive sampler and the deferred romaji fade.
 *
 * Pattern: kanji-progress.ts — one localStorage key, JSON blob, corrupt
 * reads degrade to empty, never throw. Private-mode safe.
 *
 * Shape: manobu.kanaMastery → { cells: Record<cell, { kind, row, outcomes, state }> }
 * where outcomes is [{ correct, mode, at }] and state is solid|shaky|unseen
 * derived via the §6.1 rule: solid = ≥3 correct over ≥2 sessions last 2 correct.
 */

const STORAGE_KEY = "manobu.kanaMastery";

export type KanaKind = string;
export type KanaCellState = "solid" | "shaky" | "unseen";

export interface KanaOutcome {
  at: number;
  correct: boolean;
  mode: string;
}

export interface KanaCellRecord {
  cell: string;
  kind: KanaKind;
  outcomes: readonly KanaOutcome[];
  row: string;
  state: KanaCellState;
}

export interface KanaMastery {
  cells: Readonly<Record<string, KanaCellRecord>>;
}

const CELL_STATES: readonly KanaCellState[] = ["solid", "shaky", "unseen"];

const EMPTY: KanaMastery = { cells: {} };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

const isCellState = (v: string | null): v is KanaCellState =>
  CELL_STATES.includes(v as KanaCellState);

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

const parseOutcome = (raw: unknown): KanaOutcome | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const at = typeof raw.at === "number" ? raw.at : null;
  const correct = typeof raw.correct === "boolean" ? raw.correct : null;
  const mode = str(raw.mode);
  if (at === null || correct === null || mode === null) {
    return null;
  }
  return { at, correct, mode };
};

const parseOutcomes = (raw: unknown): KanaOutcome[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  const outcomes: KanaOutcome[] = [];
  for (const entry of raw) {
    const outcome = parseOutcome(entry);
    if (outcome) {
      outcomes.push(outcome);
    }
  }
  return outcomes;
};

const parseCellRecord = (key: string, raw: unknown): KanaCellRecord | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const kind = str(raw.kind);
  const row = str(raw.row);
  const state = str(raw.state);
  if (kind === null || row === null || !isCellState(state)) {
    return null;
  }
  const outcomes = parseOutcomes(raw.outcomes);
  // Re-derive state to avoid trusting stored state if outcomes disagree
  return {
    cell: str(raw.cell) ?? key,
    kind,
    outcomes,
    row,
    state: deriveState(outcomes),
  };
};

const parseMastery = (raw: string | null): KanaMastery => {
  const parsed = parseJsonRecord(raw);
  if (parsed === null) {
    return EMPTY;
  }
  const cellsRaw = parsed.cells;
  if (!isRecord(cellsRaw)) {
    return EMPTY;
  }
  const cells: Record<string, KanaCellRecord> = {};
  for (const [key, val] of Object.entries(cellsRaw)) {
    const record = parseCellRecord(key, val);
    if (record) {
      cells[key] = record;
    }
  }
  return { cells };
};

export const deriveState = (
  outcomes: readonly KanaOutcome[]
): KanaCellState => {
  if (outcomes.length === 0) {
    return "unseen";
  }
  const corrects = outcomes.filter((o) => o.correct);
  if (corrects.length < 3) {
    return "shaky";
  }
  const sessions = new Set(outcomes.map((o) => Math.floor(o.at / 86_400_000)));
  if (sessions.size < 2) {
    return "shaky";
  }
  const last2 = outcomes.slice(-2);
  if (last2.length === 2 && last2.every((o) => o.correct)) {
    return "solid";
  }
  return "shaky";
};

export const readKanaMastery = (): KanaMastery => {
  try {
    return parseMastery(localStorage.getItem(STORAGE_KEY));
  } catch {
    return EMPTY;
  }
};

const persist = (m: KanaMastery): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch {
    // private mode
  }
};

export const recordKanaOutcome = (
  cell: string,
  kind: string,
  row: string,
  correct: boolean,
  mode: string,
  at = Date.now()
): void => {
  const cur = readKanaMastery();
  const existing = cur.cells[cell];
  const outcomes = [...(existing?.outcomes ?? []), { at, correct, mode }];
  const state = deriveState(outcomes);
  const rec: KanaCellRecord = { cell, kind, outcomes, row, state };
  persist({ cells: { ...cur.cells, [cell]: rec } });
};

export const getKanaCellState = (cell: string): KanaCellState => {
  const cur = readKanaMastery();
  return cur.cells[cell]?.state ?? "unseen";
};

export const clearKanaMastery = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
};

export const __test__ = { EMPTY, parseMastery, STORAGE_KEY };
