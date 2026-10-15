import { asyncIteratorObject, oc } from "@orpc/contract";
import { z } from "zod";

import {
  ChatFrameSchema,
  DrillItemSchema,
  DrillResolutionSchema,
  DrillSnapshotSchema,
} from "./schemas/chat-frames";

export type { ChatFrame } from "./schemas/chat-frames";

/**
 * Chat contract (TASK-80.2) — the native-ACP chat surface, inspired by
 * AionUi's adapter semantics (prompt returns an ack; IResponseMessage frames
 * arrive separately; turn survives socket drop; dedicated ask-answer channel)
 * but mapped onto oRPC: live-turn procedures ride the WebSocket RPCHandler,
 * persisted-state reads ride the existing fetch /rpc router. One contract,
 * one implementer, two handlers.
 */

const ConversationIdInput = z.object({
  conversationId: z.string().min(1),
});
const NotFoundError = z.object({ message: z.string() });
const BusyError = z.object({ message: z.string() });
const ConfigSwitchError = z.object({ message: z.string() });

/** Shared chat error codes — handlers throw these via `errors.CODE()`. */
const chatErrors = {
  CONFIG_SWITCH_FAILED: { data: ConfigSwitchError },
  CONVERSATION_BUSY: { data: BusyError },
  NOT_FOUND: { data: NotFoundError },
} as const;

/**
 * One prompt message. `content` is the text the engine sends; the AionUi
 * prompt-file injection (files as resource blocks at the send edge) is an
 * unported feature, so there is no files field on the wire (TASK-80.8).
 */
const PromptMessageSchema = z.looseObject({
  content: z.string(),
  role: z.enum(["assistant", "system", "user"]),
});

/** ── WS link: live-turn surface ─────────────────────────────────────── */

/**
 * Per-conversation frame stream (TASK-80.14 live/durable split). On connect
 * the subscriber gets a coarse, idempotent history replay (persisted rows,
 * `replace: true`), then the in-flight turn's live frames off an in-memory
 * ring. The stream CLOSES on the turn's terminal `finish`/`error` frame
 * (stream-close = settled); a resubscribe replays history + the live tail.
 * `lastEventId` is accepted for wire compatibility but ignored: the coarse
 * replay is the resume mechanism (the per-frame seq-cursor replay was
 * dropped with the TASK-80.7 design).
 */
const subscribe = oc
  .input(ConversationIdInput)
  .output(asyncIteratorObject(ChatFrameSchema));

/** Start one turn: ensures the conversation, returns the ack immediately
 * (frames flow via `subscribe`). Throws CONVERSATION_BUSY while the gate
 * is held. */
const send = oc
  .input(
    z.object({
      agent: z.string().trim().min(1).optional(),
      assistant: z.string().trim().min(1).optional(),
      conversationId: z.string().min(1),
      messages: z.array(PromptMessageSchema).min(1),
      model: z.string().trim().min(1).optional(),
    })
  )
  .output(
    z.object({
      msg_id: z.string(),
      runtime: z.looseObject({
        can_send_message: z.boolean(),
        is_processing: z.boolean(),
        pending_confirmations: z.number(),
        state: z.string(),
        turn_id: z.string().nullable(),
      }),
      turn_id: z.string(),
    })
  )
  .errors(chatErrors);

/** Answer a parked permission (engine echoes a real offered option id). */
const confirm = oc
  .input(
    z.object({
      alwaysAllow: z.boolean().optional(),
      callId: z.string().min(1),
      conversationId: z.string().min(1),
      data: z.string(),
      msgId: z.string().optional(),
    })
  )
  .output(z.object({ settled: z.boolean() }))
  .errors({ NOT_FOUND: { data: NotFoundError } });

/** Resolve a parked ask_user question set; decline = explicit deny. */
const answerAsk = oc
  .input(
    z.object({
      answers: z
        .array(
          z.object({
            labels: z.array(z.string()),
            question: z.string(),
          })
        )
        .optional(),
      conversationId: z.string().min(1),
      decline: z.boolean().optional(),
      requestId: z.string().min(1),
    })
  )
  .output(z.object({ settled: z.boolean() }))
  .errors({ NOT_FOUND: { data: NotFoundError } });

