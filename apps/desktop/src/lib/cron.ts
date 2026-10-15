/*
 * Cron scheduler wrappers (TASK-22 Tier B) — typed invokes for the
 * Tauri `cron_*` commands. Mirrors AionUi's `ipcBridge.cron.*` surface.
 * All wrappers reject with the backend's error string; the UI never-throw
 * contract lives one layer up.
 */

const isTauri = (): boolean =>
  typeof globalThis !== "undefined" &&
  Boolean((globalThis as Record<string, unknown>).__TAURI__);

/** Execution mode (AionUi CreateTaskDialog): append vs fresh conversation. */
export type CronExecutionMode = "continue" | "new";

/** One scheduled job — the persisted `ICronJob`. */
export interface ICronJob {
  agent?: string | null;
  conversationId?: string | null;
  /** Exactly one of cronExpr / intervalMinutes / oneTimeAt. */
  cronExpr?: string | null;
  enabled: boolean;
  executionMode: CronExecutionMode;
  id: string;
  intervalMinutes?: number | null;
  keepAwake: boolean;
  model?: string | null;
  name: string;
  oneTimeAt?: string | null;
  prompt: string;
  queueProtection: boolean;
  /** IANA timezone, e.g. `Asia/Tokyo`. */
  tz: string;
}

/** One recorded run (execution history). */
export interface CronRunRecord {
  finishedAt?: string | null;
  firedAt: string;
  jobId: string;
  status: "running" | "done" | "failed" | "skipped";
}

const invokeCron = async <T>(
  cmd: string,
  args?: Parameters<typeof import("@tauri-apps/api/core").invoke>[1]
): Promise<T> => {
  if (!isTauri()) {
    return Promise.reject(new Error("cron only in Tauri desktop"));
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
};

export function cronList(): Promise<ICronJob[]> {
  return invokeCron<ICronJob[]>("cron_list");
}

export function cronUpsert(job: ICronJob): Promise<void> {
  return invokeCron<void>("cron_upsert", { request: { job } });
}

export function cronRemove(jobId: string): Promise<boolean> {
  return invokeCron<boolean>("cron_remove", { jobId });
}

export function cronHistory(
  jobId?: string,
  limit = 50
): Promise<CronRunRecord[]> {
  return invokeCron<CronRunRecord[]>("cron_history", {
    jobId: jobId ?? null,
    limit,
  });
}

export function cronClearHistory(jobId?: string): Promise<number> {
  return invokeCron<number>("cron_clear_history", { jobId: jobId ?? null });
}

export function cronRunNow(jobId: string): Promise<CronRunRecord> {
  return invokeCron<CronRunRecord>("cron_run_now", { jobId });
}

export function cronReportResult(
  jobId: string,
  firedAt: string,
  ok: boolean
): Promise<void> {
  return invokeCron<void>("cron_report_result", {
    request: { firedAt, jobId, ok },
  });
}

// ---- Schedule presets (AionUi CreateTaskDialog) ---------------------------

export interface CronPreset {
  build: (tz: string) => Partial<ICronJob>;
  label: string;
}

/** Visual presets — sugar over the raw 5-field cron (doc-1 §6). */
export const CRON_PRESETS: readonly CronPreset[] = [
  { build: (tz) => ({ cronExpr: "0 * * * *", tz }), label: "Hourly" },
  { build: (tz) => ({ cronExpr: "0 8 * * *", tz }), label: "Daily 8:00" },
  { build: (tz) => ({ cronExpr: "0 9 * * 1", tz }), label: "Weekly Mon 9:00" },
  { build: (tz) => ({ cronExpr: "0 9 * * 1-5", tz }), label: "Weekdays 9:00" },
  // TASK-23.8: bi-weekly JLPT mock → weak → Plan cadence (doc-4 §5.2).
  {
    build: (tz) => ({ cronExpr: "0 9 */14 * *", tz }),
    label: "Bi-weekly Mon 9:00",
  },
] as const;

/**
 * Round-trip a raw cron string to a human label (AionUi `parseCronExpr`).
 * Returns the raw string when nothing matches — the advanced path.
 */
export const describeCronExpr = (expr: string): string => {
  const match = CRON_PRESETS.find((p) => {
    const built = p.build("Asia/Tokyo");
    return built.cronExpr === expr;
  });
  return match?.label ?? expr;
};
