import { autoDownload, type SpeechAutoSpec } from "@manobu/speech/models";
import type { ModelInfo, SpeechStatus } from "@manobu/speech/types";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import {
  type CronRunRecord,
  cronClearHistory,
  cronHistory,
  cronList,
  cronRemove,
  cronRunNow,
  cronUpsert,
  type ICronJob,
} from "@/lib/cron";

const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

// ---------------------------------------------------------------------------
// Speech status — read path (useQuery, offlineFirst)
// ---------------------------------------------------------------------------

export const SPEECH_STATUS_QUERY_KEY = ["speech", "status"] as const;

export const speechStatusQueryOptions = queryOptions({
  enabled: isTauri,
  gcTime: 1000 * 60 * 5,
  networkMode: "offlineFirst",
  queryFn: async (): Promise<SpeechStatus | null> => {
    if (!isTauri) {
      return null;
    }
    return await invoke<SpeechStatus>("speech_status");
  },
  queryKey: SPEECH_STATUS_QUERY_KEY,
  retry: 1,
  staleTime: 1000 * 60,
});

export function useSpeechStatus() {
  return useQuery(speechStatusQueryOptions);
}

// ---------------------------------------------------------------------------
// Speech models (TASK-21.4 AC3) — offlineFirst query + mutation coverage for
// list/known models, model dir bootstrap, tier-aware auto-download, and
// byte progress polling for the Settings [Download] buttons.
// ---------------------------------------------------------------------------

interface DownloadProgressEntry {
  done: boolean;
  downloaded: number;
  model_id: string;
  total: number;
}

/**
 * Byte progress per active download. Polled by the UI while a download is
 * in flight; `refetchInterval` is controlled by the caller via `enabled`.
 */
const speechDownloadProgressQueryOptions = (enabled: boolean) =>
  queryOptions({
    enabled: enabled && isTauri,
    networkMode: "offlineFirst",
    queryFn: async (): Promise<DownloadProgressEntry[]> => {
      if (!isTauri) {
        return [];
      }
      return await invoke<DownloadProgressEntry[]>("speech_download_progress");
    },
    queryKey: ["speech", "download-progress"] as const,
    refetchInterval: 500,
    staleTime: 0,
  });

export function useSpeechDownloadProgress(enabled: boolean) {
  return useQuery(speechDownloadProgressQueryOptions(enabled));
}

/** Installed models scanned from `app_data_dir/speech/models/`. */
export const speechModelsQueryOptions = queryOptions({
  enabled: isTauri,
  gcTime: 1000 * 60 * 5,
  networkMode: "offlineFirst",
  queryFn: async (): Promise<ModelInfo[]> => {
    if (!isTauri) {
      return [];
    }
    return await invoke<ModelInfo[]>("speech_list_models");
  },
  queryKey: ["speech", "models"] as const,
  retry: 1,
  staleTime: 1000 * 60,
});

export function useSpeechModels() {
  return useQuery(speechModelsQueryOptions);
}

/**
 * Tier-aware auto-download (Rust resolves low/medium/high from explicit
 * spec fields, navigator hints, or sysinfo) and guarantees the model is
 * present. Delegates to the `@manobu/speech/models` wrapper, which enriches
 * the spec with `detectPcSpec()` (navigator.deviceMemory/hardwareConcurrency)
 * before the invoke. Returns the resolved `ModelInfo`.
 */
export function useAutoDownloadModel() {
  return useMutation({
    mutationFn: async (spec: SpeechAutoSpec) => await autoDownload(spec),
    networkMode: "offlineFirst",
  });
}

/**
 * Ensure a specific model id is present (skips when already downloaded,
 * otherwise fetches the KNOWN_MODELS manifest entry). Mutation-style —
 * callers invalidate SPEECH_STATUS_QUERY_KEY on settle.
 */
export function useEnsureModel() {
  return useMutation({
    mutationFn: async (modelId: string) => {
      if (!isTauri) {
        throw new Error("model download only in Tauri desktop");
      }
      return await invoke<string>("speech_ensure_model", { modelId });
    },
    networkMode: "offlineFirst",
  });
}

// ---------------------------------------------------------------------------
// Cron (TASK-22) — read + write paths. 2026-09-14 (state audit): Settings
// ScheduledTasks hand-rolled useState + useEffect + a refresh() call after
// every mutation while its sibling SpeechModels used react-query. These
// options move the cron data into the same cache: one query owns the job
// list + run history, every mutation invalidates it, so a write refreshes
// the table without a manual refetch and the busy/error states come from
// the mutation, not component-local flags.
// ---------------------------------------------------------------------------

/* Module-private: the query options and the mutation invalidation below
 * are the only users; no surface selects by key (unlike
 * SPEECH_STATUS_QUERY_KEY, which SpeechModels imports). */
const CRON_JOBS_QUERY_KEY = ["cron", "jobs"] as const;
const CRON_HISTORY_QUERY_KEY = ["cron", "history"] as const;

/** The persisted job table (cron_list). */
export const cronJobsQueryOptions = queryOptions({
  enabled: isTauri,
  networkMode: "offlineFirst",
  queryFn: async (): Promise<ICronJob[]> => await cronList(),
  queryKey: CRON_JOBS_QUERY_KEY,
  staleTime: 1000 * 30,
});

/** The last 50 runs across all jobs (cron_history). */
export const cronHistoryQueryOptions = queryOptions({
  enabled: isTauri,
  networkMode: "offlineFirst",
  queryFn: async (): Promise<CronRunRecord[]> =>
    await cronHistory(undefined, 50),
  queryKey: CRON_HISTORY_QUERY_KEY,
  staleTime: 1000 * 30,
});

/**
 * A cron write that invalidates both the job table and the run history on
 * settle. `mutationFn` gets nothing — callers close over their payload.
 */
function useCronMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => await fn(args),
    networkMode: "offlineFirst",
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CRON_JOBS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: CRON_HISTORY_QUERY_KEY });
    },
  });
}

export function useCronUpsert() {
  return useCronMutation<ICronJob>((job) => cronUpsert(job));
}

export function useCronRemove() {
  return useCronMutation<string>((jobId) => cronRemove(jobId));
}

export function useCronRunNow() {
  return useCronMutation<string>((jobId) => cronRunNow(jobId));
}

export function useCronClearHistory() {
  return useCronMutation<string | undefined>((jobId) =>
    cronClearHistory(jobId)
  );
}
