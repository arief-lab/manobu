/*
 * Boot recovery pass for rows stranded in `work` (TASK-105).
 *
 * The sink writes status `work` for every non-terminal frame and nothing
 * reconciles a row whose turn died with the sidecar: a tool row left
 * mid-run replayed a card rendering as running forever. `recoverStranded-
 * WorkRows` settles those rows AND rewrites the embedded tool content
 * (the client card state comes from the content, not the row status),
 * while turns listed as active are exempt. Driven at the store boundary
 * over the shared in-memory chat db (the chat-history pattern); the boot
 * wiring itself is the one-shot call in src/index.ts before serving.
 *
 * Ids are prefixed `rec-`: the chat-store singleton's in-memory db is
 * shared across server test files in this process, so reads filter to
 * this file's conversations.
 */

import { describe, expect, it } from "bun:test";

// Required env before src imports load (Bun hoists statics; see chat-e2e).
process.env.CORS_ORIGIN = "http://localhost:3000";
const { isolatedDbUrl } = await import("./harness");
const { setUserDbProvider } = await import("../src/user-db");
const DB_URL = isolatedDbUrl("chat-recovery");
const { applyContentMigrations } = await import("@manobu/db/migrate");
applyContentMigrations(DB_URL);
process.env.DATABASE_URL = DB_URL;
// Every code path, including the module-scope singletons in chat-store and
// routes/cards, resolves through this. Setting the env alone is not enough:
// `bun test` loads all spec files first, so the env is whatever the last one
// assigned. See src/user-db.ts for the whole story.
setUserDbProvider(async () =>
  (await import("@manobu/db")).createUserDb(DB_URL)
);

const { toWireFrame } = await import("../src/chat-persistence");
const {
  appendMessage,
  ensureConversation,
  listMessages,
  recoverStrandedPendingCards,
  recoverStrandedWorkRows,
  settlePending,
} = await import("../src/chat-store");

type StoredMessage = import("../src/chat-store").StoredMessage;

/** One non-terminal tool row as the sink would have persisted it. */
async function addToolRow(
  conversationId: string,
  toolCallId: string,
  status: string,
  turnId: string
): Promise<void> {
  await appendMessage({
    content: {
      content: null,
      kind: "execute",
      rawInput: { command: "cargo build" },
      status,
      title: `run ${toolCallId}`,
      toolCallId,
    },
    conversationId,
    frameType: "acp_tool_call",
    msgId: `${conversationId}-msg`,
    status: "work",
    turnId,
    uiId: `tool:${toolCallId}`,
  });
}

/** A streamed text row (status `work`, no spinner: content-only bookkeeping). */
async function addTextRow(
  conversationId: string,
  turnId: string
): Promise<void> {
  await appendMessage({
    content: { text: "partial answer", type: "text" },
    conversationId,
    frameType: "content",
    msgId: `${conversationId}-msg`,
    status: "work",
    turnId,
    uiId: `text:${conversationId}-msg`,
  });
}

async function seed(conversationId: string): Promise<void> {
  await ensureConversation(conversationId, { title: conversationId });
}

function findRow(
  rows: StoredMessage[],
  uiId: string
): StoredMessage | undefined {
  return rows.find((row) => row.uiId === uiId);
}

