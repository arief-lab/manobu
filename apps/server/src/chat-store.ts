/**
 * Server-side chat persistence (TASK-80.2).
 *
 * The native ACP migration moves conversation history out of the browser's
 * localStorage blob into user.db: one row per normalized frame card (the
 * `AcpStreamEvent` vocabulary), keyed for the client reducer by the
 * deterministic `ui_id`. Pending permission/ask cards are projected from
 * here (plus the live engine parks) so a reload restores them.
 *
 * Tables ship in `@manobu/db` migration 0006; the content-migration applier
 * creates them at boot for file dbs. This module additionally ensures them
 * on its own handle so in-memory test URLs and pre-boot queries work
 * (duplicate-CREATE errors are swallowed — same rule as the applier).
 */

import { chatSchemaStatements } from "@manobu/db/migrate";
import { conversations, messages } from "@manobu/db/schema/user";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { getUserDb } from "./user-db";

export type ChatDb = Awaited<ReturnType<typeof getUserDb>>;

/**
 * The 0006 DDL, applied once per HANDLE and remembered by handle identity.
 *
 * The cache used to hold the handle itself (`schemaReady: Promise<ChatDb>`), so
 * the first caller in the process pinned chat persistence to whatever database
 * the provider returned at that moment. Under `bun test` that is the first spec
 * file's file: its `afterAll` unlinks the path, and every later spec keeps
 * writing through the still-open handle on the deleted inode, while anything
 * that opens the path again (a write transaction takes its own connection) sees
 * an empty database beside it. Resolving through the provider and keying the
 * schema by handle gives each spec its own live database.
 */
const schemaApplied = new WeakMap<ChatDb, Promise<void>>();

const applyChatSchema = async (db: ChatDb): Promise<void> => {
  // The 0006 DDL must apply sequentially (later statements reference
  // earlier tables) and runs once per handle, so a batched `Promise.all`
  // would only change error ordering, not correctness.
  const applyStatement = async (statement: string) => {
    try {
      await db.run(statement as never);
    } catch {
      // already applied (duplicate CREATE) — expected on migrated dbs
    }
  };
  // `noAwaitInLoops` rejects any `await` lexically inside a loop body,
  // so the sequential apply is a recursive walk: each call handles one
  // statement and recurses into the next, with the `await` living only
  // in the named helpers.
  const applyStatements = async (index: number): Promise<void> => {
    if (index >= chatSchemaStatements.length) {
      return;
    }
    await applyStatement(chatSchemaStatements[index] as string);
    await applyStatements(index + 1);
  };
  await applyStatements(0);
};

export async function getChatDb(): Promise<ChatDb> {
  const db = await getUserDb();
  const applied = schemaApplied.get(db);
  if (applied) {
    await applied;
    return db;
  }
  const ready = applyChatSchema(db);
  schemaApplied.set(db, ready);
  await ready;
  return db;
}

export interface ConversationRow {
  acpSessionId: string | null;
  agent: string | null;
  assistant: string | null;
  id: string;
  title: string | null;
}

const conversationFromExisting = (
  existing: ConversationRow,
  title: string | null
): ConversationRow => ({
  acpSessionId: existing.acpSessionId,
  agent: existing.agent,
  assistant: existing.assistant,
  id: existing.id,
  title,
});

const newConversation = (
  id: string,
  init: { agent?: string; assistant?: string; title?: string }
): ConversationRow => ({
  acpSessionId: null,
  agent: init.agent ?? null,
  assistant: init.assistant ?? null,
  id,
  title: init.title ?? null,
});

/** `datetime('now')` has second precision; explicit writes do not. */
function isoNow(): string {
  return new Date().toISOString();
}

const WHITESPACE_RUN = /\s+/gu;
const TITLE_MAX_CHARS = 60;

