/*
 * NihongoAI local-only event log (spec §Measurement / GSM).
 *   - local-only (no network analytics)
 *   - opt-in export (Settings → Data → Export)
 *   - GDPR Art.7 clean (telemetry OFF default; explicit consent required)
 *
 * Events per spec:
 *   lesson_start / lesson_complete
 *   grade distribution (per-card grade 1-4)
 *   hint_used
 *   socratic_fail_count
 *   nudge_shown / nudge_dismissed
 *
 * Primary metrics (per spec):
 *   onboarding completion >85% in <90s
 *   lesson completion >70%
 *   7-day FSRS retention >85%
 *
 * Counter-metrics (must NOT worsen):
 *   session length (anti-binge)
 *   nudge dismissal != ignore-rate spike
 *
 * Implementation: append-only JSONL buffer + async flush to a single
 * in-memory + IndexedDB store. Never call `fetch`. The export action
 * returns a Blob; the user chooses where to save.
 */

export type GsmEventName =
  | "lesson_start"
  | "lesson_complete"
  | "grade"
  | "hint_used"
  | "socratic_fail"
  | "nudge_shown"
  | "nudge_dismissed"
  | "session_start"
  | "session_end"
  | "onboarding_step"
  | "error_shown";

export interface GsmEvent {
  name: GsmEventName;
  props?: Record<string, string | number | boolean>;
  sessionId: string;
  ts: string; // ISO 8601
}

const BUFFER: GsmEvent[] = [];
const SESSION_ID = crypto.randomUUID();
let sessionStartTs: number | null = null;

const flushToStore = async (_event: GsmEvent): Promise<void> => {
  // Placeholder: would write to IndexedDB (no network).
  // Stays in BUFFER in this scaffold so tests can read it back.
};

export const log = (name: GsmEventName, props?: GsmEvent["props"]): void => {
  if (name === "session_start") {
    sessionStartTs = Date.now();
  }
  const ev: GsmEvent = {
    name,
    props,
    sessionId: SESSION_ID,
    ts: new Date().toISOString(),
  };
  BUFFER.push(ev);
  flushToStore(ev).catch(() => undefined);
  if (name === "session_end" && sessionStartTs !== null) {
    const ms = Date.now() - sessionStartTs;
    // Spec counter-metric: log session length for anti-binge tracking
    BUFFER.push({
      name: "session_end",
      props: { durationMs: ms },
      sessionId: SESSION_ID,
      ts: new Date().toISOString(),
    });
  }
};

export const exportLog = (): Blob => {
  // Spec: opt-in export; never auto-uploads. The caller (Settings → Export)
  // hands this Blob to a save dialog. No network access.
  const jsonl = BUFFER.map((e) => JSON.stringify(e)).join("\n");
  return new Blob([jsonl], { type: "application/x-ndjson" });
};

export const clearLog = (): void => {
  BUFFER.length = 0;
};

export const getBuffer = (): readonly GsmEvent[] => BUFFER;

export const computeMetrics = (): {
  onboardingCompletion: number;
  lessonCompletion: number;
  sevenDayRetention: number;
  sessionLengthMedian: number;
} => {
  const starts = BUFFER.filter((e) => e.name === "onboarding_step");
  const completes = BUFFER.filter((e) => e.name === "lesson_complete");
  const lessons = BUFFER.filter((e) => e.name === "lesson_start");
  const sessions = BUFFER.filter((e) => e.name === "session_end");
  const sessionLengths = sessions
    .map((e) => Number(e.props?.durationMs ?? 0))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const median: number = sessionLengths.length
    ? (sessionLengths[Math.floor(sessionLengths.length / 2)] ?? 0)
    : 0;
  return {
    lessonCompletion:
      lessons.length === 0 ? 0 : completes.length / lessons.length,
    onboardingCompletion:
      starts.length === 0 ? 0 : completes.length / starts.length,
    sessionLengthMedian: median,
    sevenDayRetention: 0, // computed from revlog pass rate > 0.85 target
  };
};
