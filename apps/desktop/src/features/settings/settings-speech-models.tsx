import {
  classifyModelDownloadError,
  ensureModel,
  knownModels,
  removeModel,
  validateModel,
} from "@manobu/speech/models";
import { initStt } from "@manobu/speech/stt";
import type { ModelInfo, SpeechStatus } from "@manobu/speech/types";
import { initVad } from "@manobu/speech/vad";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useState } from "react";
import {
  SPEECH_STATUS_QUERY_KEY,
  useAutoDownloadModel,
  useEnsureModel,
  useSpeechDownloadProgress,
  useSpeechStatus,
} from "@/lib/tauri-queries";

/**
 * Offline speech-models section (TASK-21.4): surfaces `models_dir` +
 * tts/stt/vad readiness and the known STT manifests with per-model
 * [Download]. Download = `ensureModel(id)` (Rust resolves KNOWN_MODELS +
 * tar.bz2 extract into app_data_dir) then `validateModel(id)` (UUIuC
 * corrupt check) then `initStt(id)` so TASK-21.2 pronunciation grading
 * activates without leaving Settings. Status invalidation flows through
 * the ["speech","status"] query.
 */
/**
 * VAD row (TASK-21.3): shows Silero readiness with a standalone [Download]
 * that ensure→initVad→invalidates status. Extracted from SpeechModels to
 * keep the parent component under the complexity budget.
 */
const VadRow = ({
  busy,
  onDownload,
  ready,
}: {
  busy: boolean;
  onDownload: () => void;
  ready: boolean;
}): ReactNode => (
  <li
    className="flex items-center gap-2 text-sm"
    data-model="sherpa-onnx-silero-vad"
    data-testid="settings-speech-vad"
  >
    <span className="flex-1">
      Silero VAD (~1MB) · mic turn-taking + silence trim
    </span>
    {ready ? (
      <span className="text-muted-foreground text-xs">ready ✓</span>
    ) : (
      <button
        className="rounded-card border-2 border-border px-2 py-0.5 text-xs"
        data-busy={busy}
        data-testid="settings-speech-vad-download"
        disabled={busy}
        onClick={onDownload}
        type="button"
      >
        {busy ? "⏬ downloading…" : "[Download]"}
      </button>
    )}
  </li>
);

const STT_KINDS: readonly ModelInfo["kind"][] = [
  "stt_offline",
  "stt_streaming",
];

/** TASK-21.3 AC3: VAD auto-downloads alongside STT (never blocks a lesson). */
const VAD_MODEL_ID = "sherpa-onnx-silero-vad";

/**
 * Non-blocking VAD ensure (TASK-21.3 AC1/AC3): fetch the ~1MB Silero model
 * when absent, then `initVad` it so mic turn-taking + trimming activate.
 * Runs best-effort after an STT download; failures never surface as errors.
 */
const ensureVadAlongside = async (
  ensure: (modelId: string) => Promise<unknown>
): Promise<void> => {
  try {
    await ensure(VAD_MODEL_ID);
    await initVad();
  } catch {
    // VAD stays optional · the stub energy path keeps working (AC4).
  }
};

/** UUIuC recovery: strip the corrupt dir, then run the download again. */
const reDownload = async (modelId: string): Promise<void> => {
  await removeModel(modelId);
  await ensureModel(modelId);
};

/**
 * One STT model row (download / progress / corrupt-banner actions).
 * Extracted from SpeechModels (2026-09-14) to keep the parent under the
 * complexity budget · same treatment as VadRow.
 */