/**
 * Name a conversation from a prompt (TASK-101/TASK-107): the history list
 * shows a phrase the learner recognises instead of a UUID. Only ever a SEED
 * or a backfill candidate - a stored title is never rewritten from here, and
 * a rename is the learner's own words. Returns null for text with nothing
 * recoverable, so an untitled chat stays untitled rather than being
 * fabricated (TASK-107 AC#4).
 */
export function deriveTitle(text: string): string | null {
  const collapsed = text.replace(WHITESPACE_RUN, " ").trim();
  if (collapsed.length === 0) {
    return null;
  }
  return collapsed.length <= TITLE_MAX_CHARS
    ? collapsed
    : `${collapsed.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`;
}

/**
 * One history row as the list serves it (TASK-101). `messageCount` rides
 * along so a list can show a size without a query per row.
 */
export interface ConversationSummary {
  agent: string | null;
  assistant: string | null;
  id: string;
  messageCount: number;
  title: string | null;
  updatedAt: string;
}

/** Keyset cursor: the last served row's `(updatedAt, id)` pair. */
export interface HistoryCursor {
  id: string;
  updatedAt: string;
}

export interface ConversationPage {
  conversations: ConversationSummary[];
  nextCursor: HistoryCursor | null;
}

/**
 * The recency key, normalised. The schema default is `datetime('now')`
 * ("YYYY-MM-DD HH:MM:SS", a SPACE) while every explicit write here is
 * `toISOString` (a "T"); compared as text the space form sorts before the
 * T form on the same date, so a raw column ORDER BY would interleave old
 * and new chats. strftime puts both in one shape, and the cursor carries
 * that shape. A value strftime cannot parse (a row written before this
 * module owned the column) has unknown age, so it falls back to the epoch
 * and sinks to the bottom of the list instead of becoming a null the wire
 * schema cannot carry.
 */
const recency = sql<string>`IFNULL(strftime('%Y-%m-%dT%H:%M:%fZ', ${conversations.updatedAt}), '1970-01-01T00:00:00.000Z')`;

const summaryColumns = {
  agent: conversations.agent,
  assistant: conversations.assistant,
  id: conversations.id,
  title: conversations.title,
  updatedAt: recency,
};

/** A history row before its message count is attached. */
interface SummaryRow {
  agent: string | null;
  assistant: string | null;
  id: string;
  title: string | null;
  updatedAt: string;
}

/**
 * Message counts for a set of conversations in ONE grouped read. Doing it
 * as a correlated `COUNT(*)` subquery in the page SELECT would need both
 * tables qualified, and drizzle renders its column references bare (inside
 * the subquery `"id"` binds to the inner row), so the count silently
 * returns 0.
 */
async function countMessages(
  db: ChatDb,
  ids: string[]
): Promise<Map<string, number>> {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      conversationId: messages.conversationId,
      count: sql<number>`COUNT(*)`,
    })
    .from(messages)
    .where(inArray(messages.conversationId, ids))
    .groupBy(messages.conversationId);
  return new Map(rows.map((row) => [row.conversationId, Number(row.count)]));
}

async function toSummaries(
  db: ChatDb,
  rows: SummaryRow[]
): Promise<ConversationSummary[]> {
  const counts = await countMessages(
    db,
    rows.map((row) => row.id)
  );
  return rows.map((row) => ({
    ...row,
    messageCount: counts.get(row.id) ?? 0,
  }));
}

/**
 * Create (or return the existing) conversation row for an id. Every call
 * re-stamps recency, because a turn is what makes a conversation worth
 * listing, and names an untitled conversation from the caller's seed so the
 * history list shows a phrase instead of a UUID. A stored title is never
 * overwritten from here: renames belong to `renameConversation`.
 */
