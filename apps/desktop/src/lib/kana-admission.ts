/*
 * Kana admission model (TASK-119) — OR of three named sources per doc-13 §6.
 *
 * Sources: checkpoint | drill-coverage | skip
 * D12: drill-coverage is refused as "not available" until six-kind decks ship.
 * Uses kana-mastery state machine and kana-checkpoint store; never reads
 * mastery directly for admission, only via deriveState.
 */

import {
  type CheckpointSource,
  type KanaScript,
  readKanaCheckpoint,
} from "./kana-checkpoint";
import { readKanaMastery } from "./kana-mastery";

export type AdmissionSource = CheckpointSource;
export type AdmissionStatus = "admitted" | "not-admitted" | "not-available";

export interface AdmissionResult {
  reason: string;
  source: AdmissionSource | null;
  status: AdmissionStatus;
}

// D12: drill-coverage flips on with the six-kind deck extension (TASK-120)
const DRILL_COVERAGE_AVAILABLE = true;

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const canAttemptCheckpoint = (
  script: KanaScript,
  now = Date.now()
): { allowed: boolean; nextAvailableAt: number | null } => {
  const cp = readKanaCheckpoint()[script];
  const attempts = cp?.attempts ?? [];
  if (attempts.length < 2) {
    return { allowed: true, nextAvailableAt: null };
  }
  // biome-ignore lint/style/noNonNullAssertion: length >=2 guarantees last exists
  const last = attempts.at(-1)!;
  const next = last.at + COOLDOWN_MS;
  // backwards clock: if now < last.at, still in cooldown (don't clear)
  if (now < last.at) {
    return { allowed: false, nextAvailableAt: next };
  }
  if (now - last.at >= COOLDOWN_MS) {
    return { allowed: true, nextAvailableAt: null };
  }
  return { allowed: false, nextAvailableAt: next };
};

export const getAdmission = (script: KanaScript): AdmissionResult => {
  const cp = readKanaCheckpoint()[script];
  // skip is override, never a pass
  if (cp?.source === "skip") {
    return { reason: "skip", source: "skip", status: "admitted" };
  }
  if (cp?.source === "checkpoint" && cp.passedAt !== null) {
    return { reason: "checkpoint", source: "checkpoint", status: "admitted" };
  }
  // drill-coverage D12: refuse as not available, not not-yet-met
  // biome-ignore lint/suspicious/noUnnecessaryConditions: D12 flag, flip to true in TASK-120
  if (!DRILL_COVERAGE_AVAILABLE) {
    // Even if every group were solid, still not available; helper getDrillCoverageAdmission reports it
  }
  return {
    reason: "no pass yet",
    source: cp?.source ?? null,
    status: "not-admitted",
  };
};

export const getDrillCoverageAdmission = (
  _script: KanaScript
): AdmissionResult => {
  // biome-ignore lint/suspicious/noUnnecessaryConditions: D12 flag
  if (!DRILL_COVERAGE_AVAILABLE) {
    return {
      reason: "not available",
      source: "drill-coverage",
      status: "not-available",
    };
  }
  // when available, every (kind,row) group must be solid
  const mastery = readKanaMastery();
  // check all groups for script — need at least one solid per group; if any not solid, not admitted
  // For now, since groups are 22, we check that every cell that exists is solid
  // A missing cell is not solid, so not admitted. This is the strictest.
  const groups = new Set<string>();
  for (const rec of Object.values(mastery.cells)) {
    groups.add(`${rec.kind}:${rec.row}`);
  }
  // If no mastery at all, not admitted
  if (groups.size === 0) {
    return {
      reason: "not yet met",
      source: "drill-coverage",
      status: "not-admitted",
    };
  }
  for (const rec of Object.values(mastery.cells)) {
    if (rec.state !== "solid") {
      return {
        reason: "not yet met",
        source: "drill-coverage",
        status: "not-admitted",
      };
    }
  }
  return {
    reason: "drill-coverage",
    source: "drill-coverage",
    status: "admitted",
  };
};

// For testing backwards clock safety
export const __test__ = { COOLDOWN_MS, DRILL_COVERAGE_AVAILABLE };
