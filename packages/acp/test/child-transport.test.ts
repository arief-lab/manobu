/**
 * Child-transport contract (TASK-99 AC#1, #2, #5, #6).
 *
 * Unit-level for the three pieces `ensureSession` wraps a spawned agent in:
 * the spawn environment, the tolerant stdout framer (frames through, junk
 * dropped and bounded), and the bounded redacted stderr ring. The wire-level
 * half of the same task lives in `session.test.ts`, which drives these
 * through a real child.
 */

import { expect, test } from "bun:test";
import { Readable } from "node:stream";

import {
  AcpHandshakeTimeoutError,
  agentChildEnv,
  captureStderr,
  failureDetail,
  redactSecrets,
  tolerantStdout,
  withTimeout,
} from "../src/session-child";

function bytes(...lines: string[]): Readable {
  return Readable.from(lines.map((line) => Buffer.from(`${line}\n`)));
}

/** The two failure messages these suites assert, as top-level patterns. */
const JUNK_BURST_RE =
  /agent wrote 4 non-protocol lines to stdout within 60000ms/;
const TIMEOUT_RE =
  /"opencode" did not complete the ACP handshake within 10ms \| stderr: waiting on stdin/;

/** Drain a byte stream to non-empty text lines. */
async function readLines(
  stream: ReadableStream<Uint8Array>
): Promise<{ error: unknown; lines: string[] }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: read the stream to EOF
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    return { error, lines: [] };
  }
  const lines = text.split("\n").filter((line) => line.length > 0);
  return { error: null, lines };
}

// ── Spawn environment ────────────────────────────────────────────────

test("agentChildEnv: strips the vars that change a Node CLI's behaviour", () => {
  const env = agentChildEnv({
    CLAUDECODE: "1",
    FORCE_COLOR: "3",
    HOME: "/home/arif",
    NODE_DEBUG: "module",
    NODE_OPTIONS: "--max-old-space-size=512",
    PATH: "/usr/bin",
  });
  expect(env.CLAUDECODE).toBeUndefined();
  expect(env.FORCE_COLOR).toBeUndefined();
  expect(env.NODE_DEBUG).toBeUndefined();
  expect(env.NODE_OPTIONS).toBeUndefined();
  // Everything the agent actually needs to run stays.
  expect(env.HOME).toBe("/home/arif");
  expect(env.PATH).toBe("/usr/bin");
});

test("agentChildEnv: forces a plain terminal and never mutates the parent env", () => {
  const base = { TERM: "xterm-256color" };
  const env = agentChildEnv(base);
  expect(env.NO_COLOR).toBe("1");
  expect(env.TERM).toBe("dumb");
  expect(base.TERM).toBe("xterm-256color");
});

// ── Tolerant stdout ──────────────────────────────────────────────────

test("tolerantStdout: forwards frames verbatim, drops blanks, reports junk once per kind", async () => {
  const junk: string[] = [];
  const stream = tolerantStdout(
    bytes(
      "banner text",
      "",
      "   ",
      '{"jsonrpc":"2.0","id":1,"result":{}}',
      '{"jsonrpc":"2.0","id":2,"result":{}}',
      "banner text",
      "42",
      "[1,2]"
    ),
    { onJunk: (line) => junk.push(line) }
  );
  const { error, lines } = await readLines(stream);
  expect(error).toBeNull();
  expect(lines).toEqual([
    '{"jsonrpc":"2.0","id":1,"result":{}}',
    '{"jsonrpc":"2.0","id":2,"result":{}}',
  ]);
  // The repeated banner collapses to one report; scalars and arrays count as
  // junk because no ACP message is one.
  expect(junk).toEqual(["banner text", "42", "[1,2]"]);
});

test("tolerantStdout: reassembles a frame split across chunks", async () => {
  const source = Readable.from([
    Buffer.from('{"jsonrpc":"2.0","id":1,"res'),
    Buffer.from('ult":{"ok":true}}\n'),
  ]);
  const { error, lines } = await readLines(tolerantStdout(source));
  expect(error).toBeNull();
  expect(lines).toEqual(['{"jsonrpc":"2.0","id":1,"result":{"ok":true}}']);
});

test("tolerantStdout: a bounded junk burst fails the transport instead of logging forever", async () => {
  const stream = tolerantStdout(bytes("j1", "j2", "j3", "j4", "j5"), {
    junkWindowMs: 60_000,
    maxJunkLines: 3,
    onJunk: () => undefined,
  });
  const { error, lines } = await readLines(stream);
  expect(lines).toEqual([]);
  expect(String(error)).toMatch(JUNK_BURST_RE);
});

test("tolerantStdout: junk inside the bound never trips it", async () => {
  const stream = tolerantStdout(bytes("a", "b", "c"), {
    junkWindowMs: 1,
    maxJunkLines: 3,
    onJunk: () => undefined,
  });
  const { error, lines } = await readLines(stream);
  expect(error).toBeNull();
  expect(lines).toEqual([]);
});

// ── Stderr ring ──────────────────────────────────────────────────────

test("captureStderr: keeps a bounded tail and never leaks a credential value", async () => {
  const stderr = captureStderr(
    bytes(
      "booting…",
      'OPENAI_API_KEY="sk-live-abcdefghijklmnopqrstuvwxyz"',
      "Authorization: Bearer abc.def-123",
      "done"
    )
  );
  // The ring fills as the source drains; give it a tick to flush.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const tail = stderr.tail();
  expect(tail).toContain("booting…");
  expect(tail).toContain('OPENAI_API_KEY="***"');
  expect(tail).toContain("Authorization: ***");
  expect(tail).not.toContain("sk-live");
  expect(tail).not.toContain("abc.def");
});

test("captureStderr: an agent that never writes produces no detail suffix", () => {
  const stderr = captureStderr(Readable.from([]));
  expect(stderr.tail()).toBe("");
  expect(failureDetail("agent exited (1)", stderr)).toBe("agent exited (1)");
  expect(failureDetail("agent exited (1)", "panic: no config")).toBe(
    "agent exited (1) | stderr: panic: no config"
  );
});

test("redactSecrets: masks credential values only", () => {
  expect(redactSecrets("token: abc123")).toBe("token: ***");
  expect(redactSecrets("client_secret=zzz and nothing else")).toBe(
    "client_secret=*** and nothing else"
  );
  expect(redactSecrets("model=turbo usage=123")).toBe("model=turbo usage=123");
});

// ── Handshake budget ─────────────────────────────────────────────────

test("withTimeout: a slow child gets the typed retryable error, with its stderr", async () => {
  const slow = withTimeout({
    ms: 10,
    onTimeout: () =>
      new AcpHandshakeTimeoutError("opencode", 10, "waiting on stdin"),
    work: new Promise<string>((resolve) => {
      setTimeout(() => resolve("late"), 200);
    }),
  });
  const [value, error] = await slow.then(
    (resolved) => [resolved, null] as const,
    (rejected: unknown) => [null, rejected] as const
  );
  expect(value).toBeNull();
  expect(error).toBeInstanceOf(AcpHandshakeTimeoutError);
  expect(String(error)).toMatch(TIMEOUT_RE);
});

test("withTimeout: a child that answers in time wins, and ms<=0 disables the bound", async () => {
  expect(
    await withTimeout({
      ms: 1000,
      onTimeout: () => new Error("never"),
      work: Promise.resolve("fast"),
    })
  ).toBe("fast");
  expect(
    await withTimeout({
      ms: 0,
      onTimeout: () => new Error("never"),
      work: Promise.resolve("off"),
    })
  ).toBe("off");
});
