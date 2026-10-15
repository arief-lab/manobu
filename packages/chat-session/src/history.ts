/*
 * Conversation history reads (TASK-101).
 *
 * The learner's past chats live in user.db, so every query here goes to the
 * server: the list is `chat.listConversations` (keyset-paged, most recent
 * turn first) and a transcript is `chat.listMessages` folded through the
 * SAME reducer the live stream uses. That fold is why a conversation still
 * opens on a device profile whose localStorage was cleared: nothing here
 * reads the blob.
 */

import type { ContractClient } from "@manobu/api-contract";
import { ChatFrameSchema } from "@manobu/api-contract/schemas/chat-frames";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { type TMessage, transformFrame } from "./chat-engine";
import { orpc } from "./orpc";

/** Rows per history page. The server clamps its own page at 100. */
export const HISTORY_PAGE_SIZE = 50;

/** One row of the history list, derived from the contract (no mirrored type). */
export type ConversationSummary = Awaited<
  ReturnType<ContractClient["chat"]["getConversation"]>
>;

/** The keyset cursor the server hands back for the next page. */
export type HistoryCursor = NonNullable<
  Awaited<ReturnType<ContractClient["chat"]["listConversations"]>>["nextCursor"]
>;

/** One persisted frame row. */
export type MessageRow = Awaited<
  ReturnType<ContractClient["chat"]["listMessages"]>
>["messages"][number];

const STALE_TIME = 1000 * 60;

/**
 * The infinite history list: page 1 is the most recent chats, and each
 * further page continues from the cursor the previous page returned
 * (`useInfiniteQuery` feeds `pageParam` back in). Bounded by design: a
 * learner with 500 chats loads 50.
 */
export const conversationHistoryQueryKey = ["chat", "history"] as const;

/** The page shape `chat.listConversations` serves (derived, not mirrored). */
type HistoryPage = Awaited<
  ReturnType<ContractClient["chat"]["listConversations"]>
>;

export function conversationHistoryQueryOptions() {
  return infiniteQueryOptions({
    getNextPageParam: (lastPage: HistoryPage) =>
      lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as HistoryCursor | undefined,
    queryFn: ({ pageParam }: { pageParam: HistoryCursor | undefined }) =>
      orpc.chat.listConversations({
        before: pageParam,
        limit: HISTORY_PAGE_SIZE,
      }),
    queryKey: conversationHistoryQueryKey,
    staleTime: STALE_TIME,
  });
}

/**
 * The cache key for one page of one conversation's persisted rows. Exposed
 * so an invalidation (a paper frame landing in the transcript) does not have
 * to build the whole queryOptions for it, and does not have to answer the
 * TASK-157 `known` gate it is not gating.
 */
export function messageHistoryQueryKey(
  conversationId: string,
  before?: number
): readonly [string, string, string, number] {
  return ["chat", "messages", conversationId, before ?? -1];
}

/**
 * The persisted transcript of one conversation: a newest-last page of frame
 * rows, keyset-paged backwards on the row id (`before` is the oldest id the
 * caller already has).
 *
 * `known` is the gate (TASK-157). The server answers for a conversation it
 * holds (a stored row or a stored ACP session id), so the caller has to say
 * whether this id is one the server told it about. The old test,
 * `conversationId.length > 0`, proved nothing: the id is minted client-side
 * by `crypto.randomUUID()` (provider-initial.ts), so every fresh chat passed
 * it and took a NOT_FOUND before the learner typed a word. A conversation
 * that IS known but has no rows is still NOT_FOUND, so the caller treats
 * that as an empty transcript rather than an error.
 */
export function messageHistoryQueryOptions(input: {
  before?: number;
  conversationId: string;
  known: boolean;
}) {
  const { before, conversationId, known } = input;
  return queryOptions({
    enabled: known,
    queryFn: async (): Promise<MessageRow[]> => {
      try {
        const { messages } = await orpc.chat.listMessages({
          before,
          conversationId,
          limit: 200,
        });
        return messages;
      } catch (error) {
        if ((error as { code?: string }).code === "NOT_FOUND") {
          return [];
        }
        throw error;
      }
    },
    queryKey: messageHistoryQueryKey(conversationId, before),
    retry: 0,
    staleTime: STALE_TIME,
  });
}