export async function ensureConversation(
  id: string,
  init: { agent?: string; assistant?: string; title?: string }
): Promise<ConversationRow> {
  const db = await getChatDb();
  const now = isoNow();
  const existing = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .get();
  if (existing) {
    const title = existing.title ?? init.title ?? null;
    await db
      .update(conversations)
      .set({ title, updatedAt: now })
      .where(eq(conversations.id, id));
    return conversationFromExisting(existing, title);
  }
  await db.insert(conversations).values({
    agent: init.agent ?? null,
    assistant: init.assistant ?? null,
    createdAt: now,
    id,
    title: init.title ?? null,
    updatedAt: now,
  });
  return newConversation(id, init);
}

/** The one conversation behind an id, or null when it never existed. */
export async function getConversation(
  id: string
): Promise<ConversationSummary | null> {
  const db = await getChatDb();
  const rows = await db
    .select(summaryColumns)
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  const [summary] = await toSummaries(db, rows);
  return summary ?? null;
}

/**
 * Does this conversation have a learner turn (TASK-150)?
 *
 * A history entry is a conversation the learner spoke in. `user_created` is
 * the one row the learner's own prompt writes (`emitUserTurn`), so it is the
 * marker: a conversation whose rows are all agent frames is not a chat the
 * learner can reopen, it is storage for something that lives elsewhere. That
 * is exactly what a paper built without a conversation leaves behind: the
 * exam path needs a value for `messages.conversation_id` and
 * `exams.conversation_id` (both NOT NULL FKs, `PRAGMA foreign_keys = ON`), so
 * it synthesises `exam:<examId>`, and the row would otherwise be offered in
 * /chat/history as a chat that opens on an empty screen.
 *
 * The identifiers inside the subquery are spelled literally on purpose: this
 * is the trap `countMessages` records, where drizzle renders its column refs
 * bare and a bare `id` inside the subquery binds to the INNER row, so the
 * correlation would compare a message id with a conversation id.
 */
const hasLearnerTurn = sql`EXISTS (
  SELECT 1 FROM ${messages} AS learner_frame
  WHERE learner_frame.conversation_id = conversations.id
    AND learner_frame.frame_type = 'user_created'
)`;

/**
 * Most recently active conversations the learner has spoken in (TASK-150),
 * keyset-paged on `(updatedAt, id)`. `limit` is clamped the same way
 * `listMessages` clamps its own, and `nextCursor` is null exactly when the
 * page was the last one.
 */
export async function listConversations(
  options: { before?: HistoryCursor; limit?: number } = {}
): Promise<ConversationPage> {
  const db = await getChatDb();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  let query = db.select(summaryColumns).from(conversations).$dynamic();
  if (options.before) {
    // id breaks timestamp ties (two turns can land in the same millisecond),
    // which is what makes the walk total rather than occasionally skipping
    // or repeating a row at a page boundary. The cursor only ever names a
    // listed row, so the learner-turn filter holds across the whole walk.
    // `.where()` replaces rather than adds, so both conditions go in once.
    query = query.where(
      and(
        hasLearnerTurn,
        sql`(${recency} < ${options.before.updatedAt}) OR (${recency} = ${options.before.updatedAt} AND ${conversations.id} < ${options.before.id})`
      )
    );
  } else {
    query = query.where(hasLearnerTurn);
  }
  // One extra row answers "is there a next page" without a COUNT over the
  // whole table.
  const rows = await query
    .orderBy(desc(recency), desc(conversations.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    conversations: await toSummaries(db, page),
    nextCursor:
      hasMore && last ? { id: last.id, updatedAt: last.updatedAt } : null,
  };
}

/**
 * Recover the prompt text stored in a `user_created` row's JSON content
 * (`{ text }`), or "" for anything unreadable. The backfill reads this; a
 * corrupt row yields no title rather than throwing.
 */
function promptTextFromContent(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "";
  }
  if (parsed && typeof parsed === "object" && "text" in parsed) {
    const { text } = parsed as { text: unknown };
    return typeof text === "string" ? text : "";
  }
  return "";
}

