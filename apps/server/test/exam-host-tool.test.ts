import { describe, expect, test } from "bun:test";

/*
 * TASK-147: `start_exam` as a host tool.
 *
 * The learner model is "tell the teacher I want an exam, get an exam". The
 * decision of WHETHER a message is an exam request belongs to the agent, not to
 * `intent.ts:48-49`'s two literal regexes, because "can you set me a practice
 * paper?" matches neither and today becomes chat about exams. So the trigger is
 * a third host tool next to `ask_user` and `next_drill_item`.
 *
 * What makes this small is that everything UNDER the trigger already shipped:
 * the contract takes `conversationId`, `emitPaperFrame` binds the paper to it,
 * the paper fold and PaperCard and the `/exam/$examId` workspace all exist. This
 * file drives the real wiring in `src/context.ts` rather than a rebuilt copy of
 * it, because the wiring is where the three AC-relevant facts live: the
 * conversation comes from the endpoint's token, the hub is the process-wide one
 * `/ws` serves, and the allocation comes from the level default.
 *
 * The scope limit is enforced at the wire, not in prose: the input schema is
 * `.strict()`, so a call carrying `budget` is refused before the handler runs
 * and doc-21 §9.2 ("the model never decides how many items a section has") holds
 * on a model-triggered path.
 */

process.env.CORS_ORIGIN = "http://localhost:3000";

const { isolatedDbUrl } = await import("./harness");
const DB_URL = isolatedDbUrl("exam-host-tool");
const { applyContentMigrations } = await import("@manobu/db/migrate");
applyContentMigrations(DB_URL);
process.env.DATABASE_URL = DB_URL;

const { createUserDb } = await import("@manobu/db");
const { createItemStore } = await import("@manobu/db/item-store");
const { PAPER_DEFAULT_BUDGETS } = await import("@manobu/item-engine/paper");
const { createRouterClient } = await import("@orpc/server");
const { and, eq } = await import("drizzle-orm");
const { messages } = await import("@manobu/db/schema/user");
const { closeHub, createChatContext, hubFor, publishFrame, waitSettled } =
  await import("../src/chat-hub");
const { AskToolServer } = await import("../src/ask-tool");
const { callHostTool } = await import("./host-tool-client");
const { createRpcHandlers } = await import("../src/rpc");
const { setUserDbProvider } = await import("../src/user-db");

// The one injection point (src/user-db.ts): the module-scope `askTool` and the
// exam service behind it resolve through this, so the process wiring under test
// is the production wiring with a test database, not a re-implementation.
setUserDbProvider(async () => await createUserDb(DB_URL));

const { askTool, chatContext } = await import("../src/context");

const CONVERSATION = "conv-t147";

const database = await createUserDb(DB_URL);
const store = createItemStore(database);

/** The in-process `/rpc` surface, used to START a paper the way a client does.
 * A fresh context, so starting an exam publishes onto its own hubs and cannot
 * disturb the assertions about the conversation the tool bound. */
const client = createRouterClient(
  createRpcHandlers({}, async () => await createUserDb(DB_URL)),
  { context: createChatContext() }
);

type ToolReply = import("./host-tool-client").ToolReply;

interface AdvertisedTool {
  description: string;
  inputSchema: {
    additionalProperties?: unknown;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  name: string;
}

/** One JSON-RPC round trip against one conversation's host-tools endpoint. */
const callTool = async (
  name: string,
  args: Record<string, unknown>,
  token = askTool.tokenFor(CONVERSATION),
  server: InstanceType<typeof AskToolServer> = askTool
): Promise<ToolReply> => callHostTool(server, token, { arguments: args, name });

const listTools = async (): Promise<AdvertisedTool[]> => {
  const response = await askTool.handleRequest(
    new Request(
      `http://127.0.0.1/internal/host-tools/${askTool.tokenFor(CONVERSATION)}`,
      {
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "tools/list",
          params: {},
        }),
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": "2025-06-18",
        },
        method: "POST",
      }
    )
  );
  const body = (await response.json()) as {
    result?: { tools?: AdvertisedTool[] };
  };
  return body.result?.tools ?? [];
};

