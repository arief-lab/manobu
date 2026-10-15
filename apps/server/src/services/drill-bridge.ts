import { createHash, randomUUID } from "node:crypto";

import type {
  AcpDrillItem,
  AcpDrillItemEvent,
  AcpDrillResolution,
  AcpDrillSnapshot,
  AcpStreamEvent,
} from "@manobu/acp/acp-events";
import type { AcpSessionHandle } from "@manobu/acp/session-types";

import { toAcpDrillSnapshot } from "../chat-persistence";
import { settlePending as persistSettlePending } from "../chat-store";
import type {
  DrillLifecycle,
  DrillOpenResult,
  OpenDrillInput,
} from "./drill-lifecycle";

export type DrillBridgeErrorCode = "NOT_FOUND" | "UNAVAILABLE";

export class DrillBridgeError extends Error {
  readonly code: DrillBridgeErrorCode;

  constructor(
    code: DrillBridgeErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "DrillBridgeError";
    this.code = code;
  }
}

export interface DrillBridgeController {
  answerDrillItem: (
    requestId: string,
    resolution: AcpDrillResolution,
    snapshot?: AcpDrillSnapshot
  ) => boolean;
  emitDrillEvent?: (sessionId: string, event: AcpDrillItemEvent) => void;
  handleFor: (sessionId: string) => AcpSessionHandle | null;
  listConfirmations: (sessionId: string) => AcpStreamEvent[];
  parkDrillItem: (
    handle: AcpSessionHandle,
    drillSessionId: string,
    item: AcpDrillItem,
    snapshot: AcpDrillSnapshot,
    key?: string
  ) => { promise: Promise<AcpDrillResolution>; requestId: string };
  retireDrillItem?: (requestId: string) => boolean;
  stopDrillItem?: (requestId: string, snapshot?: AcpDrillSnapshot) => boolean;
}

export interface DrillConversationSession {
  handle: AcpSessionHandle;
  sessionId: string;
}

export interface DrillSessionOwner {
  conversationId: string;
}

export type GetDrillConversationSession = (
  conversationId: string
) => Promise<DrillConversationSession | null>;
export type GetDrillSessionOwner = (
  drillSessionId: string
) => Promise<DrillSessionOwner | null>;
export type SettleDrillPending = (
  conversationId: string,
  refId: string,
  status?: "finish" | "error",
  contentPatch?: Record<string, unknown>
) => Promise<void>;

export interface DrillBridgeOptions {
  controller: DrillBridgeController;
  getConversationSession: GetDrillConversationSession;
  getDrillSessionOwner: GetDrillSessionOwner;
  lifecycle: DrillLifecycle;
  settlePending?: SettleDrillPending;
}

export interface ParkedDrillItem {
  promise: Promise<AcpDrillResolution>;
  requestId: string;
}

export type DrillEventPublisher = (
  conversationId: string,
  event: AcpDrillItemEvent
) => Promise<void>;

interface DirectPendingDrill {
  conversationId: string;
  drillSessionId: string;
  event: AcpDrillItemEvent;
  publish: DrillEventPublisher;
}

interface PendingDrillSource {
  drillSessionId: string;
  event: AcpDrillItemEvent;
  publish: DrillEventPublisher | null;
}

export interface DrillAnswerInput {
  chosenIndex: number;
  conversationId: string;
  itemId: string;
  requestId: string;
}

export interface DrillAnswerOutput {
  resolution: AcpDrillResolution;
  snapshot: AcpDrillSnapshot;
}

export interface DrillSkipInput {
  conversationId: string;
  itemId: string;
  requestId: string;
}

export interface DrillSkipOutput {
  skipped: boolean;
  snapshot: AcpDrillSnapshot;
}

export interface DrillStopInput {
  conversationId: string;
  requestId: string;
}

export interface DrillStopOutput {
  snapshot: AcpDrillSnapshot;
  stopped: boolean;
}

export interface DrillBridge {
  answer: (input: DrillAnswerInput) => Promise<DrillAnswerOutput>;
  lifecycle: DrillLifecycle;
  open: (input: OpenDrillInput) => Promise<DrillOpenResult>;
  park: (input: {
    conversationId: string;
    drillSessionId: string;
  }) => Promise<ParkedDrillItem>;
  skip: (input: DrillSkipInput) => Promise<DrillSkipOutput>;
  start: (
    input: OpenDrillInput,
    publish: DrillEventPublisher
  ) => Promise<DrillOpenResult>;
  stop: (input: DrillStopInput) => Promise<DrillStopOutput>;
}