/**
 * Name every UNTITLED conversation from its first persisted prompt
 * (TASK-107 AC#3). Conversations created before prompt persistence have no
 * `user_created` row to read, so they stay untitled and renameable rather
 * than being given a fabricated name (AC#4). Returns how many conversations
 * were named; idempotent (a named conversation is no longer null-title, so a
 * second pass is a no-op).
 */
export async function backfillConversationTitles(): Promise<number> {
  const db = await getChatDb();
  const untitled = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(sql`${conversations.title} IS NULL`);
  if (untitled.length === 0) {
    return 0;
  }
  // Reading the user rows id-ASCENDING means the FIRST row seen for a
  // conversation is its earliest prompt, so the first non-null title wins
  // without a correlated subquery.
  const rows = await db
    .select({
      content: messages.content,
      conversationId: messages.conversationId,
    })
    .from(messages)
    .where(
      and(
        inArray(
          messages.conversationId,
          untitled.map((row) => row.id)
        ),
        eq(messages.frameType, "user_created")
      )
    )
    .orderBy(messages.id);
  const named = new Map<string, string>();
  for (const row of rows) {
    if (named.has(row.conversationId)) {
      continue;
    }
    const title = deriveTitle(promptTextFromContent(row.content));
    if (title !== null) {
      named.set(row.conversationId, title);
    }
  }
  // Backfill writes are independent per conversation but applied one at a
  // time on the single test/process connection, so no interleaving surprises.
  for (const [id, title] of named) {
    // biome-ignore lint/performance/noAwaitInLoops: a one-shot startup backfill over a handful of untitled chats; sequencing the writes keeps the single-connection update path simple and this is not a hot loop.
    await db
      .update(conversations)
      .set({ title })
      .where(eq(conversations.id, id));
  }
  return named.size;
}

/** The persisted tool status that renders as a LIVE card (status-tag.tsx:
 * pending blue, in_progress orange). Anything else is already terminal. */
const NON_TERMINAL_TOOL_STATUSES = new Set(["in_progress", "pending"]);

/** Shown in the recovered card's output slot; the reason the UI can show
 * (TASK-105 AC#1/#3). No em dash (R-02). */
const INTERRUPTED_REASON =
  "Interrupted: the agent stopped before this tool finished (server restart)";

interface WorkRecoveryPatch {
  content?: string;
  status: "error" | "finish";
}

interface WorkRecovery {
  outcome: "interrupted" | "settled";
  patch: WorkRecoveryPatch;
}

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const settledWorkRecovery = (): WorkRecovery => ({
  outcome: "settled",
  patch: { status: "finish" },
});

const recoveryForStrandedWorkRow = (row: {
  content: string;
  frameType: string;
}): WorkRecovery => {
  if (row.frameType !== "acp_tool_call") {
    return settledWorkRecovery();
  }
  const content: unknown = JSON.parse(row.content);
  if (
    !(
      isJsonRecord(content) &&
      NON_TERMINAL_TOOL_STATUSES.has(String(content.status ?? ""))
    )
  ) {
    return settledWorkRecovery();
  }
  return {
    outcome: "interrupted",
    patch: {
      content: JSON.stringify({
        ...content,
        raw_output: INTERRUPTED_REASON,
        rawOutput: INTERRUPTED_REASON,
        status: "failed",
      }),
      status: "error",
    },
  };
};

const belongsToActiveTurn = (
  turnId: string | null,
  activeTurnIds: Set<string>
): boolean => turnId !== null && activeTurnIds.has(turnId);

/**
 * Boot recovery for rows stranded in `work` (TASK-105). The sink writes
 * status `work` for every non-terminal frame (chat-persistence
 * `rowStatus`) and a crash or restart kills the turn that would have
 * settled it, so a tool row's embedded content keeps the last live status
 * (`in_progress`) and a reopened conversation replays a card that renders
 * as running forever — the client card state comes from the content, not
 * the row status.
 *
 * The pass moves every `work` row to a terminal status: a non-terminal
 * `acp_tool_call` row additionally gets its embedded content rewritten to
 * `failed` + an interrupted reason (dual-case raw output per the
 * sanitizeAcpToolUpdate contract). Rows belonging to a turn in
 * `activeTurnIds` are EXEMPT: the pass runs before the sidecar serves, so
 * no turn of this process is live yet, but the parameter keeps the
 * exemption rule testable and the function safe to call from anywhere.
 * Idempotent: recovered rows no longer match the `work` filter.
 */
