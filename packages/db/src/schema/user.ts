import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const cards = sqliteTable(
  "cards",
  {
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
    difficulty: real("difficulty").notNull().default(5),
    due: text("due").notNull(),
    id: integer("id").primaryKey({ autoIncrement: true }),
    isLeech: integer("is_leech", { mode: "boolean" }).notNull().default(false),
    // TASK-40: vocab snapshot at insert (see migrations/0005).
    jp: text("jp"),
    lapses: integer("lapses").notNull().default(0),
    level: text("level"),
    reading: text("reading"),
    stability: real("stability").notNull().default(0),
    state: text("state").notNull().default("new"),
    vocabId: integer("vocab_id").notNull(),
  },
  (table) => [index("idx_cards_due").on(table.due)]
);

export const revlog = sqliteTable(
  "revlog",
  {
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id),
    deltaT: real("delta_t").notNull(),
    dSnapshot: real("d_snapshot"),
    grade: integer("grade").notNull(),
    id: integer("id").primaryKey({ autoIncrement: true }),
    rSnapshot: real("r_snapshot"),
    sSnapshot: real("s_snapshot"),
    ts: text("ts").notNull().default("(datetime('now'))"),
  },
  (table) => [index("idx_revlog_card").on(table.cardId, table.ts)]
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const srsPause = sqliteTable("srs_pause", {
  pausedUntil: text("paused_until"),
});

export const drafts = sqliteTable("drafts", {
  context: text("context").notNull(),
  lessonId: text("lesson_id").primaryKey(),
  position: integer("position").notNull(),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

// TASK-80.2: server-side AI conversation persistence (migrations/0006).
// `conversations` owns the agent/session binding; `messages` stores the
// normalized ACP frames (one row per card/segment) so history and pending
// permission/ask cards survive reloads. `acp_session_id` is the resume
// anchor for `session/load` after a server restart.

export const conversations = sqliteTable(
  "conversations",
  {
    /** ACP sessionId for session/load resume (null until first spawn). */
    acpSessionId: text("acp_session_id"),
    agent: text("agent"),
    assistant: text("assistant"),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
    id: text("id").primaryKey(),
    title: text("title"),
    updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
  },
  (table) => [index("idx_conversations_updated").on(table.updatedAt)]
);

export const messages = sqliteTable(
  "messages",
  {
    /** JSON payload per frame type (text: {content}, tool: {update}, ...). */
    content: text("content").notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
    /** Frame type from the AcpStreamEvent vocabulary. */
    frameType: text("frame_type").notNull(),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    /** Row key; autoincrement so keyset pagination is insertion-ordered. */
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** ACP turn id this row belongs to. */
    msgId: text("msg_id").notNull(),
    /** Permission/ask correlation ids (confirmation recovery lookups). */
    refId: text("ref_id"),
    /** Per-conversation monotonic event cursor (subscribe replay/resume;
     * bumped on INSERT and in-place UPDATE so live frames re-emit). */
    seq: integer("seq").notNull().default(0),
    status: text("status").notNull().default("finish"),
    turnId: text("turn_id"),
    /** Deterministic UI id the reducer dedupes on (plan:{msg}, term:...). */
    uiId: text("ui_id"),
  },
  (table) => [
    index("idx_messages_conversation").on(table.conversationId, table.id),
    index("idx_messages_seq").on(table.conversationId, table.seq),
    index("idx_messages_ref").on(table.refId),
    index("idx_messages_ui").on(table.conversationId, table.uiId),
  ]
);

export const items = sqliteTable("items", {
  anchors: text("anchors").notNull(),
  answerIndex: integer("answer_index").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  disputed: integer("disputed", { mode: "boolean" }).notNull().default(false),
  disputedAt: text("disputed_at"),
  explanation: text("explanation"),
  fsrsVocabId: integer("fsrs_vocab_id"),
  id: text("id").primaryKey(),
  itemType: text("item_type").notNull(),
  level: text("level").notNull(),
  /** TASK-142: the masking record as JSON, null for an item with nothing to
   * mask. A cell the store cannot read is corruption, like `stimuli`. */
  mask: text("mask"),
  options: text("options").notNull(),
  passage: text("passage"),
  prompt: text("prompt").notNull(),
  script: text("script"),
  seedPart: text("seed_part"),
  /** TASK-173.2: the Japanese line the paper prints for this 小問, null for an
   * item a real paper never asks. `prompt` is the English stem every daily
   * mode shows; a real paper shows neither of them, so the material has to be
   * stored rather than re-derived from a corpus row that may not resolve. */
  stem: text("stem"),
  stimuli: text("stimuli"),
  surface: text("surface").notNull(),
});

export const exams = sqliteTable(
  "exams",
  {
    abandonedAt: text("abandoned_at"),
    budgets: text("budgets").notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    currentSection: text("current_section"),
    /** TASK-139: the request's `focus` as JSON, so `requestForState`
     * rebuilds the request the learner actually made instead of a
     * lookalike with an empty focus. Always written, `'[]'` when the
     * request carried no focus, which is what `parseRequest` yields. */
    focus: text("focus").notNull().default("[]"),
    id: text("id").primaryKey(),
    level: text("level").notNull(),
    mode: text("mode").notNull(),
    readyAt: text("ready_at"),
    result: text("result"),
    seed: text("seed").notNull(),
    source: text("source").notNull(),
    startedAt: text("started_at"),
    status: text("status").notNull().default("draft"),
    submittedAt: text("submitted_at"),
  },
  (table) => [index("idx_exams_conversation").on(table.conversationId)]
);

export const examItems = sqliteTable(
  "exam_items",
  {
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    itemType: text("item_type").notNull(),
    order: integer("order").notNull(),
    section: text("section").notNull(),
  },
  (table) => [
    uniqueIndex("idx_exam_items_order").on(table.examId, table.order),
    uniqueIndex("idx_exam_items_item").on(table.examId, table.itemId),
  ]
);

export const examSections = sqliteTable(
  "exam_sections",
  {
    activeMs: integer("active_ms").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    pauseCount: integer("pause_count").notNull().default(0),
    pausedAt: text("paused_at"),
    pausedMs: integer("paused_ms").notNull().default(0),
    position: integer("position").notNull(),
    requestedItems: integer("requested_items").notNull().default(0),
    section: text("section").notNull(),
    startedAt: text("started_at"),
    status: text("status").notNull().default("pending"),
    submittedAt: text("submitted_at"),
    timeLimitSeconds: integer("time_limit_seconds"),
    timerStartedAt: text("timer_started_at"),
  },
  (table) => [
    primaryKey({ columns: [table.examId, table.section] }),
    uniqueIndex("idx_exam_sections_position").on(table.examId, table.position),
    index("idx_exam_sections_status").on(
      table.examId,
      table.status,
      table.position
    ),
  ]
);

export const examAnswers = sqliteTable(
  "exam_answers",
  {
    answeredAt: text("answered_at").notNull().default(sql`(datetime('now'))`),
    answerIndex: integer("answer_index").notNull(),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    section: text("section").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.examId, table.section],
      foreignColumns: [examSections.examId, examSections.section],
      name: "exam_answers_section_fk",
    }).onDelete("cascade"),
    uniqueIndex("idx_exam_answers_item").on(table.examId, table.itemId),
    index("idx_exam_answers_section").on(table.examId, table.section),
  ]
);

