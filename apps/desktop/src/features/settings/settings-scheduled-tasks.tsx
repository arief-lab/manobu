import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { CRON_PRESETS, describeCronExpr, type ICronJob } from "@/lib/cron";
import {
  cronHistoryQueryOptions,
  cronJobsQueryOptions,
  useCronClearHistory,
  useCronRemove,
  useCronRunNow,
  useCronUpsert,
} from "@/lib/tauri-queries";

/**
 * ScheduledTasks (TASK-22 Tier B, AC2) · the AionUi ScheduledTasksPage clone
 * in scope: job table with pause/resume, Run Now, history batch delete,
 * queue-protection toggle, and the keep-awake banner. Create form offers the
 * Hourly/Daily/Weekly/Weekdays presets plus an advanced raw-cron input.
 * 2026-09-14 (state audit): the data moved into react-query
 * (lib/tauri-queries.ts) · the component used to hand-roll useState +
 * useEffect + a refresh() after every write while its sibling SpeechModels
 * used the cache. Now the queries own jobs + history, every mutation
 * invalidates them, and busy/error come from the mutation state. The render
 * is split into CreateTaskForm + JobRow so the desk reads as data flow
 * instead of one 240-line block.
 */

/** Build the ICronJob the create form submits (pure; pinned by tests). */
const buildTask = (input: {
  advanced: boolean;
  name: string;
  presetLabel: string;
  prompt: string;
  rawCron: string;
}): ICronJob => {
  const preset = CRON_PRESETS.find((p) => p.label === input.presetLabel);
  const presetSchedule = preset?.build("Asia/Tokyo");
  const schedule = input.advanced
    ? { cronExpr: input.rawCron.trim(), tz: "Asia/Tokyo" }
    : {
        cronExpr: presetSchedule?.cronExpr ?? "0 * * * *",
        tz: presetSchedule?.tz ?? "Asia/Tokyo",
      };
  return {
    enabled: true,
    executionMode: "continue",
    id: `user-${Date.now()}`,
    keepAwake: false,
    name: input.name.trim() || "Untitled task",
    prompt: input.prompt.trim(),
    queueProtection: true,
    ...schedule,
  };
};

/** The first non-null error message among queries + mutations (pure). */
const firstErrorMessage = (
  ...errors: (Error | null | undefined)[]
): string | null => {
  for (const error of errors) {
    if (error) {
      return error.message;
    }
  }
  return null;
};

/** Run-history entries belonging to one job. Rows are `firedAt|jobId|status`
 *  (the shape ScheduledTasks keeps in the cache); the jobId is the MIDDLE
 *  field · the original code filtered with endsWith(`|${jobId}`), which can
 *  never match a `…|status` row, so the per-job panel always read
 *  "No runs yet." (caught by test/scheduled-tasks.test.ts, 2026-09-14). */
const runsFor = (history: readonly string[], jobId: string): string[] =>
  history.filter((h) => h.split("|")[1] === jobId);

export const ScheduledTasks = () => {
  const jobsQuery = useQuery(cronJobsQueryOptions);
  const historyQuery = useQuery(cronHistoryQueryOptions);
  const upsert = useCronUpsert();
  const remove = useCronRemove();
  const runNow = useCronRunNow();
  const clear = useCronClearHistory();

  const jobs = jobsQuery.data ?? [];
  const history = useMemo(
    () =>
      (historyQuery.data ?? []).map(
        (r) => `${r.firedAt}|${r.jobId}|${r.status}`
      ),
    [historyQuery.data]
  );
  const error = firstErrorMessage(
    upsert.error,
    remove.error,
    runNow.error,
    clear.error,
    jobsQuery.error,
    historyQuery.error
  );
  /** A job's row is busy while a mutation carrying *that job* is pending. */
  const isJobBusy = (jobId: string): boolean =>
    (upsert.isPending && upsert.variables?.id === jobId) ||
    (remove.isPending && remove.variables === jobId) ||
    (runNow.isPending && runNow.variables === jobId) ||
    (clear.isPending && clear.variables === jobId);

  const [creating, setCreating] = useState(false);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const onCreate = useCallback(
    (job: ICronJob): void => {
      upsert.mutate(job, { onSuccess: () => setCreating(false) });
    },
    [upsert]
  );
  const toggleCreating = useCallback(() => setCreating((p) => !p), []);
  const handleHistoryToggle = useCallback((jobId: string) => {
    setHistoryFor((prev) => (prev === jobId ? null : jobId));
  }, []);
  const handleToggleEnabled = useCallback(
    (job: ICronJob) => {
      upsert.mutate({ ...job, enabled: !job.enabled });
    },
    [upsert]
  );
  const handleToggleProtection = useCallback(
    (job: ICronJob) => {
      upsert.mutate({ ...job, queueProtection: !job.queueProtection });
    },
    [upsert]
  );
  const handleRunNow = useCallback(
    (jobId: string) => {
      runNow.mutate(jobId);
    },
    [runNow]
  );
  const handleDelete = useCallback(
    (jobId: string) => {
      remove.mutate(jobId);
    },
    [remove]
  );
  const handleDeleteHistory = useCallback(
    (jobId: string) => {
      clear.mutate(jobId);
    },
    [clear]
  );
  const handleClearAllHistory = useCallback(() => {
    clear.mutate(undefined);
  }, [clear]);

  return (
    <section
      aria-label="Scheduled tasks"
      className="flex flex-col gap-2"
      data-testid="settings-scheduled-tasks"
    >
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-sm">Scheduled tasks</h3>
        <button
          className="rounded-card border-2 border-border px-2 py-0.5 text-xs"
          data-testid="cron-create-toggle"
          onClick={toggleCreating}
          type="button"
        >
          {creating ? "[Cancel]" : "[+ New task]"}
        </button>
      </div>
      <p
        className="text-muted-foreground text-xs"
        data-testid="cron-keep-awake-banner"
      >
        ⚠ Tasks only run while your computer is awake. Jobs with keep-awake ask
        the OS to stay awake while armed.
      </p>
      {isDesktopOnlyNote()}
      {creating ? <CreateTaskForm onCreate={onCreate} /> : null}
      <ul className="flex flex-col gap-1">
        {jobs.map((job) => (
          <JobRow
            busy={isJobBusy(job.id)}
            history={runsFor(history, job.id)}
            historyOpen={historyFor === job.id}
            job={job}
            key={job.id}
            onDelete={handleDelete}
            onDeleteHistory={handleDeleteHistory}
            onHistoryToggle={handleHistoryToggle}
            onRunNow={handleRunNow}
            onToggleEnabled={handleToggleEnabled}
            onToggleProtection={handleToggleProtection}
          />
        ))}
      </ul>
      {history.length > 0 ? (
        <button
          className="self-start text-destructive text-xs underline"
          data-testid="cron-history-clear-all"
          onClick={handleClearAllHistory}
          type="button"
        >
          Clear all run history ({history.length})
        </button>
      ) : null}
      {error === null ? null : (
        <p
          aria-live="polite"
          className="text-destructive text-xs"
          data-testid="cron-error"
          role="alert"
        >
          {error}
        </p>
      )}
    </section>
  );
};

