/**
 * Launch-policy module — the TypeScript analogue of `aioncore`'s
 * `factory/acp_launch_policy.rs` (see `research/agent-stack-gaps-vs-aionui.md`,
 * Tier 1.2).
 *
 * Takes a resolved `AgentSpec` plus per-call overrides and produces the
 * concrete `CommandSpec` used to spawn the agent. The bridge call site
 * (`getAcpModel`) stops deciding anything about *how* an agent launches — it
 * just consumes the spec.
 *
 * ## What stays out of argv (and why)
 *
 * `opencode acp --help` accepts only server flags (`--port`, `--cwd`, ...).
 * `--print`, `--resume` / `-s`, and `--model` / `-m` belong to the *run /
 * session* CLI path, NOT the ACP stdio server. Passing them to ACP mode makes
 * the agent exit with "unknown option" before the first message.
 *
 * So for `transport: 'acp'` this module:
 * - only adds the `acp` subcommand when `requiresAcpSubcommand` says so, and
 * - carries `resume` / `model` / `mode` as *data* on `CommandSpec`. The bridge
 *   applies them via the ACP protocol (`existingSessionId` → `session/new`,
 *   `session/update` for model/mode), never as argv.
 *
 * `nonInteractive` is likewise policy intent, not argv here: stdio JSON-RPC is
 * inherently non-TTY. The direct-CLI adapter (Tier 2.1) will consume it as
 * `--print` for single-shot `opencode run` invocations.
 */

import type { RequestedMcpServer } from "./mcp";
import type { AgentSpec } from "./registry";

/** Per-call overrides layered on top of the registry's `AgentLaunchPolicy`. */
export interface LaunchPolicyInput {
  /** Resolved registry entry for the agent being launched. */
  agent: AgentSpec;
  /** Working directory for the agent child. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * User-configured MCP servers to attach. Tier 1.3 (`mcp.ts`) filters these
   * against the agent's advertised capabilities (warn-skip on mismatch) and
   * converts the survivors into ACP `McpServer` configs for `session/new`.
   */
  mcpServers?: RequestedMcpServer[];
  /**
   * Free-form session mode (e.g. `"plan"`, `"yolo"`). Carried as data for
   * the catalog / picker surface; consumed once direct-CLI lands.
   */
  mode?: string;
  /**
   * Model override (e.g. `"anthropic/claude-sonnet-4-5"`). Carried as data;
   * ACP mode applies it via `session/update`.
   */
  model?: string;
  /**
   * Resume anchor — an existing ACP `sessionId` (or CLI session id for
   * direct-CLI routes). Threaded to the bridge, not argv.
   */
  resume?: string;
}

/**
 * Concrete spawn command derived from a launch policy + overrides. `args` is
 * argv for the child process; `resume` / `model` / `mode` are carried for the
 * bridge to apply via the ACP protocol.
 */
export interface CommandSpec {
  /** argv for the child process (ACP-safe; see module doc). */
  args: string[];
  /** Binary resolved against `$PATH`. */
  command: string;
  /** Working directory for the child. */
  cwd: string;
  /** Whether MCP servers may be attached (registry `forwardMcp`). */
  forwardMcp: boolean;
  /** MCP servers to attach on `initialize` (empty when `forwardMcp` is false). */
  mcpServers: RequestedMcpServer[];
  /** Session mode, if requested. */
  mode?: string;
  /** Model override, if requested. */
  model?: string;
  /** Session resume anchor, if requested. */
  resume?: string;
}

/**
 * Compose registry policy + per-call overrides into a `CommandSpec`.
 *
 * Defaults are deliberately inert: calling with just `{ agent }` reproduces
 * today's behavior exactly (`args: ["acp"]`, no MCP servers) — the module is
 * the same code path, extracted.
 */
export function applyLaunchPolicy(input: LaunchPolicyInput): CommandSpec {
  const {
    agent,
    cwd = process.cwd(),
    mcpServers = [],
    mode,
    model,
    resume,
  } = input;

  const args: string[] = [];
  if (agent.launchPolicy.requiresAcpSubcommand) {
    args.push("acp");
  }

  return {
    args,
    command: agent.command,
    cwd,
    forwardMcp: agent.launchPolicy.forwardMcp,
    mcpServers: agent.launchPolicy.forwardMcp ? mcpServers : [],
    mode,
    model,
    resume,
  };
}
