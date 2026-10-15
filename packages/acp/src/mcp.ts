/**
 * MCP capability negotiation — the TypeScript analogue of the MCP snapshot /
 * capability-filter step the research note calls out as Tier 1.3
 * (`research/agent-stack-gaps-vs-aionui.md`).
 *
 * The rule that matters for the Japanese-teacher agent: a stdio MCP server
 * (e.g. a JLPT vocab lookup) only works if the agent can host that transport.
 * Before attaching user-configured MCP servers to `session/new` we check what
 * the agent advertised at `initialize` and **warn-skip on mismatch rather than
 * fail the session**.
 *
 * ## Where capabilities come from
 *
 * The native engine reads `mcpCapabilities` directly from the ACP
 * `initialize` response it owns: `session.ts` passes
 * `agentCapabilities.mcpCapabilities` through
 * {@link capabilitiesFromRuntime}, and falls back to the registry's static
 * per-agent defaults ({@link capabilitiesFromRegistry}) when the agent
 * advertises nothing. The research note acknowledges those defaults can
 * drift (the runtime read catches e.g. opencode advertising `sse` where
 * the registry default said `false`), so the runtime read is attempted
 * first. The provider-era one-shot capability probe (spawned a second agent
 * to read `initialize`) was deleted with the AI-SDK bridge in TASK-80.6.
 *
 * ## stdio is the protocol baseline
 *
 * ACP's `McpCapabilities` only carries `http` and `sse` — the SDK type has no
 * `stdio` field, and opencode's real initialize response confirms it (`{ http:
 * true, sse: true }`). A stdio ACP server is by construction capable of
 * spawning stdio MCP servers, so the normalized view always sets
 * `stdio: true`.
 */

import type {
  EnvVariable,
  McpCapabilities,
  McpServer,
} from "@agentclientprotocol/sdk";

import type { AgentCapabilities } from "./registry";

/** Splits a stdio target (command + args) on whitespace. */
const WHITESPACE = /\s+/;

/** Separates the optional env suffix from the rest of a literal entry. */
const ENV_SUFFIX = "|";

/** Separates two `KEY=VALUE` pairs inside the env suffix. */
const ENV_PAIR = ";";

/** Shell-legal variable name. */
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A value can't carry `|` or `;` (the delimiters this literal form splits on)
 * or a control character, which would let one value forge a second entry.
 * Mirrors `is_illegal_env_value` in `apps/desktop/src-tauri/src/mcp.rs`.
 */