/* ── create form ─────────────────────────────────────────────────── */

interface CreateTaskFormProps {
  onCreate: (job: ICronJob) => void;
}

/** The preset/raw-cron create dialog. Owns its draft fields; submits a
 *  built ICronJob upward so the parent keeps the single upsert mutation.
 *  The header's [Cancel] toggle (parent state) is the dismiss affordance. */
const CreateTaskForm = ({ onCreate }: CreateTaskFormProps) => {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [presetLabel, setPresetLabel] = useState<string>(
    CRON_PRESETS[0]?.label ?? "Hourly"
  );
  const [rawCron, setRawCron] = useState("");
  const [advanced, setAdvanced] = useState(false);

  const onSave = useCallback(() => {
    onCreate(buildTask({ advanced, name, presetLabel, prompt, rawCron }));
  }, [advanced, name, onCreate, presetLabel, prompt, rawCron]);
  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
    []
  );
  const handlePromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value),
    []
  );
  const handleRawCronChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setRawCron(e.target.value),
    []
  );
  const handlePresetChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => setPresetLabel(e.target.value),
    []
  );
  const handleAdvancedToggle = useCallback(() => setAdvanced((p) => !p), []);

  return (
    <div
      className="flex flex-col gap-2 rounded-card border-2 border-border p-3"
      data-testid="cron-create-dialog"
    >
      <input
        aria-label="Task name"
        className="rounded-card border-2 border-border px-3 py-1 text-sm"
        data-testid="cron-create-name"
        onChange={handleNameChange}
        placeholder="Task name"
        value={name}
      />
      <textarea
        aria-label="Prompt"
        className="rounded-card border-2 border-border px-3 py-1 text-sm"
        data-testid="cron-create-prompt"
        onChange={handlePromptChange}
        placeholder="Prompt sent to the agent when the task fires"
        rows={2}
        value={prompt}
      />
      {advanced ? (
        <input
          aria-label="Advanced cron expression"
          className="rounded-card border-2 border-border px-3 py-1 font-mono text-sm"
          data-testid="cron-create-raw"
          onChange={handleRawCronChange}
          placeholder="*/15 * * * *"
          value={rawCron}
        />
      ) : (
        <select
          aria-label="Schedule preset"
          className="rounded-card border-2 border-border px-2 py-1 text-sm"
          data-testid="cron-create-preset"
          onChange={handlePresetChange}
          value={presetLabel}
        >
          {CRON_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </select>
      )}
      <div className="flex items-center gap-2">
        <button
          aria-pressed={advanced}
          className="text-muted-foreground text-xs underline"
          data-testid="cron-create-advanced"
          onClick={handleAdvancedToggle}
          type="button"
        >
          {advanced ? "use presets" : "advanced raw cron"}
        </button>
        <button
          className="rounded-card bg-primary px-3 py-1 text-primary-foreground text-sm"
          data-testid="cron-create-save"
          disabled={prompt.trim().length === 0}
          onClick={onSave}
          type="button"
        >
          Create task
        </button>
      </div>
    </div>
  );
};

