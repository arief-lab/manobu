/*
 * TASK-149: the sink must drop a host tool's whole call, not just its first frame.
 *
 * A host tool (`ask_user`, `next_drill_item`, `start_exam`) answers through its
 * own card, so its raw tool card is a duplicate on screen and is suppressed
 * before publish and before persist. But ACP only names the tool on the frame
 * that OPENS the call: the follow-up `tool_call_update`s arrive with
 * `title: null`, so a title-only check let the raw JSON through on the second
 * frame — the stored row that started this (local.db id 19330) was exactly
 * such a frame.
 *
 * The fix lives here rather than only in the client reducer because the client
 * cannot hold the claim: the titled frame is dropped before publish, so the
 * first frame a live client ever sees for that call IS the title-less update.
 * This file drives `sinkFor` directly (the production bridge, test database
 * behind it) and asserts both planes at once: the hub's ring and the rows.
 *
 * The non-host control is what makes the drop test meaningful. A sink that
 * suppressed every title-less update would pass it and break ordinary tool
 * cards, so the control asserts the opposite: an unrelated tool call in the
 * SAME turn must still publish both frames and store its collapsed row.
 */

import { describe, expect, it } from "bun:test";

process.env.CORS_ORIGIN = "http://localhost:3000";

const { isolatedDbUrl } = await import("./harness");
const DB_URL = isolatedDbUrl("host-tool-suppression");
const { applyContentMigrations } = await import("@manobu/db/migrate");
applyContentMigrations(DB_URL);
process.env.DATABASE_URL = DB_URL;
const { setUserDbProvider } = await import("../src/user-db");
setUserDbProvider(async () =>
  (await import("@manobu/db")).createUserDb(DB_URL)
);

type AcpStreamEvent = import("@manobu/acp/acp-events").AcpStreamEvent;
type WireFrame = import("../src/chat-hub").WireFrame;

const { eq } = await import("drizzle-orm");
const { conversations, messages } = await import("@manobu/db/schema/user");
const { ensureConversation, getChatDb } = await import("../src/chat-store");
const { createChatContext, hubFor, resetHub } = await import("../src/chat-hub");
const { sinkFor } = await import("../src/chat-persistence");

/** Mirrors `HOST_TOOL_NAMES` (packages/acp/src/acp-events.ts:37): the tools
 * whose raw card the client never shows because they own a card already. */
const HOST_TOOL_TITLES = ["ask_user", "next_drill_item", "start_exam"];

/** One tool frame in the shape the engine emits. */
function toolEvent(
  toolCallId: string,
  title: string | null,
  sessionUpdate: "tool_call" | "tool_call_update",
  rawOutput: unknown = { text: `output:${toolCallId}` }
): AcpStreamEvent {
  return {
    type: "acp_tool_call",
    update: { rawOutput, sessionUpdate, title, toolCallId },
  } as AcpStreamEvent;
}

/** The opening frame plus the title-less update every real call gets. */
function callAndUpdate(toolCallId: string, title: string | null) {
  return [
    toolEvent(toolCallId, title, "tool_call"),
    toolEvent(toolCallId, null, "tool_call_update", { text: "late raw json" }),
  ];
}

/** Run one turn through the production sink and return both planes. */
async function driveTurn(
  conversationId: string,
  events: AcpStreamEvent[]
): Promise<{ frames: WireFrame[]; rows: (typeof messages.$inferSelect)[] }> {
  await ensureConversation(conversationId, {});
  const context = createChatContext();
  const sink = sinkFor(
    context,
    conversationId,
    `turn-${conversationId}`,
    `msg-${conversationId}`
  );
  for (const event of events) {
    // biome-ignore lint/performance/noAwaitInLoops: the sink's durability chain is ORDERED — frame N+1 must not start before frame N is handed over, so feeding the turn concurrently would test a stream the production sink does not have.
    await sink(event);
  }
  const db = await getChatDb();
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId));
  return { frames: context.hubs.get(conversationId)?.ring ?? [], rows };
}

const toolFramesOf = (frames: WireFrame[]): WireFrame[] =>
  frames.filter((frame) => frame.type === "acp_tool_call");