function isIllegalEnvValue(value: string): boolean {
  if (value.includes(ENV_SUFFIX) || value.includes(ENV_PAIR)) {
    return true;
  }
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** MCP transport a requested server wants to talk over. */
export type McpTransport = "stdio" | "http" | "sse";

/**
 * One user-configured MCP server. `target` is a shell command for `stdio`
 * (args separated by spaces) or a URL for `http` / `sse`.
 *
 * `env` (TASK-96) is extra environment for **this server's stdio child only**
 * — e.g. `JLPT_MCP_DEBUG` for the debug-tool gate in `crates/jlpt-mcp`. ACP
 * carries it on `McpServerStdio.env`, so `http` / `sse` servers have nowhere
 * to put it and their map is warn-skipped in {@link toMcpServer}.
 */
export interface RequestedMcpServer {
  env?: Record<string, string>;
  id: string;
  target: string;
  transport: McpTransport;
}

/** Normalized transport support used by negotiation (stdio/http/sse). */
export interface McpCapabilityView {
  http: boolean;
  sse: boolean;
  stdio: boolean;
}

/** A requested server the agent can't host. */
export interface SkippedMcpServer {
  reason: string;
  server: RequestedMcpServer;
}

export interface McpNegotiationResult {
  /** Servers the agent can host — map with {@link toMcpServer} and pass to `session/new`. */
  attached: RequestedMcpServer[];
  /** Servers the agent can't host — log the reason and continue. */
  skipped: SkippedMcpServer[];
}

/**
 * Normalize the ACP `initialize` `mcpCapabilities` into a view. Returns `null`
 * when the agent didn't advertise them, so callers can fall back to registry
 * defaults. `stdio` is always `true` (protocol baseline — see module doc).
 */
export function capabilitiesFromRuntime(
  cap: McpCapabilities | null | undefined
): McpCapabilityView | null {
  if (!cap) {
    return null;
  }
  return {
    http: cap.http ?? false,
    sse: cap.sse ?? false,
    stdio: true,
  };
}

/** Build a view from the registry's static per-agent defaults. */
export function capabilitiesFromRegistry(
  cap: AgentCapabilities
): McpCapabilityView {
  return {
    http: cap.mcpHttp,
    sse: cap.mcpSse,
    stdio: cap.mcpStdio,
  };
}

/**
 * Filter requested MCP servers against the agent's capability view. Servers
 * whose transport the agent doesn't advertise land in `skipped` (with the
 * reason) instead of failing the whole session.
 */
export function negotiateMcpServers(
  requested: readonly RequestedMcpServer[],
  caps: McpCapabilityView
): McpNegotiationResult {
  const attached: RequestedMcpServer[] = [];
  const skipped: SkippedMcpServer[] = [];
  for (const server of requested) {
    // Malformed entries are warn-skipped here too, not just in the env
    // parser — callers that pass `RequestedMcpServer[]` directly (bypassing
    // `parseMcpServers`) can't hard-fail the session through `toMcpServer`.
    if (server.transport === "stdio" && !server.target.trim()) {
      skipped.push({
        reason: "stdio server has an empty command",
        server,
      });
      continue;
    }
    if (caps[server.transport]) {
      attached.push(server);
    } else {
      skipped.push({
        reason: `agent does not advertise ${server.transport} MCP support`,
        server,
      });
    }
  }
  return { attached, skipped };
}

/**
 * Split a stdio target into `command` + `args`.
 *
 * Whitespace separates the arguments, except when the target opens with `"`:
 * then everything up to the closing quote is the command and the remainder is
 * the argument list. The quotes are the caller's to add, and
 * `apps/desktop/src-tauri/src/mcp.rs` adds them whenever a target contains
 * whitespace (TASK-177). Without that rule the packaged Windows path,
 * `C:\Program Files\manobu\jlpt-mcp-….exe`, was read as the command
 * `C:\Program` and the session silently lost the vocab tools. A POSIX target
 * with a space in it is fixed by the same rule.
 */
export function splitStdioTarget(target: string): {
  args: string[];
  command: string;
} {
  const trimmed = target.trim();
  if (trimmed.startsWith('"')) {
    const closing = trimmed.indexOf('"', 1);
    if (closing === -1) {
      throw new Error(`MCP stdio target has an unclosed quote: "${target}"`);
    }
    const command = trimmed.slice(1, closing);
    if (command.length === 0) {
      throw new Error(`MCP stdio target has an empty command: "${target}"`);
    }
    return {
      args: trimmed
        .slice(closing + 1)
        .split(WHITESPACE)
        .filter((arg) => arg.length > 0),
      command,
    };
  }
  const [command = "", ...args] = trimmed.split(WHITESPACE);
  return { args, command };
}

/**
 * Convert a negotiated server into the ACP `McpServer` config passed in
 * `session/new`. `stdio` targets are split into command + args by
 * {@link splitStdioTarget} (whitespace, with a quoted command allowed) and
 * carry their {@link RequestedMcpServer.env} as name-sorted pairs;
 * `http` / `sse` targets are used verbatim as the URL.
 */
export function toMcpServer(server: RequestedMcpServer): McpServer {
  if (server.transport === "stdio") {
    const { args, command } = splitStdioTarget(server.target);
    if (!command) {
      throw new Error(`MCP server "${server.id}" has an empty stdio command`);
    }
    return {
      args,
      command,
      env: envVariables(server.env),
      name: server.id,
    };
  }
  if (server.env) {
    console.warn(
      `[acp] MCP server "${server.id}" declares env over ${server.transport}, which has no env on the ACP wire type — ignored`
    );
  }
  return {
    headers: [],
    name: server.id,
    type: server.transport,
    url: server.target,
  };
}

/**
 * ACP models stdio env as a list, not a map. Sorted so the `session/new`
 * payload is stable across restarts (and comparable in tests).
 */
function envVariables(env: Record<string, string> | undefined): EnvVariable[] {
  if (!env) {
    return [];
  }
  return Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({ name, value }));
}

