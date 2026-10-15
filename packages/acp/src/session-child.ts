/**
 * Agent-child plumbing (TASK-99): what `ensureSession` needs around a
 * spawned CLI *before* the ACP SDK owns the wire.
 *
 * Three jobs, all of them about not trusting the child's stdio:
 *
 * - `agentChildEnv` — a deliberate environment for the child. Inherited
 *   `NODE_OPTIONS`/`NODE_DEBUG` change how a Node-based agent runs,
 *   `FORCE_COLOR` overrides `NO_COLOR`, and `CLAUDECODE` makes claude-code
 *   refuse to start inside itself.
 * - `tolerantStdout` — the line framer between `child.stdout` and
 *   `ndJsonStream`. The SDK already tolerates a bad line (it logs and keeps
 *   going, `sdk/dist/stream.js:31-41`), which is the real problem: an agent
 *   that banners or spam-writes its protocol stdout never fails, it just
 *   floods the log forever and the handshake never completes. This filter
 *   forwards protocol frames byte-for-byte, drops what is plainly not a
 *   frame, and fails the transport once the drop *rate* says the child is
 *   unusable. Bounded, not infinite.
 * - `captureStderr` — a bounded, redacted tail instead of `stderr.resume()`
 *   silence, so a failure can say what the child actually reported.
 *
 * The SDK stays the single JSON-RPC parser: this module only decides whether
 * a line is plausible protocol traffic, never what a frame means.
 */

import { Readable } from "node:stream";

const NEWLINE = 0x0a;
/** ASCII blank bytes, i.e. `String.prototype.trim`'s set minus vertical tab. */
const BLANK_BYTES = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20]);
const EMPTY = new Uint8Array(0);
const NEWLINE_BYTES = new Uint8Array([NEWLINE]);
/** How much of a junk line is kept for the once-per-kind report. */
const JUNK_REPORT_LIMIT = 160;

/** No agent should need this long to answer `initialize` + open a session. */
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000;
/** Junk-rate bound: more than this many non-frame lines inside the window
 * means the child is writing prose to its protocol stdout, not speaking ACP. */
const DEFAULT_JUNK_WINDOW_MS = 5000;
const DEFAULT_MAX_JUNK_LINES = 50;

const STDERR_MAX_BYTES = 64 * 1024;
/** How much of the ring a failure detail may carry. */
const STDERR_DETAIL_LIMIT = 2000;

/** Child env vars that must not leak into an agent process. */
const STRIPPED_CHILD_ENV = [
  "CLAUDECODE",
  "FORCE_COLOR",
  "NODE_DEBUG",
  "NODE_INSPECT_RESUME_ON_START",
  "NODE_OPTIONS",
] as const;

/**
 * The environment an agent child is spawned with: an explicit copy of the
 * parent's, minus the vars that alter a Node CLI's behaviour, plus a plain
 * terminal so nothing decorates the protocol stream with ANSI.
 */
export function agentChildEnv(
  base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const name of STRIPPED_CHILD_ENV) {
    delete env[name];
  }
  env.NO_COLOR = "1";
  env.TERM = "dumb";
  return env;
}

/** The child's stdout is not a protocol channel: `tolerantStdout` gave up. */
class AcpStdoutJunkError extends Error {
  constructor(dropped: number, windowMs: number) {
    super(
      `agent wrote ${dropped} non-protocol lines to stdout within ${windowMs}ms; ` +
        "refusing to keep discarding its output"
    );
    this.name = "AcpStdoutJunkError";
  }
}

/** The handshake never completed in time; respawning is a reasonable next try. */
export class AcpHandshakeTimeoutError extends Error {
  constructor(agentId: string, timeoutMs: number, stderrTail = "") {
    super(
      failureDetail(
        `agent "${agentId}" did not complete the ACP handshake within ${timeoutMs}ms`,
        stderrTail
      )
    );
    this.name = "AcpHandshakeTimeoutError";
  }
}

/**
 * The turn-failure discriminants the engine projects onto the terminal frame
 * (`code`). A plain `Error & { code }` tagged by a factory, not a class: the
 * server reads these structurally (`.code`), so a subclass would only add a
 * name nothing checks. The message is the human legibility the client renders.
 */