const SttModelRow = ({
  acked,
  busy,
  corrupt,
  desktop,
  model,
  onContinueOffline,
  onDownload,
  onReDownload,
  progress,
}: {
  acked: boolean;
  busy: boolean;
  corrupt: boolean;
  desktop: boolean;
  model: ModelInfo;
  onContinueOffline: (modelId: string) => void;
  onDownload: (modelId: string) => void;
  onReDownload: (modelId: string) => void;
  progress: string | null;
}): ReactNode => {
  const onDownloadClick = (): void => {
    onDownload(model.id);
  };
  const onReDownloadClick = (): void => {
    onReDownload(model.id);
  };
  const onContinueOfflineClick = (): void => {
    onContinueOffline(model.id);
  };
  return (
    <li
      className="flex flex-col gap-1"
      data-corrupt={corrupt}
      data-model={model.id}
      data-testid="settings-speech-model"
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="flex-1">{model.display_name}</span>
        {progress === null ? null : (
          <output
            aria-live="polite"
            className="font-mono text-muted-foreground text-xs"
            data-testid="settings-speech-progress"
          >
            ⏬ {progress}
          </output>
        )}
        {desktop ? (
          <button
            className="rounded-card border-2 border-border px-2 py-0.5 text-xs"
            data-busy={busy}
            data-testid="settings-speech-download"
            disabled={busy}
            onClick={onDownloadClick}
            type="button"
          >
            {busy ? "⏬ downloading…" : "[Download]"}
          </button>
        ) : null}
      </div>
      {corrupt && !acked && desktop ? (
        <div
          aria-live="polite"
          className="rounded-card border-2 border-destructive px-2 py-1 text-xs"
          data-testid="settings-speech-corrupt-banner"
          role="alert"
        >
          <p className="text-destructive">
            UUIuC · model corrupted (checksum/size mismatch). Type fallback and
            pitch diagrams keep working offline.
          </p>
          <div className="mt-1 flex gap-2">
            <button
              className="rounded-card border-2 border-border px-2 py-0.5"
              data-testid="settings-speech-redownload"
              disabled={busy}
              onClick={onReDownloadClick}
              type="button"
            >
              [Re-download]
            </button>
            <button
              className="rounded-card border-2 border-border px-2 py-0.5"
              data-testid="settings-speech-continue-offline"
              onClick={onContinueOfflineClick}
              type="button"
            >
              [Continue offline]
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
};

/** `models_dir · tts ✓ · stt · · vad ·` summary (desktop only). */
const StatusLine = ({ status }: { status: SpeechStatus }): ReactNode => (
  <p
    className="font-mono text-muted-foreground text-xs"
    data-testid="settings-speech-status"
  >
    {status.models_dir} · tts {status.tts_ready ? "✓" : "–"} · stt{" "}
    {status.stt_ready ? "✓" : "–"} · vad {status.vad_ready ? "✓" : "–"}
  </p>
);

/** The two tier-aware [Auto-pick] buttons (AC1). */
const AutoPickButtons = ({
  busy,
  onAutoDownload,
  onAutoStreaming,
}: {
  busy: boolean;
  onAutoDownload: () => void;
  onAutoStreaming: () => void;
}): ReactNode => (
  <div className="flex flex-wrap gap-2">
    <button
      className="self-start rounded-card border-2 border-border px-2 py-0.5 text-xs"
      data-busy={busy}
      data-testid="settings-speech-auto-download"
      disabled={busy}
      onClick={onAutoDownload}
      type="button"
    >
      {busy
        ? "⏬ picking model for your PC…"
        : "[Auto-pick for my PC] · best JA STT"}
    </button>
    <button
      className="self-start rounded-card border-2 border-border px-2 py-0.5 text-xs"
      data-busy={busy}
      data-streaming
      data-testid="settings-speech-auto-streaming"
      disabled={busy}
      onClick={onAutoStreaming}
      type="button"
    >
      {busy
        ? "⏬ picking model for your PC…"
        : "[Auto-pick] · live shadowing (streaming)"}
    </button>
  </div>
);

/** Copy-key → friendly message for the download-error alert region. */
const ERROR_KIND_MESSAGES: Record<string, string> = {
  disk_full: "k7SrUT · out of disk space. Free space and retry.",
  interrupted: "Download interrupted · retry to continue.",
  offline: "Download failed · check your connection and retry.",
};

/** Percent text for a progress entry, tolerant of unknown totals. */
const progressLabel = (p: { downloaded: number; total: number }): string =>
  p.total > 0
    ? `${Math.min(100, Math.round((p.downloaded / p.total) * 100))}%`
    : `${(p.downloaded / 1024 / 1024).toFixed(1)} MB`;

// CRAP is a coverage-weighted estimate: this is the Tauri-only settings
// surface (invoke-based model lifecycle), not runnable under bun test; its
// pure helpers (progressLabel, classifyModelDownloadError,
// ensureVadAlongside) are tested. Rows extracted to StatusLine/
// AutoPickButtons/SttModelRow/VadRow took cognitive 19→9; the CRAP flag
// remains an artifact of zero measured coverage.
// fallow-ignore-next-line complexity
export const SpeechModels = () => {
  const status = useSpeechStatus();
  const queryClient = useQueryClient();
  const ensureMutation = useEnsureModel();
  const autoMutation = useAutoDownloadModel();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<string | null>(null);
  const [corruptIds, setCorruptIds] = useState<readonly string[]>([]);
  const [offlineAck, setOfflineAck] = useState<readonly string[]>([]);
  const [autoBusy, setAutoBusy] = useState(false);
  const sttModels = knownModels().filter((m) => STT_KINDS.includes(m.kind));
  // Poll byte progress only while something is downloading.
  const downloading = busyId !== null || autoBusy;
  const progressQuery = useSpeechDownloadProgress(downloading);
  const progressFor = (modelId: string): string | null => {
    const entry = progressQuery.data?.find((p) => p.model_id === modelId);
    return entry !== undefined && !entry.done ? progressLabel(entry) : null;
  };

  const applyValidation = useCallback(
    (modelId: string, corrupt: boolean): void => {
      setCorruptIds((prev) => {
        if (!corrupt) {
          return prev.filter((id) => id !== modelId);
        }
        return prev.includes(modelId) ? prev : [...prev, modelId];
      });
    },
    []
  );

  /** Settle-time actions shared by ensure + auto paths. */
  const afterDownload = useCallback(
    async (modelId: string): Promise<void> => {
      const v = await validateModel(modelId);
      applyValidation(modelId, v.corrupt);
      if (v.corrupt) {
        return; // UUIuC · banner offers [Re-download] / [Continue offline]
      }
      await initStt(modelId, { language: "ja" });
      await queryClient.invalidateQueries({
        queryKey: [...SPEECH_STATUS_QUERY_KEY],
      });
      await queryClient.invalidateQueries({ queryKey: ["speech", "models"] });
      // TASK-21.3 AC3: bring VAD up with STT so turn-taking works without
      // a second manual download. Fire-and-forget · never blocks this flow.
      ensureVadAlongside((id) => ensureMutation.mutateAsync(id))
        .then(() =>
          queryClient.invalidateQueries({
            queryKey: [...SPEECH_STATUS_QUERY_KEY],
          })
        )
        .catch(() => undefined);
    },
    [applyValidation, ensureMutation, queryClient]
  );

  const fail = useCallback((e: unknown): void => {
    setError(e instanceof Error ? e.message : String(e));
    setErrorKind(classifyModelDownloadError(e));
  }, []);

  const download = useCallback(
    async (modelId: string): Promise<void> => {
      setBusyId(modelId);
      setError(null);
      setErrorKind(null);
      try {
        await ensureMutation.mutateAsync(modelId);
        await afterDownload(modelId);
      } catch (e) {
        fail(e);
      } finally {
        setBusyId(null);
      }
    },
    [afterDownload, ensureMutation, fail]
  );

  /**
   * Tier-aware alternative (AC1): lets Rust pick the model family from the
   * PC spec (low→small, high→full) instead of a fixed manifest id.
   */
  const autoDownload = useCallback(
    async (streaming: boolean): Promise<void> => {
      setAutoBusy(true);
      setError(null);
      setErrorKind(null);
      try {
        const info = await autoMutation.mutateAsync({
          language: "ja",
          streaming,
          task: "stt",
        });
        await afterDownload(info.id);
      } catch (e) {
        fail(e);
      } finally {
        setAutoBusy(false);
      }
    },
    [afterDownload, autoMutation, fail]
  );

  const onReDownload = useCallback(
    (modelId: string): void => {
      setOfflineAck((prev) => prev.filter((id) => id !== modelId));
      reDownload(modelId)
        .then(() => download(modelId))
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
          setErrorKind(classifyModelDownloadError(e));
        });
    },
    [download]
  );

  /** TASK-21.3: explicit [Download] for the VAD row · ensure → initVad → invalidate. */
  const [vadBusy, setVadBusy] = useState(false);
  const downloadVad = useCallback(async (): Promise<void> => {
    setVadBusy(true);
    setError(null);
    setErrorKind(null);
    try {
      await ensureMutation.mutateAsync(VAD_MODEL_ID);
      await initVad();
      await queryClient.invalidateQueries({
        queryKey: [...SPEECH_STATUS_QUERY_KEY],
      });
      await queryClient.invalidateQueries({ queryKey: ["speech", "models"] });
    } catch (e) {
      fail(e);
    } finally {
      setVadBusy(false);
    }
  }, [ensureMutation, fail, queryClient]);

  const onVadDownload = useCallback((): void => {
    downloadVad().catch(() => undefined);
  }, [downloadVad]);
  const onAutoDownload = useCallback((): void => {
    autoDownload(false).catch(() => undefined);
  }, [autoDownload]);
  const onAutoStreaming = useCallback((): void => {
    autoDownload(true).catch(() => undefined);
  }, [autoDownload]);

  const { data } = status;

  const vadRow = data ? (
    <VadRow busy={vadBusy} onDownload={onVadDownload} ready={data.vad_ready} />
  ) : null;

  const onContinueOffline = useCallback((modelId: string): void => {
    setOfflineAck((prev) =>
      prev.includes(modelId) ? prev : [...prev, modelId]
    );
  }, []);

  /** Stable per-row download dispatcher (errors handled in-state). */
  const onDownloadModel = useCallback(
    (modelId: string): void => {
      download(modelId).catch(() => undefined);
    },
    [download]
  );

  return (
    <section
      aria-label="Offline speech models"
      className="flex flex-col gap-2"
      data-testid="settings-speech-models"
    >
      <h3 className="font-medium text-sm">Offline speech models</h3>
      {data ? (
        <StatusLine status={data} />
      ) : (
        <p
          className="text-muted-foreground text-xs"
          data-testid="settings-speech-desktop-only"
        >
          Speech model management is available in the desktop app.
        </p>
      )}
      {data ? (
        <AutoPickButtons
          busy={autoBusy}
          onAutoDownload={onAutoDownload}
          onAutoStreaming={onAutoStreaming}
        />
      ) : null}
      <ul className="flex flex-col gap-1">
        {sttModels.map((m) => (
          <SttModelRow
            acked={offlineAck.includes(m.id)}
            busy={busyId === m.id}
            corrupt={corruptIds.includes(m.id)}
            desktop={!!data}
            key={m.id}
            model={m}
            onContinueOffline={onContinueOffline}
            onDownload={onDownloadModel}
            onReDownload={onReDownload}
            progress={busyId === m.id ? progressFor(m.id) : null}
          />
        ))}
        {data ? vadRow : null}
      </ul>
      {error ? (
        <p
          aria-live="polite"
          className="text-destructive text-xs"
          data-error-kind={errorKind ?? "error"}
          data-testid="settings-speech-error"
          role="alert"
        >
          {(errorKind !== null && ERROR_KIND_MESSAGES[errorKind]) || error}
        </p>
      ) : null}
      <p
        className="text-muted-foreground text-xs"
        data-testid="settings-speech-manual-fallback"
      >
        Manual fallback: download the tar.bz2 from
        k2-fsa.github.io/sherpa/onnx/pretrained_models/ and extract it to the
        models_dir above · models are fetched on demand, never bundled.
      </p>
    </section>
  );
};