/** The LIVE paper frames published for one conversation, in order. */
const paperFramesFor = (conversationId: string) =>
  (chatContext.hubs.get(conversationId)?.ring ?? []).filter(
    (frame) => frame.type === "paper"
  );

interface StartedPaper {
  examId: string;
  level: string;
  mode: string;
  sections: { id: string; items: number; validated: number }[];
  sizeStatement: string;
  totalItems: number;
}

const startedPaper = (reply: ToolReply): StartedPaper =>
  JSON.parse(reply.text) as StartedPaper;

describe("start_exam host tool (TASK-147)", () => {
  test("advertises what the agent may decide, and nothing it may not", async () => {
    const tools = await listTools();
    const startExam = tools.find((tool) => tool.name === "start_exam");
    expect(startExam).toBeDefined();
    // The agent's whole surface: subject matter. A property named `budget` or
    // `sections` here would be the scope limit leaking into the tool.
    expect(Object.keys(startExam?.inputSchema.properties ?? {}).sort()).toEqual(
      ["focus", "level", "mode"]
    );
    expect(startExam?.inputSchema.required).toContain("level");
    // `.strict()` is what refuses per-section counts (AC#2). It has to survive
    // the SDK's JSON-schema conversion to reach the agent as a real boundary,
    // which is what this assertion is about: the advertised contract, not the
    // TypeScript one.
    expect(startExam?.inputSchema.additionalProperties).toBe(false);
  });

  test("refuses a call that sets item counts, and builds nothing", async () => {
    const before = paperFramesFor(CONVERSATION).length;
    const reply = await callTool("start_exam", {
      budget: { vocabulary: 2 },
      level: "N5",
    });
    expect(reply.isError).toBe(true);
    expect(reply.text.toLowerCase()).toContain("budget");
    // The refusal has teeth: no paper was requested, so no frame was published
    // and no exam was bound to this conversation.
    expect(paperFramesFor(CONVERSATION).length).toBe(before);
    const rows = await database
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.conversationId, CONVERSATION));
    expect(rows).toEqual([]);
  });

  test("binds the paper to the calling conversation, not the exam:<id> fallback", async () => {
    const reply = await callTool("start_exam", { level: "N5" });
    expect(reply.isError).toBe(false);
    const paper = startedPaper(reply);
    const state = await store.getExamState(paper.examId);
    expect(state?.conversationId).toBe(CONVERSATION);
    // AC#1's observable half: the card lands in THIS transcript, live. The
    // fallback binding (`exam:<id>`) is what a conversation-less request
    // produces, and it is the difference between a paper the learner can see
    // and one that only exists in the database.
    const frames = paperFramesFor(CONVERSATION);
    expect(frames.length).toBe(1);
    const frame = frames.at(-1);
    expect(frame?.conversation_id).toBe(CONVERSATION);
    expect(frame?.msg_id).toBe(`paper:${paper.examId}`);
    expect(frame?.replace).toBe(true);
  });

  test("the allocation is the level default, whatever the caller asked for", async () => {
    const first = startedPaper(await callTool("start_exam", { level: "N5" }));
    // The counts the tool reports are the counts the code chose: every section
    // of the level's default budget, unchanged by the caller (AC#2).
    const defaults = PAPER_DEFAULT_BUDGETS.N5;
    for (const section of first.sections) {
      expect(section.items).toBe(
        defaults[section.id as keyof typeof defaults] ?? 0
      );
    }
    expect(first.totalItems).toBe(
      Object.values(defaults).reduce((total, count) => total + count, 0)
    );
    // A different call, with a focus the first call did not carry, allocates the
    // same. This is the property, not one of its defences: strictness stops a
    // `budget` key, and this stops a caller steering the size through the keys
    // it IS allowed to send.
    const second = startedPaper(
      await callTool("start_exam", {
        focus: ["particles"],
        level: "N5",
        mode: "shortened",
      })
    );
    expect(
      second.sections.map((section) => [section.id, section.items])
    ).toEqual(first.sections.map((section) => [section.id, section.items]));
    expect(second.examId).not.toBe(first.examId);
  });

  test("mode moves the clock, never the count, and the listing says so", async () => {
    // TASK-167. The advertised description used to offer `shortened` as "a quick
    // paper", which reads like a size knob. It is not one:
    // `paperSectionTimeLimitSeconds` (packages/item-engine/src/paper.ts:302-326)
    // scales the *seconds* and the items always come from the level's default
    // budget. Both halves are pinned here because the bug was a sentence, and a
    // sentence only stays true if something checks it against the wiring.
    const quick = startedPaper(
      await callTool("start_exam", { level: "N5", mode: "shortened" })
    );
    const formal = startedPaper(
      await callTool("start_exam", { level: "N5", mode: "exam-conditions" })
    );

    expect(
      formal.sections.map((section) => [section.id, section.items])
    ).toEqual(quick.sections.map((section) => [section.id, section.items]));
    expect(formal.totalItems).toBe(quick.totalItems);

    const limitsFor = async (examId: string): Promise<Map<string, number>> => {
      const state = await store.getExamState(examId);
      const sections = state?.sections ?? [];
      if (sections.length === 0) {
        throw new Error(`the started paper ${examId} has no stored sections`);
      }
      const limits = new Map<string, number>();
      for (const section of sections) {
        if (section.timeLimitSeconds === null) {
          throw new Error(`${section.section} was built without a time limit`);
        }
        limits.set(section.section, section.timeLimitSeconds);
      }
      return limits;
    };
    const quickLimits = await limitsFor(quick.examId);
    const formalLimits = await limitsFor(formal.examId);
    for (const [section, seconds] of quickLimits) {
      expect(formalLimits.get(section)).toBeGreaterThan(seconds);
    }

    const startExam = (await listTools()).find(
      (tool) => tool.name === "start_exam"
    );
    const description = startExam?.description ?? "";
    expect(description).toContain(
      "`shortened` and `exam-conditions` carry the same number of items"
    );
    expect(description).toContain("a mode is not a way to ask for fewer items");
    expect(description).not.toContain("for a quick paper");
  });

  test("AC#2: `real` is on the agent's mode enum and reaches the service as real", async () => {
    // TASK-173.1. The mode the learner asks for in chat ("the real paper", "a
    // mock") has to survive the agent's tool call, so two things are pinned: the
    // advertised schema accepts the value (a mode the listing does not name is a
    // mode the model never sends), and the paper that comes back says `real`
    // rather than having quietly fallen back to `shortened` - which is exactly
    // what `defaultPaperMode` does with a mode the engine does not know.
    const startExam = (await listTools()).find(
      (tool) => tool.name === "start_exam"
    );
    const enumValues = JSON.stringify(startExam?.inputSchema ?? {});
    for (const mode of ["real", "shortened", "exam-conditions"]) {
      expect(enumValues).toContain(mode);
    }
    expect(startExam?.description ?? "").toContain("`real`");

    // Both outcomes are correct here and neither is asserted: a real paper whose
    // official shape the engine can fully build comes back `real`, and one that
    // cannot (today: every N5 paper, see TASK-173.4) is refused and names the 大問
    // it gave up on. What must hold either way is that the request was understood
    // as `real`, and that a refusal explains itself instead of reading as a broken
    // build or a dry level.
    const reply = await callTool("start_exam", { level: "N5", mode: "real" });
    if (reply.isError) {
      expect(reply.text).toContain("cannot be built yet");
      expect(reply.text).toContain("大問");
      expect(reply.text).not.toContain("no unseen content");
    } else {
      expect(startedPaper(reply).mode).toBe("real");
    }
  });

  test("the result says what size the host gave the paper, in the agent's hands", async () => {
    // TASK-156 AC#2. A learner who names a count in chat cannot have it, so the
    // only honest move left is to tell them what they did get. `totalItems` is
    // the number; `sizeStatement` is the sentence that makes the model repeat it
    // instead of just "your paper is ready", and it is host-owned.
    const reply = await callTool("start_exam", { level: "N5" });
    const paper = startedPaper(reply);
    const allocated = Object.values(PAPER_DEFAULT_BUDGETS.N5).reduce(
      (total, count) => total + count,
      0
    );
    expect(paper.totalItems).toBe(allocated);
    expect(paper.sizeStatement).toContain(String(allocated));
    // The count in the sentence is the count in the payload: a size the agent
    // reads out has to be the size the card shows.
    expect(paper.sizeStatement).toContain(String(paper.totalItems));
    expect(paper.sizeStatement).toContain("N5");

    const startExam = (await listTools()).find(
      (tool) => tool.name === "start_exam"
    );
    expect(startExam?.description).toContain("sizeStatement");
  });

  test("the result carries the paper's shape and none of its content", async () => {
    const reply = await callTool("start_exam", { level: "N5" });
    const paper = startedPaper(reply);
    expect(paper.level).toBe("N5");
    expect(paper.mode).toBe("shortened");
    expect(paper.sections.length).toBeGreaterThan(0);
    // AC#4. The tool result is text the model may repeat, so the property worth
    // pinning is not "the shape looks right" but "there is nothing here to read
    // aloud": every stem, option and passage the paper actually holds must be
    // absent from what the agent was handed.
    const state = await store.getExamState(paper.examId);
    expect(state?.items.length).toBeGreaterThan(0);
    if (!state) {
      throw new Error("the started paper has no stored state to read");
    }
    const surfaces = state.items
      .flatMap((row) => [
        ...row.item.options,
        row.item.prompt,
        row.item.passage ?? "",
        ...(row.item.stimuli ?? []).map((stimulus) => stimulus.text),
      ])
      .filter((text) => text.length > 1);
    expect(surfaces.length).toBeGreaterThan(0);
    for (const text of surfaces) {
      expect(reply.text).not.toContain(text);
    }
  });

  test("resolves while a paper is still running, and leaves nothing parked", async () => {
    // AC#3. `ask_user` and `next_drill_item` BLOCK the agent's request until the
    // learner answers (a 25-minute deadline bounds the park, ask-tool.ts:221).
    // `start_exam` must not inherit that: the paper is finished minutes later,
    // and a tool that waited for it would hold the turn open and leave the
    // conversation busy (ask-tool.ts:221 is the behaviour this pins against).
    const running = startedPaper(await callTool("start_exam", { level: "N5" }));
    await client.exam.start({ examId: running.examId });
    expect((await store.getExamState(running.examId))?.status).toBe(
      "in_progress"
    );

    const second = await callTool("start_exam", {
      level: "N5",
      mode: "shortened",
    });
    expect(second.isError).toBe(false);
    const secondPaper = startedPaper(second);
    // Resolved while the first is still in progress, and the new paper is
    // waiting for nobody: it is ready, unanswered, and no interactive row was
    // parked in the transcript.
    expect((await store.getExamState(running.examId))?.status).toBe(
      "in_progress"
    );
    const fresh = await store.getExamState(secondPaper.examId);
    expect(fresh?.status).toBe("ready");
    expect(fresh?.answeredCount).toBe(0);
    const parked = await database
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, CONVERSATION),
          eq(messages.status, "pending")
        )
      );
    expect(parked).toEqual([]);
    // AC#5's other half: the debrief belongs to a later turn, so nothing here
    // may leave the conversation busy. A turn is busy while a row is pending,
    // and a hub with no live turn has no entry in `turns`.
    expect(chatContext.turns.has(CONVERSATION)).toBe(false);
  });

  test("a paper written between turns reopens the settled hub for the live drain", async () => {
    // AC#1 across a turn boundary. `chat.subscribe` treats a settled hub with
    // terminal history as "the transcript is done, close" (chat-rpc.ts:318),
    // and a pump on a settled hub exits instead of waiting (chat-hub.ts:170).
    // So a learner whose socket is mid-reconnect when the paper is built gets
    // the row in the database and no card in front of them. The property worth
    // pinning is therefore not "a frame exists" but "the hub is live again".
    const conversationId = "conv-t147-between-turns";
    const hub = hubFor(chatContext, conversationId);
    closeHub(hub);
    expect(hub.terminal).toBe(true);

    const reply = await callTool(
      "start_exam",
      { level: "N5" },
      askTool.tokenFor(conversationId)
    );
    expect(reply.isError).toBe(false);
    const paper = startedPaper(reply);

    expect(hub.terminal).toBe(false);
    const frames = hub.ring.filter((frame) => frame.type === "paper");
    expect(frames.length).toBe(1);
    expect(frames[0]?.msg_id).toBe(`paper:${paper.examId}`);
    if (frames[0] === undefined) {
      throw new Error("the between-turns paper published no frame");
    }
    // The hub is live again: a drain PARKS on its gate and wakes on the next
    // publish, instead of the short-circuit `waitSettled` gives a settled hub
    // (chat-hub.ts:170) that the pump reads as "close the stream".
    const stillParked = Symbol("still-parked");
    const drain = waitSettled(hub);
    const outcome = await Promise.race<"woken" | symbol>([
      drain.then(() => "woken" as const),
      new Promise<symbol>((resolve) => {
        setTimeout(() => {
          resolve(stillParked);
        }, 5);
      }),
    ]);
    expect(outcome).toBe(stillParked);
    publishFrame(hub, frames[0]);
    await drain;
  });

  test("an unconfigured host refuses instead of crashing the turn", async () => {
    const bare = new AskToolServer({
      park: () => ({ promise: Promise.resolve(""), requestId: "unused" }),
    });
    const token = bare.tokenFor("conv-unconfigured");
    const reply = await callTool("start_exam", { level: "N5" }, token, bare);
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("start_exam unavailable");
  });

  test("a paper the level cannot fill carries its REASON to the agent", async () => {
    // TASK-148: `startExam` throws when the receipt is not `ready`, and the
    // harness used to append "tell the learner the paper could not be built"
    // unconditionally. That sentence is true and it buries the one the learner
    // can act on: this level has no new questions left, so a different level is
    // the way out. The reason therefore has to survive the wire, and this pins
    // the composition (the service side, that a short paper throws at all, is
    // `exam-no-repeat.test.ts` AC#4).
    const dry = new AskToolServer({
      park: () => ({ promise: Promise.resolve(""), requestId: "unused" }),
      startExam: () =>
        Promise.reject(
          new Error(
            "the N5 level has no unseen content left for this learner: only 20 of 30 items could be filled. Offer the learner a different level."
          )
        ),
    });
    const reply = await callTool(
      "start_exam",
      { level: "N5" },
      dry.tokenFor("conv-t148-dry"),
      dry
    );
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("no unseen content left");
    expect(reply.text).toContain("20 of 30");
    // The harness sentence is agent-facing copy, so it is pinned as one (the
    // TASK-147 rule for `START_EXAM_DESCRIPTION`): "tell them it failed" alone
    // is a true instruction that lets the reason be dropped, which is the half
    // of AC#6 the model has to say.
    expect(reply.text).toContain("including any reason the message states");
    expect(reply.text).toContain("do not describe a paper you do not have");
  });

  test("the exam request survives without an agent: the model-free path is the same code", async () => {
    // AC#6. doc-21 §5 keeps the model-free path authoritative, so the paper an
    // agent triggers must be one the sidecar can build on its own. This calls
    // the same service the tool closure calls, with no agent and no session in
    // sight, and asserts the same observable outcome: a ready paper bound to the
    // conversation and a paper frame on the live hub.
    const detached = createChatContext();
    const { createExamService } = await import("../src/services/exam-service");
    const service = createExamService(async () => await createUserDb(DB_URL));
    const conversationId = "conv-t147-no-agent";
    const requested = await service.request({
      conversationId,
      focus: [],
      level: "N5",
      mode: "shortened",
    });
    const built = await service.assemble(requested.examId, detached);
    expect(built.status).toBe("ready");
    expect(built.conversationId).toBe(conversationId);
    const frames = (detached.hubs.get(conversationId)?.ring ?? []).filter(
      (frame) => frame.type === "paper"
    );
    expect(frames.length).toBe(1);
    expect(frames[0]?.msg_id).toBe(`paper:${requested.examId}`);
  });
});