export type AcpEngineErrorCode = "AUTH_REQUIRED" | "CONFIG_SWITCH_FAILED";

export type AcpEngineError = Error & { code: AcpEngineErrorCode };

/**
 * TASK-102 AC#4: the agent opened fine but REJECTED `session/new` (or
 * `session/load`) for an authentication reason, and it is not signed in.
 * Distinct from a generic send failure so the client renders a sign-in
 * prompt; respawning the same unsigned-in CLI cannot help.
 */
export function acpAuthRequiredError(
  agentId: string,
  methods: string[],
  cause: unknown
): AcpEngineError {
  return Object.assign(
    new Error(
      `agent "${agentId}" needs you to sign in before it can chat.${
        methods.length > 0
          ? ` Sign in via ${methods.map((name) => `"${name}"`).join(" or ")}.`
          : " Sign in to the agent CLI first."
      }`,
      { cause }
    ),
    { code: "AUTH_REQUIRED" as const }
  );
}

/**
 * TASK-102 AC#6: the session opened, but a model/mode switch the learner
 * asked for was rejected. Surfaced instead of warn-swallowed so the answer
 * is never silently attributed to a model the learner did not pick.
 */
export function acpConfigSwitchError(
  kind: "model" | "mode",
  value: string,
  detail: string,
  cause: unknown
): AcpEngineError {
  return Object.assign(
    new Error(
      `${kind} switch to "${value}" was rejected by the agent: ${detail}`,
      { cause }
    ),
    { code: "CONFIG_SWITCH_FAILED" as const }
  );
}

/**
 * Does an `ensureSession` rejection mean "not signed in"? Classified from the
 * agent's own words, never from the mere presence of advertised `authMethods`
 * — opencode-like agents list methods yet chat anonymously, so presence-only
 * detection would regress them. The ACP `auth_required` error is code
 * `-32000` with an "Authentication required" message (that code is also the
 * generic server-error code, so the message is the reliable signal).
 */
const AUTH_REJECTION_RE =
  /auth(?:entication)?\s+required|not\s+authenticated|unauthoriz|please\s+(?:log|sign)\s*[-\s]?in|(?:must|need(?:s|ed)?)\s+(?:to\s+)?(?:log|sign)\s*[-\s]?in/i;

export function isAuthRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return AUTH_REJECTION_RE.test(message);
}

export interface StdoutFilterOptions {
  /** Sliding window a junk burst is measured inside. */
  junkWindowMs?: number;
  /** Junk lines tolerated inside the window before the transport fails. */
  maxJunkLines?: number;
  /** First sighting of each distinct junk line, reported once per kind. */
  onJunk?: (line: string, dropped: number) => void;
}

/**
 * A tolerant `ReadableStream<Uint8Array>` of complete NDJSON lines, fed from
 * a Node readable. Demand-driven: nothing is read from the child until the SDK
 * asks for the next message, so a flooding child still blocks on its pipe
 * instead of being buffered here.
 */
export function tolerantStdout(
  source: Readable,
  options: StdoutFilterOptions = {}
): ReadableStream<Uint8Array> {
  return new StdoutFramer(source, {
    at: [],
    dropped: 0,
    kinds: new Set<string>(),
    max: options.maxJunkLines ?? DEFAULT_MAX_JUNK_LINES,
    onJunk: options.onJunk ?? reportJunk,
    windowMs: options.junkWindowMs ?? DEFAULT_JUNK_WINDOW_MS,
  }).stream;
}

/**
 * The web reader over a Node source. Typed by inference because
 * `Readable.toWeb` returns @types/node's `ReadableStream`, whose reader
 * surface is not the DOM lib's.
 */
function stdoutReader(source: Readable) {
  return Readable.toWeb(source).getReader();
}

/** What the framer did with one line: drop it, queue a frame, or give up. */
type LineOutcome = "dropped" | "failed" | "queued";

/**
 * The stdout framer. One instance per child; `stream` is what the ACP SDK
 * reads, `#drain` is the only thing that touches the child's stdout.
 */