export async function recoverStrandedWorkRows(
  activeTurnIds: Set<string> = new Set()
): Promise<{ interrupted: number; settled: number }> {
  const db = await getChatDb();
  const stranded = await db
    .select({
      content: messages.content,
      frameType: messages.frameType,
      id: messages.id,
      turnId: messages.turnId,
    })
    .from(messages)
    .where(eq(messages.status, "work"));
  let interrupted = 0;
  let settled = 0;
  for (const row of stranded) {
    if (belongsToActiveTurn(row.turnId, activeTurnIds)) {
      continue;
    }
    const recovery = recoveryForStrandedWorkRow(row);
    if (recovery.outcome === "interrupted") {
      interrupted += 1;
    } else {
      settled += 1;
    }
    // One-shot startup reconciliation on the single process connection;
    // sequencing the writes keeps the update path simple (backfill
    // precedent above).
    // biome-ignore lint/performance/noAwaitInLoops: a one-shot boot pass over the few rows a crash stranded; see above.
    await db
      .update(messages)
      .set(recovery.patch)
      .where(eq(messages.id, row.id));
  }
  return { interrupted, settled };
}

/**
 * Boot recovery for parked cards stranded in `pending` (TASK-109). A
 * crashed sidecar takes its engine parks down with it, so an `ask` or
 * `acp_permission` row left `pending` replays as a live card inviting a
 * tap whose answer can never reach a park (the `onExpire` ->
 * `settlePending` path lives in-process too). The pass mirrors that
 * expiry outcome: status `error` only, content NEVER patched — recovery
 * must not fabricate a learner answer, and the terminal renders carry the
 * explanation (the ask card shows its expired pill from the replayed
 * status; the permission card gets an expired title from
 * `AcpPermissionPart`). Unlike TASK-105 there is no active-turn exemption:
 * parks are in-process state, so a pass that runs before serving cannot
 * race one. Idempotent: settled rows no longer match the `pending`
 * filter.
 */
export async function recoverStrandedPendingCards(): Promise<{
  asks: number;
  drills: number;
  permissions: number;
}> {
  const db = await getChatDb();
  const stranded = await db
    .select({ frameType: messages.frameType, id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.status, "pending"),
        inArray(messages.frameType, ["acp_permission", "ask", "drill_item"])
      )
    );
  let asks = 0;
  let drills = 0;
  let permissions = 0;
  for (const row of stranded) {
    if (row.frameType === "ask") {
      asks += 1;
    } else if (row.frameType === "drill_item") {
      drills += 1;
    } else {
      permissions += 1;
    }
    // Same one-shot boot-pass rationale as recoverStrandedWorkRows.
    // biome-ignore lint/performance/noAwaitInLoops: a one-shot boot pass over the few rows a crash stranded; see above.
    await db
      .update(messages)
      .set({ status: "error" })
      .where(eq(messages.id, row.id));
  }
  return { asks, drills, permissions };
}

/**
 * Set a conversation's title. Returns null when the id is unknown, so the
 * handler can raise NOT_FOUND. Renaming deliberately does NOT re-stamp
 * recency: the list is ordered by activity, and editing a label is not one.
 */
export async function renameConversation(
  id: string,
  title: string
): Promise<ConversationSummary | null> {
  const db = await getChatDb();
  const updated = await db
    .update(conversations)
    .set({ title })
    .where(eq(conversations.id, id))
    .returning({ id: conversations.id });
  if (updated.length === 0) {
    return null;
  }
  return await getConversation(id);
}