export const toAcpDrillItem = (item: {
  anchors: readonly string[];
  id: string;
  itemType: string;
  level: string;
  options: readonly string[];
  passage?: string | null;
  prompt: string;
}): AcpDrillItem => ({
  anchors: [...item.anchors],
  id: item.id,
  itemType: item.itemType,
  level: item.level,
  options: [...item.options],
  passage: item.passage ?? null,
  prompt: item.prompt,
});

const toAcpDrillResolution = (
  itemId: string,
  resolution: {
    chosenIndex: number;
    correct: boolean;
    correctIndex: number;
    correctOption: string;
    explanation: string | null;
  }
): AcpDrillResolution => ({
  chosenIndex: resolution.chosenIndex,
  correct: resolution.correct,
  correctIndex: resolution.correctIndex,
  correctOption: resolution.correctOption,
  explanation: resolution.explanation,
  itemId,
});

const drillStableKey = (
  drillSessionId: string,
  itemId: string,
  attemptId?: number
): string =>
  createHash("sha256")
    .update(`${drillSessionId}:${itemId}:${attemptId ?? "initial"}`)
    .digest("hex");

const isPendingDrill = (
  event: AcpStreamEvent
): event is Extract<AcpStreamEvent, { type: "drill_item" }> =>
  event.type === "drill_item";

const notFound = (message: string, cause?: unknown): DrillBridgeError =>
  new DrillBridgeError("NOT_FOUND", message, { cause });

const unavailable = (message: string): DrillBridgeError =>
  new DrillBridgeError("UNAVAILABLE", message);

const isAnswerable = (
  input: DrillAnswerInput,
  event: AcpDrillItemEvent
): boolean => {
  const { item } = event;
  return (
    item !== null &&
    item.id === input.itemId &&
    Number.isInteger(input.chosenIndex) &&
    input.chosenIndex >= 0 &&
    input.chosenIndex < item.options.length
  );
};