function isMcpTransport(value: string): value is McpTransport {
  return value === "stdio" || value === "http" || value === "sse";
}

/**
 * Parse `ACP_MCP_SERVERS` — comma-separated `<id>:<transport>:<target>`
 * entries, e.g.
 *
 * ```text
 * jlpt-vocab:stdio:npx jlpt-mcp@latest,notes:http:http://localhost:3001/mcp
 * ```
 *
 * Each entry may carry a per-server env suffix (TASK-96) after a `|`:
 *
 * ```text
 * jlpt-vocab:stdio:/usr/local/bin/jlpt-mcp|JLPT_MCP_DEBUG=1;LANG=ja_JP.UTF-8
 * ```
 *
 * A stdio target is `command [args…]`, split on whitespace, except when it
 * opens with `"`: then the quoted token is the command and the rest are the
 * arguments (TASK-177, because `C:\Program Files\…` is one path). The desktop
 * shell quotes such a target when it renders the literal.
 *
 * `|` is reserved because `:` and `,` are already taken by the transport and
 * the target (a URL or a whitespace-separated command can contain either).
 * Malformed entries are warn-skipped (never thrown), so one bad line can't
 * take the session down; a malformed **pair** only loses that pair.
 */
export function parseMcpServers(
  raw: string | null | undefined
): RequestedMcpServer[] {
  if (!raw) {
    return [];
  }
  const out: RequestedMcpServer[] = [];
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (!entry) {
      continue;
    }
    const { id, suffix, target, transport } = splitMcpEntry(entry);
    if (!(id && isMcpTransport(transport) && target)) {
      console.warn(
        `[acp] ignoring malformed ACP_MCP_SERVERS entry: "${entry}"`
      );
      continue;
    }
    const env = parseEnvSuffix(suffix ?? "", id);
    out.push(env ? { env, id, target, transport } : { id, target, transport });
  }
  return out;
}

/**
 * Split one literal entry into `id` / `transport` / `target` plus the optional
 * `KEY=VAL;KEY2=VAL2` env tail (TASK-96). Only the first two colons split the
 * spec, so a URL target keeps the colons in its own scheme; `suffix` is absent
 * when the entry carries no `|`, so an env-less entry reads as it did before.
 */
function splitMcpEntry(entry: string): {
  id: string;
  suffix?: string;
  target: string;
  transport: string;
} {
  const at = entry.indexOf(ENV_SUFFIX);
  const spec = at === -1 ? entry : entry.slice(0, at);
  const firstColon = spec.indexOf(":");
  const secondColon = spec.indexOf(":", firstColon + 1);
  return {
    id: spec.slice(0, firstColon).trim(),
    suffix: at === -1 ? undefined : entry.slice(at + ENV_SUFFIX.length),
    target: secondColon === -1 ? "" : spec.slice(secondColon + 1).trim(),
    transport: spec.slice(firstColon + 1, secondColon),
  };
}

/**
 * Parse one entry's `KEY=VALUE;KEY2=VALUE2` suffix. Returns `undefined` when
 * nothing legal survived, so the server keeps no empty env property.
 */