/**
 * Delete a conversation and cascade its messages. The count is taken before
 * the delete so the caller can prove the cascade removed rows rather than
 * trusting the FK; returns null for an unknown id.
 */
export async function deleteConversation(
  id: string
): Promise<{ deleted: true; messagesDeleted: number } | null> {
  const db = await getChatDb();
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  if (!existing) {
    return null;
  }
  // COUNT(*) always returns exactly one row; `?? 0` only satisfies
  // drizzle's optional get() result.
  const counted = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(messages)
    .where(eq(messages.conversationId, id))
    .get();
  await db.delete(conversations).where(eq(conversations.id, id));
  return { deleted: true, messagesDeleted: Number(counted?.count ?? 0) };
}

/** The stored ACP sessionId used for `session/load` resume. */
export async function getUserAcpSessionId(
  conversationId: string
): Promise<string | null> {
  const db = await getChatDb();
  const row = await db
    .select({ acpSessionId: conversations.acpSessionId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .get();
  return row?.acpSessionId ?? null;
}

export async function setUserAcpSessionId(
  conversationId: string,
  acpSessionId: string
): Promise<void> {
  const db = await getChatDb();
  await db
    .update(conversations)
    .set({ acpSessionId, updatedAt: new Date().toISOString() })
    .where(eq(conversations.id, conversationId));
}

/** One normalized frame row as stored (and as served to the client). */
export interface StoredMessage {
  content: string;
  conversationId: string;
  createdAt: string;
  frameType: string;
  hidden: boolean;
  id: number;
  msgId: string;
  refId: string | null;
  /** Lifecycle of a parked card: pending until answered, then finish/error. */
  seq: number;
  status: string;
  turnId: string | null;
  uiId: string | null;
}

export interface AppendMessageInput {
  content: unknown;
  conversationId: string;
  frameType: string;
  hidden?: boolean;
  msgId: string;
  refId?: string | null;
  status?: "finish" | "pending" | "error" | "work";
  turnId?: string | null;
  uiId?: string | null;
}

/** Insert one frame row; returns the stored row. */
export async function appendMessage(
  input: AppendMessageInput
): Promise<StoredMessage> {
  const db = await getChatDb();
  // Per-conversation monotonic seq, computed atomically inside the INSERT so
  // two concurrent writers on one conversation can never read the same
  // MAX(seq) and land on the same seq (TASK-80.7 AC#1). The subquery reads
  // the per-conversation max at commit time; `seq` is a plain column with
  // no default, so the expression fills it on every insert.
  const row = await db
    .insert(messages)
    .values({
      content: JSON.stringify(input.content ?? null),
      conversationId: input.conversationId,
      frameType: input.frameType,
      hidden: input.hidden ?? false,
      msgId: input.msgId,
      refId: input.refId ?? null,
      seq: sql`(SELECT COALESCE(MAX(${messages.seq}), 0) + 1 FROM ${messages} WHERE ${messages.conversationId} = ${input.conversationId})`,
      status: input.status ?? "finish",
      turnId: input.turnId ?? null,
      uiId: input.uiId ?? null,
    })
    .returning()
    .get();
  return rowToStored(row);
}

function rowToStored(row: typeof messages.$inferSelect): StoredMessage {
  return {
    content: row.content,
    conversationId: row.conversationId,
    createdAt: row.createdAt,
    frameType: row.frameType,
    hidden: row.hidden,
    id: row.id,
    msgId: row.msgId,
    refId: row.refId,
    seq: row.seq,
    status: row.status,
    turnId: row.turnId,
    uiId: row.uiId,
  };
}

/**
 * Keyset page of a conversation's messages, oldest-first within the page:
 * pass `before` (a message id) to walk backwards. Text/thinking frames with
 * the same `ui_id` collapse into one row (the writer updates in place), so
 * pages stay stable.
 */
export async function listMessages(
  conversationId: string,
  options: { before?: number; limit?: number } = {}
): Promise<StoredMessage[]> {
  const db = await getChatDb();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  let query = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .$dynamic();
  if (options.before !== undefined) {
    query = query.where(
      and(
        eq(messages.conversationId, conversationId),
        lt(messages.id, options.before)
      )
    );
  }
  const rows = await query.orderBy(desc(messages.id)).limit(limit);
  return rows.reverse().map(rowToStored);
}

/**
 * Frames with seq > `afterSeq`, in seq order (subscribe catch-up). oRPC
 * echoes the last delivered event id back as `lastEventId` on resubscribe;
 * this is the replay window.
 *
 * `drainReads` counts `listFramesAfter` calls so the live-drain e2e can
 * prove a dropped subscriber stops draining (TASK-80.10 AC#2).
 */
let drainReads = 0;

/** Test-only: how many `listFramesAfter` calls this module has made. */
export function getDrainReads(): number {
  return drainReads;
}

/** Test-only: zero the drain-read counter. */
export function resetDrainReads(): void {
  drainReads = 0;
}

export async function listFramesAfter(
  conversationId: string,
  afterSeq: number,
  limit = 500
): Promise<StoredMessage[]> {
  drainReads += 1;
  const db = await getChatDb();
  return (
    await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          gt(messages.seq, afterSeq)
        )
      )
      .orderBy(messages.seq)
      .limit(limit)
  ).map(rowToStored);
}

