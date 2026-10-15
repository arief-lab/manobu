/*
 * The React hook that drives `chatEngine.ts` over a WS oRPC link.
 *
 * `useChatEngine` owns one per-instance `TMessage[]` (React `useState`)
 * plus the WS subscription lifecycle:
 *   - On mount / `conversationId` change: open `chat.subscribe`,
 *     for-await frames, fold each through `transformFrame`.
 *   - On socket drop (the iterator throws): resubscribe carrying
 *     `lastEventId` (AionUi bus semantics — no cancel-on-drop).
 *   - `send`: call `chat.send`, set the active `turnId` from the ack
 *     (the stale-turn guard's key).
 *   - TASK-104: a retryable terminal error (rate limit, timeout, empty
 *     response, connection reset) is CONSUMED before the fold and the turn
 *     is re-driven once automatically (`createRetryOrchestrator`); the
 *     transcript carries a `retry_notice` card instead of an error bubble.
 *   - `stop`: call `chat.cancel` with the active `turnId`.
 *   - `regenerate`: re-send the last user card's text.
 *   - `reset`: clear the card list and refs.
 *
 * The hook is transport-injectable: pass `opts.client` (a `ContractClient`
 * or any structural fake) to test without a real socket. The default
 * client is the shared `getChatWsClient()` live-turn client from `orpc.ts`.
 */

import type { ChatFrame } from "@manobu/api-contract";
import { getEventMeta } from "@orpc/client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  beginRetryNotice,
  classifyTerminalError,
  deriveStatus,
  dropRetryingNotice,
  type FrameCtx,
  type FrameStatus,
  type TMessage,
  transformFrame,
} from "./chat-engine";
import { classifySend, type SendOutcome } from "./composer-send";
import { getChatWsClient } from "./orpc";
import type { AcpCommand, ConfigOptionWire } from "./slash";

/** The client surface `useChatEngine` calls. The real `ContractClient`
 * satisfies this; test fakes implement the structural surface + cast. */
export interface ChatWsClient {
  chat: {
    cancel: (
      input: { conversationId: string; turnId: string },
      options?: unknown
    ) => Promise<{ cancelled: boolean }>;
    send: (
      input: {
        agent?: string;
        assistant?: string;
        conversationId: string;
        messages: Array<{ content: string; role: string }>;
        model?: string;
      },
      options?: unknown
    ) => Promise<{
      msg_id: string;
      runtime: {
        can_send_message: boolean;
        is_processing: boolean;
        pending_confirmations: number;
        state: string;
        turn_id: string | null;
      };
      turn_id: string;
    }>;
    subscribe: (
      input: { conversationId: string },
      options?: { lastEventId?: string }
    ) => AsyncIterable<ChatFrame>;
  };
}

export interface UseChatEngineOptions {
  agent?: string;
  assistant?: string;
  client?: ChatWsClient;
  initialMessages?: TMessage[];
  model?: string;
  /** TASK-80.5 (AC#1 data feed): the live `available_commands` frame ->
   * the composer's command-menu overlay; `version` is the server-stamped
   * `created_at` that gates stale pushes against the fresh snapshot. */
  onAvailableCommands?: (commands: AcpCommand[], version: number) => void;
  /** TASK-80.5 (AC#2 data feed): the live `acp_config_option` frame ->
   * the model/mode pickers' option list. */
  onConfigOptions?: (options: ConfigOptionWire[]) => void;
  readOnly?: boolean;
}

export interface UseChatEngineResult {
  isSending: boolean;
  messages: TMessage[];
  regenerate: () => void;
  reset: () => void;
  /**
   * TASK-100: the answer is part of the interface. A caller that wipes its
   * draft must know the engine actually took the text, so the accept/refuse
   * verdict is reported instead of being re-derived from `isSending`.
   */
  send: (text: string) => SendOutcome;
  status: FrameStatus;
  stop: () => void;
}

const IDLE_RESUBSCRIBE_MS = 1000;

interface SubscribeGate {
  notify: () => void;
  wait: () => Promise<void>;
}

const createSubscribeGate = (): SubscribeGate => {
  let pending = false;
  let resolve: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    notify: () => {
      pending = true;
      const wake = resolve;
      resolve = undefined;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      wake?.();
    },
    wait: () => {
      if (pending) {
        pending = false;
        return Promise.resolve();
      }
      return new Promise<void>((next) => {
        resolve = () => {
          if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
          }
          next();
        };
        timer = setTimeout(() => {
          timer = undefined;
          resolve = undefined;
          next();
        }, IDLE_RESUBSCRIBE_MS);
      });
    },
  };
};

