#!/usr/bin/env bun
/**
 * MCP end-to-end smoke test — repeatable.
 *
 * Spawns apps/server with `ACP_MCP_SERVERS` pointing at the compiled
 * `jlpt-mcp` binary, runs the 4-conversation suite (opencode vocab→
 * conjugation, kilo conjugation→follow-up, antigravity direct-cli, opencode
 * pitch accent), watches for real `jlpt-mcp` child spawns as proof of tool
 * calls, prints a verdict table + the server's negotiation log, then tears
 * the server down. Exits non-zero if the server fails to boot or any
 * conversation streams zero text.
 *
 * Usage (from repo root):
 *   bun run smoke:mcp
 *
 * Env overrides:
 *   MANOBU_SMOKE_PORT   port for the throwaway server (default 4399 —
 *                       deliberately NOT 4317/3000 so a dev server can run
 *                       alongside).
 *   MANOBU_MCP_BIN      path to the jlpt-mcp binary (default: crates build).
 *   MANOBU_SMOKE_AGENT  run only the given agent's conversation (e.g.
 *                       `antigravity`) — the light form for a loaded PC.
 *   ACP_AGENT_BIN       the default agent is overridden per-conversation;
 */

import { execSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";

import { createORPCClient, getEventMeta } from "@orpc/client";
import { RPCLink as WsRPCLink } from "@orpc/client/websocket";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const SERVER_ENTRY = join(REPO_ROOT, "apps/server/src/index.ts");
const MCP_BIN_DEFAULT = join(
  REPO_ROOT,
  "crates/jlpt-mcp/target/release/jlpt-mcp"
);
const MCP_BIN = process.env.MANOBU_MCP_BIN ?? MCP_BIN_DEFAULT;
const PORT = Number(process.env.MANOBU_SMOKE_PORT ?? 4399);
const BASE = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}/ws`;
const CONVO_TIMEOUT_MS = 240_000;
const BOOT_WAIT_S = 45;

/** Server-log lines worth surfacing (agent boot + MCP negotiation). */
const INTERESTING_LOG_RE = /\[ai\]|\[acp\]|jlpt/i;

/** A conversation is an ordered list of prompts; each turn appends the prior
 *  assistant reply so the warm ACP session sees the full transcript. */
const ALL_CONVERSATIONS = [
  {
    agent: "opencode",
    turns: [
      "What does 食べる mean? Use your lookup tools.",
      "Now show me its te-form and polite past. Use the conjugation tool.",
    ],
  },
  {
    agent: "kilo",
    turns: [
      "How do I conjugate 行く in the potential form? Use the conjugation tool.",
      "What about the negative form of 行く?",
    ],
  },
  {
    agent: "antigravity",
    turns: ["What does 学校 mean? Give the reading and JLPT level."],
  },
  {
    agent: "opencode",
    turns: [
      "How is はし pronounced? Teach me the pitch accent of 橋 and 箸. Use the pitch accent tool.",
    ],
  },
];

// `MANOBU_SMOKE_AGENT` filters the suite to one agent's conversation (the
// light form: a single agent keeps a loaded PC from spawning the whole 3-
// agent suite). The antigravity entry exercises the direct-CLI facade.
const CONVERSATIONS = process.env.MANOBU_SMOKE_AGENT
  ? ALL_CONVERSATIONS.filter(
      (convo) => convo.agent === process.env.MANOBU_SMOKE_AGENT
    )
  : ALL_CONVERSATIONS;
const fail = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

for (const required of [SERVER_ENTRY, MCP_BIN]) {
  if (!existsSync(required)) {
    fail(`missing path: ${required}`);
  }
}

// Pre-flight: if a leftover smoke server (orphaned by a SIGKILLed parent —
// the `detached` server survives) still holds the port, the fresh server
// would fail with EADDRINUSE and the suite would silently test the STALE
// server instead. Only act when the port is actually occupied, and only kill
// the PID listening on it — never a blanket `pkill` on the server entry
// (that would also kill a user's dev server on :4317).
const smokePortBusy = await new Promise((resolvePort) => {
  const socket = createConnection({ host: "127.0.0.1", port: PORT });
  socket.once("connect", () => {
    socket.destroy();
    resolvePort(true);
  });
  socket.once("error", () => resolvePort(false));
});
if (smokePortBusy) {
  try {
    // Kill EVERY pid listening on the smoke port (`ss` may list both IPv4 and
    // IPv6 stanzas). Only the port's owner dies — a user's dev server on
    // :4317/:3000 is never matched.
    const listeners = execSync(
      `ss -tlnp 2>/dev/null | grep ':${PORT} ' || true`,
      { encoding: "utf8" }
    );
    const pids = [...listeners.matchAll(/pid=(\d+)/g)].map((m) => m[1]);
    for (const pid of pids) {
      execSync(`kill -9 ${pid}`, { stdio: "ignore" });
      console.log(`[pre-flight] killed stale server on :${PORT} (pid ${pid})`);
    }
    if (pids.length > 0) {
      // Give the port a moment to free up.
      await new Promise((r) => setTimeout(r, 800));
    }
  } catch {
    // Fall through — if the port is still held, the fresh server's EADDRINUSE
    // surfaces loudly in the boot log instead of silently testing a stale one.
  }
}

// ---------------------------------------------------------------------------
// 1. Boot the server (child process) with the JLPT MCP server attached.
// ---------------------------------------------------------------------------
const serverLog = [];
const server = spawn(process.execPath, ["run", SERVER_ENTRY], {
  cwd: REPO_ROOT,
  detached: true, // own process group so shutdown can reap agent grandchildren
  env: {
    ...process.env,
    ACP_MCP_SERVERS: `jlpt:stdio:${MCP_BIN}`,
    BUN_PORT: String(PORT),
    CORS_ORIGIN: "http://localhost:3001",
    DATABASE_URL: `file:/tmp/manobu-mcp-smoke-${process.pid}.db`,
    NODE_ENV: "development",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => serverLog.push(d.toString()));
server.stderr.on("data", (d) => serverLog.push(d.toString()));
server.on("error", (error) => {
  serverLog.push(`[server spawn error] ${String(error)}\n`);
});

const shutdown = () => {
  // Kill the whole process group: the server's agent children (opencode/kilo/
  // agy) and their jlpt-mcp grandchildren die with it instead of orphaning.
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {
    server.kill("SIGKILL");
  }
};
process.on("exit", shutdown);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForBoot() {
  // Recursive poll (no await-in-loop): try once, then retry until the boot
  // window elapses. `fail` exits, so the recursion always terminates.
  const attempt = async (remaining) => {
    try {
      const res = await fetch(`${BASE}/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        return;
      }
    } catch {
      // not up yet
    }
    if (remaining <= 0) {
      fail(
        `server did not boot within ${BOOT_WAIT_S}s — log tail:\n${serverLog.slice(-20).join("")}`
      );
    }
    await sleep(1000);
    await attempt(remaining - 1);
  };
  await attempt(BOOT_WAIT_S);
}

