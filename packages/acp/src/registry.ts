/**
 * Agent registry — single source of truth for every ACP-speaking CLI that
 * manobu can route to.
 *
 * Adding a new agent is pure config: append an `AgentSpec` below. The router
 * (`packages/acp/src/index.ts`) and the picker UI both read from here. No
 * surgery at the call site.
 *
 * The shape mirrors the static portion of `aioncore`'s `AgentSpec` — see
 * `research/agent-stack-gaps-vs-aionui.md` for the diff and what's planned
 * to grow over Tier 1 → Tier 3.
 */

/** How the bridge reaches the agent child. */
export type AgentTransport = "acp" | "direct-cli";

/**
 * Capabilities negotiated at ACP `initialize`. Static defaults — Tier 1.3
 * will refresh these from the runtime response (some agents over-advertise).
 */
export interface AgentCapabilities {
  mcpHttp: boolean;
  mcpSse: boolean;
  mcpStdio: boolean;
  streaming: boolean;
}

/**
 * Spawn-time defaults applied to every session unless the call site
 * overrides them. Tier 1.2 (`applyLaunchPolicy`) composes these with
 * per-call overrides.
 */
export interface AgentLaunchPolicy {
  /** Forward user-configured MCP servers on `initialize`. */
  forwardMcp: boolean;
  /** Pass args that keep the agent non-interactive (no TTY prompt). */
  nonInteractive: boolean;
  /**
   * Whether the binary expects `acp` as a subcommand (most ACP-speaking
   * CLIs do, e.g. `opencode acp`, `claude acp`). When `false`, the binary
   * is spawned bare.
   */
  requiresAcpSubcommand: boolean;
}

/**
 * Static description of one agent CLI. `id` is the public handle used by
 * the config / UI; `command` is what's resolved against `$PATH` and spawned.
 * They may differ (e.g. `id: 'claude-code'`, `command: 'claude'`).
 */
export interface AgentSpec {
  capabilities: AgentCapabilities;
  command: string;
  displayName: string;
  id: string;
  launchPolicy: AgentLaunchPolicy;
  transport: AgentTransport;
}

const AGENT_REGISTRY: readonly AgentSpec[] = [
  {
    capabilities: {
      mcpHttp: true,
      mcpSse: false,
      mcpStdio: true,
      streaming: true,
    },
    command: "opencode",
    displayName: "OpenCode (sst/opencode)",
    id: "opencode",
    launchPolicy: {
      forwardMcp: true,
      nonInteractive: true,
      requiresAcpSubcommand: true,
    },
    transport: "acp",
  },
  {
    capabilities: {
      mcpHttp: true,
      mcpSse: false,
      mcpStdio: true,
      streaming: true,
    },
    command: "claude",
    displayName: "Anthropic Claude Code",
    id: "claude-code",
    launchPolicy: {
      forwardMcp: true,
      nonInteractive: true,
      requiresAcpSubcommand: true,
    },
    transport: "acp",
  },
  {
    capabilities: {
      mcpHttp: false,
      mcpSse: false,
      mcpStdio: true,
      streaming: true,
    },
    command: "gemini",
    displayName: "Google Gemini CLI",
    id: "gemini-cli",
    launchPolicy: {
      forwardMcp: true,
      nonInteractive: true,
      requiresAcpSubcommand: true,
    },
    transport: "acp",
  },
  {
    capabilities: {
      mcpHttp: false,
      mcpSse: false,
      mcpStdio: true,
      streaming: true,
    },
    command: "codex",
    displayName: "OpenAI Codex CLI",
    id: "codex-cli",
    launchPolicy: {
      forwardMcp: true,
      nonInteractive: true,
      requiresAcpSubcommand: true,
    },
    transport: "acp",
  },
  {
    capabilities: {
      mcpHttp: false,
      mcpSse: false,
      mcpStdio: false,
      streaming: true,
    },
    command: "copilot",
    displayName: "GitHub Copilot CLI",
    id: "gh-copilot",
    launchPolicy: {
      forwardMcp: false,
      nonInteractive: true,
      requiresAcpSubcommand: true,
    },
    transport: "acp",
  },
  {
    capabilities: {
      // KiloCode (kilocode.ai) — `kilo acp` starts an ACP (Agent Client
      // Protocol) server. Capabilities are conservative static defaults;
      // Tier 1.3 runtime probing refreshes these from the initialize
      // response when MCP servers are configured.
      mcpHttp: true,
      mcpSse: false,
      mcpStdio: true,
      streaming: true,
    },
    command: "kilo",
    displayName: "KiloCode",
    id: "kilo-code",
    launchPolicy: {
      forwardMcp: true,
      nonInteractive: true,
      requiresAcpSubcommand: true,
    },
    transport: "acp",
  },
  {
    capabilities: {
      // Google Antigravity (antigravity.google) — `agy` has NO ACP server
      // mode (verified: subcommands are changelog/help/install/models/
      // plugin/plugins/update only). It ships a proprietary `agentapi`
      // sidecar protocol instead, so it rides the direct-cli route (Tier
      // 2.1): single-shot `agy --print "<prompt>"`. No MCP hosting.
      mcpHttp: false,
      mcpSse: false,
      mcpStdio: false,
      streaming: true,
    },
    command: "agy",
    displayName: "Google Antigravity",
    id: "antigravity",
    launchPolicy: {
      forwardMcp: false,
      nonInteractive: true,
      requiresAcpSubcommand: false,
    },
    transport: "direct-cli",
  },
];

/**
 * Resolve a handle to an `AgentSpec` by `id` or `command`. Returns `null`
 * if neither matches — callers should treat as "unknown agent" and either
 * fall back to a default or surface the error.
 *
 * Match is exact, case-sensitive. Future: version-pinned lookups (e.g.
 * `claude-code@^1`).
 */
export function findAgent(idOrCommand: string): AgentSpec | null {
  for (const spec of AGENT_REGISTRY) {
    if (spec.id === idOrCommand || spec.command === idOrCommand) {
      return spec;
    }
  }
  return null;
}

/** Iterate the registry in declaration order. Read-only — never mutate. */
export function listAgents(): readonly AgentSpec[] {
  return AGENT_REGISTRY;
}

/**
 * Default agent used when the caller does not pick one explicitly.
 * Override via `ACP_AGENT_BIN` env or `getAcpModel('some-id')`.
 */
export const DEFAULT_AGENT_ID = "opencode";