/** The subscribe loop extracted to keep `useChatEngine` under the
 * cognitive-complexity threshold. Runs until `stopped` or the
 * component unmounts (`disposedRef`). TASK-80.14: the stream close is a
 * settle (one-shot turn replay semantics), so BOTH exit paths resubscribe
 * while the component lives; the server's coarse history replay makes the
 * resubscribe idempotent, and `lastEventId` is no longer a resume cursor
 * (the server ignores it) — it is kept only for debuggability. A clean
 * close parks on the wake gate before re-arming, so an idle conversation
 * does not recurse through resolved promises. */
export async function runSubscribeLoop(
  client: ChatWsClient,
  conversationId: string,
  lastEventIdRef: React.MutableRefObject<string | null>,
  isStopped: () => boolean,
  waitForWake: () => Promise<void>,
  onFrame: (frame: ChatFrame, _meta: { id?: string } | undefined) => void
): Promise<void> {
  // Drain one live stream into `onFrame`. Returns when the stream ends
  // (settle: the terminal frame was the last yield, per the 80.14 contract).
  // The real oRPC client's `chat.subscribe` resolves to the iterator
  // (`await` required — a fake test client that returns a bare generator
  // makes the `await` a pass-through, so both shapes work). The `for await`
  // lives here (not in a loop body) so `noAwaitInLoops` stays satisfied.
  async function drainStream(): Promise<void> {
    const iterator = await client.chat.subscribe(
      { conversationId },
      lastEventIdRef.current
        ? { lastEventId: lastEventIdRef.current }
        : undefined
    );
    for await (const frame of iterator) {
      if (isStopped()) {
        return;
      }
      const meta = getEventMeta(frame);
      if (meta?.id) {
        lastEventIdRef.current = meta.id;
      }
      onFrame(frame, meta);
    }
  }

  // Recurse instead of looping: one pass drains a stream to its settle
  // (clean close) or through a socket drop (throw); both re-enter while
  // the component lives. No `await` sits in a loop body. The drop path
  // backs off, while a clean close waits for a local send or the bounded
  // idle fallback before re-arming.
  const pass = async (): Promise<void> => {
    if (isStopped()) {
      return;
    }
    let backoffMs = 0;
    try {
      await drainStream();
    } catch {
      // Socket dropped mid-iterator (AionUi bus semantics): no
      // cancel-on-drop. Back off (bounded), then resubscribe — the coarse
      // replay repairs any gap.
      if (isStopped()) {
        return;
      }
      backoffMs = 1000;
    }
    if (isStopped()) {
      return;
    }
    if (backoffMs > 0) {
      const { promise: backoff, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, backoffMs);
      await backoff;
      if (isStopped()) {
        return;
      }
    } else {
      await waitForWake();
      if (isStopped()) {
        return;
      }
    }
    await pass();
  };

  await pass();
}

/**
 * One side-state frame -> the caller's overlay callbacks (TASK-80.5):
 * `available_commands` feeds the composer's command menu,
 * `acp_config_option` feeds the model/mode pickers. Neither produces a
 * card (chat-engine.ts folds card types only), so `handleFrame` stays
 * thin and the message state is untouched. Exported for the headless
 * tests (no DOM test environment in the workspace).
 */
export function dispatchSideState(
  frame: ChatFrame,
  opts: UseChatEngineOptions
): void {
  if (frame.type === "available_commands") {
    opts.onAvailableCommands?.(frame.data.commands, frame.created_at ?? 0);
    return;
  }
  if (frame.type === "acp_config_option") {
    opts.onConfigOptions?.(frame.data.configOptions);
  }
}

/** Deps for `createRetryOrchestrator` — every React/transport touchpoint
 * is a stable thunk so the orchestrator is a plain object the headless
 * tests can drive with a fake client (no DOM env in this package). */