class StdoutFramer {
  readonly #decoder = new TextDecoder();
  readonly #meter: JunkMeter;
  #pending: Uint8Array = EMPTY;
  readonly #reader: ReturnType<typeof stdoutReader>;
  readonly stream: ReadableStream<Uint8Array>;

  constructor(source: Readable, meter: JunkMeter) {
    this.#meter = meter;
    this.#reader = stdoutReader(source);
    this.stream = new ReadableStream<Uint8Array>({
      cancel: async (reason: unknown) => {
        await this.#reader.cancel(reason);
      },
      pull: (controller) => this.#drain(controller),
    });
  }

  /**
   * Read until one frame has been enqueued, the transport fails, or the child
   * closes stdout. The loop is required: a pull that enqueues nothing is never
   * called again, so dropped junk and split lines have to be crossed here.
   */
  async #drain(
    controller: ReadableStreamDefaultController<Uint8Array>
  ): Promise<void> {
    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: drain until a frame lands
      const { done, value } = await this.#reader.read();
      if (done) {
        this.#finish(controller);
        return;
      }
      const framed = takeLines(this.#pending, value);
      this.#pending = framed.rest;
      let queued = false;
      for (const line of framed.lines) {
        const outcome = this.#forward(line, controller);
        if (outcome === "failed") {
          return;
        }
        queued ||= outcome === "queued";
      }
      if (queued) {
        return;
      }
    }
  }

  /** Stdout ended: the unterminated tail is the child's last message, if any. */
  #finish(controller: ReadableStreamDefaultController<Uint8Array>): void {
    const tail = this.#pending;
    this.#pending = EMPTY;
    if (tail.byteLength > 0 && this.#forward(tail, controller) === "failed") {
      return;
    }
    controller.close();
  }

  #forward(
    line: Uint8Array,
    controller: ReadableStreamDefaultController<Uint8Array>
  ): LineOutcome {
    if (isBlank(line)) {
      return "dropped";
    }
    const text = this.#decoder.decode(line);
    if (!isProtocolFrame(text)) {
      return meterJunk(this.#meter, text) ? "dropped" : this.#fail(controller);
    }
    controller.enqueue(concat(line, NEWLINE_BYTES));
    return "queued";
  }

  /** Give up on a child that writes prose to its protocol stdout. */
  #fail(controller: ReadableStreamDefaultController<Uint8Array>): "failed" {
    controller.error(
      new AcpStdoutJunkError(this.#meter.dropped, this.#meter.windowMs)
    );
    return "failed";
  }
}

/** Junk accounting for one stdout framer instance. */
interface JunkMeter {
  /** Timestamps of the recent sightings, ascending (the window is a prefix prune). */
  at: number[];
  dropped: number;
  /** Junk kinds already reported, so a repeated banner is logged once. */
  kinds: Set<string>;
  max: number;
  onJunk: (line: string, dropped: number) => void;
  windowMs: number;
}

/** Record one junk line; `false` once the burst exceeds the bound. */
function meterJunk(meter: JunkMeter, text: string): boolean {
  meter.dropped += 1;
  const kind = text.slice(0, JUNK_REPORT_LIMIT);
  if (!meter.kinds.has(kind)) {
    meter.kinds.add(kind);
    meter.onJunk(kind, meter.dropped);
  }
  return noteJunk(meter.at, meter.windowMs) <= meter.max;
}

/** Junk burst size inside the window, after pruning older sightings. */
function noteJunk(seen: number[], windowMs: number): number {
  const now = Date.now();
  seen.push(now);
  // Sorted ascending, so the stale sightings are a prefix.
  const firstFresh = seen.findIndex((at) => at > now - windowMs);
  if (firstFresh > 0) {
    seen.splice(0, firstFresh);
  }
  return seen.length;
}

function reportJunk(line: string, dropped: number): void {
  console.warn(
    `[acp] dropping non-protocol agent stdout line #${dropped}: ${JSON.stringify(line)}`
  );
}