/**
 * One conversation's identity row (TASK-101): the `/ai?c=<id>` route loader
 * awaits this BEFORE mounting the provider, because the row carries the
 * `agent`/`assistant` the conversation belongs to. Resuming on the wrong
 * CLI cannot work (the stored `acp_session_id` is that CLI's session), and
 * an unknown id must fail as a route error rather than silently opening a
 * blank chat.
 */
export function conversationQueryOptions(conversationId: string) {
  return queryOptions({
    queryFn: () => orpc.chat.getConversation({ conversationId }),
    queryKey: ["chat", "conversation", conversationId] as const,
    retry: 0,
    staleTime: STALE_TIME,
  });
}

/**
 * Fold persisted rows into render cards. Each row is validated against the
 * wire frame schema (the row's `content` is the frame's `data`, and the
 * `type` column is a free string the reducer cannot be trusted with), then
 * folded exactly as a connect-time replay folds it: `replace: true`, because
 * a stored row is the frame's final accumulated state, not a delta.
 *
 * A row that fails validation is skipped rather than fatal: one unreadable
 * frame must not blank the transcript.
 */
export function cardsFromRows(rows: readonly MessageRow[]): TMessage[] {
  let cards: TMessage[] = [];
  for (const row of rows) {
    const parsed = ChatFrameSchema.safeParse({
      conversation_id: row.conversation_id,
      created_at: storedStampToEpochMs(row.created_at),
      data: parseFrameData(row.content),
      hidden: row.hidden,
      msg_id: row.msg_id,
      replace: true,
      // The parked families replay their lifecycle status (TASK-86 ask,
      // TASK-109 permission); every other frame type folds statusless.
      status:
        row.type === "ask" ||
        row.type === "acp_permission" ||
        row.type === "drill_item"
          ? row.status
          : undefined,
      turn_id: row.turn_id ?? undefined,
      type: row.type,
    });
    if (!parsed.success) {
      continue;
    }
    cards = transformFrame(cards, parsed.data, {});
  }
  return cards;
}

/**
 * Union a persisted transcript with the live engine's cards so an OPENED
 * conversation renders its stored rows AND keeps streaming (TASK-108 AC#4).
 *
 * A stored chat used to show only whatever the live `chat.subscribe` replay
 * delivered, so an offline agent or a truncated replay opened it near-empty
 * even though every row is in the database. The fix feeds `cardsFromRows`
 * into the transcript; this merge lets that coexist with a live turn: both
 * sources fold the SAME frames through the same reducer, so their card ids
 * (deterministic, `chat-engine/transform.ts`) overlap exactly and dedupe
 * here, while a send made after opening carries fresh ids that only the live
 * list has and is appended. Persisted order is the chronological base; a live
 * turn is always the newest, so appending live-only cards keeps the ordering.
 */
export function mergeTranscript(
  persisted: readonly TMessage[],
  live: readonly TMessage[]
): TMessage[] {
  if (live.length === 0) {
    return [...persisted];
  }
  const storedIds = new Set(persisted.map((card) => card.id));
  const liveOnly = live.filter((card) => !storedIds.has(card.id));
  if (liveOnly.length === 0) {
    return [...persisted];
  }
  return [...persisted, ...liveOnly];
}

/**
 * Older-history paging (TASK-106 AC#1-#4). The connect-time replay and
 * `messageHistoryQueryOptions` carry the newest 200 rows and stop there;
 * everything older is reachable through the SAME server keyset:
 * `before` = the oldest row id the client holds, and the store returns the
 * rows strictly below it, ascending (`lt(id)` + desc + limit + reverse,
 * `chat-store.listMessages`). A chain of such cursors is gap- and
 * dup-free by construction, and rows persisted after page 1 sit ABOVE
 * page 1's ids, so older pages can never absorb or reorder
 * live-streamed frames (mergeTranscript appends those after the fold).
 */
export const OLDER_PAGE_SIZE = 200;

/** The paging cursor: oldest row id in an ascending page, or undefined
 * when the caller holds no rows at all. */