function parseEnvSuffix(
  suffix: string,
  serverId: string
): Record<string, string> | undefined {
  if (!suffix.trim()) {
    return undefined;
  }
  const env: Record<string, string> = {};
  for (const rawPair of suffix.split(ENV_PAIR)) {
    const pair = rawPair.trim();
    if (!pair) {
      continue;
    }
    const assignAt = pair.indexOf("=");
    const key = assignAt === -1 ? "" : pair.slice(0, assignAt);
    const value = assignAt === -1 ? "" : pair.slice(assignAt + 1);
    if (!(ENV_KEY.test(key) && !isIllegalEnvValue(value))) {
      console.warn(
        `[acp] ignoring malformed env pair "${pair}" on MCP server "${serverId}"`
      );
      continue;
    }
    env[key] = value;
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

// --- MCP catalog (TASK-22 Tier C) -----------------------------------------
//
// The AionUi `IMcpServer[]` analogue: one config file is the single source
// of truth, replacing the env literal as the primary declaration point.
// Shape (app_data_dir/config/mcp-servers.json):
//
//   { "version": 1, "servers": [{
//       "id": "jlpt-vocab", "transport": "stdio",
//       "target": "/path/to/jlpt-mcp", "enabled": true,
//       "env": { "JLPT_MCP_DEBUG": "1" } }] }
//
// `env` is optional (TASK-96). The file is read by the Tauri shell, which
// folds enabled entries into the `ACP_MCP_SERVERS` literal the sidecar parses
// — so the suffix grammar in {@link parseMcpServers} has to carry `env` across
// that round-trip (`apps/desktop/src-tauri/src/mcp.rs`).
//
// Precedence: the env literal still wins when set (existing users, tests,
// smoke scripts override without touching the file); the file is the
// default path once present.

export interface McpCatalogServer extends RequestedMcpServer {
  enabled: boolean;
}

export interface McpCatalog {
  servers: McpCatalogServer[];
  version: number;
}

export function isMcpCatalog(value: unknown): value is McpCatalog {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { servers?: unknown; version?: unknown };
  if (candidate.version !== 1 || !Array.isArray(candidate.servers)) {
    return false;
  }
  return candidate.servers.every((server) => {
    if (typeof server !== "object" || server === null) {
      return false;
    }
    const s = server as Record<string, unknown>;
    return (
      typeof s.id === "string" &&
      typeof s.target === "string" &&
      typeof s.transport === "string" &&
      isMcpTransport(s.transport) &&
      typeof s.enabled === "boolean" &&
      isOptionalEnvMap(s.env)
    );
  });
}

/**
 * A catalog entry's optional `env` (TASK-96) has to be a plain map of legal
 * names to legal strings. A bad one invalidates the whole file, the same
 * all-or-nothing rule the rest of {@link isMcpCatalog} applies — the warning
 * in {@link parseMcpCatalog} names the file, not the entry.
 */
function isOptionalEnvMap(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([key, entry]) =>
      ENV_KEY.test(key) &&
      typeof entry === "string" &&
      !isIllegalEnvValue(entry)
  );
}

/**
 * Parse the catalog JSON text. Invalid JSON or shape resolves to an empty
 * catalog with a warning — a corrupt config can't take sessions down
 * (same never-throw rule as `parseMcpServers`).
 */
export function parseMcpCatalog(text: string | null | undefined): McpCatalog {
  if (!text?.trim()) {
    return { servers: [], version: 1 };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isMcpCatalog(parsed)) {
      console.warn("[acp] mcp-servers.json has an invalid shape — ignoring");
      return { servers: [], version: 1 };
    }
    return parsed;
  } catch (error) {
    console.warn(`[acp] mcp-servers.json parse failed: ${String(error)}`);
    return { servers: [], version: 1 };
  }
}

/**
 * Resolve the effective MCP server list: catalog file (enabled entries
 * only) when it parses and declares at least one server, else the env
 * literal. Catalog entries that are disabled are dropped silently.
 */
export function resolveMcpServers(
  catalog: McpCatalog,
  envLiteral: string | null | undefined
): RequestedMcpServer[] {
  const enabled = catalog.servers.filter((s) => s.enabled);
  if (enabled.length > 0) {
    return enabled.map(({ enabled: _enabled, ...rest }) => rest);
  }
  return parseMcpServers(envLiteral);
}