describe("stranded-work recovery (TASK-105)", () => {
  it("interrupts a non-terminal tool row: terminal status AND rewritten content", async () => {
    await seed("rec-stranded");
    await addToolRow("rec-stranded", "rec-inprog", "in_progress", "rec-t1");
    await addToolRow("rec-stranded", "rec-pend", "pending", "rec-t1");

    const { interrupted } = await recoverStrandedWorkRows();
    expect(interrupted).toBeGreaterThanOrEqual(2);

    const rows = await listMessages("rec-stranded");
    for (const uiId of ["tool:rec-inprog", "tool:rec-pend"]) {
      const row = findRow(rows, uiId);
      expect(row?.status).toBe("error");
      const content = JSON.parse(row?.content ?? "") as Record<string, unknown>;
      expect(content.status).toBe("failed");
      // The reason the UI can show rides the content (AC#1/#3), dual-case
      // per the sanitize contract.
      expect(content.rawOutput).toContain("Interrupted");
      expect(content.raw_output).toContain("Interrupted");
      // The replayed frame carries the terminal card state: no endless
      // spinner can render from it.
      const frame = toWireFrame(row as StoredMessage, true);
      expect((frame.data as { status?: string }).status).toBe("failed");
    }
    // Other fields survive the rewrite (the card still shows what ran).
    const kept = JSON.parse(
      findRow(rows, "tool:rec-inprog")?.content ?? ""
    ) as Record<string, unknown>;
    expect(kept.title).toBe("run rec-inprog");
    expect(kept.kind).toBe("execute");
  });

  it("settles other work rows without touching their content", async () => {
    await seed("rec-settle");
    await addToolRow("rec-settle", "rec-done", "completed", "rec-t2");
    await addTextRow("rec-settle", "rec-t2");

    await recoverStrandedWorkRows();

    const rows = await listMessages("rec-settle");
    const done = findRow(rows, "tool:rec-done");
    expect(done?.status).toBe("finish");
    expect(JSON.parse(done?.content ?? "") as Record<string, unknown>).toEqual({
      content: null,
      kind: "execute",
      rawInput: { command: "cargo build" },
      status: "completed",
      title: "run rec-done",
      toolCallId: "rec-done",
    });
    const text = rows.find((row) => row.frameType === "content");
    expect(text?.status).toBe("finish");
    expect(JSON.parse(text?.content ?? "") as Record<string, unknown>).toEqual({
      text: "partial answer",
      type: "text",
    });
  });

  it("exempts rows of a live turn (AC#4) and leaves pending ask rows alone", async () => {
    await seed("rec-live");
    await addToolRow("rec-live", "rec-running", "in_progress", "rec-live-turn");
    await addToolRow("rec-live", "rec-crashed", "in_progress", "rec-dead-turn");
    await appendMessage({
      content: {
        options: [{ kind: "allow_once", name: "Allow", optionId: "a1" }],
        question: null,
        questions: [],
        request_id: "rec-ask-1",
      },
      conversationId: "rec-live",
      frameType: "ask",
      msgId: "rec-live-msg",
      refId: "rec-ask-1",
      status: "pending",
      turnId: "rec-live-turn",
    });

    await recoverStrandedWorkRows(new Set(["rec-live-turn"]));

    const rows = await listMessages("rec-live");
    const live = findRow(rows, "tool:rec-running");
    expect(live?.status).toBe("work");
    expect(
      (JSON.parse(live?.content ?? "") as Record<string, unknown>).status
    ).toBe("in_progress");
    const dead = findRow(rows, "tool:rec-crashed");
    expect(dead?.status).toBe("error");
    // Parked asks are status `pending`, not `work`: TASK-86 owns them.
    const ask = rows.find((row) => row.frameType === "ask");
    expect(ask?.status).toBe("pending");
  });

  it("is idempotent: a second pass finds nothing left to recover", async () => {
    await seed("rec-idem");
    await addToolRow("rec-idem", "rec-twice", "in_progress", "rec-t3");
    await recoverStrandedWorkRows();

    expect(await recoverStrandedWorkRows()).toEqual({
      interrupted: 0,
      settled: 0,
    });
    const rows = await listMessages("rec-idem");
    expect(findRow(rows, "tool:rec-twice")?.status).toBe("error");
  });
});

/*
 * TASK-109: the parked-card sibling of the pass above. A crashed sidecar
 * takes its engine parks with it, so `pending` ask/permission rows survive
 * with no live state to settle them; the boot pass expires them to `error`
 * without ever patching content (recovery must not fabricate an answer).
 */

/** A parked ask row as the sink persists it (status `pending`, refId-keyed). */
async function addAskRow(
  conversationId: string,
  requestId: string
): Promise<Record<string, unknown>> {
  const content = {
    options: [{ kind: "allow_once", name: "Allow", optionId: "a1" }],
    question: null,
    questions: [],
    request_id: requestId,
  };
  await appendMessage({
    content,
    conversationId,
    frameType: "ask",
    msgId: `${conversationId}-msg`,
    refId: requestId,
    status: "pending",
    turnId: "rec-park-turn",
  });
  return content;
}

/** A parked permission row as the sink persists it. */
async function addPermissionRow(
  conversationId: string,
  requestId: string
): Promise<Record<string, unknown>> {
  const content = {
    options: [{ kind: "allow_once", name: "Allow", optionId: "p1" }],
    request_id: requestId,
    tool_call: { title: "write file", toolCallId: requestId },
  };
  await appendMessage({
    content,
    conversationId,
    frameType: "acp_permission",
    msgId: `${conversationId}-msg`,
    refId: requestId,
    status: "pending",
    turnId: "rec-park-turn",
  });
  return content;
}