const answerDrillItem = oc
  .input(
    z.object({
      chosenIndex: z.number().int().nonnegative(),
      conversationId: z.string().min(1),
      itemId: z.string().min(1),
      requestId: z.string().min(1),
    })
  )
  .output(
    z.object({
      resolution: DrillResolutionSchema,
      snapshot: DrillSnapshotSchema,
    })
  )
  .errors({ NOT_FOUND: { data: NotFoundError } });

const startDrill = oc
  .input(
    z.object({
      anchors: z.array(z.string().min(1)).min(1),
      conversationId: z.string().min(1),
      count: z.number().int().min(1).max(30),
      itemId: z.string().min(1).optional(),
      level: z.string().min(1),
      seed: z.string().min(1),
      tier: z.literal("2"),
    })
  )
  .output(
    z.discriminatedUnion("kind", [
      z.object({
        item: DrillItemSchema.nullable(),
        kind: z.literal("opened"),
        phase: z.enum([
          "answered",
          "pending",
          "suspended",
          "summary",
          "unavailable",
        ]),
        sessionId: z.string().min(1),
        snapshot: DrillSnapshotSchema,
      }),
      z.object({
        kind: z.literal("unavailable"),
        reason: z.string(),
      }),
    ])
  );

const skipDrill = oc
  .input(
    z.object({
      conversationId: z.string().min(1),
      itemId: z.string().min(1),
      requestId: z.string().min(1),
    })
  )
  .output(
    z.object({
      skipped: z.boolean(),
      snapshot: DrillSnapshotSchema,
    })
  )
  .errors({ NOT_FOUND: { data: NotFoundError } });

const stopDrill = oc
  .input(
    z.object({
      conversationId: z.string().min(1),
      requestId: z.string().min(1),
    })
  )
  .output(
    z.object({
      snapshot: DrillSnapshotSchema,
      stopped: z.boolean(),
    })
  )
  .errors({ NOT_FOUND: { data: NotFoundError } });

/** Cancel an in-flight turn (session/cancel + queue-slot release). */
const cancel = oc
  .input(z.object({ conversationId: z.string().min(1), turnId: z.string() }))
  .output(z.object({ cancelled: z.boolean() }));

/** Kill one hosted terminal child without cancelling the turn. */
const killTerminal = oc
  .input(
    z.object({ conversationId: z.string().min(1), terminalId: z.string() })
  )
  .output(z.object({ killed: z.boolean() }));

/** Pending permission/ask cards for recovery (live engine parks, not rows). */
const listConfirmations = oc
  .input(ConversationIdInput)
  .output(
    z.object({
      confirmations: z.array(
        z
          .object({
            data: z.unknown(),
            msg_id: z.string(),
            type: z.enum(["acp_permission", "ask", "drill_item"]),
          })
          .passthrough()
      ),
      turn_id: z.string().nullable(),
    })
  )
  .errors({ NOT_FOUND: { data: NotFoundError } });

/** ── fetch link: persisted-state surface ────────────────────────────── */

/**
 * One row of the history list (TASK-101). `agent`/`assistant` are the
 * binding the conversation was created with: the client MUST resume a
 * conversation on its own agent, because the stored `acp_session_id` is an
 * ACP session of that CLI and `session/load` on another one cannot work.
 * `updatedAt` is the recency stamp (bumped by every turn) and
 * `messageCount` is the persisted frame rows, so a list can show a size
 * without a second query per row.
 */
const ConversationSummarySchema = z.object({
  agent: z.string().nullable(),
  assistant: z.string().nullable(),
  id: z.string(),
  messageCount: z.number().int().nonnegative(),
  title: z.string().nullable(),
  updatedAt: z.string(),
});

/**
 * Keyset cursor for the history page: the `(updatedAt, id)` pair of the
 * last row served. `id` breaks timestamp ties, so the walk is total.
 */
const HistoryCursorSchema = z.object({
  id: z.string().min(1),
  updatedAt: z.string().min(1),
});