export interface RetryOrchestratorDeps {
  /** The live WS client (thunk: the hook's ref stays authoritative). */
  client: () => ChatWsClient;
  /** The host subscription's dispose guard. */
  guard: () => boolean;
  /** Send identity for the re-drive (the hook's current opts slice). */
  identity: () => { agent?: string; assistant?: string; model?: string };
  /** The re-drive's ack REJECTED (e.g. CONVERSATION_BUSY raced us): the
   * host drops the stale "retrying" notice and settles to an error
   * status — same shape as a plain send failure. */
  onDriveFailed: () => void;
  /** A retry fired: the host injects the "retrying" notice and moves to
   * `submitted` (the transcript must not show an error bubble for an
   * error the policy already decided to re-drive, TASK-104 AC#1). */
  onRetryStarted: (frame: ChatFrame, reason: string) => void;
  /** The retried turn's ack arrived: the host moves to `streaming`. */
  onRetryStreaming: () => void;
  /** Adopt the re-drive's turn id as the active turn (the stale-turn
   * guard's key; the failed turn's stragglers then fold away). */
  setTurnId: (turnId: string) => void;
  /** Wake an idle subscription after the retry re-drive is accepted. */
  wake?: () => void;
}

export interface RetryOrchestrator {
  /** Frame-gate: returns true when the orchestrator CONSUMED the frame
   * (retry fired, or the failed turn's paired terminal frame) and the
   * caller must NOT fold it. */
  consume: (frame: ChatFrame) => boolean;
  /** Record a fresh learner send: refills the once-per-turn retry budget
   * and the text the re-drive replays. */
  noteSend: (text: string) => void;
  /** Drop all retry state (conversation switch / reset). */
  reset: () => void;
}

/**
 * The TASK-104 retry-once orchestrator. One instance per hook mount;
 * state is a closed set (budget, failed-turn id, last text), so the
 * headless tests cover the AC#5 boundary directly: a retryable terminal
 * error re-drives EXACTLY once per learner send, a second failure folds
 * its real error card, and a non-retryable failure never re-drives.
 *
 * Wire shape note: the server emits BOTH an `error` frame AND a
 * `finish(stopReason:"error")` per failed turn (chat-frames.ts:11), so
 * after consuming the first the orchestrator also swallows the failed
 * turn's remaining terminal frames (matched by `turn_id`) — otherwise
 * the pair's second frame would fold an error card anyway and the
 * status rules (status.ts rule 1) would pin the turn as failed.
 */
export function createRetryOrchestrator(
  deps: RetryOrchestratorDeps
): RetryOrchestrator {
  // One retry per learner send (noteSend refills it; manual `regenerate`
  // goes through send(), so it counts as a fresh send — intended).
  let budgetLeft = 0;
  // The failed turn whose terminal frames we already swallowed; its
  // paired frames must not resurrect the error. Cleared on next send.
  let failedTurnId: string | null = null;
  let lastText = "";

  return {
    consume(frame) {
      if (
        failedTurnId !== null &&
        frame.turn_id === failedTurnId &&
        classifyTerminalError(frame) !== null
      ) {
        return true;
      }
      const decision = classifyTerminalError(frame);
      if (decision === null || !decision.retryable || budgetLeft <= 0) {
        return false;
      }
      budgetLeft -= 1;
      failedTurnId = frame.turn_id ?? null;
      const { agent, assistant, model } = deps.identity();
      deps.onRetryStarted(frame, decision.reason ?? "upstream error");
      deps
        .client()
        .chat.send({
          agent,
          assistant,
          conversationId: frame.conversation_id,
          messages: [{ content: lastText, role: "user" }],
          model,
        })
        .then((ack) => {
          if (deps.guard()) {
            deps.setTurnId(ack.turn_id);
            deps.onRetryStreaming();
            deps.wake?.();
          }
        })
        .catch(() => {
          if (deps.guard()) {
            deps.onDriveFailed();
          }
        });
      return true;
    },
    noteSend(text) {
      budgetLeft = 1;
      failedTurnId = null;
      lastText = text;
    },
    reset() {
      budgetLeft = 0;
      failedTurnId = null;
      lastText = "";
    },
  };
}

/** The live-frame fold, as a dependency-injected factory.
 *
 * REGRESSION PIN (2026-09-20): the stale-frame guard is `!guard()` —
 * `guard()` is TRUE when the engine is alive, so `if (guard()) return;`
 * drops every frame on the healthy path (commit 585db4b shipped exactly
 * that inversion; the fake-client tests bypass this handler and could
 * not see it — only the live UI could). The factory is exported so the
 * guard semantics are exercised headlessly: an "alive" engine MUST fold
 * frames, a disposed one MUST drop them.
 *
 * TASK-104: `consumeRetry` runs BEFORE the fold — a retryable terminal
 * error the orchestrator re-drove must never reach `transformFrame`
 * (folding it would show an error bubble and, via status.ts rule 1,
 * pin the turn as failed).
 *
 * `setMessages`/`setStatus` take React's functional-updater / value
 * signatures so the hook can pass its `useState` setters unchanged. */
