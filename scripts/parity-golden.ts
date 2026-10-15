#!/usr/bin/env bun
/**
 * Regenerate ONE key of the Rust parity golden from the built sidecar.
 *
 * `crates/jlpt-mcp/tests/golden.json` was captured from the TypeScript engine
 * before that engine was deleted, so the golden is now the only surviving record
 * of the reference output. That has a failure mode: the corpus changes underneath
 * it and nothing can refresh it. `search_vocab_english` sat stale for weeks
 * because widening JMdict meanings put 作る ("cr**eat**e an artistic work") ahead
 * of 食べる in the ASCII substring scan. The check failed, and the only way to
 * answer it was a hand edit of a one-line JSON file.
 *
 * This is that way, and it is deliberately narrow: one battery key at a time,
 * from the binary, printing before/after so the change is reviewable. It is NOT
 * a wholesale snapshot updater — a golden regenerated in full cannot fail, so it
 * would stop being a test. Refresh only when the *data contract* intentionally
 * changed (see `crates/jlpt-mcp/AGENTS.md`); when Rust disagrees with the golden
 * because Rust is wrong, fix Rust.
 *
 * Usage (build the debug binary first; parity spawns that same profile):
 *   cargo build --manifest-path crates/jlpt-mcp/Cargo.toml
 *   bun scripts/parity-golden.ts <golden-key> <tool> <json-args>
 * The triple comes from the `battery` table in `crates/jlpt-mcp/tests/parity.rs`,
 * which stays the only place those triples are written down:
 *   bun scripts/parity-golden.ts search_vocab_english search_vocab '{"query":"eat","limit":5}'
 */

import { spawnSync } from "node:child_process";

const BINARY = "crates/jlpt-mcp/target/debug/jlpt-mcp";
const GOLDEN = "crates/jlpt-mcp/tests/golden.json";
const PROTOCOL_VERSION = "2025-11-25";
const CALL_ID = 2;

interface RpcFrame {
  readonly error?: unknown;
  readonly id?: number;
  readonly result?: {
    readonly content?: readonly { readonly text?: string }[];
  };
}

const [key, tool, rawArgs] = process.argv.slice(2);
if (key === undefined || tool === undefined || rawArgs === undefined) {
  process.stderr.write(
    "usage: bun scripts/parity-golden.ts <key> <tool> <json-args>\n"
  );
  process.exit(2);
}

const golden = JSON.parse(await Bun.file(GOLDEN).text()) as Record<
  string,
  unknown
>;
if (!(key in golden)) {
  process.stderr.write(
    `unknown golden key "${key}" — battery names are in crates/jlpt-mcp/tests/parity.rs\n`
  );
  process.exit(2);
}

// The three-line handshake, then EOF. rmcp answers each line in order before it
// sees the close, so every response is on stdout by the time the child exits.
const request = [
  {
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "parity-golden", version: "0" },
      protocolVersion: PROTOCOL_VERSION,
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
  {
    id: CALL_ID,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: JSON.parse(rawArgs), name: tool },
  },
]
  .map((message) => JSON.stringify(message))
  .join("\n");

const run = spawnSync(BINARY, [], {
  encoding: "utf8",
  input: `${request}\n`,
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["pipe", "pipe", "ignore"],
});
if (run.error || run.stdout === undefined || run.stdout === "") {
  process.stderr.write(
    `${BINARY} produced nothing (${run.error?.message ?? `exit ${run.status}`}); run cargo build first\n`
  );
  process.exit(1);
}

const frames = run.stdout
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as RpcFrame);
const frame = frames.find((candidate) => candidate.id === CALL_ID);
if (frame === undefined) {
  process.stderr.write(
    `no response for id ${CALL_ID} (${frames.length} frames read)\n`
  );
  process.exit(1);
}
if (frame.error !== undefined) {
  process.stderr.write(`tool call failed: ${JSON.stringify(frame.error)}\n`);
  process.exit(1);
}
const text = frame.result?.content?.[0]?.text;
if (text === undefined) {
  process.stderr.write("tool returned no text content\n");
  process.exit(1);
}

const rows = JSON.parse(text);
console.log(`--- ${key}: before ---`);
console.log(JSON.stringify(golden[key]));
golden[key] = rows;
await Bun.write(GOLDEN, JSON.stringify(golden));
console.log(`--- ${key}: after (written) ---`);
console.log(JSON.stringify(rows));
console.log("verify with: bun run test:rust");