/** The single conversation behind an id (NOT_FOUND when it never existed). */
const getConversation = oc
  .input(ConversationIdInput)
  .output(ConversationSummarySchema)
  .errors({ NOT_FOUND: { data: NotFoundError } });

/**
 * Conversations the learner has had, most recently active first. Bounded:
 * `limit` defaults to 50 and caps at 100, and a page is only complete when
 * `nextCursor` is null. Ordering is by activity, not by id, because a
 * conversation's whole point is that a later turn moves it back to the top.
 */
const listConversations = oc
  .input(
    z.object({
      before: HistoryCursorSchema.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
  )
  .output(
    z.object({
      conversations: z.array(ConversationSummarySchema),
      nextCursor: HistoryCursorSchema.nullable(),
    })
  );

/** Rename a conversation. Returns the updated row so a list can patch in place. */
const renameConversation = oc
  .input(
    z.object({
      conversationId: z.string().min(1),
      title: z.string().trim().min(1).max(120),
    })
  )
  .output(z.object({ conversation: ConversationSummarySchema }))
  .errors({ NOT_FOUND: { data: NotFoundError } });

/**
 * Delete a conversation AND its message rows (the FK cascade is the point;
 * `messagesDeleted` is the proof, counted before the delete). Throws
 * CONVERSATION_BUSY while a turn is in flight rather than pulling the rows
 * out from under a live sink.
 */
const deleteConversation = oc
  .input(ConversationIdInput)
  .output(
    z.object({
      deleted: z.boolean(),
      messagesDeleted: z.number().int().nonnegative(),
    })
  )
  .errors({
    CONVERSATION_BUSY: { data: BusyError },
    NOT_FOUND: { data: NotFoundError },
  });

/** One persisted frame row (AionUi message-row shape). `type` is the frame
 * discriminator the row was stored under, so a reader can rebuild the wire
 * frame from the row alone (TASK-101: the history transcript fold). */
const MessageRowSchema = z.looseObject({
  content: z.string(),
  conversation_id: z.string(),
  created_at: z.string(),
  hidden: z.boolean(),
  id: z.number(),
  msg_id: z.string(),
  ref_id: z.string().nullable(),
  status: z.string(),
  turn_id: z.string().nullable(),
  type: z.string(),
  ui_id: z.string().nullable(),
});

/** Keyset page, oldest-first within the page; `before` = message id cursor. */
const listMessages = oc
  .input(
    z.object({
      before: z.number().int().optional(),
      conversationId: z.string().min(1),
      limit: z.number().int().min(1).max(200).optional(),
    })
  )
  .output(z.object({ messages: z.array(MessageRowSchema) }))
  .errors({ NOT_FOUND: { data: NotFoundError } });

/** Slash commands for the composer (authoritative snapshot, HTTP analogue
 * of AionUi's GET slash-commands; the live overlay is the frame stream). */
const slashCommands = oc
  .input(ConversationIdInput)
  .output(
    z.object({
      commands: z.array(
        z.looseObject({
          description: z.string(),
          input: z
            .looseObject({ hint: z.string().optional() })
            .nullable()
            .optional(),
          name: z.string(),
        })
      ),
    })
  )
  .errors({ NOT_FOUND: { data: NotFoundError } });

/** Model/mode/generic config switch (ACP session/set_config_option path). */
const setConfigOption = oc
  .input(
    z.object({
      conversationId: z.string().min(1),
      optionId: z.string().min(1),
      value: z.union([z.string(), z.boolean()]),
    })
  )
  .output(
    z.object({
      configOptions: z.array(
        z.looseObject({
          currentValue: z.union([z.string(), z.boolean()]),
          id: z.string(),
          options: z.array(z.looseObject({ value: z.string() })),
          type: z.enum(["select", "boolean"]),
        })
      ),
    })
  )
  .errors(chatErrors);

export const chatContract = {
  answerAsk,
  answerDrillItem,
  cancel,
  confirm,
  deleteConversation,
  getConversation,
  killTerminal,
  listConfirmations,
  listConversations,
  listMessages,
  renameConversation,
  send,
  setConfigOption,
  skipDrill,
  slashCommands,
  startDrill,
  stopDrill,
  subscribe,
};