export function oldestRowId(rows: readonly MessageRow[]): number | undefined {
  let oldest: number | undefined;
  for (const row of rows) {
    if (oldest === undefined || row.id < oldest) {
      oldest = row.id;
    }
  }
  return oldest;
}

/**
 * The full persisted transcript assembled so far, in strict row-id order:
 * the older pages first (oldest page first), the connect-time page last.
 */
export function flattenOlderPages(
  olderPages: readonly (readonly MessageRow[])[],
  pageOne: readonly MessageRow[]
): MessageRow[] {
  const rows: MessageRow[] = [];
  for (let i = olderPages.length - 1; i >= 0; i -= 1) {
    rows.push(...(olderPages[i] ?? []));
  }
  rows.push(...pageOne);
  return rows;
}

interface OlderPagesState {
  conv: string;
  /** Fetched backwards pages, newest page first (the fetch order). */
  pages: MessageRow[][];
  /** A short page ended the walk back to the first turn. */
  reachedStart: boolean;
}

/**
 * The "back to the first turn" hook: keeps the fetched older pages beside
 * the connect-time page and exposes the merged ascending row list plus a
 * `loadOlder` that walks the keyset one page at a time. Paging is done
 * when a fetch returns fewer than a full page (the table start) or when
 * the connect-time page itself was short. State is keyed on the
 * conversation id, so switching chats resets the walk without an effect.
 */
export function useOlderHistory(
  conversationId: string,
  pageOne: readonly MessageRow[] | undefined
): {
  hasMore: boolean;
  loadOlder: () => Promise<void>;
  loading: boolean;
  rows: MessageRow[];
} {
  const [held, setHeld] = useState<OlderPagesState>({
    conv: conversationId,
    pages: [],
    reachedStart: false,
  });
  const [loading, setLoading] = useState(false);
  const state =
    held.conv === conversationId
      ? held
      : { ...held, conv: conversationId, pages: [], reachedStart: false };
  const rows = useMemo(
    () => flattenOlderPages(state.pages, pageOne ?? []),
    [pageOne, state.pages]
  );
  const loadedShort = pageOne !== undefined && pageOne.length < OLDER_PAGE_SIZE;
  const hasMore = rows.length > 0 && !state.reachedStart && !loadedShort;
  const loadOlder = useCallback(async (): Promise<void> => {
    const cursor = oldestRowId(rows);
    if (cursor === undefined || loading) {
      return;
    }
    setLoading(true);
    try {
      const { messages } = await orpc.chat.listMessages({
        before: cursor,
        conversationId,
        limit: OLDER_PAGE_SIZE,
      });
      setHeld({
        conv: conversationId,
        pages: [messages, ...state.pages],
        reachedStart: messages.length < OLDER_PAGE_SIZE,
      });
    } catch (error) {
      // An empty conversation answers NOT_FOUND: that is "nothing older",
      // so the walk ends. Any other failure leaves the held pages as they
      // are; the button stays enabled and the next click retries from the
      // same cursor (the keyset makes the fetch idempotent).
      if ((error as { code?: string }).code === "NOT_FOUND") {
        setHeld({ ...state, reachedStart: true });
      }
    } finally {
      setLoading(false);
    }
  }, [conversationId, loading, rows, state]);
  return { hasMore, loading, loadOlder, rows };
}

/**
 * Stored timestamp → epoch ms. Persisted stamps come in two shapes: the
 * legacy `datetime('now')` text (`YYYY-MM-DD HH:MM:SS`, UTC, no designator)
 * and the newer ISO string. Bare `Date.parse` reads the first in LOCAL time,
 * which mis-dates every legacy row by the machine's offset, so the space
 * form is converted to its explicit UTC equivalent (the same rule the
 * server's `toWireFrame` applies). Unparseable → undefined.
 *
 * Exported because the history desk formats row recency with this rule too:
 * two readers of one column must not disagree about when it happened.
 */
export function storedStampToEpochMs(stamp: string): number | undefined {
  const iso = stamp.includes(" ") ? `${stamp.replace(" ", "T")}Z` : stamp;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/** The stored `content` column as a frame payload, or a value that fails
 * schema validation (a row written by an older writer). */
function parseFrameData(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}
