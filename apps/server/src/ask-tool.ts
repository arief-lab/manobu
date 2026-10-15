/**
 * Host `ask_user` MCP tool server (TASK-80.2).
 *
 * ACP has no host-provided tool surface except MCP: instead of the old
 * `acpTools()` provider registry (which silently dropped unregistered tools
 * and forced the HANDOFF_UI sentinel), the host serves `ask_user` as a real
 * MCP server attached to each conversation's `session/new`. A `tools/call`
 * BLOCKS the agent's request until the learner answers through the REST
 * endpoint (`park` resolves), so the turn genuinely pauses on the human.
 *
 * Transport: loopback streamable-HTTP (stateless — one POST per JSON-RPC
 * message, no session ids) via `@modelcontextprotocol/sdk`'s WebStandard
 * transport, mounted on the shared Hono app at `/internal/host-tools/*`.
 * Agents without `mcpCapabilities.http` get a stdio bridge: a tiny bun
 * child (`host-mcp-bridge.ts`) piping NDJSON stdio ↔ the same endpoint, so
 * one implementation covers both registry capability classes.
 */

import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AcpAskQuestion,
  type AcpDrillResolution,
  projectAcpDrillResolution,
} from "@manobu/acp/acp-events";
import type { McpServer } from "@manobu/acp/session-types";
import {
  EXAM_MODES,
  type ExamLevel,
  ExamLevelSchema,
  type ExamMode,
} from "@manobu/api-contract";
import { McpServer as McpToolServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

/**
 * Park questions on a conversation's live session. Returns the parked
 * correlation `requestId` (TASK-86: the caller needs it to settle the
 * persisted row if this tool's own timeout races ahead of the engine's)
 * plus the waiter promise, which resolves with the answer text.
 *
 * TASK-92: `key` is a content hash of the question set. Passing it makes
 * the park idempotent — a re-call while the ask is live (or after it
 * settled) attaches to the same park / replays its outcome instead of
 * minting a duplicate card.
 */
export type ParkAsk = (
  conversationId: string,
  questions: AcpAskQuestion[],
  key?: string
) => { promise: Promise<string>; requestId: string };

export type ParkDrillItem = (
  conversationId: string,
  drillSessionId: string
) => Promise<{
  promise: Promise<AcpDrillResolution>;
  requestId: string;
}>;

/**
 * TASK-147: what the agent may decide about a paper, and what it gets back.
 *
 * The agent picks the subject matter; the host picks the size. `StartedPaper`
 * is the shape the agent may speak of — sections and counts, with no field
 * that could hold a stem or an option, so "never read the paper aloud" is a
 * type constraint rather than a rule the model can break.
 */
export interface StartExamParams {
  focus: string[];
  level: ExamLevel;
  mode: ExamMode;
}

export interface StartedPaperSection {
  id: string;
  items: number;
  validated: number;
}

export interface StartedPaper {
  examId: string;
  level: string;
  mode: string;
  sections: StartedPaperSection[];
  /**
   * TASK-156: the size is the host's, so the learner has to hear it from the
   * agent. `totalItems` alone answers "how many did I get", which is only half
   * of what a learner who named a number asked. This is the other half, as a
   * fact the tool returned rather than something the model infers.
   */
  sizeStatement: string;
  totalItems: number;
}

export type StartExam = (
  conversationId: string,
  params: StartExamParams
) => Promise<StartedPaper>;

export interface AskToolOptions {
  /** Max ms the blocking tools/call waits for the learner (AC: explicit). */
  askTimeoutMs?: number;
  drillTimeoutMs?: number;
  onDrillExpire?: (conversationId: string, requestId: string) => void;
  /**
   * Called once when an ask dies without an answer reaching the agent: the
   * 25-min tool-side timeout wins the race, or the park rejects (engine
   * timeout, cancel, dead session). The host settles the parked row to
   * "error" so it stops replaying interactive (TASK-86).
   */
  onExpire?: (conversationId: string, requestId: string) => void;
  park: ParkAsk;
  parkDrillItem?: ParkDrillItem;
  /**
   * TASK-94: called ONLY when this tool's own deadline fires, to retire the
   * engine park (reject it into the terminal replay cache). Without it a
   * learner could still answer an already-expired row inside the engine's
   * longer backstop window, resurrecting a question the transcript shows as
   * expired. The park-reject branch needs no retire: the engine got there
   * first.
   */
  retire?: (requestId: string) => void;
  retireDrillItem?: (requestId: string) => void;
  /**
   * TASK-147: build a paper for this conversation from the deterministic exam
   * service. Awaited (the paper has to exist before the agent is told about
   * it) but NOT parked: it returns once the paper is assembled and never waits
   * for the learner to answer it.
   */
  startExam?: StartExam;
}

const ASK_TOOL_NAME = "ask_user";
const NEXT_DRILL_ITEM_TOOL_NAME = "next_drill_item";
const START_EXAM_TOOL_NAME = "start_exam";
const HOST_SERVER_NAME = "manobu-host-tools";

const NextDrillItemInputShape = {
  sessionId: z.string().min(1),
};

/*
 * TASK-147: the agent's whole decision surface for a paper.
 *
 * `.strict()` is the scope limit, enforced at the wire rather than in prose: a
 * call that supplies per-section item counts is refused before the handler
 * runs, so the model cannot set a paper's size even if it tries. doc-21 §9.2's
 * rule ("the model never decides how many items a section has") therefore holds
 * on a host-tool path, where the allocation still comes from
 * `PAPER_DEFAULT_BUDGETS`.
 */
const StartExamInputSchema = z
  .object({
    focus: z.array(z.string().trim().min(1)).max(100).optional(),
    level: ExamLevelSchema,
    mode: z.enum(EXAM_MODES).optional(),
  })
  .strict();

interface StartExamToolInput {
  focus?: string[];
  level: ExamLevel;
  mode?: ExamMode;
}

/*
 * TASK-167: the description used to advertise `mode` as "shortened for a quick
 * paper". It is not a size knob. `paperSectionTimeLimitSeconds`
 * (packages/item-engine/src/paper.ts:302-326) reads the budget only to scale
 * the *seconds*, and the item count always comes from the level's default
 * budget, so that sentence let Sensei answer "10 questions" with "here is a
 * short one" and hand over the 30-item N3 paper. Every clause below states what
 * the wire actually does, and `apps/server/test/exam-host-tool.test.ts` pins
 * the mode-independence claim against the listing this server advertises.
 *
 * TASK-173.1 adds a third mode, and it is the one that earns an exception to
 * "the count never moves": `real` refuses fabricated candidates, so its paper
 * can be shorter than the allocation. Saying so is what keeps the TASK-167
 * sentence true for the two modes it was written about, instead of quietly
 * becoming a lie about the new one.
 */
const START_EXAM_DESCRIPTION =
  "Build a practice paper for this learner from the local item corpus. It appears as a paper card in this conversation and opens on their screen; the learner starts it when they choose, and each section they are working on runs against a time limit that stops while they pause. You choose only what it is about: `level` (N1 to N5), `mode`, and `focus` (topics or words to lean on). `mode` is `shortened`, `exam-conditions` or `real`. `shortened` and `exam-conditions` carry the same number of items and move only the clock: `shortened` gives each section a shorter limit and `exam-conditions` the official section minutes. Choose `real` when the learner asks for the real JLPT paper or a mock exam (模試): it takes the official minutes and refuses every item the corpus cannot supply honestly, so it is the one mode whose paper can come back short. When it does, the call fails and names the section: tell the learner which part the app cannot yet ask for real, and offer a practice paper instead. You do NOT choose item counts or sections, and a mode is not a way to ask for fewer items: the host allocates the count from the default budget for that level, and a call that passes a count is refused. `focus` can narrow what the items are about, never how many there are. This returns as soon as the paper is built, so do not wait for answers or ask for them in this turn. The paper is on screen: never read item stems or options aloud, and do not narrate a result or debrief before the learner submits. Say that the paper is ready, name its level and its sections, and repeat `sizeStatement` from the result so the learner hears the size the host gave it. If the learner named a number, your reply must carry both numbers before anything else: the count they asked for, the count this paper has (`sizeStatement` states it), and the reason: the size comes from the level, and a smaller paper is not something this tool can build. Stating only the paper's size leaves a learner who asked for ten reading a thirty-item paper without ever being told the two differ.";

const NEXT_DRILL_ITEM_DESCRIPTION =
  "Call this to present the next item in the learner's accepted drill set. Pass the drill session id and wait for the learner's pick; the result arrives only after the pick and contains the verdict.";

const drillUnavailable = (message: string) => ({
  content: [
    {
      text: `next_drill_item unavailable: ${message}`,
      type: "text" as const,
    },
  ],
  isError: true,
});

const drillFailure = (message: string) => ({
  content: [
    {
      text: `next_drill_item failed: ${message}. Do not invent an item; continue without one.`,
      type: "text" as const,
    },
  ],
  isError: true,
});

const drillResolutionText = (resolution: AcpDrillResolution): string =>
  JSON.stringify(projectAcpDrillResolution(resolution));

const examUnavailable = (message: string) => ({
  content: [
    {
      text: `start_exam unavailable: ${message}`,
      type: "text" as const,
    },
  ],
  isError: true,
});

const examFailure = (message: string) => ({
  content: [
    {
      // TASK-148: the reason has to travel. `startExam` distinguishes "this
      // level has no unseen content left" from "something broke", and a flat
      // "could not be built" instruction made the model drop the first one,
      // which is the only thing the learner can act on.
      text: `start_exam failed: ${message}. Tell the learner the paper could not be built, including any reason the message states, and do not describe a paper you do not have.`,
      type: "text" as const,
    },
  ],
  isError: true,
});

/**
 * MCP-facing input shape for ask_user (the parked AcpAskQuestion payload the
 * learner's card renders from). The @modelcontextprotocol/sdk types resolve
 * `zod/v4/core` against its own nested zod@4.4.3 while this package builds
 * schemas with catalog zod@4.5.4 — runtime-identical, type-disjoint — so the
 * raw shape needs one cast at registerTool and the callback types itself.
 */
const AskUserInputShape = {
  questions: z
    .array(
      z.object({
        header: z.string().optional(),
        multiSelect: z.boolean().optional(),
        options: z
          .array(
            z.object({
              description: z.string().optional(),
              label: z.string(),
            })
          )
          .length(3),
        question: z.string(),
      })
    )
    .min(1)
    .max(3),
};

interface AskUserToolInput {
  questions: AcpAskQuestion[];
}

const ASK_USER_DESCRIPTION =
  'MUST be called before teaching when the learner has not stated a goal or level (e.g. a bare "help me study"). Provide 1-3 questions, each with exactly 3 short, distinct answer choices; the learner can also type another answer. Calling this renders a tappable card in the chat UI and BLOCKS until the learner answers; the tool result is their answers. If this call fails or times out, call it AGAIN with the same questions: an already-answered question returns the answer immediately and a still-unanswered one reuses the same card. NEVER answer the questions yourself.';

const TRAILING_SLASH = /\/$/;

/** Base64url token for one conversation's host-tools endpoint. */
function newToken(): string {
  return randomBytes(12).toString("base64url");
}

/**
 * TASK-92 park identity: sha256 over the JSON-canonical question set. The
 * SDK hands us schema-parsed values, so key order is deterministic and the
 * hash only drifts when the questions actually differ.
 */
function askKey(questions: AcpAskQuestion[]): string {
  return createHash("sha256").update(JSON.stringify(questions)).digest("hex");
}

/**
 * The stdio→HTTP forwarder spawned for agents without http MCP support.
 * MCP stdio framing is newline-delimited JSON; one POST per line, response
 * line written back (204/no-content for notifications). Env:
 * MANOBU_HOST_TOOLS_URL/_TOKEN.
 */
const BRIDGE_SCRIPT = `
const readline = require("node:readline");
const url = process.env.MANOBU_HOST_TOOLS_URL ?? "";
const token = process.env.MANOBU_HOST_TOOLS_TOKEN ?? "";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  try {
    const res = await fetch(url + "/" + token, {
      method: "POST",
      headers: { "content-type": "application/json", "mcp-protocol-version": "2025-06-18" },
      body: line,
    });
    const text = await res.text();
    if (text) process.stdout.write(text + "\\n");
  } catch (e) {
    process.stderr.write("host-tools bridge: " + e + "\\n");
  }
});
`;

export class AskToolServer {
  readonly #askTimeoutMs: number;
  readonly #base: string;
  readonly #conversationByToken = new Map<string, string>();
  readonly #drillTimeoutMs: number;
  readonly #onDrillExpire: (conversationId: string, requestId: string) => void;
  readonly #onExpire: (conversationId: string, requestId: string) => void;
  readonly #park: ParkAsk;
  readonly #parkDrillItem: ParkDrillItem | undefined;
  readonly #retire: (requestId: string) => void;
  readonly #retireDrillItem: ((requestId: string) => void) | undefined;
  readonly #startExam: StartExam | undefined;
  #bridgePath: Promise<string> | null = null;
  readonly #tokenForConversation = new Map<string, string>();

  constructor(
    options: AskToolOptions & {
      /** Loopback origin prefix (default: the sidecar itself). */
      baseUrl?: string;
    }
  ) {
    this.#park = options.park;
    this.#parkDrillItem = options.parkDrillItem;
    this.#retire = options.retire ?? (() => undefined);
    this.#retireDrillItem = options.retireDrillItem;
    this.#startExam = options.startExam;
    this.#askTimeoutMs = options.askTimeoutMs ?? 25 * 60 * 1000;
    this.#drillTimeoutMs = options.drillTimeoutMs ?? 25 * 60 * 1000;
    this.#base = options.baseUrl ?? "/internal/host-tools";
    this.#onExpire = options.onExpire ?? (() => undefined);
    this.#onDrillExpire = options.onDrillExpire ?? (() => undefined);
  }

  /** Hono-style route handler for POST /internal/host-tools/:token. */
  handleRequest = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const token = url.pathname.split("/").pop() ?? "";
    const conversationId = this.#conversationByToken.get(token);
    if (!conversationId) {
      return Response.json(
        {
          error: { code: -32_000, message: "Unknown host-tools token" },
          id: null,
          jsonrpc: "2.0",
        },
        { status: 404 }
      );
    }
    // Stateless per-request wiring (SDK-recommended shape for HTTP).
    const server = new McpToolServer(
      { name: HOST_SERVER_NAME, version: "0.1.0" },
      { instructions: "manobu host tools" }
    );
    server.registerTool(
      ASK_TOOL_NAME,
      {
        description: ASK_USER_DESCRIPTION,
        inputSchema: AskUserInputShape,
      },
      async ({ questions }: AskUserToolInput) => {
        const waitMs = this.#askTimeoutMs;
        let parked: { promise: Promise<string>; requestId: string };
        try {
          // TASK-92: the content-keyed park makes a re-call after a client
          // timeout attach to the same ask (or replay its outcome).
          parked = this.#park(conversationId, questions, askKey(questions));
        } catch (error: unknown) {
          // No live session: nothing was parked, so there is no row to
          // settle — the failure never reached the transcript.
          return {
            content: [
              {
                text: `ask_user failed: ${String(error)}. Do not re-ask; proceed conservatively.`,
                type: "text" as const,
              },
            ],
            isError: true,
          };
        }
        const { promise, requestId } = parked;
        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<"timeout">((resolve) => {
          timeoutTimer = setTimeout(() => {
            resolve("timeout");
          }, waitMs);
        });
        const answer = await Promise.race([promise, timedOut]).then(
          (winner) => winner,
          (error: unknown) => {
            // The park rejected first (engine timeout, cancel, dead child):
            // the card is dead even though the learner may still see it.
            this.#onExpire(conversationId, requestId);
            return `ask_user failed: ${String(error)}`;
          }
        );
        clearTimeout(timeoutTimer);
        if (answer === "timeout") {
          // TASK-94: retire the engine park alongside settling the row —
          // after this the learner's tap cannot answer (answerAsk false) and
          // a re-call replays the expiry instead of resurrecting the ask.
          this.#retire(requestId);
          this.#onExpire(conversationId, requestId);
          return {
            content: [
              {
                text: `ask_user timed out after ${Math.round(waitMs / 60_000)} min without an answer. End your turn with a short line; the learner can answer later.`,
                type: "text" as const,
              },
            ],
            isError: true,
          };
        }
        if (
          typeof answer === "string" &&
          answer.startsWith("ask_user failed")
        ) {
          return {
            content: [
              {
                text: `${answer}. Do not re-ask; proceed conservatively.`,
                type: "text" as const,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [{ text: answer, type: "text" as const }],
        };
      }
    );
    server.registerTool(
      NEXT_DRILL_ITEM_TOOL_NAME,
      {
        description: NEXT_DRILL_ITEM_DESCRIPTION,
        inputSchema: NextDrillItemInputShape,
      },
      async ({ sessionId }: { sessionId: string }) => {
        const parkDrillItem = this.#parkDrillItem;
        if (!parkDrillItem) {
          return drillUnavailable("the drill bridge is not configured");
        }
        let parked: {
          promise: Promise<AcpDrillResolution>;
          requestId: string;
        };
        try {
          parked = await parkDrillItem(conversationId, sessionId);
        } catch (error: unknown) {
          return drillUnavailable(
            error instanceof Error ? error.message : "the drill is unavailable"
          );
        }

        type DrillWait =
          | { kind: "resolution"; resolution: AcpDrillResolution }
          | { kind: "timeout" }
          | { kind: "error"; message: string };
        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<DrillWait>((resolve) => {
          timeoutTimer = setTimeout(() => {
            resolve({ kind: "timeout" });
          }, this.#drillTimeoutMs);
        });
        const answer: DrillWait = await Promise.race<DrillWait>([
          parked.promise.then(
            (resolution) => ({ kind: "resolution", resolution }) as const
          ),
          timedOut,
        ]).catch(
          (error: unknown): DrillWait => ({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          })
        );
        clearTimeout(timeoutTimer);
        if (answer.kind === "error") {
          this.#onDrillExpire(conversationId, parked.requestId);
          return drillFailure(answer.message);
        }
        if (answer.kind === "timeout") {
          this.#retireDrillItem?.(parked.requestId);
          this.#onDrillExpire(conversationId, parked.requestId);
          return drillUnavailable(
            `the item was not picked within ${Math.round(this.#drillTimeoutMs / 60_000)} min`
          );
        }
        return {
          content: [
            {
              text: drillResolutionText(answer.resolution),
              type: "text" as const,
            },
          ],
        };
      }
    );
    server.registerTool(
      START_EXAM_TOOL_NAME,
      {
        description: START_EXAM_DESCRIPTION,
        inputSchema: StartExamInputSchema,
      },
      async ({ focus, level, mode }: StartExamToolInput) => {
        const startExam = this.#startExam;
        if (!startExam) {
          return examUnavailable("exam generation is not configured");
        }
        let paper: StartedPaper;
        try {
          // The conversation comes from this endpoint's token, never from the
          // agent's arguments: a paper can only be bound to the chat the
          // calling session belongs to.
          paper = await startExam(conversationId, {
            focus: focus ?? [],
            level,
            mode: mode ?? "shortened",
          });
        } catch (error: unknown) {
          return examFailure(
            error instanceof Error ? error.message : String(error)
          );
        }
        return {
          content: [{ text: JSON.stringify(paper), type: "text" as const }],
        };
      }
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await server.close().catch(() => undefined);
    }
  };

  /** Token + URL path for a conversation (stable per conversation). */
  tokenFor(conversationId: string): string {
    let token = this.#tokenForConversation.get(conversationId);
    if (!token) {
      token = newToken();
      this.#tokenForConversation.set(conversationId, token);
      this.#conversationByToken.set(token, conversationId);
    }
    return token;
  }

  /**
   * The ACP `McpServer` entries to attach for one conversation.
   * `viaHttp` = the agent advertised `mcpCapabilities.http`; otherwise the
   * stdio bridge child forwards to the same endpoint. `origin` is the
   * absolute loopback base (scheme+host+port) the agent can reach.
   */
  async mcpServersFor(
    conversationId: string,
    viaHttp: boolean,
    origin: string
  ): Promise<McpServer[]> {
    const token = this.tokenFor(conversationId);
    const url = `${origin.replace(TRAILING_SLASH, "")}${this.#base}/${token}`;
    if (viaHttp) {
      return [
        {
          headers: [],
          name: HOST_SERVER_NAME,
          type: "http" as const,
          url,
        },
      ];
    }
    return [
      {
        // The bridge forwards NDJSON stdio to the same HTTP endpoint.
        args: [await this.bridgeScriptPath, url, token],
        command: process.execPath,
        env: [],
        name: HOST_SERVER_NAME,
      },
    ];
  }

  /** The bridge script path (materialized once into tmpdir). */
  get bridgeScriptPath(): Promise<string> {
    this.#bridgePath ??= (async (): Promise<string> => {
      const path = join(tmpdir(), `manobu-host-mcp-bridge-${process.pid}.js`);
      await writeFile(path, BRIDGE_SCRIPT, "utf8");
      return path;
    })();
    return this.#bridgePath;
  }
}