// ---------------------------------------------------------------------------
// 2. Watch for real jlpt-mcp child spawns (the agent calling a tool spawns it).
// ---------------------------------------------------------------------------
// Match the BASENAME, not the configured abs path: opencode invokes the
// binary through argv shapes the abs path never matches (observed live:
// `bash -c printf … | ./target/release/jlpt-mcp`, cwd-relative), and the
// process is per-tool-call EPHEMERAL — it is a zombie within milliseconds of
// the call finishing, so the poll interval must be tighter than the old
// 500ms or the watcher sees nothing even while tools are executing.
const PGREP_PATTERN = "jlpt-mcp";
const spawnEvents = [];
let prevPids = "";
const watcher = setInterval(() => {
  const out = spawn("pgrep", ["-f", PGREP_PATTERN], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  let pids = "";
  out.stdout.on("data", (d) => {
    pids += d.toString();
  });
  out.on("error", () => {
    // pgrep missing on $PATH — spawn watcher is best-effort only.
  });
  out.on("close", () => {
    const cur = pids.split("\n").filter(Boolean).sort().join(",");
    if (cur !== prevPids) {
      spawnEvents.push(
        `${new Date().toISOString().slice(11, 19)} jlpt-mcp pids: ${cur || "none"}`
      );
      prevPids = cur;
    }
  });
}, 100);

// ---------------------------------------------------------------------------
// 3. Drive the native-ACP chat surface over the oRPC WebSocket link.
//    `chat.send` + `chat.subscribe` are the live-turn procedures (TASK-80.6
//    cutover); frames are the AionUi `IResponseMessage` union on the WS
//    link, not the old REST/SSE text-delta events. One shared WS client:
//    the server's /ws RPC handler serves the whole `chat` subtree
//    (`LIVE_TURN_PROCEDURES`), so `send`/`subscribe`/`confirm`/`answerAsk`
//    all ride the same socket.
// ---------------------------------------------------------------------------
const wsLink = new WsRPCLink({
  connect: () => new WebSocket(WS_URL),
  // The oRPC WS reconnect `delay` slot expects a *function*
  // `(info) => number`, not a number — a number starves the event
  // loop on reconnect attempts. Match the desktop's `getChatWsClient`
  // exactly (omit `delay`; default backoff applies).
  reconnect: { enabled: true, onClose: { enabled: true } },
});
const orpc = createORPCClient(wsLink);

/** Per-conversation turn results, collected for the final verdict table. */
const turnResults = [];

/** Read the text payload off a `content`/`thinking` frame. The wire payload
 * is `{ type: string }` (a content block); a text block carries the text in
 * `data.text` or `data.content` (the `z.looseObject` schema is open, so the
 * field is read structurally — same rule as `frameDataText` in
 * `packages/chat-session/src/chat-engine.ts`). */
function frameText(frame) {
  const data = frame.data ?? {};
  if (typeof data.text === "string") {
    return data.text;
  }
  if (typeof data.content === "string") {
    return data.content;
  }
  return "";
}

/** Auto-approve a parked permission frame. The smoke has no human in the
 * loop, so an agent that requests tool permission would otherwise park the
 * turn to the engine's 30-minute confirmation timeout and stall the drain.
 * `callId` is the ACP `toolCallId` the engine parks on; `data` is a REAL
 * offered `optionId` (the engine echoes it back to the ACP child).
 * Fire-and-forget: recording the approval here keeps the drain loop
 * await-free. */
// Accepted complexity (TASK-81.6): this fake smoke harness mirrors the
// real permission UI's option ranking (kind fallback chain) so the smoke
// exercises the same echo path a learner's click takes; keeping it
// adjacent to the approval recording it feeds beats indirection.
// Accepted-by-design.
// fallow-ignore-next-line complexity
function approvePermission(frame, conversationId, record) {
  const callRef = frame.data.tool_call?.toolCallId;
  if (callRef && !record.approved.has(callRef)) {
    record.approved.add(callRef);
    const options = frame.data.options ?? [];
    const chosen =
      options.find((o) => o.kind === "allow_once")?.optionId ??
      options.find((o) => o.kind === "allow_always")?.optionId ??
      options[0]?.optionId;
    if (chosen) {
      orpc.chat
        .confirm({ callId: callRef, conversationId, data: chosen })
        .then(() => {
          record.permissions += 1;
        })
        .catch((error) => {
          console.log(`  chat.confirm failed: ${String(error)}`);
        });
    }
  }
}

/** Decline a parked ask frame so the turn keeps running instead of stalling
 * to the confirmation timeout. `requestId` keys the engine's parked ask. */
function declineAsk(frame, conversationId, record) {
  const reqId = frame.data.request_id;
  if (reqId && !record.declined.has(reqId)) {
    record.declined.add(reqId);
    orpc.chat
      .answerAsk({ conversationId, decline: true, requestId: reqId })
      .catch((error) => {
        console.log(`  chat.answerAsk failed: ${String(error)}`);
      });
  }
}

/** Run one turn on the WS chat surface and record it. `chat.send` carries
 * only the new user message — the warm ACP session accumulates the
 * transcript server-side, so follow-up turns see full prior context without
 * re-sending it. Frames drain from `chat.subscribe` until the terminal
 * `finish`/`error` frame (the server closes the hub, so the stream ends
 * there). A socket drop mid-iterator resubscribes carrying `lastEventId`
 * (AionUi bus parity — the server replays frames missed while the socket
 * was down). No `await` in the frame loop body: auto-approve/decline fire
 * and record instead of blocking the drain (`noAwaitInLoops`). */
async function runTurn(convo, conversationId, prompt) {
  const started = Date.now();
  const signal = AbortSignal.timeout(CONVO_TIMEOUT_MS);
  const record = {
    approved: new Set(),
    declined: new Set(),
    permissions: 0,
  };
  try {
    await orpc.chat.send(
      {
        agent: convo.agent,
        conversationId,
        messages: [{ content: prompt, role: "user" }],
      },
      { signal }
    );
  } catch (error) {
    console.log(`  chat.send failed: ${String(error)}`);
  }

  let text = "";
  let contentFrames = 0;
  let toolCalls = 0;
  let terminal = null;
  let lastEventId = null;

  // Recurse instead of a `for await` that awaits in its body
  // (`noAwaitInLoops`): one pass drains one live stream; the server closes
  // the stream on the terminal frame, so the loop body only records. A
  // socket drop throws out of the iterator and the resubscribe below
  // carries `lastEventId` to replay the missed frames (AionUi bus
  // semantics, same as the desktop client's subscribe loop).
  // Smoke driver folds every frame type for verdict accounting.
  // Accepted complexity (TASK-81.6): the drain intentionally folds EVERY
  // frame family in one pass because the smoke's verdict accounting needs
  // to observe the whole wire in stream order — per-type handlers would
  // require a second pass or shared mutable state. Accepted-by-design.
  // fallow-ignore-next-line complexity
  async function drain() {
    try {
      const iterator = await orpc.chat.subscribe(
        { conversationId },
        lastEventId ? { lastEventId, signal } : { signal }
      );
      for await (const frame of iterator) {
        const meta = getEventMeta(frame);
        if (meta?.id) {
          lastEventId = meta.id;
        }
        switch (frame.type) {
          case "content":
            text += frameText(frame);
            contentFrames += 1;
            break;
          case "acp_tool_call":
            toolCalls += 1;
            break;
          case "acp_permission":
            approvePermission(frame, conversationId, record);
            break;
          case "ask":
            declineAsk(frame, conversationId, record);
            break;
          case "finish":
            terminal = "finish";
            break;
          case "error":
            terminal = "error";
            console.log(`  error frame: ${frame.data?.text ?? "?"}`);
            break;
          default:
            break;
        }
        if (terminal) {
          return;
        }
      }
    } catch (error) {
      // Socket dropped mid-iterator. Once the per-turn abort fired, stop
      // resubscribing (report a non-terminal result); otherwise log it.
      if (signal.aborted) {
        return;
      }
      console.log(
        `  subscribe stream dropped (${String(error)}); resubscribing`
      );
    }
    // No terminal frame yet (socket drop recovered, or the replay/
    // live stream ended clean): resubscribe carrying `lastEventId`.
    await sleep(500);
    await drain();
  }
  await drain();

  const textTrimmed = text.replace(/\s+/g, " ").trim();
  const passed = textTrimmed.length > 0 && terminal !== "error";
  const result = {
    agent: convo.agent,
    contentFrames,
    ms: Date.now() - started,
    passed,
    permissions: record.permissions,
    text: textTrimmed,
    toolCalls,
  };
  turnResults.push(result);
  console.log(
    `  → ${convo.agent}: ${result.ms}ms, ${contentFrames} content frames, ${toolCalls} tool calls, ${record.permissions} perms approved ${passed ? "✓" : "✗"}`
  );
  console.log(
    `    ${result.text.slice(0, 400)}${result.text.length > 400 ? "…" : ""}`
  );
  if (!result.text) {
    console.log("    (no content frames — possible regression)");
  }
  return passed;
}

// Sequential turn walker (no await-in-loop): one conversation id per
// convo, so the warm ACP session keeps the transcript across its turns.
function runConversation(convo, index) {
  const label = `C${index} ${convo.agent}`;
  console.log(
    `\n=== ${label} (${convo.turns.length} turn${convo.turns.length > 1 ? "s" : ""}) ===`
  );
  const conversationId = randomUUID();
  const walk = async (turnIndex, okSoFar) => {
    if (turnIndex >= convo.turns.length) {
      return okSoFar;
    }
    const prompt = convo.turns[turnIndex];
    let ok = okSoFar;
    try {
      const passed = await runTurn(convo, conversationId, prompt);
      ok = okSoFar && passed;
    } catch (error) {
      ok = false;
      console.log(`  → turn ${turnIndex + 1}: FAILED — ${String(error)}`);
    }
    return walk(turnIndex + 1, ok);
  };
  return walk(0, true);
}

// Accepted complexity (TASK-81.6): main is the e2e orchestration — boot
// server, wait healthy, run the conversation walk, verify MCP spawns, and
// report each as one guard clause. The branches map 1:1 to the smoke's
// steps; extracting them hides the run order the script exists to show.
// Accepted-by-design.
// fallow-ignore-next-line complexity
async function main() {
  console.log(
    `MCP smoke: server=${SERVER_ENTRY}\n           jlpt-mcp=${MCP_BIN}\n           port=${PORT}`
  );
  console.log("Booting server…");
  await waitForBoot();
  console.log("Server up. Running conversations over the oRPC WS link…");

  const walk = async (i, okSoFar) => {
    if (i >= CONVERSATIONS.length) {
      return okSoFar;
    }
    const ok = await runConversation(CONVERSATIONS[i], i + 1);
    return walk(i + 1, okSoFar && ok);
  };
  const allOk = await walk(0, true);

  console.log("\n=== per-turn verdict (oRPC WS chat surface) ===");
  for (let t = 0; t < turnResults.length; t += 1) {
    const r = turnResults[t];
    console.log(
      `  #${t + 1} ${r.agent}: ${r.contentFrames} content frames, ${r.toolCalls} tool calls, ${r.permissions} perms - ${r.passed ? "PASS" : "FAIL"}`
    );
  }

  clearInterval(watcher);

  console.log("\n=== jlpt-mcp spawns observed (proof of tool calls) ===");
  console.log(spawnEvents.length ? spawnEvents.join("\n") : "(none observed)");

  console.log("\n=== server negotiation / boot lines ===");
  const logText = serverLog.join("");
  for (const line of logText.split("\n")) {
    if (INTERESTING_LOG_RE.test(line)) {
      console.log(`  ${line}`);
    }
  }

  if (!allOk) {
    // A failure's real cause usually lives in the full server log (agent
    // spawn errors, MCP probe failures, etc.), which the filter above hides.
    console.log("\n=== full server log tail (failure diagnostics) ===");
    console.log(logText.split("\n").slice(-25).join("\n") || "(empty)");
  }

  console.log(
    allOk ? "\n✓ ALL CONVERSATIONS PASSED" : "\n✗ SOME CONVERSATIONS FAILED"
  );
  process.exit(allOk ? 0 : 1);
}

await main();