describe("host-tool suppression at the persistence sink (TASK-149)", () => {
  for (const title of HOST_TOOL_TITLES) {
    it(`drops ${title}'s titled frame AND its title-less update from both planes`, async () => {
      const { frames, rows } = await driveTurn(`t149-host-${title}`, [
        { type: "turn_start" } as AcpStreamEvent,
        ...callAndUpdate(`call-${title}`, title),
        { stopReason: "end_turn", type: "turn_end" } as AcpStreamEvent,
      ]);

      // The live plane: neither frame reached the ring a subscriber reads.
      expect(toolFramesOf(frames)).toEqual([]);
      // The durable plane: no row exists for a reopen to replay.
      expect(rows.map((row) => row.frameType)).not.toContain("acp_tool_call");
      // Not vacuous: the turn still settled, so the drop did not eat the
      // terminal frame along with the tool frames.
      expect(rows.map((row) => row.frameType)).toContain("finish");
    });
  }

  it("keeps a non-host tool call in the same turn", async () => {
    const { frames, rows } = await driveTurn("t149-mixed", [
      { type: "turn_start" } as AcpStreamEvent,
      ...callAndUpdate("call-ask", "ask_user"),
      ...callAndUpdate("call-read", "Read file"),
      { stopReason: "end_turn", type: "turn_end" } as AcpStreamEvent,
    ]);

    // The claim is keyed by toolCallId, so it must not spread to the next
    // call: the ordinary tool published its opening frame AND its update.
    expect(
      toolFramesOf(frames).map(
        (frame) => (frame.data as { toolCallId: string }).toolCallId
      )
    ).toEqual(["call-read", "call-read"]);
    // Both frames collapse into the one card row the reducer dedupes on, and
    // the row's content is the LATE update — the frame the drop tests above
    // would have erased for a host tool.
    const toolRows = rows.filter((row) => row.frameType === "acp_tool_call");
    expect(toolRows.map((row) => row.uiId)).toEqual(["tool:call-read"]);
    expect(JSON.parse(toolRows[0]?.content ?? "{}")).toMatchObject({
      rawOutput: { text: "late raw json" },
      title: null,
    });
  });

  it("releases the claim when the turn settles (AC#4)", async () => {
    // The claim is per-turn, not per-process: a sidecar serving hundreds of
    // conversations cannot accumulate toolCallIds forever, and a later turn
    // that reuses an id is not suppressed for free. `chat.send` reopens the
    // hub for each new turn (chat-rpc.ts:461), which is what this replays.
    const conversationId = "t149-two-turns";
    await ensureConversation(conversationId, {});
    const context = createChatContext();

    const firstTurn = sinkFor(context, conversationId, "turn-1", "msg-1");
    await firstTurn(toolEvent("call-shared", "ask_user", "tool_call"));
    await firstTurn({
      stopReason: "end_turn",
      type: "turn_end",
    } as AcpStreamEvent);
    resetHub(hubFor(context, conversationId));

    const secondTurn = sinkFor(context, conversationId, "turn-2", "msg-2");
    await secondTurn(toolEvent("call-shared", null, "tool_call_update"));
    await secondTurn({
      stopReason: "end_turn",
      type: "turn_end",
    } as AcpStreamEvent);

    // Turn 2 carries no claim and opens with no title, so its frame is an
    // ordinary tool frame: it reaches the ring and the row store.
    const ring = context.hubs.get(conversationId)?.ring ?? [];
    expect(
      toolFramesOf(ring).map(
        (frame) => (frame.data as { toolCallId: string }).toolCallId
      )
    ).toEqual(["call-shared"]);
    const db = await getChatDb();
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId));
    expect(rows.map((row) => row.uiId)).toContain("tool:call-shared");
  });

  it("stores a title-less update that never had a titled frame", async () => {
    // The boundary of the server-side fix, recorded so nobody "widens" it into
    // dropping all title-less updates: the sink can only suppress a call it
    // saw open. A lone update has nothing to claim, so it rides both planes
    // like any other tool frame, and the CLIENT fold is what refuses to build
    // a card from it (packages/chat-session/src/chat-engine/folds/tool-call.ts).
    const { frames, rows } = await driveTurn("t149-orphan-update", [
      toolEvent("call-orphan", null, "tool_call_update"),
      { stopReason: "end_turn", type: "turn_end" } as AcpStreamEvent,
    ]);
    expect(toolFramesOf(frames).length).toBe(1);
    expect(rows.map((row) => row.uiId)).toContain("tool:call-orphan");
  });

  it("the fixture conversation exists, so a zero-row assert means zero frames", async () => {
    // Guards against a silent pass: if `ensureConversation` never inserted,
    // every "no rows" assertion above would hold with no writes attempted at
    // all, and the file would prove nothing about the sink.
    const db = await getChatDb();
    const seeded = await db
      .select({ id: conversations.id })
      .from(conversations);
    expect(seeded.map((row) => row.id)).toContain("t149-host-ask_user");
  });
});
