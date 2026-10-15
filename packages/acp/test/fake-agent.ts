/**
 * Scripted fake ACP agent (TASK-80.1 test double).
 *
 * A real stdio child speaking NDJSON JSON-RPC (the ACP wire), driven by a
 * JSON script passed as argv[2]. `bun test/fake-agent.ts <script>` is the
 * `command` the engine spawns, so every test exercises the actual
 * connection stack (spawn + ndJsonStream + ClientSideConnection) instead of
 * a mocked interface.
 *
 * Script shape:
 * {
 *   "capabilities": { "loadSession": true, ... },        // initialize result
 *   "dumpMcpServers": "/path/file",                      // write the mcpServers
 *                                                        //   array session/new
 *                                                        //   received, verbatim
 *   "responses": {
 *     "session/new":    { "result": { "sessionId": "s-1", "configOptions": [...] } },
 *     "session/load":   { "result": {...}, "updates": [..] }, // replay first
 *     "session/prompt": {
 *        "updates": [...],            // stream before the terminal response
 *        "stopReason": "end_turn",
 *        "usage": {...},
 *        "delayMs": 80,               // hold the turn open (cancel tests)
 *        "askPermission": true,       // reverse session/request_permission,
 *        "permissionThen": [...],     //   updates after the answer arrives
 *        "callHostTool": {...},       //   MCP tools/call against the attached
 *        "terminalFlow": {...}        //   reverse terminal/* sequence
 *     },
 *     "session/cancel": { "updates": [...] }             // flush on cancel
 *   }
 * }
 *
 * `session/load` streams its replay `updates` while the load response is
 * still pending — the exact race the suppression guard must swallow.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

interface TerminalFlow {
  /** "read": output after exit; "clientKill": wait externally (test kills). */
  action: "clientKill" | "read";
  args?: string[];
  command: string;
  cwd?: string;
}

interface FakeBehaviour {
  askPermission?: boolean;
  callHostTool?: { arguments: Record<string, unknown>; name: string };
  delayMs?: number;
  error?: { code?: number; message: string };
  permissionThen?: unknown[];
  result?: Record<string, unknown>;
  stopReason?: string;
  terminalFlow?: TerminalFlow;
  updates?: unknown[];
  usage?: Record<string, unknown>;
}

interface FakeScript {
  capabilities?: Record<string, unknown>;
  /** Dump the verbatim `mcpServers` array from session/new here (TASK-96). */
  dumpMcpServers?: string;
  responses?: Record<string, FakeBehaviour>;
  /** TASK-99: write this many lines to stderr at startup. */
  stderrNoise?: number;
  /**
   * TASK-99: junk written to protocol stdout — `count` lines immediately, or
   * one every `intervalMs` (forever unless `count` caps it). Models a CLI that
   * banners or spams its stdout instead of keeping it for NDJSON.
   */
  stdoutJunk?: { count?: number; intervalMs?: number; line?: string };
}

interface InboundMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

interface McpEndpoint {
  headers?: { name: string; value: string }[];
  type?: string;
  url?: string;
}

const script = JSON.parse(
  readFileSync(process.argv[2] ?? "/dev/stdin", "utf8")
) as FakeScript;

/** TASK-99 noise fixtures: stdout junk and stderr chatter, both optional. */
function junkLine(): string {
  return script.stdoutJunk?.line ?? "opencode v1.2.3 ready when you are";
}

function emitJunk(times: number): void {
  for (const _ of Array.from({ length: times })) {
    process.stdout.write(`${junkLine()}\n`);
  }
}

function startStdoutJunk(): void {
  const junk = script.stdoutJunk;
  if (!junk) {
    return;
  }
  if (!junk.intervalMs) {
    emitJunk(junk.count ?? 1);
    return;
  }
  let written = 0;
  const timer = setInterval(() => {
    written += 1;
    if (junk.count !== undefined && written >= junk.count) {
      clearInterval(timer);
    }
    emitJunk(1);
  }, junk.intervalMs);
}

function emitStderrNoise(): void {
  const lines = Array.from({ length: script.stderrNoise ?? 0 });
  for (const [index] of lines.entries()) {
    process.stderr.write(`debug ${index}: OPENAI_API_KEY=sk-secret-${index}\n`);
  }
}

startStdoutJunk();
emitStderrNoise();

let nextRpcId = 100;
let cancelArrived = false;
// session/new must mint a UNIQUE sessionId: the engine keys its session
// bookkeeping by that id, and a shared "s-1" makes disposing one session
// tear down every other session on the same agent (pool eviction bug).
let nextSessionSeq = 0;
/** The http MCP endpoint attached at session/new (the host ask server). */
let attachedMcp: McpEndpoint | null = null;
const clientResolvers = new Map<number, (value: unknown) => void>();

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id: number | string, result: unknown): void {
  send({ id, jsonrpc: "2.0", result });
}