async function addDrillRow(
  conversationId: string,
  requestId: string
): Promise<Record<string, unknown>> {
  const content = {
    drill_session_id: "rec-drill-session",
    item: {
      anchors: ["grammar:particle"],
      id: "rec-drill-item",
      itemType: "grammar-form",
      level: "N5",
      options: ["a", "b", "c", "d"],
      passage: null,
      prompt: "Choose one.",
    },
    phase: "pending",
    request_id: requestId,
    session_id: "rec-acp-session",
    snapshot: {
      answered: 0,
      asked: 1,
      declaredCount: 5,
      pendingRefill: false,
      readyCount: 3,
      remaining: 4,
    },
  };
  await appendMessage({
    content,
    conversationId,
    frameType: "drill_item",
    msgId: `${conversationId}-msg`,
    refId: requestId,
    status: "pending",
    turnId: "rec-park-turn",
    uiId: `drill:${requestId}`,
  });
  return content;
}

describe("stranded-park recovery (TASK-109)", () => {
  it("expires stranded ask and permission rows: terminal status, untouched content, replayed status", async () => {
    await seed("rec-park");
    const askBefore = await addAskRow("rec-park", "rec-ask-9");
    const permBefore = await addPermissionRow("rec-park", "rec-perm-9");

    const counts = await recoverStrandedPendingCards();
    expect(counts.asks).toBeGreaterThanOrEqual(1);
    expect(counts.permissions).toBeGreaterThanOrEqual(1);

    const rows = await listMessages("rec-park");
    for (const [frameType, contentBefore] of [
      ["ask", askBefore],
      ["acp_permission", permBefore],
    ] as const) {
      const row = rows.find((candidate) => candidate.frameType === frameType);
      expect(row?.status).toBe("error");
      // Content survives verbatim: recovery never fabricates an answer.
      expect(
        JSON.parse(row?.content ?? "null") as Record<string, unknown>
      ).toEqual(contentBefore);
      // Both families replay the lifecycle status (AC#1: the client can
      // tell an expired park from a live one).
      expect(toWireFrame(row as StoredMessage, true).status).toBe("error");
    }
  });

  it("expires stranded drill rows without fabricating a resolution", async () => {
    await seed("rec-drill-park");
    const before = await addDrillRow("rec-drill-park", "rec-drill-9");

    const counts = await recoverStrandedPendingCards();
    expect(counts.drills).toBeGreaterThanOrEqual(1);

    const row = (await listMessages("rec-drill-park")).find(
      (candidate) => candidate.frameType === "drill_item"
    );
    expect(row?.status).toBe("error");
    expect(JSON.parse(row?.content ?? "null")).toEqual(before);
    expect(toWireFrame(row as StoredMessage, true).status).toBe("error");
  });

  it("is idempotent and leaves already-terminal rows alone", async () => {
    // The pass above settled everything pending in the shared db, so a
    // second sweep recovers nothing at all.
    expect(await recoverStrandedPendingCards()).toEqual({
      asks: 0,
      drills: 0,
      permissions: 0,
    });
    await seed("rec-park-done");
    await addAskRow("rec-park-done", "rec-ask-answered");
    await settlePending("rec-park-done", "rec-ask-answered", "finish", {
      answers: [{ labels: ["Ja"], question: "Verstanden?" }],
    });
    await recoverStrandedPendingCards();
    const [row] = await listMessages("rec-park-done");
    expect(row?.status).toBe("finish");
    // The answered summary from the real settle survived: recovery does
    // not re-settle or re-project terminal rows.
    expect(
      JSON.parse(row?.content ?? "") as Record<string, unknown>
    ).toHaveProperty("answers");
  });

  it("a park created after the pass still settles normally (AC#5)", async () => {
    await seed("rec-park-live");
    await addAskRow("rec-park-live", "rec-ask-late");
    await addPermissionRow("rec-park-live", "rec-perm-late");
    // The boot pass already ran (previous tests); these rows postdate it
    // and must keep the live lifecycle: answer one, expire the other.
    await settlePending("rec-park-live", "rec-ask-late", "finish", {
      answers: [],
    });
    await settlePending("rec-park-live", "rec-perm-late", "error");
    const rows = await listMessages("rec-park-live");
    const ask = rows.find((row) => row.frameType === "ask");
    const perm = rows.find((row) => row.frameType === "acp_permission");
    expect(ask?.status).toBe("finish");
    expect(perm?.status).toBe("error");
  });
});