/* ── one job row ─────────────────────────────────────────────────── */

interface JobRowProps {
  busy: boolean;
  history: readonly string[];
  historyOpen: boolean;
  job: ICronJob;
  onDelete: (jobId: string) => void;
  onDeleteHistory: (jobId: string) => void;
  onHistoryToggle: (jobId: string) => void;
  onRunNow: (jobId: string) => void;
  onToggleEnabled: (job: ICronJob) => void;
  onToggleProtection: (job: ICronJob) => void;
}

/* The row binds the parent's stable handlers to its own job via
 * useCallback · pre-declared handlers (not inline JSX arrows) so the
 * noJsxPropsBind contract holds and the row doesn't re-mutate props. */
const JobRow = ({
  busy,
  history,
  historyOpen,
  job,
  onDelete,
  onDeleteHistory,
  onHistoryToggle,
  onRunNow,
  onToggleEnabled,
  onToggleProtection,
}: JobRowProps) => {
  const onDeleteJob = useCallback(() => onDelete(job.id), [onDelete, job.id]);
  const onDeleteHistoryJob = useCallback(
    () => onDeleteHistory(job.id),
    [onDeleteHistory, job.id]
  );
  const onHistoryToggleJob = useCallback(
    () => onHistoryToggle(job.id),
    [onHistoryToggle, job.id]
  );
  const onRunNowJob = useCallback(() => onRunNow(job.id), [onRunNow, job.id]);
  const onToggleEnabledJob = useCallback(
    () => onToggleEnabled(job),
    [onToggleEnabled, job]
  );
  const onToggleProtectionJob = useCallback(
    () => onToggleProtection(job),
    [onToggleProtection, job]
  );
  return (
    <li
      className="flex flex-col gap-1"
      data-enabled={job.enabled}
      data-testid="cron-job"
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="flex-1">
          {job.name}{" "}
          <span className="text-muted-foreground text-xs">
            ({scheduleLabel(job)} · {job.tz})
          </span>
        </span>
        <button
          aria-pressed={job.queueProtection}
          className="rounded-card border-2 border-border px-2 py-0.5 text-xs"
          data-queue-protection={job.queueProtection}
          data-testid="cron-queue-protection"
          disabled={busy}
          onClick={onToggleProtectionJob}
          type="button"
        >
          queue {job.queueProtection ? "on" : "off"}
        </button>
        <button
          className="rounded-card border-2 border-border px-2 py-0.5 text-xs"
          data-testid="cron-run-now"
          disabled={busy}
          onClick={onRunNowJob}
          type="button"
        >
          Run now
        </button>
        <button
          aria-pressed={job.enabled}
          className="rounded-card border-2 border-border px-2 py-0.5 text-xs"
          data-testid="cron-pause-resume"
          disabled={busy}
          onClick={onToggleEnabledJob}
          type="button"
        >
          {job.enabled ? "Pause" : "Resume"}
        </button>
        <button
          className="rounded-card border-2 border-border px-2 py-0.5 text-xs"
          data-testid="cron-history-toggle"
          disabled={busy}
          onClick={onHistoryToggleJob}
          type="button"
        >
          History
        </button>
        <button
          className="rounded-card border-2 border-destructive px-2 py-0.5 text-destructive text-xs"
          data-testid="cron-delete"
          disabled={busy}
          onClick={onDeleteJob}
          type="button"
        >
          Delete
        </button>
      </div>
      {historyOpen ? (
        <div
          className="flex flex-col gap-1 rounded-card bg-muted px-3 py-2"
          data-testid="cron-history"
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">Runs</span>
            <button
              className="text-destructive text-xs underline"
              data-testid="cron-history-clear"
              onClick={onDeleteHistoryJob}
              type="button"
            >
              Delete all runs
            </button>
          </div>
          {history.length === 0 ? (
            <p className="text-muted-foreground text-xs">No runs yet.</p>
          ) : (
            <ol className="flex flex-col gap-0.5">
              {history.map((entry) => {
                const [firedAt, , status] = entry.split("|");
                return (
                  <li className="font-mono text-xs" key={entry}>
                    {firedAt} · {status}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ) : null}
    </li>
  );
};

/** Human schedule label for one job row (cron preset, interval, or one-time). */
const scheduleLabel = (job: ICronJob): string => {
  if (job.cronExpr) {
    return describeCronExpr(job.cronExpr);
  }
  if (job.intervalMinutes !== null && job.intervalMinutes !== undefined) {
    return `every ${job.intervalMinutes}m`;
  }
  return "one-time";
};

/** Desktop-only hint (cron store lives in app_data_dir via Tauri). */
const isDesktopOnlyNote = (): ReactNode =>
  typeof globalThis !== "undefined" &&
  (globalThis as Record<string, unknown>).__TAURI__ ? null : (
    <p
      className="text-muted-foreground text-xs"
      data-testid="cron-desktop-hint"
    >
      Scheduled tasks run in the desktop app only.
    </p>
  );

export const __test__ = { buildTask, firstErrorMessage, runsFor };