export const createDrillBridge = (options: DrillBridgeOptions): DrillBridge => {
  const settlePending = options.settlePending ?? persistSettlePending;
  const directPending = new Map<string, DirectPendingDrill>();

  const requireConversationSession = async (
    conversationId: string
  ): Promise<DrillConversationSession> => {
    const session = await options.getConversationSession(conversationId);
    if (!session || session.sessionId !== session.handle.sessionId) {
      throw notFound("No live session owns this conversation");
    }
    return session;
  };

  const requireDrillOwner = async (
    conversationId: string,
    drillSessionId: string
  ): Promise<void> => {
    const owner = await options.getDrillSessionOwner(drillSessionId);
    if (!owner || owner.conversationId !== conversationId) {
      throw notFound("No drill session owns this conversation");
    }
  };

  const findPending = async (
    conversationId: string,
    requestId: string
  ): Promise<PendingDrillSource> => {
    const direct = directPending.get(requestId);
    if (direct) {
      if (direct.conversationId !== conversationId) {
        throw notFound("No pending drill item for that request");
      }
      return {
        drillSessionId: direct.drillSessionId,
        event: direct.event,
        publish: direct.publish,
      };
    }
    const session = await requireConversationSession(conversationId);
    const pending = options.controller
      .listConfirmations(session.sessionId)
      .filter(isPendingDrill)
      .find((event) => event.request_id === requestId);
    if (!pending || pending.session_id !== session.sessionId) {
      throw notFound("No pending drill item for that request");
    }
    return {
      drillSessionId: pending.drill_session_id,
      event: pending,
      publish: null,
    };
  };

  const park = async (input: {
    conversationId: string;
    drillSessionId: string;
  }): Promise<ParkedDrillItem> => {
    const session = await requireConversationSession(input.conversationId);
    await requireDrillOwner(input.conversationId, input.drillSessionId);

    let draw: Awaited<ReturnType<DrillLifecycle["draw"]>>;
    try {
      draw = await options.lifecycle.draw(input.drillSessionId);
    } catch (error: unknown) {
      throw notFound(
        "No drill session is available for this conversation",
        error
      );
    }
    if (draw.kind !== "item") {
      let message = "No item right now";
      if (draw.kind === "paused") {
        message = "The drill is paused";
      } else if (draw.kind === "completed") {
        message = "The drill is complete";
      }
      throw unavailable(message);
    }

    return options.controller.parkDrillItem(
      session.handle,
      input.drillSessionId,
      toAcpDrillItem(draw.item),
      toAcpDrillSnapshot(draw.snapshot),
      drillStableKey(input.drillSessionId, draw.item.id, draw.attemptId)
    );
  };

  const publishNextDirect = async (
    conversationId: string,
    drillSessionId: string,
    publish: DrillEventPublisher,
    requestId: string
  ): Promise<void> => {
    const draw = await options.lifecycle.draw(drillSessionId);
    const request = randomUUID();
    if (draw.kind === "item") {
      const event: AcpDrillItemEvent = {
        drill_session_id: drillSessionId,
        item: toAcpDrillItem(draw.item),
        phase: "pending",
        request_id: request,
        session_id: "server",
        snapshot: toAcpDrillSnapshot(draw.snapshot),
        type: "drill_item",
      };
      directPending.set(request, {
        conversationId,
        drillSessionId,
        event,
        publish,
      });
      await publish(conversationId, event);
      return;
    }
    let phase: AcpDrillItemEvent["phase"] = "unavailable";
    if (draw.kind === "paused") {
      phase = "suspended";
    } else if (draw.kind === "completed") {
      phase = "summary";
    } else if (draw.kind === "pending") {
      phase = "pending";
    }
    await publish(conversationId, {
      drill_session_id: drillSessionId,
      item: null,
      phase,
      request_id: requestId,
      session_id: "server",
      snapshot: toAcpDrillSnapshot(draw.snapshot),
      type: "drill_item",
    });
  };

  const settleLifecycleAnswer = async (
    input: DrillAnswerInput,
    pending: PendingDrillSource
  ): Promise<Awaited<ReturnType<DrillLifecycle["settle"]>>> => {
    try {
      return await options.lifecycle.settle({
        chosenIndex: input.chosenIndex,
        itemId: input.itemId,
        responseQuality: "standard",
        sessionId: pending.drillSessionId,
      });
    } catch (error: unknown) {
      throw notFound("No pending drill item for that request", error);
    }
  };

  const resolveAnsweredDrill = async (
    input: DrillAnswerInput,
    pending: PendingDrillSource,
    resolution: AcpDrillResolution,
    snapshot: AcpDrillSnapshot
  ): Promise<void> => {
    if (pending.publish) {
      await pending.publish(input.conversationId, {
        ...pending.event,
        phase: "answered",
        resolution,
        snapshot,
      });
      directPending.delete(input.requestId);
      return;
    }
    if (
      !options.controller.answerDrillItem(input.requestId, resolution, snapshot)
    ) {
      throw notFound("No pending drill item for that request");
    }
  };

  const continueAfterAnswer = async (
    input: DrillAnswerInput,
    pending: PendingDrillSource
  ): Promise<void> => {
    if (pending.publish) {
      await publishNextDirect(
        input.conversationId,
        pending.drillSessionId,
        pending.publish,
        input.requestId
      );
      return;
    }
    try {
      await park({
        conversationId: input.conversationId,
        drillSessionId: pending.drillSessionId,
      });
    } catch (error: unknown) {
      if (!(error instanceof DrillBridgeError)) {
        throw error;
      }
    }
  };

  const answer = async (
    input: DrillAnswerInput
  ): Promise<DrillAnswerOutput> => {
    const pending = await findPending(input.conversationId, input.requestId);
    if (!isAnswerable(input, pending.event)) {
      throw notFound("No pending drill item for that request");
    }
    await requireDrillOwner(input.conversationId, pending.drillSessionId);

    const settlement = await settleLifecycleAnswer(input, pending);
    const resolution = toAcpDrillResolution(input.itemId, settlement.verdict);
    const snapshot = toAcpDrillSnapshot(settlement.snapshot);
    await resolveAnsweredDrill(input, pending, resolution, snapshot);
    await settlePending(input.conversationId, input.requestId, "finish", {
      phase: "answered",
      resolution,
      snapshot,
    });
    await continueAfterAnswer(input, pending);
    return { resolution, snapshot };
  };

  const skip = async (input: DrillSkipInput): Promise<DrillSkipOutput> => {
    const pending = await findPending(input.conversationId, input.requestId);
    if (pending.event.item?.id !== input.itemId) {
      throw notFound("No pending drill item for that request");
    }
    await requireDrillOwner(input.conversationId, pending.drillSessionId);
    const skipped = toAcpDrillSnapshot(
      await options.lifecycle.skip({
        itemId: input.itemId,
        sessionId: pending.drillSessionId,
      })
    );
    if (pending.publish) {
      directPending.delete(input.requestId);
      await pending.publish(input.conversationId, {
        ...pending.event,
        phase: "answered",
        resolution: {
          chosenIndex: -1,
          correct: false,
          correctIndex: -1,
          skipped: true,
        },
        snapshot: skipped,
      });
      await settlePending(input.conversationId, input.requestId, "finish", {
        phase: "answered",
        skipped: true,
        snapshot: skipped,
      });
      await publishNextDirect(
        input.conversationId,
        pending.drillSessionId,
        pending.publish,
        input.requestId
      );
    } else {
      if (!options.controller.stopDrillItem?.(input.requestId, skipped)) {
        options.controller.retireDrillItem?.(input.requestId);
      }
      await settlePending(input.conversationId, input.requestId, "finish", {
        phase: "answered",
        skipped: true,
        snapshot: skipped,
      });
      try {
        await park({
          conversationId: input.conversationId,
          drillSessionId: pending.drillSessionId,
        });
      } catch (error: unknown) {
        if (!(error instanceof DrillBridgeError)) {
          throw error;
        }
      }
    }
    return { skipped: true, snapshot: skipped };
  };

  const stop = async (input: DrillStopInput): Promise<DrillStopOutput> => {
    const pending = await findPending(input.conversationId, input.requestId);
    await requireDrillOwner(input.conversationId, pending.drillSessionId);
    const ended = await options.lifecycle.end(pending.drillSessionId);
    const snapshot = toAcpDrillSnapshot(ended);
    const event: AcpDrillItemEvent = {
      ...pending.event,
      item: null,
      phase: "summary",
      resolution: undefined,
      snapshot,
    };
    if (pending.publish) {
      directPending.delete(input.requestId);
      await pending.publish(input.conversationId, event);
    } else {
      if (!options.controller.stopDrillItem?.(input.requestId, snapshot)) {
        options.controller.retireDrillItem?.(input.requestId);
      }
      options.controller.emitDrillEvent?.(pending.event.session_id, event);
    }
    await settlePending(input.conversationId, input.requestId, "finish", {
      phase: "summary",
      snapshot,
    });
    return { snapshot, stopped: true };
  };

  const start = async (
    input: OpenDrillInput,
    publish: DrillEventPublisher
  ): Promise<DrillOpenResult> => {
    const result = await options.lifecycle.open(input);
    if (result.kind === "unavailable") {
      await publish(input.conversationId, {
        drill_session_id: `unavailable:${input.conversationId}`,
        item: null,
        phase: "unavailable",
        request_id: randomUUID(),
        session_id: "server",
        snapshot: {
          answered: 0,
          asked: 0,
          declaredCount: input.count,
          pendingRefill: false,
          readyCount: 0,
          remaining: input.count,
        },
        type: "drill_item",
      });
      return result;
    }
    if (result.draw.kind !== "item") {
      await publish(input.conversationId, {
        drill_session_id: result.snapshot.sessionId,
        item: null,
        phase: result.draw.kind === "pending" ? "pending" : "unavailable",
        request_id: randomUUID(),
        session_id: "server",
        snapshot: toAcpDrillSnapshot(result.draw.snapshot),
        type: "drill_item",
      });
      return result;
    }
    const drillSessionId = result.snapshot.sessionId;
    const event: AcpDrillItemEvent = {
      drill_session_id: drillSessionId,
      item: toAcpDrillItem(result.draw.item),
      phase: "pending",
      request_id: randomUUID(),
      session_id: "server",
      snapshot: toAcpDrillSnapshot(result.draw.snapshot),
      type: "drill_item",
    };
    directPending.set(event.request_id, {
      conversationId: input.conversationId,
      drillSessionId,
      event,
      publish,
    });
    await publish(input.conversationId, event);
    return result;
  };

  return {
    answer,
    lifecycle: options.lifecycle,
    open: options.lifecycle.open,
    park,
    skip,
    start,
    stop,
  };
};