function isBlank(line: Uint8Array): boolean {
  return line.every((byte) => BLANK_BYTES.has(byte));
}

/** Only a JSON *object* can be an ACP message; scalars and arrays are junk. */
function isProtocolFrame(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return (
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
}

/** A complete-line split of `buffer + chunk`, plus the unterminated remainder. */
function takeLines(
  buffer: Uint8Array,
  chunk: Uint8Array
): { lines: Uint8Array[]; rest: Uint8Array } {
  const bytes = buffer.byteLength === 0 ? chunk : concat(buffer, chunk);
  const lines: Uint8Array[] = [];
  let start = 0;
  for (
    let index = bytes.indexOf(NEWLINE, start);
    index !== -1;
    index = bytes.indexOf(NEWLINE, start)
  ) {
    lines.push(bytes.subarray(start, index));
    start = index + 1;
  }
  return { lines, rest: start === 0 ? bytes : bytes.slice(start) };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

/** Bounded redacted tail of a child's stderr; see `captureStderr`. */
export interface StderrTail {
  /** Redacted and byte-capped, `""` when the child wrote nothing. */
  tail: () => string;
}

/**
 * Drain a child's stderr into a ring of the last `STDERR_MAX_BYTES`, so a
 * chatty agent can never block on a full pipe *and* the tail is still
 * available to explain a failure. Values are redacted on the way in, which
 * means the ring itself never holds a secret.
 */
export function captureStderr(source: Readable): StderrTail {
  const lines: string[] = [];
  let buffered = 0;
  let partial = "";
  const push = (line: string): void => {
    const secretFree = redactSecrets(line);
    lines.push(secretFree);
    buffered += secretFree.length + 1;
    while (buffered > STDERR_MAX_BYTES && lines.length > 1) {
      const [oldest] = lines.splice(0, 1);
      buffered -= (oldest?.length ?? 0) + 1;
    }
  };
  source.on("data", (chunk: Buffer) => {
    partial += chunk.toString();
    const parts = partial.split("\n");
    partial = parts.pop() ?? "";
    for (const part of parts) {
      push(part);
    }
  });
  source.on("end", () => {
    if (partial.length > 0) {
      push(partial);
      partial = "";
    }
  });
  return {
    tail: (): string => lines.join("\n").slice(-STDERR_DETAIL_LIMIT),
  };
}

const SECRET_ASSIGNMENT_RE =
  /([A-Za-z0-9_]*(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|authorization|client[_-]?secret|password|secret|token)[A-Za-z0-9_]*)(\s*[:=]\s*)(["']?)[^"'\s,;]*/gi;
const BEARER_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

/**
 * Mask the value of anything that looks like a credential in agent output.
 * Bearer tokens first: an `Authorization: Bearer …` line would otherwise be
 * cut at the word `Bearer` and leave the token itself on screen.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(BEARER_RE, "$1***")
    .replace(SECRET_ASSIGNMENT_RE, "$1$2$3***");
}

/**
 * A failure detail that carries the child's own last words: the message plus
 * a redacted stderr tail when there is one.
 */
export function failureDetail(
  message: string,
  stderr: StderrTail | string | null
): string {
  const tail = typeof stderr === "string" ? stderr : (stderr?.tail() ?? "");
  return tail.length > 0 ? `${message} | stderr: ${tail}` : message;
}

export interface TimeoutOptions<T> {
  /** Budget in ms; `0` or less disables the bound (used by tests). */
  ms: number;
  /** Build the rejection once the budget is spent. */
  onTimeout: () => Error;
  work: Promise<T>;
}

/**
 * Race a promise against a budget. The budget is cleared as soon as the work
 * settles, so a healthy handshake leaves no timer behind.
 */
export function withTimeout<T>({
  ms,
  onTimeout,
  work,
}: TimeoutOptions<T>): Promise<T> {
  if (ms <= 0) {
    return work;
  }
  const { promise, reject, resolve } = Promise.withResolvers<T>();
  const timer = setTimeout(() => {
    reject(onTimeout());
  }, ms);
  work.then(resolve, reject);
  return promise.finally(() => {
    clearTimeout(timer);
  });
}