export function createFrameHandler(params: {
  consumeRetry?: ((frame: ChatFrame) => boolean) | undefined;
  guard: () => boolean;
  setMessages: (updater: (prev: TMessage[]) => TMessage[]) => void;
  setStatus: (status: FrameStatus) => void;
  sideStateRef: { current: UseChatEngineOptions };
  turnIdRef: { current: string | null };
}): (frame: ChatFrame, meta?: { id?: string }) => void {
  return (frame, _meta) => {
    if (!params.guard()) {
      return;
    }
    if (params.consumeRetry?.(frame)) {
      return;
    }
    const ctx: FrameCtx = { turnId: params.turnIdRef.current ?? undefined };
    params.setMessages((prev) => {
      const next = transformFrame(prev, frame, ctx);
      params.setStatus(deriveStatus(next, frame));
      return next;
    });
    dispatchSideState(frame, params.sideStateRef.current);
  };
}

/**
 * The chat engine hook. One instance per mounted
 * `<ChatSessionProvider`; state is per-instance (multi-mount contract).
 */
export function useChatEngine(
  conversationId: string,
  opts: UseChatEngineOptions
): UseChatEngineResult {
  const { agent, assistant, client, initialMessages, model, readOnly } = opts;
  const clientRef = useRef<ChatWsClient>(
    client ?? (getChatWsClient() as unknown as ChatWsClient)
  );
  // Keep the ref fresh if opts.client changes (e.g. provider re-mount
  // with a new fake in tests).
  useEffect(() => {
    if (client) {
      clientRef.current = client;
    }
  }, [client]);

  const [messages, setMessages] = useState<TMessage[]>(
    () => initialMessages ?? []
  );
  const [status, setStatus] = useState<FrameStatus>("idle");

  // The active turn id (stale-turn guard key); null = no turn in flight.
  const turnIdRef = useRef<string | null>(null);
  // The last delivered event seq (oRPC withEventMeta id, AionUi parity);
  // carried on resubscribe after a socket drop.
  const lastEventIdRef = useRef<string | null>(null);
  const subscribeGateRef = useRef<SubscribeGate | null>(null);
  if (subscribeGateRef.current === null) {
    subscribeGateRef.current = createSubscribeGate();
  }
  // Tracks the current subscription's cancellation; a stale for-await
  // loop (after conversationId changed or reset) must not fold frames
  // into a new messages state.
  const disposedRef = useRef(false);

  const isSending = status === "submitted" || status === "streaming";
  // Guard against a stable-identity closure: it closes over the ref, so
  // useCallback([]) keeps it referentially stable — safe to list in the
  // deps of the callbacks that consult it (useExhaustiveDependencies).
  const guard = useCallback(() => !disposedRef.current, []);

  // Fold one frame into the card list AND derive the new status in a
  // single setMessages call so the UI sees a consistent snapshot.
  // TASK-80.5: the side-state callbacks are read through a ref so
  // `handleFrame` stays referentially stable (a dep on `opts` would
  // restart the subscribe loop on every render).
  const sideStateRef = useRef(opts);
  useEffect(() => {
    sideStateRef.current = opts;
  });

  // TASK-104: the retry-once orchestrator. Lazily created ONCE: its state
  // is a plain closure (budget / failed-turn id / last text), consulted
  // only from frame handling and side effects, so it stays referentially
  // stable across renders and the headless tests can build one directly.
  const retryRef = useRef<RetryOrchestrator | null>(null);
  if (retryRef.current === null) {
    retryRef.current = createRetryOrchestrator({
      client: () => clientRef.current,
      guard,
      identity: () => sideStateRef.current,
      onDriveFailed: () => {
        setMessages((prev) => dropRetryingNotice(prev));
        setStatus("error");
      },
      onRetryStarted: (frame, reason) => {
        setMessages((prev) => beginRetryNotice(prev, frame, reason));
        setStatus("submitted");
      },
      onRetryStreaming: () => {
        setStatus("streaming");
      },
      setTurnId: (turnId) => {
        turnIdRef.current = turnId;
      },
      wake: () => {
        subscribeGateRef.current?.notify();
      },
    });
  }

  // The handler body lives in the exported `createFrameHandler` factory
  // so the guard semantics are unit-testable (2026-09-20 regression: an
  // inverted guard silently dropped every live frame and the fake-client
  // tests could not see it — this factory is where that class is pinned).
  const handleFrame = useCallback(
    createFrameHandler({
      consumeRetry: (frame) => retryRef.current?.consume(frame) ?? false,
      guard,
      setMessages,
      setStatus,
      sideStateRef,
      turnIdRef,
    }),
    // setState setters are stable by contract; `guard` is useCallback-
    // stable with an empty dep list, so an empty array is correct here.
    []
  );

  // Subscribe lifecycle: one useEffect per conversationId.
  useEffect(() => {
    if (readOnly) {
      // No live frames for a read-only viewer; the provider's persisted
      // state (loaded from localStorage on mount) is the transcript.
      return;
    }
    disposedRef.current = false;
    // TASK-104: a conversation switch (or re-subscription after unmount)
    // starts with a clean retry slate.
    retryRef.current?.reset();
    let stopped = false;
    const subscribeGate = subscribeGateRef.current ?? createSubscribeGate();
    subscribeGateRef.current = subscribeGate;

    runSubscribeLoop(
      clientRef.current,
      conversationId,
      lastEventIdRef,
      () => stopped || disposedRef.current,
      subscribeGate.wait,
      handleFrame
    );

    return () => {
      stopped = true;
      disposedRef.current = true;
      subscribeGate.notify();
    };
  }, [conversationId, handleFrame, readOnly]);

  const send = useCallback(
    (text: string): SendOutcome => {
      const outcome = classifySend({ isSending, text });
      if (outcome !== "accepted") {
        return outcome;
      }
      const trimmed = text.trim();
      // TASK-104: a learner send refills the once-per-turn retry budget
      // and records the text the auto-retry replays (the server re-drives
      // with a fresh turn; the transcript already shows the user row).
      retryRef.current?.noteSend(trimmed);
      // The user's row appears as a user_created card when the server's
      // frame arrives on the live subscription (near-instant over a live
      // socket); no optimistic append needed. Status goes to submitted
      // immediately so the UI shows the "thinking" indicator.
      setStatus("submitted");

      clientRef.current.chat
        .send({
          agent,
          assistant,
          conversationId,
          messages: [{ content: trimmed, role: "user" }],
          model,
        })
        .then((ack) => {
          if (guard()) {
            turnIdRef.current = ack.turn_id;
            setStatus("streaming");
            subscribeGateRef.current?.notify();
          }
        })
        .catch(() => {
          // chat.send failed (e.g. CONVERSATION_BUSY): surface as an
          // error status; the user can retry.
          if (guard()) {
            turnIdRef.current = null;
            setStatus("error");
          }
        });
      // The engine took the text; whether the composer may forget it is the
      // provider's call (composer-send.ts), not this function's side effect.
      return "accepted";
    },
    [agent, assistant, conversationId, isSending, model, guard]
  );

  const stop = useCallback(() => {
    const turnId = turnIdRef.current;
    if (turnId === null) {
      return;
    }
    clientRef.current.chat
      .cancel({ conversationId, turnId })
      .then(() => {
        if (guard()) {
          turnIdRef.current = null;
          setStatus("idle");
        }
      })
      .catch(() => {
        // Cancel failed; the turn may already be done — clear the
        // active-turn ref and settle to idle.
        if (guard()) {
          turnIdRef.current = null;
          setStatus("idle");
        }
      });
  }, [conversationId, guard]);

  const regenerate = useCallback(() => {
    // Find the last user card in the list and re-send its text (a
    // no-op when the list has no user card, or a turn is in flight).
    if (isSending) {
      return;
    }
    const lastUserCard = messages.find((m) => m.type === "user_created");
    if (lastUserCard && lastUserCard.type === "user_created") {
      send(lastUserCard.text);
    }
  }, [isSending, messages, send]);

  const reset = useCallback(() => {
    // Wipe the card list; the next frame / subscription re-fills it
    // (the provider's selectAgent/selectPersona handlers call this
    // to start a fresh conversation — same semantics as the old
    // setMessages([]) on useChat).
    turnIdRef.current = null;
    lastEventIdRef.current = null;
    retryRef.current?.reset();
    setMessages([]);
    setStatus("idle");
  }, []);

  return {
    isSending,
    messages,
    regenerate,
    reset,
    send,
    status,
    stop,
  };
}