export const drillSessions = sqliteTable(
  "drill_sessions",
  {
    anchors: text("anchors").notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    declaredCount: integer("declared_count").notNull(),
    endedAt: text("ended_at"),
    id: text("id").primaryKey(),
    level: text("level"),
    startedAt: text("started_at").notNull().default(sql`(datetime('now'))`),
    status: text("status").notNull().default("active"),
    tier: text("tier").notNull(),
  },
  (table) => [index("idx_drill_sessions_conversation").on(table.conversationId)]
);

export const drillAttempts = sqliteTable(
  "drill_attempts",
  {
    at: text("at").notNull().default(sql`(datetime('now'))`),
    chosenIndex: integer("chosen_index"),
    correct: integer("correct", { mode: "boolean" }),
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => drillSessions.id, { onDelete: "cascade" }),
    skipped: integer("skipped", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    uniqueIndex("idx_drill_attempts_item").on(table.sessionId, table.itemId),
  ]
);

export const drillSessionLifecycle = sqliteTable("drill_session_lifecycle", {
  generation: integer("generation").notNull().default(0),
  maxPerType: integer("max_per_type").notNull().default(1),
  sessionId: text("session_id")
    .primaryKey()
    .references(() => drillSessions.id, { onDelete: "cascade" }),
  supersessionCount: integer("supersession_count").notNull().default(0),
});

export const drillPoolItems = sqliteTable(
  "drill_pool_items",
  {
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    dropReason: text("drop_reason"),
    generation: integer("generation").notNull().default(0),
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => drillSessions.id, { onDelete: "cascade" }),
    state: text("state").notNull().default("ready"),
  },
  (table) => [
    uniqueIndex("idx_drill_pool_item").on(table.sessionId, table.itemId),
    uniqueIndex("idx_drill_pool_position").on(table.sessionId, table.position),
    index("idx_drill_pool_ready").on(
      table.sessionId,
      table.state,
      table.position
    ),
  ]
);