function sendError(
  id: number | string,
  error: { code?: number; message: string }
): void {
  send({
    error: { code: error.code ?? -32_603, message: error.message },
    id,
    jsonrpc: "2.0",
  });
}

function sendUpdates(sessionId: string, updates: unknown[] | undefined): void {
  for (const update of updates ?? []) {
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId, update },
    });
  }
}

function textChunk(text: string): Record<string, unknown> {
  return {
    content: { text, type: "text" },
    sessionUpdate: "agent_message_chunk",
  };
}

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

/** Send a reverse request (permission/terminal) and await its response. */
function askClient(
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const id = nextRpcId;
  nextRpcId += 1;
  const { promise, resolve } = Promise.withResolvers<unknown>();
  clientResolvers.set(id, resolve);
  send({ id, jsonrpc: "2.0", method, params });
  return promise;
}

async function handlePermissionRequest(
  sessionId: string,
  behaviour: FakeBehaviour
): Promise<void> {
  const first = (behaviour.updates?.[0] ?? {}) as Record<string, unknown>;
  const outcome = await askClient("session/request_permission", {
    options: [
      { kind: "allow_once", name: "Allow once", optionId: "allow_1" },
      { kind: "allow_always", name: "Allow always", optionId: "allow_all" },
      { kind: "reject_once", name: "Reject", optionId: "reject_1" },
    ],
    sessionId,
    toolCall: {
      status: "pending",
      title: "dangerous tool",
      toolCallId: first.toolCallId ?? "tc-perm",
    },
  });
  // Echo the client's answer back as a text frame so tests can assert the
  // optionId actually delivered on the wire.
  sendUpdates(sessionId, [textChunk(`PERMISSION:${JSON.stringify(outcome)}`)]);
  sendUpdates(sessionId, behaviour.permissionThen);
}

/** MCP tools/call against the host server attached at session/new. */
async function callHostTool(
  sessionId: string,
  call: { arguments: Record<string, unknown>; name: string }
): Promise<void> {
  const url = attachedMcp?.url;
  if (!url) {
    sendUpdates(sessionId, [
      textChunk("HOSTTOOL:error no mcp endpoint attached"),
    ]);
    return;
  }
  const headers: Record<string, string> = {
    // The stateless streamable-HTTP transport rejects POSTs that do not
    // accept both media types (same requirement ask-tool.test.ts pins).
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  for (const header of attachedMcp?.headers ?? []) {
    headers[header.name] = header.value;
  }
  const post = async (body: Record<string, unknown>): Promise<unknown> => {
    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    });
    if (response.status === 202) {
      return null;
    }
    return await response.json();
  };
  await post({
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "fake", version: "0" },
      protocolVersion: "2025-03-26",
    },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  const result = (await post({
    id: 2,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: call.arguments, name: call.name },
  })) as { result?: { content?: { text?: string }[] } };
  const text = result.result?.content?.[0]?.text ?? "(no text)";
  sendUpdates(sessionId, [textChunk(`HOSTTOOL:${text}`)]);
}

/** terminal/create → (wait) → output → report; clientKill lets the test kill. */
async function runTerminalFlow(
  sessionId: string,
  flow: TerminalFlow
): Promise<void> {
  const created = (await askClient("terminal/create", {
    args: flow.args ?? [],
    command: flow.command,
    cwd: flow.cwd ?? null,
    sessionId,
  })) as { terminalId?: string };
  const terminalId = created.terminalId ?? "";
  if (flow.action === "clientKill") {
    // Surface the id so the test can call SessionController.killTerminal.
    sendUpdates(sessionId, [textChunk(`TERMINAL:${terminalId}`)]);
  }
  const exit = await askClient("terminal/wait_for_exit", {
    sessionId,
    terminalId,
  });
  const output = (await askClient("terminal/output", {
    sessionId,
    terminalId,
  })) as { output?: string; truncated?: boolean };
  sendUpdates(sessionId, [
    textChunk(
      `TERMRESULT:${JSON.stringify({
        exit,
        output: output.output,
        truncated: output.truncated,
      })}`
    ),
  ]);
}

