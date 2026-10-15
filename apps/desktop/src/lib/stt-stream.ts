/*
 * Streaming STT (TASK-21.5) — live Zipformer recognition for the
 * shadowing loop.
 *
 * Split per repo convention (logic in lib, hooks thin):
 *  - `createSttStreamController` — imperative start/stop state machine,
 *    unit-testable without React (bun test drives it with a fake capture)
 *  - `useSttStream` — thin React adapter mirroring controller state
 *
 * One controller drives one mic session at a time:
 *   start(sessionId) → mic opens, ~200ms ticks feed `acceptSttStreamChunk`,
 *   `partial` updates live, `onFinal` fires on endpoint detection
 *   (the backend stream resets; the session keeps running) →
 *   stop() → `finishSttStreamSession` flushes the tail and resolves the
 *   last utterance.
 *
 * Never throws: every failure lands in `error` with the `stt-stream:`
 * prefix, mirroring the `recordAndTranscribe` contract. The backend stub
 * (no Zipformer model) echoes `[stub stream] N` — surfaced as-is so callers
 * can degrade exactly like the offline `[stub STT]` path.
 */

import {
  acceptSttStreamChunk,
  closeSttStreamSession,
  createSttStreamSession,
  finishSttStreamSession,
  initSttStream,
  isSttStreamReady,
} from "@manobu/speech/stt";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type MicRecording,
  type MicTickListener,
  startMicCapture,
  type VadActivityListener,
} from "./mic-stt";

/** ReazonSpeech Zipformer JA — the only streaming STT manifest. */
export const STREAMING_STT_MODEL_ID =
  "sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01";

const STREAM_ERROR_PREFIX = "stt-stream:";

const isTauriShell = (): boolean =>
  typeof globalThis !== "undefined" &&
  Boolean((globalThis as Record<string, unknown>).__TAURI__);

export interface SttStreamHandlers {
  /**
   * VAD activity passthrough so the shared speaking indicator keeps
   * working during a streaming session (TASK-21.3 reuse).
   */
  onActivity?: VadActivityListener;
  /** Finalized utterance (endpoint detection or explicit stop). */
  onFinal?: (text: string) => void;
}

export interface SttStreamSnapshot {
  /** `stt-stream:*` error code; null while healthy. */
  error: string | null;
  listening: boolean;
  /** Running hypothesis (empty when idle or before the first chunk). */
  partial: string;
}

export interface SttStreamController extends SttStreamSnapshot {
  /** Open a session and start feeding mic ticks. Never throws. */
  start: (sessionId: string, handlers?: SttStreamHandlers) => Promise<void>;
  /** Finalize the session and stop the mic. Resolves the final text. */
  stop: () => Promise<string | null>;
  /** Subscribe to snapshot changes (the React adapter uses this). */
  subscribe: (listener: () => void) => () => void;
}

/**
 * Capture seam — defaults to real mic capture; tests inject a fake that
 * emits ticks through the returned `emitTick` (same shape as
 * `startMicCapture` opts so the production path stays identical).
 */
export interface SttStreamCaptureOpts {
  onActivity?: VadActivityListener;
  onTick?: MicTickListener;
}

export type SttStreamCapture = (
  opts: SttStreamCaptureOpts
) => Promise<MicRecording>;

export const createSttStreamController = (
  capture: SttStreamCapture = (opts) => startMicCapture(opts)
): SttStreamController => {
  let snapshot: SttStreamSnapshot = {
    error: null,
    listening: false,
    partial: "",
  };
  const listeners = new Set<() => void>();

  const set = (patch: Partial<SttStreamSnapshot>): void => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) {
      listener();
    }
  };

  let recording: MicRecording | null = null;
  let sessionId: string | null = null;
  let handlers: SttStreamHandlers = {};
  let starting = false;

  const teardownMic = async (): Promise<void> => {
    const current = recording;
    recording = null;
    await current?.stop().catch(() => undefined);
  };

  return {
    get error(): string | null {
      return snapshot.error;
    },
    get listening(): boolean {
      return snapshot.listening;
    },
    get partial(): string {
      return snapshot.partial;
    },
    async start(id: string, nextHandlers?: SttStreamHandlers): Promise<void> {
      if (starting) {
        return;
      }
      starting = true;
      // A live session restarts in place: finalize the previous mic first.
      if (sessionId) {
        await this.stop();
      }
      handlers = nextHandlers ?? {};
      set({ error: null, partial: "" });
      try {
        if (!isTauriShell()) {
          throw new Error("no-tauri");
        }
        if (!(await isSttStreamReady())) {
          // Model not loaded yet — try once (works after a mid-session
          // Settings download); a stub dir still initializes.
          await initSttStream(STREAMING_STT_MODEL_ID);
        }
        await createSttStreamSession(id);
        sessionId = id;
        const onTick: MicTickListener = (tick) => {
          const active = sessionId;
          if (!active) {
            return;
          }
          acceptSttStreamChunk(active, tick)
            .then((chunk) => {
              if (sessionId !== active) {
                return;
              }
              set({ partial: chunk.text });
              if (chunk.final && chunk.text.trim().length > 0) {
                handlers.onFinal?.(chunk.text.trim());
              }
            })
            .catch(() => {
              // Chunk failures are transient (session reset races);
              // keep listening rather than tearing the loop down.
            });
        };
        recording = await capture({
          onActivity: handlers.onActivity,
          onTick,
        });
        set({ listening: true });
      } catch {
        set({ error: `${STREAM_ERROR_PREFIX}unavailable` });
        sessionId = null;
        await teardownMic();
      } finally {
        starting = false;
      }
    },
    async stop(): Promise<string | null> {
      const id = sessionId;
      sessionId = null;
      set({ listening: false });
      await teardownMic();
      if (!id) {
        return null;
      }
      try {
        const result = await finishSttStreamSession(id);
        set({ partial: "" });
        const text = result.text.trim();
        if (text.length > 0) {
          handlers.onFinal?.(text);
        }
        return text.length > 0 ? text : null;
      } catch {
        set({ error: `${STREAM_ERROR_PREFIX}finish-failed` });
        return null;
      } finally {
        // Defensive: drop the backend session even if finish failed.
        await closeSttStreamSession(id).catch(() => undefined);
      }
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export interface UseSttStream extends SttStreamSnapshot {
  start: (sessionId: string, handlers?: SttStreamHandlers) => Promise<void>;
  stop: () => Promise<string | null>;
}

/** React adapter over one app-lifetime controller instance. */
export const useSttStream = (): UseSttStream => {
  const controllerRef = useRef<SttStreamController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createSttStreamController();
  }
  const controller = controllerRef.current;
  const [snapshot, setSnapshot] = useState<SttStreamSnapshot>({
    error: controller.error,
    listening: controller.listening,
    partial: controller.partial,
  });

  useEffect(
    () =>
      controller.subscribe(() => {
        setSnapshot({
          error: controller.error,
          listening: controller.listening,
          partial: controller.partial,
        });
      }),
    [controller]
  );

  // Unmount safety: never leak the mic.
  const activeController = controller;
  useEffect(
    () => () => {
      if (activeController.listening) {
        activeController.stop().catch(() => undefined);
      }
    },
    [activeController]
  );

  const start = useCallback(
    (sessionId: string, handlers?: SttStreamHandlers): Promise<void> =>
      controller.start(sessionId, handlers),
    [controller]
  );
  const stop = useCallback(
    (): Promise<string | null> => controller.stop(),
    [controller]
  );

  return { ...snapshot, start, stop };
};