/** Update an in-place frame row (text append, tool merge) by ui_id. */
export async function updateMessageByUiId(
  conversationId: string,
  uiId: string,
  patch: { content?: unknown; status?: string }
): Promise<boolean> {
  const db = await getChatDb();
  const values: Record<string, unknown> = {};
  if (patch.content !== undefined) {
    values.content = JSON.stringify(patch.content);
  }
  if (patch.status !== undefined) {
    values.status = patch.status;
  }
  if (Object.keys(values).length === 0) {
    return false;
  }
  // Re-stamp seq (excluding this row from the MAX) so live subscribers see
  // the update as a new event; the client reducer replaces in place by ui_id.
  const nextSeq = sql<number>`(
    SELECT COALESCE(MAX(m2.seq), 0) + 1 FROM messages AS m2
    WHERE m2.conversation_id = ${conversationId} AND m2.id <> ${messages.id}
  )`;
  const updated = await db
    .update(messages)
    .set({ ...values, seq: nextSeq })
    .where(
      and(eq(messages.conversationId, conversationId), eq(messages.uiId, uiId))
    )
    .returning({ id: messages.id });
  return updated.length > 0;
}
/** Settle a parked row once answered (recovery no longer re-projects it). */
export async function settlePending(
  conversationId: string,
  refId: string,
  status: "finish" | "error" = "finish",
  /**
   * TASK-86: fields merged into the row's frame content at settle time
   * (the ask answer summary, so a reload replays the compact answered
   * card with what was chosen). Only the first settle (status pending)
   * wins, so a late expire cannot rewrite an answered row's content.
   */
  contentPatch?: Record<string, unknown>
): Promise<void> {
  const db = await getChatDb();
  const parked = and(
    eq(messages.conversationId, conversationId),
    eq(messages.refId, refId),
    eq(messages.status, "pending")
  );
  if (contentPatch === undefined) {
    await db.update(messages).set({ status }).where(parked);
    return;
  }
  const [row] = await db
    .select({ content: messages.content, id: messages.id })
    .from(messages)
    .where(parked)
    .limit(1);
  if (!row) {
    return;
  }
  await db
    .update(messages)
    .set({ content: mergeFrameContent(row.content, contentPatch), status })
    .where(eq(messages.id, row.id));
}

/** Merge patch fields into a stored frame's JSON object content. */
function mergeFrameContent(
  raw: string,
  patch: Record<string, unknown>
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return JSON.stringify(patch);
  }
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return JSON.stringify({ ...parsed, ...patch });
  }
  return JSON.stringify(patch);
}