// Accepted complexity (TASK-81.6): the scripted ACP fixture mirrors the
// real agent's request surface one method per branch — splitting it into
// per-method handlers would scatter the wire script across files and hurt
// debuggability for zero production value. Accepted-by-design.
// fallow-ignore-next-line complexity
async function handle(message: InboundMessage): Promise<void> {
  const { id, method, params = {}, result } = message;
  if (method === undefined) {
    if (id !== undefined) {
      clientResolvers.get(id)?.(result);
      clientResolvers.delete(id);
    }
    return;
  }
  const sessionId = String(params.sessionId ?? "s-1");
  if (method === "session/cancel") {
    cancelArrived = true;
    sendUpdates(sessionId, script.responses?.["session/cancel"]?.updates);
    return;
  }
  if (id === undefined) {
    return;
  }
  const behaviour = script.responses?.[method];
  if (!behaviour) {
    respondDefault(id, method, params);
    return;
  }
  if (behaviour.error) {
    sendError(id, behaviour.error);
    return;
  }
  if (method === "session/new" || method === "session/load") {
    await handleOpen(id, sessionId, method, params, behaviour);
    return;
  }
  await handleTurn(id, sessionId, method, behaviour);
}

function respondDefault(
  id: number | string,
  method: string,
  params: Record<string, unknown>
): void {
  if (method === "session/new" || method === "session/load") {
    rememberMcp(params);
  }
  if (method === "initialize") {
    sendResult(id, {
      agentCapabilities: script.capabilities ?? {},
      agentInfo: { name: "fake-agent", version: "0.0.1" },
      protocolVersion: 1,
    });
    return;
  }
  if (method === "session/new" || method === "session/load") {
    if (params.sessionId === undefined) {
      nextSessionSeq += 1;
    }
    sendResult(id, {
      sessionId: String(params.sessionId ?? `s-${nextSessionSeq}`),
    });
    return;
  }
  sendResult(id, {});
}

async function handleOpen(
  id: number | string,
  sessionId: string,
  method: string,
  params: Record<string, unknown>,
  behaviour: FakeBehaviour
): Promise<void> {
  attachedMcp = pickHttpMcp(params.mcpServers);
  if (method === "session/load") {
    // Replay streams before the load response (the guard window).
    sendUpdates(sessionId, behaviour.updates);
    await sleep(behaviour.delayMs ?? 0);
  } else {
    sendUpdates(sessionId, behaviour.updates);
  }
  let minted = sessionId;
  if (method === "session/new" && params.sessionId === undefined) {
    nextSessionSeq += 1;
    minted = `s-${nextSessionSeq}`;
  }
  sendResult(id, behaviour.result ?? { sessionId: minted });
}

/** The prompt leg: stream updates, run optional reverse flows, terminate. */
// Accepted complexity (TASK-81.6): the scripted turn mirrors the real
// agent cadence (updates → delay → permission/host-tool/terminal flows →
// terminal response) as one linear leg; the reverse flows are optional
// script features, not accidental branching. Accepted-by-design.
// fallow-ignore-next-line complexity
async function handleTurn(
  id: number | string,
  sessionId: string,
  method: string,
  behaviour: FakeBehaviour
): Promise<void> {
  sendUpdates(sessionId, behaviour.updates);
  if (behaviour.delayMs) {
    await sleep(behaviour.delayMs);
  }
  if (behaviour.askPermission) {
    await handlePermissionRequest(sessionId, behaviour);
  }
  if (behaviour.callHostTool) {
    await callHostTool(sessionId, behaviour.callHostTool);
  }
  if (behaviour.terminalFlow) {
    await runTerminalFlow(sessionId, behaviour.terminalFlow);
  }
  if (method === "session/prompt") {
    sendResult(id, {
      ...(behaviour.usage ? { usage: behaviour.usage } : {}),
      stopReason: cancelArrived
        ? "cancelled"
        : (behaviour.stopReason ?? "end_turn"),
    });
    return;
  }
  sendResult(id, behaviour.result ?? {});
}

function pickHttpMcp(raw: unknown): McpEndpoint | null {
  const servers = (Array.isArray(raw) ? raw : []) as McpEndpoint[];
  return servers.find((server) => typeof server.url === "string") ?? null;
}

/**
 * Stash the http endpoint the host attached, and optionally dump the whole
 * verbatim list so a test can assert what crossed the wire (TASK-96 proves a
 * per-server env map survives negotiation + mapping into `session/new`).
 */
function rememberMcp(params: Record<string, unknown>): void {
  attachedMcp = pickHttpMcp(params.mcpServers);
  if (script.dumpMcpServers) {
    const servers = Array.isArray(params.mcpServers) ? params.mcpServers : [];
    writeFileSync(script.dumpMcpServers, JSON.stringify(servers));
  }
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  try {
    handle(JSON.parse(trimmed) as InboundMessage).catch(() => {
      // reverse-flow failures surface as a stuck turn; tests time out loudly
    });
  } catch {
    // ignore malformed lines
  }
});
process.on("SIGTERM", () => {
  process.exit(0);
});
